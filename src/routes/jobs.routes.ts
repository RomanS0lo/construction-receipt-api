import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  getJobsStatistics
} from '../controllers/jobs.controller';

const router = Router();

// Job routes - all routes require authentication
router.get('/', authenticate, getJobs);
router.get('/statistics', authenticate, getJobsStatistics);
router.get('/:id', authenticate, getJob);
router.post('/', authenticate, createJob);
router.put('/:id', authenticate, updateJob);
router.delete('/:id', authenticate, deleteJob);

export default router;