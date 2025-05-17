/**
 * In-memory data store for development
 * This will be replaced with MongoDB in Phase 2
 */

import { NoteI } from '../types/notes.types';
import { RecordingI } from '../types/recordings.types';

// Initialize empty collections
const notes: Map<string, NoteI> = new Map();
const recordings: Map<string, RecordingI> = new Map();

// Note operations
const noteOperations = {
  /**
   * Find all notes for a user
   */
  findNotesByUser: (userId: string): NoteI[] => {
    const userNotes: NoteI[] = [];
    notes.forEach(note => {
      if (note.userId === userId) {
        userNotes.push(note);
      }
    });
    
    // Sort by updatedAt (newest first)
    return userNotes.sort((a, b) => 
      b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  },
  
  /**
   * Find note by ID
   */
  findNoteById: (id: string): NoteI | null => {
    return notes.get(id) || null;
  },
  
  /**
   * Create a new note
   */
  createNote: (note: NoteI): NoteI => {
    notes.set(note.id, note);
    return note;
  },
  
  /**
   * Update an existing note
   */
  updateNote: (id: string, updates: Partial<NoteI>): NoteI | null => {
    const note = notes.get(id);
    
    if (!note) {
      return null;
    }
    
    // Apply updates
    const updatedNote = { ...note, ...updates, updatedAt: new Date() };
    notes.set(id, updatedNote);
    
    return updatedNote;
  },
  
  /**
   * Delete a note
   */
  deleteNote: (id: string): boolean => {
    return notes.delete(id);
  }
};

// Recording operations
const recordingOperations = {
  /**
   * Find all recordings for a user
   */
  findRecordingsByUser: (userId: string): RecordingI[] => {
    const userRecordings: RecordingI[] = [];
    recordings.forEach(recording => {
      if (recording.userId === userId) {
        userRecordings.push(recording);
      }
    });
    
    // Sort by createdAt (newest first)
    return userRecordings.sort((a, b) => 
      b.createdAt.getTime() - a.createdAt.getTime()
    );
  },
  
  /**
   * Find recording by ID
   */
  findRecordingById: (id: string): RecordingI | null => {
    return recordings.get(id) || null;
  },
  
  /**
   * Create a new recording
   */
  createRecording: (recording: RecordingI): RecordingI => {
    recordings.set(recording.id, recording);
    return recording;
  },
  
  /**
   * Update an existing recording
   */
  updateRecording: (id: string, updates: Partial<RecordingI>): RecordingI | null => {
    const recording = recordings.get(id);
    
    if (!recording) {
      return null;
    }
    
    // Apply updates
    const updatedRecording = { ...recording, ...updates, updatedAt: new Date() };
    recordings.set(id, updatedRecording);
    
    return updatedRecording;
  },
  
  /**
   * Delete a recording
   */
  deleteRecording: (id: string): boolean => {
    return recordings.delete(id);
  }
};

export default {
  notes: noteOperations,
  recordings: recordingOperations
};