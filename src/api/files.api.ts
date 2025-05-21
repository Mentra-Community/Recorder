/**
 * Files API
 * Endpoints for file access (temporary implementation)
 * Will be replaced by Cloudflare R2 in Phase 2
 */

import { Router } from 'express';
import storageService from '../services/storage.service';
import path from 'path';

const router = Router();

// Use the AugmentOS SDK auth middleware
import { AuthenticatedRequest } from '@augmentos/sdk';
// import { AuthenticatedRequest, isaiahMiddleware } from '../middleware/isaiah.middleware';

// Note: The authMiddleware from AugmentOS SDK will:
// 1. Verify the JWT token in the Authorization header
// 2. Attach the authenticated user ID to req.authUserId
// 3. Handle error responses for unauthorized requests

import { Request, Response } from 'express';


// Serve file
// router.get('/:filename', async (req: AuthenticatedRequest, res: Response) => {
//   const userId = req.authUserId;
//   const { filename } = req.params;

//   if (!userId) {
//     return res.status(401).json({ error: 'Unauthorized' });
//   }
  
//   try {
//     // Ensure file belongs to user
//     const filePath = path.join(userId, filename);
    
//     // Get the file
//     const file = await storageService.getFile(filePath);
    
//     // Set headers based on file type
//     if (filename.endsWith('.wav')) {
//       res.setHeader('Content-Type', 'audio/wav');
//     } else if (filename.endsWith('.mp3')) {
//       res.setHeader('Content-Type', 'audio/mpeg');
//     } else {
//       res.setHeader('Content-Type', 'application/octet-stream');
//     }
    
//     // Send file
//     res.send(file);
//   } catch (error) {
//     console.error(`Error serving file ${filename}:`, error);
//     res.status(404).json({ error: 'File not found' });
//   }
// });

export default router;