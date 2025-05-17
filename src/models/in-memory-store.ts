/**
 * In-memory data store for development
 * This will be replaced with MongoDB in Phase 2
 */

import { RecordingI } from '../types/recordings.types';

// Initialize empty collections
const recordings: Map<string, RecordingI> = new Map();

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
  recordings: recordingOperations
};