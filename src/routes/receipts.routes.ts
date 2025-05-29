import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.middleware';
import { 
  receiptStorage, 
  fileFilter, 
  MAX_FILE_SIZE 
} from '../config/s3.config';
import {
  uploadReceipt,
  uploadMultipleReceipts,
  getReceipts,
  getReceipt,
  updateReceipt,
  deleteReceipt,
  getReceiptStatistics,
  createReceipt  // ADD THIS
} from '../controllers/receipts.controller';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: receiptStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE
  }
});

// Error handler for multer
const handleMulterError = (err: any, req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 10MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum is 10 files at once.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  
  if (err) {
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }
  
  next();
};

// Receipt routes - all require authentication

// File upload routes
router.post(
  '/upload',
  authenticate,
  upload.single('receipt'),
  handleMulterError,
  uploadReceipt
);

router.post(
  '/upload-multiple',
  authenticate,
  upload.array('receipts', 10),
  handleMulterError,
  uploadMultipleReceipts
);

// JSON receipt creation route (ADD THIS)
router.post('/', authenticate, createReceipt);


// Other routes
router.get('/', authenticate, getReceipts);
router.get('/statistics', authenticate, getReceiptStatistics);
router.get('/:id', authenticate, getReceipt);
router.put('/:id', authenticate, updateReceipt);
router.delete('/:id', authenticate, deleteReceipt);

export default router;