/**
 * Notes service
 * Handles business logic for notes
 */

import { v4 as uuidv4 } from 'uuid';
import { NoteI, CreateNoteDtoI, UpdateNoteDtoI } from '../types/notes.types';
import store from '../models/in-memory-store';
import streamService from './stream.service';

class NotesService {
  /**
   * Create a new note
   */
  async createNote(userId: string, dto: CreateNoteDtoI): Promise<NoteI> {
    try {
      const noteId = `note_${Date.now()}_${uuidv4().substring(0, 8)}`;
      
      const note: NoteI = {
        id: noteId,
        userId,
        content: dto.content,
        sourceRecordingId: dto.sourceRecordingId,
        tags: dto.tags || [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const createdNote = store.notes.createNote(note);
      
      // Notify clients
      streamService.broadcastToUser(userId, 'note', createdNote);
      
      return createdNote;
    } catch (error) {
      console.error(`Error creating note for user ${userId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get all notes for a user
   */
  async getNotesForUser(userId: string): Promise<NoteI[]> {
    try {
      return store.notes.findNotesByUser(userId);
    } catch (error) {
      console.error(`Error getting notes for user ${userId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get a note by ID
   */
  async getNoteById(noteId: string): Promise<NoteI> {
    try {
      const note = store.notes.findNoteById(noteId);
      
      if (!note) {
        throw new Error(`Note ${noteId} not found`);
      }
      
      return note;
    } catch (error) {
      console.error(`Error getting note ${noteId}:`, error);
      throw error;
    }
  }
  
  /**
   * Update a note
   */
  async updateNote(noteId: string, dto: UpdateNoteDtoI): Promise<NoteI> {
    try {
      const note = store.notes.findNoteById(noteId);
      
      if (!note) {
        throw new Error(`Note ${noteId} not found`);
      }
      
      // Prepare updates
      const updates: Partial<NoteI> = {
        updatedAt: new Date()
      };
      
      if (dto.content !== undefined) {
        updates.content = dto.content;
      }
      
      if (dto.tags !== undefined) {
        updates.tags = dto.tags;
      }
      
      const updatedNote = store.notes.updateNote(noteId, updates);
      
      if (!updatedNote) {
        throw new Error(`Failed to update note ${noteId}`);
      }
      
      // Notify clients
      streamService.broadcastToUser(note.userId, 'note-updated', updatedNote);
      
      return updatedNote;
    } catch (error) {
      console.error(`Error updating note ${noteId}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete a note
   */
  async deleteNote(noteId: string): Promise<void> {
    try {
      const note = store.notes.findNoteById(noteId);
      
      if (!note) {
        throw new Error(`Note ${noteId} not found`);
      }
      
      const userId = note.userId;
      
      const success = store.notes.deleteNote(noteId);
      
      if (!success) {
        throw new Error(`Failed to delete note ${noteId}`);
      }
      
      // Notify clients
      streamService.broadcastToUser(userId, 'note-deleted', { id: noteId });
    } catch (error) {
      console.error(`Error deleting note ${noteId}:`, error);
      throw error;
    }
  }
}

export default new NotesService();