/**
 * Events API
 * SSE endpoint for real-time updates
 */

import { Router } from 'express';
import streamService from '../services/stream.service';

const router = Router();

// Use the AugmentOS SDK auth middleware
import { AuthenticatedRequest } from '@mentra/sdk';
// import { AuthenticatedRequest, isaiahMiddleware } from '../middleware/isaiah.middleware';

// Note: The authMiddleware from AugmentOS SDK will:
// 1. Verify the JWT token in the Authorization header
// 2. Attach the authenticated user ID to req.authUserId
// 3. Handle error responses for unauthorized requests

import { Request, Response } from 'express';

// Connect to SSE stream
router.get('/', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Set up SSE connection (headers will be set by streamService.addClient)
  streamService.addClient(userId, res);
});

export default router;