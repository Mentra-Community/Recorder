/**
 * Transcripts API
 * Provides real-time transcript data via SSE
 */

import { Router } from 'express';
import { Request, Response } from 'express';
import streamService from '../services/stream.service';

const router = Router();

/**
 * GET /api/transcripts
 * Returns the most recent transcripts for the user
 */
// router.get('/', (req: Request, res: Response) => {
//   console.log(`[API] Transcript request received from ${req.headers['user-agent']}`);
  
//   // Get user ID
//   const userId = (req as any).authUserId || 'anonymous';
  
//   // Get recordings for the user to extract transcripts
//   const recordings = store.recordings.findRecordingsByUser(userId);
  
//   // Extract transcript data from the recordings
//   const transcripts = recordings.map(recording => ({
//     id: recording.id,
//     timestamp: recording.updatedAt.toISOString(),
//     text: recording.transcript,
//     speakerName: 'User',
//     durationMs: recording.duration * 1000,
//     recordingId: recording.id
//   }));
  
//   // Add cache prevention headers
//   res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//   res.header('Pragma', 'no-cache');
//   res.header('Expires', '0');
  
//   // Send response
//   res.json({
//     status: 'success',
//     data: transcripts
//   });
// });

/**
 * GET /api/transcripts/sse
 * Sets up a Server-Sent Events endpoint for real-time transcript updates
 */
router.get('/sse', (req: Request, res: Response) => {
  // Get user ID (or use anonymous)
  const userId = (req as any).authUserId || 'anonymous';
  console.log(`[SSE] New SSE connection for user ${userId}`);
  
  // Register client with stream service
  try {
    const clientId = streamService.addClient(userId, res);
    console.log(`[SSE] Client registered with ID: ${clientId}`);
    
    // Send a welcome message confirming connection
    streamService.broadcastToUser(userId, 'connected', {
      message: 'Connected to real-time transcript stream',
      timestamp: new Date().toISOString()
    });
    
    // Clean up on disconnect
    res.on('close', () => {
      console.log(`[SSE] Connection closed for ${clientId}`);
    });
  } catch (error) {
    console.error('[SSE] Error setting up SSE:', error);
    res.status(500).end();
  }
});

export default router;