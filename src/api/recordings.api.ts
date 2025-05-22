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
import crypto from 'crypto';

const router = Router();

// Secret key for token signing - in production, this should be an environment variable
const AUGMENTOS_API_KEY = process.env.AUGMENTOS_API_KEY;
if (!AUGMENTOS_API_KEY) {
  throw new Error('AUGMENTOS_API_KEY is not set. Please set it in your environment variables.');
}

/**
 * Generate a signed download token for secure file access
 */
function generateDownloadToken(userId: string, recordingId: string, expiresAt: number): string {
  // Create a payload
  const payload = {
    userId,
    recordingId,
    expiresAt
  };
  
  // Convert to string
  const payloadStr = JSON.stringify(payload);
  
  // Create a signature using HMAC
  const hmac = crypto.createHmac('sha256', AUGMENTOS_API_KEY as string);
  hmac.update(payloadStr);
  const signature = hmac.digest('hex');
  
  // Use URL-safe base64 encoding (replace +, / and = characters)
  const token = Buffer.from(payloadStr + '.' + signature)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
    
  console.log(`[TOKEN] Generated token for user ${userId}, recording ${recordingId}, expires ${new Date(expiresAt).toISOString()}`);
  
  return token;
}

/**
 * Verify a download token
 */
function verifyDownloadToken(token: string): { userId: string; recordingId: string; expiresAt: number } | null {
  try {
    console.log(`[TOKEN] Verifying token: ${token.substring(0, 20)}...`);
    
    // Convert URL-safe base64 back to regular base64
    const base64Token = token
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Add padding if needed
    let paddedToken = base64Token;
    while (paddedToken.length % 4 !== 0) {
      paddedToken += '=';
    }
    
    // Decode token
    const decoded = Buffer.from(paddedToken, 'base64').toString();
    
    // Find the last occurrence of . which separates payload from signature
    const lastDotIndex = decoded.lastIndexOf('.');
    if (lastDotIndex === -1) {
      console.log(`[TOKEN] No dot separator found in token`);
      return null;
    }
    
    const payloadStr = decoded.substring(0, lastDotIndex);
    const signature = decoded.substring(lastDotIndex + 1);
    
    if (!payloadStr || !signature) {
      console.log(`[TOKEN] Missing payload or signature`);
      return null;
    }
    
    // Verify signature
    const hmac = crypto.createHmac('sha256', AUGMENTOS_API_KEY as string);
    hmac.update(payloadStr);
    const expectedSignature = hmac.digest('hex');
    
    if (signature !== expectedSignature) {
      console.log(`[TOKEN] Signature mismatch`);
      return null;
    }
    
    // Parse payload
    const payload = JSON.parse(payloadStr);
    console.log(`[TOKEN] Token valid for user ${payload.userId}, recording ${payload.recordingId}`);
    return payload;
  } catch (error) {
    console.error('[TOKEN] Error verifying token:', error);
    return null;
  }
}

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

// Generate a signed download token
router.get('/:id/download-token', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
  const { id } = req.params;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // First check if the recording exists and belongs to the user
    const recording = await recordingsService.getRecordingById(id);

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recording.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    // Generate a signed token (expires in 60 minutes)
    const expirationTime = Date.now() + 60 * 60 * 1000; // 60 minutes
    const token = generateDownloadToken(userId, id, expirationTime);
    
    // Return the token and the URL to use
    return res.json({
      token: token,
      downloadUrl: `/api/recordings/${id}/download-by-token?token=${token}`,
      expiresAt: expirationTime
    });
  } catch (error) {
    console.error(`[DOWNLOAD TOKEN] Error generating token for ${id}:`, error);
    return res.status(500).json({ error: 'Error generating download token' });
  }
});

// Download a recording with a signed token
router.get('/:id/download-by-token', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { token } = req.query;
  
  console.log(`[DOWNLOAD] Received download request for recording ${id} with token: ${token ? `${token.toString().substring(0, 20)}...` : 'missing'}`);
  
  if (!token || typeof token !== 'string') {
    console.log(`[DOWNLOAD] Error: Missing or invalid token`);
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  
  try {
    // URL decode the token (since it may be URL-encoded by the client)
    const decodedToken = decodeURIComponent(token);
    console.log(`[DOWNLOAD] Token received - length: ${decodedToken.length}`);
    
    // Verify the token
    const tokenData = verifyDownloadToken(decodedToken);
    
    if (!tokenData) {
      console.log(`[DOWNLOAD] Error: Invalid token - verification failed`);
      return res.status(401).json({ error: 'Invalid token - verification failed' });
    }
    
    const { userId, recordingId, expiresAt } = tokenData;
    console.log(`[DOWNLOAD] Token verified. UserId: ${userId}, RecordingId: ${recordingId}, Expires: ${new Date(expiresAt).toISOString()}`);
    
    // Check if token is expired
    if (Date.now() > expiresAt) {
      console.log(`[DOWNLOAD] Error: Token expired at ${new Date(expiresAt).toISOString()}, current time: ${new Date().toISOString()}`);
      return res.status(401).json({ error: 'Token expired' });
    }
    
    // Verify that token is for the correct recording
    if (recordingId !== id) {
      console.log(`[DOWNLOAD] Error: Token for recording ${recordingId}, but requested ${id}`);
      return res.status(401).json({ error: 'Token does not match recording ID' });
    }
    
    console.log(`[DOWNLOAD] Getting file for user: ${userId}, recording: ${id} via token`);
    const fileData = await storageService.getFile(userId, id);

    // Set headers for WAV
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.wav"`);
    
    // Add cache control headers to prevent browser caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Enable CORS for direct browser access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    // Send the file
    console.log(`[DOWNLOAD] Sending file - size: ${fileData.length} bytes`);
    return res.send(fileData);
  } catch (storageError) {
    console.log(`[DOWNLOAD] Storage service failed:`, storageError);
    return res.status(404).json({
      error: 'Recording file not found',
      id: id,
      message: 'The audio file for this recording could not be found.'
    });
  }
});

// Keep the original endpoint for backward compatibility but add a warning
router.get('/:id/download', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
  const { id } = req.params;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log(`[DOWNLOAD] WARNING: Using deprecated direct download route for ID: ${id}, user: ${userId}`);
  console.log(`[DOWNLOAD] This route may not work in browsers. Use /download-token instead.`);

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