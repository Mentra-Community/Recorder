/**
 * Recordings API
 * Endpoints for managing recordings
 */

import { Router } from 'express';
import recordingsService from '../services/recordings.service';
import storageService from '../services/storage.service';
import path from 'path';
import fs from 'fs';
import { RecordingDocument } from '../models/recording.models';

const router = Router();

// Helper function to convert _id to id for frontend compatibility
function formatRecordingForApi(recording: RecordingDocument) {
  const plainRecord = recording.toObject ? recording.toObject() : recording;
  return {
    ...plainRecord,
    id: plainRecord._id.toString(), // Add id for backward compatibility
    _id: undefined, // Remove _id from the response
    createdAt: plainRecord.createdAt instanceof Date ? plainRecord.createdAt.getTime() : plainRecord.createdAt,
    updatedAt: plainRecord.updatedAt instanceof Date ? plainRecord.updatedAt.getTime() : plainRecord.updatedAt
  };
}

// Use the AugmentOS SDK auth middleware
import { AuthenticatedRequest } from '@augmentos/sdk';
// import { AuthenticatedRequest, isaiahMiddleware } from '../middleware/isaiah.middleware';

// Note: The authMiddleware from AugmentOS SDK will:
// 1. Verify the JWT token in the Authorization header
// 2. Attach the authenticated user ID to req.authUserId
// 3. Handle error responses for unauthorized requests

import { Request, Response } from 'express';


// Get all recordings for authenticated user
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const recordings = await recordingsService.getRecordingsForUser(userId);
    // Format recordings for API response
    const formattedRecordings = recordings.map(formatRecordingForApi);
    return res.json(formattedRecordings);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get a specific recording by ID
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
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

    // Format recording for API response
    const formattedRecording = formatRecordingForApi(recording);
    return res.json(formattedRecording);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Start a new recording
router.post('/start', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
  const { sessionId } = req.body;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    // False = not voice-initiated (this is from UI)
    const recordingId = await recordingsService.startRecording(userId, false);
    return res.status(201).json({ id: recordingId });
  } catch (error) {
    if (error instanceof Error && error.message.includes('No active AugmentOS SDK session')) {
      return res.status(400).json({ 
        error: error.message,
        code: 'NO_ACTIVE_SESSION'
      });
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Stop an active recording
router.post('/:id/stop', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
  const { id } = req.params;
  console.log(`[API] [DEBUG] Stop recording API call for recording ID: ${id} by user: ${userId}`);
  console.log(`[API] [DEBUG] Request headers: ${JSON.stringify(req.headers)}`);
  console.log(`[API] [DEBUG] Client IP: ${req.ip}`);

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // First check if the recording exists and belongs to the user
    console.log(`[API] [DEBUG] Checking if recording ${id} exists and belongs to user ${userId}`);
    const recording = await recordingsService.getRecordingById(id);

    if (recording.userId !== userId) {
      console.log(`[API] [DEBUG] ⚠️ Recording ${id} doesn't belong to user ${userId}`);
      return res.status(403).json({ error: 'Forbidden' });
    }

    console.log(`[API] [DEBUG] Proceeding to stop recording ${id}`);
    // False = not voice-initiated (this is from UI)
    await recordingsService.stopRecording(id, false);
    console.log(`[API] [DEBUG] Successfully stopped recording ${id}`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.log(`[API] [DEBUG] ⚠️ Error stopping recording ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Download a recording
router.get('/:id/download', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
  const { id } = req.params;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log(`[DOWNLOAD] Request for recording ID: ${id} from user: ${userId}`);

  try {
    console.log(`[DOWNLOAD] Getting file from storage service: ${id}`);
    const fileData = await storageService.getFile(userId, id);

    // Set headers for WAV
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.wav"`);

    // Send the file
    return res.send(fileData);
  } catch (storageError) {
    console.log({storageError}, `[DOWNLOAD] Storage service failed`);

    // DEBUGGING: Log that we reached this point - the specific file was not found
    console.log(`[DOWNLOAD] [DEBUG] ⚠️ File not found in either local storage or R2: ${id}.wav`);
    console.log(`[DOWNLOAD] [DEBUG] Call stack: ${new Error().stack}`);

    // Return a proper 404 error
    console.log(`[DOWNLOAD] [DEBUG] Returning 404 - Not Found for ${id}.wav`);
    return res.status(404).json({
      error: 'Recording file not found',
      id: id,
      message: 'The audio file for this recording could not be found.'
    });
  }
});

// Update a recording (e.g., rename)
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
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

    // Format recording for API response
    const formattedRecording = formatRecordingForApi(updatedRecording);
    return res.json(formattedRecording);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Delete a recording
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
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
    return res.status(204).end();
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;