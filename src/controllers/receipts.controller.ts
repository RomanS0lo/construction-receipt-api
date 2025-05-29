import { RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { ReceiptStatus } from '@prisma/client';
import { 
  processReceiptImage, 
  cleanupUploadedFiles,
  batchProcessReceipts 
} from '../services/upload.service';
import { 
  S3_BUCKET_NAME, 
  getSignedUrl, 
  deleteFile, 
  deleteFiles 
} from '../config/s3.config';

// Extend Express Request type for Multer
interface MulterS3File extends Express.Multer.File {
  key: string;
  location: string;
  bucket: string;
  contentType: string;
}

// Validation schemas
const createReceiptSchema = z.object({
  amount: z.string().transform(Number).pipe(z.number().positive()),
  tax: z.string().transform(Number).pipe(z.number().min(0)).optional(),
  vendorName: z.string().optional(),
  receiptDate: z.string().datetime(),
  description: z.string().optional(),
  jobId: z.string().optional()
});

const updateReceiptSchema = z.object({
  amount: z.number().positive().optional(),
  tax: z.number().min(0).optional(),
  vendorName: z.string().optional(),
  receiptDate: z.string().datetime().optional(),
  description: z.string().optional(),
  jobId: z.string().nullable().optional(),
  status: z.nativeEnum(ReceiptStatus).optional()
});

const querySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  search: z.string().optional(),
  status: z.nativeEnum(ReceiptStatus).optional(),
  jobId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  sortBy: z.enum(['createdAt', 'receiptDate', 'amount', 'vendorName']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

// Create receipt without file upload (JSON only)
export const createReceipt: RequestHandler = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Parse and validate request body
    const validatedData = {
      imageUrl: req.body.imageUrl || '',
      amount: Number(req.body.amount),
      totalAmount: Number(req.body.totalAmount || req.body.amount),
      vendorName: req.body.vendorName,
      receiptDate: req.body.receiptDate,
      description: req.body.description,
      jobId: req.body.jobId
    };

    // Verify job belongs to company if jobId provided
    if (validatedData.jobId) {
      const job = await prisma.job.findFirst({
        where: {
          id: validatedData.jobId,
          companyId: req.user.companyId
        }
      });

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
    }

    // Create receipt record
    const receipt = await prisma.receipt.create({
      data: {
        imageUrl: validatedData.imageUrl,
        amount: validatedData.amount,
        totalAmount: validatedData.totalAmount,
        vendorName: validatedData.vendorName,
        receiptDate: new Date(validatedData.receiptDate),
        description: validatedData.description,
        companyId: req.user.companyId,
        userId: req.user.userId,
        jobId: validatedData.jobId,
        status: 'PENDING'
      },
      include: {
        job: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    res.status(201).json({
      data: receipt,
      message: 'Receipt created successfully'
    });
  } catch (error) {
    console.error('Create receipt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Upload single receipt
export const uploadReceipt: RequestHandler = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const file = req.file as MulterS3File;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const validatedData = createReceiptSchema.parse(req.body);

    // Calculate total amount
    const totalAmount = validatedData.amount + (validatedData.tax || 0);

    // Process the uploaded image to create thumbnail
    let processedImage;
    try {
      processedImage = await processReceiptImage(file.key, file.contentType);
    } catch (error) {
      // Clean up the uploaded file if processing fails
      await deleteFile(file.key);
      throw error;
    }

    // Verify job belongs to company if jobId provided
    if (validatedData.jobId) {
      const job = await prisma.job.findFirst({
        where: {
          id: validatedData.jobId,
          companyId: req.user.companyId
        }
      });

      if (!job) {
        await cleanupUploadedFiles([file.key]);
        res.status(404).json({ error: 'Job not found' });
        return;
      }
    }

    // Create receipt record
    const receipt = await prisma.receipt.create({
      data: {
        imageUrl: file.key,
        thumbnailUrl: processedImage.thumbnailKey,
        amount: validatedData.amount,
        tax: validatedData.tax,
        totalAmount,
        vendorName: validatedData.vendorName,
        receiptDate: new Date(validatedData.receiptDate),
        description: validatedData.description,
        companyId: req.user.companyId,
        userId: req.user.userId,
        jobId: validatedData.jobId,
        metadata: {
          originalFilename: file.originalname,
          fileSize: file.size,
          mimeType: file.contentType,
          imageMetadata: processedImage.originalMetadata
        }
      }
    });

    // Generate signed URLs for immediate access
    const signedImageUrl = getSignedUrl(receipt.imageUrl);
    const signedThumbnailUrl = getSignedUrl(receipt.thumbnailUrl!);

    res.status(201).json({
      data: {
        ...receipt,
        imageUrl: signedImageUrl,
        thumbnailUrl: signedThumbnailUrl
      },
      message: 'Receipt uploaded successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Upload receipt error:', error);
    res.status(500).json({ error: 'Failed to upload receipt' });
  }
};

// Upload multiple receipts
export const uploadMultipleReceipts: RequestHandler = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const files = req.files as MulterS3File[];
    
    // Process all images in parallel
    const processedImages = await batchProcessReceipts(
      files.map(file => ({ key: file.key, contentType: file.contentType }))
    );

    // Create receipt records
    const receipts = await Promise.all(
      files.map(async (file, index) => {
        const processed = processedImages[index];
        if (!processed) {
          return null;
        }

        return prisma.receipt.create({
          data: {
            imageUrl: file.key,
            thumbnailUrl: processed.thumbnailKey,
            amount: 0, // To be updated later
            totalAmount: 0, // To be updated later
            receiptDate: new Date(),
            companyId: req.user!.companyId,
            userId: req.user!.userId,
            metadata: {
              originalFilename: file.originalname,
              fileSize: file.size,
              mimeType: file.contentType,
              imageMetadata: processed.originalMetadata
            }
          }
        });
      })
    );

    const successfulReceipts = receipts.filter(r => r !== null);

    res.status(201).json({
      data: successfulReceipts,
      message: `${successfulReceipts.length} receipts uploaded successfully`
    });
  } catch (error) {
    console.error('Upload multiple receipts error:', error);
    res.status(500).json({ error: 'Failed to upload receipts' });
  }
};

// Get all receipts with filters
export const getReceipts: RequestHandler<{}, any, {}, z.infer<typeof querySchema>> = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const query = querySchema.parse(req.query);
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      companyId: req.user.companyId
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.jobId) {
      where.jobId = query.jobId;
    }

    if (query.search) {
      where.OR = [
        { vendorName: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    if (query.startDate || query.endDate) {
      where.receiptDate = {};
      if (query.startDate) {
        where.receiptDate.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.receiptDate.lte = new Date(query.endDate);
      }
    }

    // Get total count
    const total = await prisma.receipt.count({ where });

    // Get receipts
    const receipts = await prisma.receipt.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        job: {
          select: {
            id: true,
            name: true,
            clientName: true
          }
        }
      },
      orderBy: {
        [query.sortBy || 'createdAt']: query.sortOrder || 'desc'
      },
      skip,
      take: limit
    });

    // Generate signed URLs for receipts
    const receiptsWithUrls = receipts.map(receipt => ({
      ...receipt,
      imageUrl: getSignedUrl(receipt.imageUrl),
      thumbnailUrl: receipt.thumbnailUrl ? getSignedUrl(receipt.thumbnailUrl) : null
    }));

    res.json({
      data: receiptsWithUrls,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid query parameters', details: error.errors });
      return;
    }
    console.error('Get receipts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get single receipt
export const getReceipt: RequestHandler<{ id: string }> = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const receipt = await prisma.receipt.findFirst({
      where: {
        id,
        companyId: req.user.companyId
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        job: {
          select: {
            id: true,
            name: true,
            clientName: true,
            address: true
          }
        }
      }
    });

    if (!receipt) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }

    // Generate signed URLs
    const receiptWithUrls = {
      ...receipt,
      imageUrl: getSignedUrl(receipt.imageUrl),
      thumbnailUrl: receipt.thumbnailUrl ? getSignedUrl(receipt.thumbnailUrl) : null
    };

    res.json({ data: receiptWithUrls });
  } catch (error) {
    console.error('Get receipt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update receipt
export const updateReceipt: RequestHandler<{ id: string }, any, z.infer<typeof updateReceiptSchema>> = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const validatedData = updateReceiptSchema.parse(req.body);

    // Find existing receipt
    const existingReceipt = await prisma.receipt.findFirst({
      where: {
        id,
        companyId: req.user.companyId
      }
    });

    if (!existingReceipt) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }

    // Only ADMIN and MANAGER can approve/reject receipts
    if (validatedData.status && 
        ['APPROVED', 'REJECTED'].includes(validatedData.status) && 
        req.user.role === 'CREW_MEMBER') {
      res.status(403).json({ error: 'Insufficient permissions to change receipt status' });
      return;
    }

    // Verify new job belongs to company if jobId is being updated
    if (validatedData.jobId !== undefined && validatedData.jobId !== null) {
      const job = await prisma.job.findFirst({
        where: {
          id: validatedData.jobId,
          companyId: req.user.companyId
        }
      });

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
    }

    // Calculate new total if amount or tax changed
    let totalAmount = existingReceipt.totalAmount;
    if (validatedData.amount !== undefined || validatedData.tax !== undefined) {
      const amount = validatedData.amount ?? existingReceipt.amount;
      const tax = validatedData.tax ?? existingReceipt.tax ?? 0;
      totalAmount = amount + tax;
    }

    // Update receipt
    const updatedReceipt = await prisma.receipt.update({
      where: { id },
      data: {
        ...validatedData,
        totalAmount,
        receiptDate: validatedData.receiptDate ? new Date(validatedData.receiptDate) : undefined,
        approvedAt: validatedData.status === 'APPROVED' ? new Date() : undefined,
        rejectionReason: validatedData.status === 'REJECTED' ? 'Rejected by user' : undefined
      }
    });

    res.json({
      data: updatedReceipt,
      message: 'Receipt updated successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Update receipt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete receipt
export const deleteReceipt: RequestHandler<{ id: string }> = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Only ADMIN can delete receipts
    if (req.user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    const { id } = req.params;

    // Find receipt
    const receipt = await prisma.receipt.findFirst({
      where: {
        id,
        companyId: req.user.companyId
      }
    });

    if (!receipt) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }

    // Delete from database
    await prisma.receipt.delete({
      where: { id }
    });

    // Delete files from S3
    const filesToDelete = [receipt.imageUrl];
    if (receipt.thumbnailUrl) {
      filesToDelete.push(receipt.thumbnailUrl);
    }
    
    await deleteFiles(filesToDelete);

    res.json({
      message: 'Receipt deleted successfully'
    });
  } catch (error) {
    console.error('Delete receipt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get receipt statistics
export const getReceiptStatistics: RequestHandler = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const [
      totalStats,
      monthlyStats,
      statusCounts,
      topVendors
    ] = await Promise.all([
      // Total statistics
      prisma.receipt.aggregate({
        where: {
          companyId: req.user.companyId
        },
        _sum: {
          totalAmount: true
        },
        _count: {
          _all: true
        }
      }),
      
      // Monthly statistics (last 12 months)
      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', "receiptDate") as month,
          COUNT(*) as count,
          SUM("totalAmount") as total
        FROM "Receipt"
        WHERE "companyId" = ${req.user.companyId}
          AND "receiptDate" >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months')
        GROUP BY month
        ORDER BY month DESC
      `,
      
      // Status counts
      prisma.receipt.groupBy({
        by: ['status'],
        where: {
          companyId: req.user.companyId
        },
        _count: {
          _all: true
        }
      }),
      
      // Top vendors
      prisma.receipt.groupBy({
        by: ['vendorName'],
        where: {
          companyId: req.user.companyId,
          vendorName: {
            not: null
          }
        },
        _sum: {
          totalAmount: true
        },
        _count: {
          _all: true
        },
        orderBy: {
          _sum: {
            totalAmount: 'desc'
          }
        },
        take: 10
      })
    ]);

    const statusCountsMap = statusCounts.reduce((acc, stat) => {
      acc[stat.status] = stat._count._all;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      data: {
        total: {
          count: totalStats._count._all,
          amount: totalStats._sum.totalAmount || 0
        },
        monthly: monthlyStats,
        statusCounts: statusCountsMap,
        topVendors: topVendors.map(v => ({
          name: v.vendorName,
          count: v._count._all,
          totalAmount: v._sum.totalAmount || 0
        }))
      }
    });
  } catch (error) {
    console.error('Get receipt statistics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};