import { Router } from 'express';
import { register, login } from '../controllers/auth.controller';

const router = Router();

// Define routes
router.post('/register', register);
router.post('/login', login);

// Export the router as default
export default router;