/**
 * Recordings API
 * Endpoints for managing recordings
 */

import { Router } from 'express';
import recordingsService from '../services/recordings.service';
import storageService from '../services/storage.service';
import path from 'path';

const router = Router();

// Use the AugmentOS SDK auth middleware
// import { authMiddleware } from '@augmentos/sdk';
import { AuthenticatedRequest, isaiahMiddleware } from '../middleware/isaiah.middleware';

// Note: The authMiddleware from AugmentOS SDK will:
// 1. Verify the JWT token in the Authorization header
// 2. Attach the authenticated user ID to req.authUserId
// 3. Handle error responses for unauthorized requests

import { Request, Response } from 'express';


// Get all recordings for authenticated user
router.get('/', isaiahMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const recordings = await recordingsService.getRecordingsForUser(userId);
    res.json(recordings);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get a specific recording by ID
router.get('/:id', isaiahMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  const { id } = req.params;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const recording = await recordingsService.getRecordingById(id);
    
    // Make sure user owns this recording
    if (recording.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    res.json(recording);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Start a new recording
router.post('/start', isaiahMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  const { sessionId } = req.body;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }
  
  try {
    const recordingId = await recordingsService.startRecording(userId, sessionId);
    res.status(201).json({ id: recordingId });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Stop an active recording
router.post('/:id/stop', isaiahMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  const { id } = req.params;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // First check if the recording exists and belongs to the user
    const recording = await recordingsService.getRecordingById(id);
    
    if (recording.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    await recordingsService.stopRecording(id);
    res.status(200).json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});


// Download a recording
router.get('/:id/download', isaiahMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  const { id } = req.params;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // First check if the recording exists and belongs to the user
    const recording = await recordingsService.getRecordingById(id);
    
    if (recording.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    // Get the file (in production, this could redirect to R2)
    const file = await storageService.getFile(path.join(userId, `${id}.wav`));
    
    // Set headers
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.wav"`);
    
    // Send file
    res.send(file);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Update a recording (e.g., rename)
router.put('/:id', isaiahMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  const { id } = req.params;
  const { title } = req.body;
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  
  try {
    // First check if the recording exists and belongs to the user
    const recording = await recordingsService.getRecordingById(id);
    
    if (recording.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const updatedRecording = await recordingsService.updateRecording(id, { 
      title,
      updatedAt: new Date()
    });
    
    res.json(updatedRecording);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Delete a recording
router.delete('/:id', isaiahMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  const { id } = req.params;
  if (!userId) { 
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // First check if the recording exists and belongs to the user
    const recording = await recordingsService.getRecordingById(id);
    
    if (recording.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    await recordingsService.deleteRecording(id);
    res.status(204).end();
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;