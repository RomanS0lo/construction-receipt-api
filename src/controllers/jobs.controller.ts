import { RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { JobStatus } from '@prisma/client';

// Validation schemas
const createJobSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  clientName: z.string().optional(),
  clientEmail: z.string().email().optional().or(z.literal('')),
  clientPhone: z.string().optional(),
  address: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  estimatedHours: z.number().positive().optional(),
  hourlyRate: z.number().positive().optional(),
  budget: z.number().positive().optional(),
  status: z.nativeEnum(JobStatus).optional()
});

const updateJobSchema = createJobSchema.partial();

const querySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  search: z.string().optional(),
  status: z.nativeEnum(JobStatus).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'clientName', 'budget']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

// Interfaces
interface CreateJobBody extends z.infer<typeof createJobSchema> {}
interface UpdateJobBody extends z.infer<typeof updateJobSchema> {}
interface JobQuery extends z.infer<typeof querySchema> {}

// Get all jobs with pagination and search
export const getJobs: RequestHandler<{}, any, {}, JobQuery> = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const query = querySchema.parse(req.query);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;
    const search = query.search;
    const status = query.status;
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';

    // Build where clause
    const where: any = {
      companyId: req.user.companyId
    };

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { clientName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get total count
    const total = await prisma.job.count({ where });

    // Get jobs with receipts for statistics
    const jobs = await prisma.job.findMany({
      where,
      include: {
        receipts: {
          select: {
            totalAmount: true,
            status: true
          }
        },
        _count: {
          select: {
            receipts: true
          }
        }
      },
      orderBy: {
        [sortBy]: sortOrder
      },
      skip,
      take: limit
    });

    // Calculate statistics for each job
    const jobsWithStats = jobs.map(job => {
      const totalExpenses = job.receipts
        .filter(receipt => receipt.status === 'APPROVED')
        .reduce((sum, receipt) => sum + receipt.totalAmount, 0);
      
      const { receipts, ...jobData } = job;
      
      return {
        ...jobData,
        statistics: {
          totalExpenses,
          receiptCount: job._count.receipts,
          budgetRemaining: job.budget ? job.budget - totalExpenses : null,
          budgetUsedPercentage: job.budget ? (totalExpenses / job.budget) * 100 : null
        }
      };
    });

    res.json({
      data: jobsWithStats,
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
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get single job by ID
export const getJob: RequestHandler<{ id: string }> = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const job = await prisma.job.findFirst({
      where: {
        id,
        companyId: req.user.companyId
      },
      include: {
        receipts: {
          select: {
            id: true,
            totalAmount: true,
            vendorName: true,
            receiptDate: true,
            status: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            }
          },
          orderBy: {
            receiptDate: 'desc'
          }
        },
        _count: {
          select: {
            receipts: true
          }
        }
      }
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Calculate statistics
    const totalExpenses = job.receipts
      .filter(receipt => receipt.status === 'APPROVED')
      .reduce((sum, receipt) => sum + receipt.totalAmount, 0);

    const { receipts, ...jobData } = job;

    res.json({
      data: {
        ...jobData,
        receipts,
        statistics: {
          totalExpenses,
          receiptCount: job._count.receipts,
          budgetRemaining: job.budget ? job.budget - totalExpenses : null,
          budgetUsedPercentage: job.budget ? (totalExpenses / job.budget) * 100 : null
        }
      }
    });
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Create new job
export const createJob: RequestHandler<{}, any, CreateJobBody> = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Only ADMIN and MANAGER can create jobs
    if (req.user.role === 'CREW_MEMBER') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    const validatedData = createJobSchema.parse(req.body);

    const job = await prisma.job.create({
      data: {
        ...validatedData,
        companyId: req.user.companyId,
        startDate: validatedData.startDate ? new Date(validatedData.startDate) : undefined,
        endDate: validatedData.endDate ? new Date(validatedData.endDate) : undefined
      }
    });

    res.status(201).json({
      data: job,
      message: 'Job created successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Create job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update job
export const updateJob: RequestHandler<{ id: string }, any, UpdateJobBody> = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Only ADMIN and MANAGER can update jobs
    if (req.user.role === 'CREW_MEMBER') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    const { id } = req.params;
    const validatedData = updateJobSchema.parse(req.body);

    // Check if job exists and belongs to company
    const existingJob = await prisma.job.findFirst({
      where: {
        id,
        companyId: req.user.companyId
      }
    });

    if (!existingJob) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const job = await prisma.job.update({
      where: { id },
      data: {
        ...validatedData,
        startDate: validatedData.startDate ? new Date(validatedData.startDate) : undefined,
        endDate: validatedData.endDate ? new Date(validatedData.endDate) : undefined
      }
    });

    res.json({
      data: job,
      message: 'Job updated successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Update job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete job
export const deleteJob: RequestHandler<{ id: string }> = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Only ADMIN can delete jobs
    if (req.user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    const { id } = req.params;

    // Check if job exists and belongs to company
    const job = await prisma.job.findFirst({
      where: {
        id,
        companyId: req.user.companyId
      },
      include: {
        _count: {
          select: {
            receipts: true
          }
        }
      }
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Prevent deletion if job has receipts
    if (job._count.receipts > 0) {
      res.status(400).json({ 
        error: 'Cannot delete job with associated receipts',
        details: `This job has ${job._count.receipts} receipts. Please reassign or delete them first.`
      });
      return;
    }

    await prisma.job.delete({
      where: { id }
    });

    res.json({
      message: 'Job deleted successfully'
    });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get job statistics summary
export const getJobsStatistics: RequestHandler = async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const stats = await prisma.job.groupBy({
      by: ['status'],
      where: {
        companyId: req.user.companyId
      },
      _count: {
        _all: true
      }
    });

    const totalBudget = await prisma.job.aggregate({
      where: {
        companyId: req.user.companyId
      },
      _sum: {
        budget: true
      }
    });

    const receiptsStats = await prisma.receipt.aggregate({
      where: {
        companyId: req.user.companyId,
        status: 'APPROVED'
      },
      _sum: {
        totalAmount: true
      },
      _count: {
        _all: true
      }
    });

    const statusCounts = stats.reduce((acc, stat) => {
      acc[stat.status] = stat._count._all;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      data: {
        totalJobs: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
        statusCounts,
        totalBudget: totalBudget._sum.budget || 0,
        totalExpenses: receiptsStats._sum.totalAmount || 0,
        totalReceipts: receiptsStats._count._all,
        budgetUtilization: totalBudget._sum.budget 
          ? ((receiptsStats._sum.totalAmount || 0) / totalBudget._sum.budget) * 100 
          : 0
      }
    });
  } catch (error) {
    console.error('Get jobs statistics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};