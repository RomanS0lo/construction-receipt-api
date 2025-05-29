import AWS from 'aws-sdk';
import multer from 'multer';
import multerS3 from 'multer-s3';

// Extend multerS3 type
const multerS3Extended = multerS3 as any;
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

// Create S3 instance
export const s3 = new AWS.S3();

// S3 bucket configuration
export const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'solyx-construction-receipts';
export const S3_REGION = process.env.AWS_REGION || 'us-east-1';

// File upload limits
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_FILE_TYPES = /jpeg|jpg|png|pdf|heic|heif/;
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'application/pdf'
];

// S3 key prefixes
export const S3_KEY_PREFIX = {
  RECEIPTS: 'receipts',
  THUMBNAILS: 'thumbnails',
  TEMP: 'temp'
};

// Generate S3 key for receipt upload
export const generateReceiptKey = (companyId: string, userId: string, filename: string): string => {
  const ext = path.extname(filename).toLowerCase();
  const uniqueId = uuidv4();
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  
  return `${S3_KEY_PREFIX.RECEIPTS}/${companyId}/${year}/${month}/${userId}/${uniqueId}${ext}`;
};

// Generate S3 key for thumbnail
export const generateThumbnailKey = (receiptKey: string): string => {
  return receiptKey.replace(S3_KEY_PREFIX.RECEIPTS, S3_KEY_PREFIX.THUMBNAILS);
};

// Multer S3 storage configuration
export const receiptStorage = multerS3Extended({
  s3: s3,
  bucket: S3_BUCKET_NAME,
  contentType: multerS3Extended.AUTO_CONTENT_TYPE,
  metadata: (req: any, file: any, cb: any) => {
    cb(null, {
      fieldName: file.fieldname,
      originalName: file.originalname,
      uploadedBy: req.user?.userId || 'unknown',
      companyId: req.user?.companyId || 'unknown',
      uploadDate: new Date().toISOString()
    });
  },
  key: (req: any, file: any, cb: any) => {
    if (!req.user?.companyId || !req.user?.userId) {
      cb(new Error('User authentication required'));
      return;
    }
    
    const key = generateReceiptKey(req.user.companyId, req.user.userId, file.originalname);
    cb(null, key);
  }
});

// File filter for multer
export const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;
  
  if (!ALLOWED_FILE_TYPES.test(ext) || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    cb(new Error('Invalid file type. Only JPEG, PNG, PDF, and HEIC files are allowed.'));
    return;
  }
  
  cb(null, true);
};

// Get signed URL for secure file access
export const getSignedUrl = (key: string, expiresIn: number = 3600): string => {
  return s3.getSignedUrl('getObject', {
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Expires: expiresIn
  });
};

// Delete file from S3
export const deleteFile = async (key: string): Promise<void> => {
  await s3.deleteObject({
    Bucket: S3_BUCKET_NAME,
    Key: key
  }).promise();
};

// Delete multiple files from S3
export const deleteFiles = async (keys: string[]): Promise<void> => {
  if (keys.length === 0) return;
  
  await s3.deleteObjects({
    Bucket: S3_BUCKET_NAME,
    Delete: {
      Objects: keys.map(key => ({ Key: key }))
    }
  }).promise();
};

// Check if file exists in S3
export const fileExists = async (key: string): Promise<boolean> => {
  try {
    await s3.headObject({
      Bucket: S3_BUCKET_NAME,
      Key: key
    }).promise();
    return true;
  } catch (error) {
    return false;
  }
};

// Copy file within S3
export const copyFile = async (sourceKey: string, destinationKey: string): Promise<void> => {
  await s3.copyObject({
    Bucket: S3_BUCKET_NAME,
    CopySource: `${S3_BUCKET_NAME}/${sourceKey}`,
    Key: destinationKey
  }).promise();
};