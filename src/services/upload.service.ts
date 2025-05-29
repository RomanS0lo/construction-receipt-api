import sharp from 'sharp';
import { s3, S3_BUCKET_NAME, generateThumbnailKey, deleteFile, deleteFiles } from '../config/s3.config';
import { Readable } from 'stream';

interface ProcessedImage {
  thumbnailKey: string;
  thumbnailUrl: string;
  originalMetadata: {
    width?: number;
    height?: number;
    format?: string;
    size?: number;
  };
}

// Convert PDF to image (first page only)
export const convertPdfToImage = async (pdfBuffer: Buffer): Promise<Buffer> => {
  // Note: PDF to image conversion requires additional libraries like pdf-poppler or pdf2pic
  // For now, we'll throw an error and handle PDFs differently
  throw new Error('PDF processing not yet implemented. Please upload image files.');
};

// Process uploaded image and create thumbnail
export const processReceiptImage = async (
  key: string,
  contentType: string
): Promise<ProcessedImage> => {
  try {
    // Get the original image from S3
    const originalImage = await s3.getObject({
      Bucket: S3_BUCKET_NAME,
      Key: key
    }).promise();

    if (!originalImage.Body) {
      throw new Error('Failed to retrieve image from S3');
    }

    const imageBuffer = originalImage.Body as Buffer;
    
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();

    // Create thumbnail (max 400px width, maintaining aspect ratio)
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize(400, null, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Generate thumbnail key
    const thumbnailKey = generateThumbnailKey(key);

    // Upload thumbnail to S3
    await s3.putObject({
      Bucket: S3_BUCKET_NAME,
      Key: thumbnailKey,
      Body: thumbnailBuffer,
      ContentType: 'image/jpeg',
      CacheControl: 'max-age=31536000', // 1 year cache
      Metadata: {
        originalKey: key,
        processedAt: new Date().toISOString()
      }
    }).promise();

    // Get the public URL for the thumbnail
    const thumbnailUrl = `https://${S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${thumbnailKey}`;

    return {
      thumbnailKey,
      thumbnailUrl,
      originalMetadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: originalImage.ContentLength
      }
    };
  } catch (error) {
    console.error('Error processing receipt image:', error);
    throw new Error('Failed to process receipt image');
  }
};

// Process HEIC/HEIF images (convert to JPEG)
export const convertHeicToJpeg = async (heicBuffer: Buffer): Promise<Buffer> => {
  try {
    // Sharp supports HEIC/HEIF conversion on systems with proper libraries installed
    const jpegBuffer = await sharp(heicBuffer)
      .jpeg({ quality: 90 })
      .toBuffer();
    
    return jpegBuffer;
  } catch (error) {
    console.error('Error converting HEIC to JPEG:', error);
    throw new Error('Failed to convert HEIC image. Please upload a different format.');
  }
};

// Clean up uploaded files (in case of error)
export const cleanupUploadedFiles = async (keys: string[]): Promise<void> => {
  try {
    const allKeys: string[] = [];
    
    // Add original keys
    allKeys.push(...keys);
    
    // Add thumbnail keys
    keys.forEach(key => {
      allKeys.push(generateThumbnailKey(key));
    });
    
    await deleteFiles(allKeys);
  } catch (error) {
    console.error('Error cleaning up uploaded files:', error);
  }
};

// Validate image dimensions and size
export const validateImageRequirements = async (
  buffer: Buffer,
  maxSizeMB: number = 10,
  minWidth: number = 100,
  minHeight: number = 100
): Promise<boolean> => {
  try {
    const metadata = await sharp(buffer).metadata();
    
    // Check file size
    const sizeMB = buffer.length / (1024 * 1024);
    if (sizeMB > maxSizeMB) {
      throw new Error(`Image size exceeds ${maxSizeMB}MB limit`);
    }
    
    // Check dimensions
    if (!metadata.width || !metadata.height) {
      throw new Error('Unable to determine image dimensions');
    }
    
    if (metadata.width < minWidth || metadata.height < minHeight) {
      throw new Error(`Image dimensions must be at least ${minWidth}x${minHeight}px`);
    }
    
    return true;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to validate image requirements');
  }
};

// Stream upload for large files
export const streamUploadToS3 = async (
  key: string,
  stream: Readable,
  contentType: string,
  metadata?: Record<string, string>
): Promise<void> => {
  const uploadParams = {
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Body: stream,
    ContentType: contentType,
    Metadata: metadata
  };

  await s3.upload(uploadParams).promise();
};

// Batch process multiple receipts
export const batchProcessReceipts = async (
  receipts: Array<{ key: string; contentType: string }>
): Promise<ProcessedImage[]> => {
  const results = await Promise.allSettled(
    receipts.map(receipt => processReceiptImage(receipt.key, receipt.contentType))
  );

  const processed: ProcessedImage[] = [];
  const failed: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      processed.push(result.value);
    } else {
      failed.push(receipts[index].key);
      console.error(`Failed to process receipt ${receipts[index].key}:`, result.reason);
    }
  });

  // Clean up failed uploads
  if (failed.length > 0) {
    await cleanupUploadedFiles(failed);
  }

  return processed;
};