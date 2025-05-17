/**
 * Recordings API
 * Endpoints for managing recordings
 */

import { Router } from 'express';
import recordingsService from '../services/recordings.service';
import storageService from '../services/storage.service';
import path from 'path';
import fs from 'fs';

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
  
  console.log(`[DOWNLOAD] Request for recording ID: ${id} from user: ${userId}`);
  
  try {
    // First look for this specific recording's file using MongoDB ID
    const targetFile = `${id}.wav`;
    const userDir = path.join(process.cwd(), 'temp_storage', userId);
    const targetPath = path.join(userDir, targetFile);
    
    console.log(`[DOWNLOAD] Looking for recording file: ${targetPath}`);
    
    if (fs.existsSync(targetPath)) {
      console.log(`[DOWNLOAD] Found exact recording file: ${targetFile}`);
      
      // Set headers for WAV
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', `attachment; filename="${targetFile}"`);
      
      // Stream the file
      const fileStream = fs.createReadStream(targetPath);
      return fileStream.pipe(res);
    }
    
    // If exact file not found, try the storage service
    try {
      console.log(`[DOWNLOAD] Getting file from storage service: ${id}`);
      const fileData = await storageService.getFile(path.join(userId, `${id}.wav`));
      
      // Set headers for WAV
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', `attachment; filename="${id}.wav"`);
      
      // Send the file
      return res.send(fileData);
    } catch (storageError) {
      console.log(`[DOWNLOAD] Storage service failed: ${storageError.message}`);
      
      // As a last resort, serve any available WAV file
      if (fs.existsSync(userDir)) {
        const files = fs.readdirSync(userDir).filter(f => f.endsWith('.wav'));
        console.log(`[DOWNLOAD] Found ${files.length} WAV files in ${userDir}`);
        
        if (files.length > 0) {
          // Use the first available WAV file as fallback
          const audioFile = files[0];
          const filePath = path.join(userDir, audioFile);
          
          console.log(`[DOWNLOAD] Serving fallback audio file: ${audioFile}`);
          
          // Set headers for WAV
          res.setHeader('Content-Type', 'audio/wav');
          res.setHeader('Content-Disposition', `attachment; filename="${audioFile}"`);
          
          // Stream the file
          const fileStream = fs.createReadStream(filePath);
          return fileStream.pipe(res);
        }
      }
      
      // If no file found, return 404
      return res.status(404).json({ error: 'Recording file not found' });
    }
  } catch (error) {
    console.error('[DOWNLOAD] Error serving audio file:', error);
    return res.status(500).json({ error: 'Failed to serve audio file' });
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