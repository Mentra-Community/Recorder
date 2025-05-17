/**
 * Notes API
 * Endpoints for CRUD operations on notes
 */

import { Router } from 'express';
import notesService from '../services/notes.service';

const router = Router();

// Use the AugmentOS SDK auth middleware
import { AuthenticatedRequest } from '@augmentos/sdk';
// Import the new auth middleware 
import { authMiddleware } from '../middleware/auth.middleware';

// Note: The authMiddleware from AugmentOS SDK will:
// 1. Verify the JWT token in the Authorization header
// 2. Attach the authenticated user ID to req.authUserId
// 3. Handle error responses for unauthorized requests

import { Request, Response } from 'express';


// Get all notes for authenticated user
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  // Get userId from the SDK's auth middleware
  const userId = req.authUserId;

  try {
    const notes = await notesService.getNotesForUser(userId);
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get a specific note by ID
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  // Get userId from the SDK's auth middleware
  const userId = req.authUserId;
  const { id } = req.params;

  try {
    const note = await notesService.getNoteById(id);
    
    // Make sure user owns this note
    if (note.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    res.json(note);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Create a new note
router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  // Get userId from the SDK's auth middleware
  const userId = req.authUserId;
  const { content, sourceRecordingId, tags } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }
  
  try {
    const note = await notesService.createNote(userId, {
      content,
      sourceRecordingId,
      tags
    });
    
    res.status(201).json(note);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Update an existing note
router.put('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  // Get userId from the SDK's auth middleware
  const userId = req.authUserId;
  const { id } = req.params;
  const { content, tags } = req.body;

  try {
    // First check if the note exists and belongs to the user
    const existingNote = await notesService.getNoteById(id);
    
    if (existingNote.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const updatedNote = await notesService.updateNote(id, { content, tags });
    res.json(updatedNote);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Delete a note
router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  // Get userId from the SDK's auth middleware
  const userId = req.authUserId;
  const { id } = req.params;

  try {
    // First check if the note exists and belongs to the user
    const existingNote = await notesService.getNoteById(id);
    
    if (existingNote.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    await notesService.deleteNote(id);
    res.status(204).end();
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;