/**
 * Recordings service
 * Handles business logic for recordings
 */

import { v4 as uuidv4 } from 'uuid';
import { AudioChunk, TpaSession, TranscriptionData, ViewType } from '@augmentos/sdk';
import { RecordingI, RecordingStatus, AudioChunkI, TranscriptionDataI } from '../types/recordings.types';
import { NoteI } from '../types/notes.types';
import storageService from './storage.service';
import streamService from './stream.service';
import store from '../models/in-memory-store';

class RecordingsService {
  private activeRecordings = new Map<string, {
    recordingId: string;
    userId: string;
    sessionId: string;
    startTime: number;
  }>();
  
  /**
   * Expose active recordings for debugging
   */
  getActiveRecordings(): object {
    return Object.fromEntries(this.activeRecordings);
  }

  /**
   * Handle new session from AugmentOS SDK
   */
  setupSDKSession(session: TpaSession, sessionId: string, userId: string): void {
    console.log(`[TPA SESSION] Setting up session for user ${userId}, session ${sessionId}`);
    
    // Set up handlers for audio chunks
    session.events.onAudioChunk((chunk: AudioChunk) => {
      const activeRecording = Array.from(this.activeRecordings.values())
        .find(r => r.sessionId === sessionId && r.userId === userId);
        
      if (activeRecording) {
        this.processAudioChunk(activeRecording.recordingId, chunk);
      }
    });
    
    // Set up handlers for transcription
    try {
      session.onTranscriptionForLanguage('en-US', async (transcription: TranscriptionData) => {
        console.log(`[TRANSCRIPTION] ${transcription.isFinal ? 'FINAL' : 'interim'}: "${transcription.text}"`);
        // Process transcription if recording is active
        const activeRecording = Array.from(this.activeRecordings.values())
          .find(r => r.sessionId === sessionId && r.userId === userId);
          
        if (activeRecording && transcription.isFinal) {
          await this.updateTranscript(
            activeRecording.recordingId, 
            transcription.text
          );
        }
        
        // Check for voice commands
        if (transcription.isFinal) {
          const text = transcription.text.toLowerCase();
          
          if (text.includes('start recording')) {
            await this.startRecording(userId, sessionId);
            session.layouts.showReferenceCard(
              "Recording Started",
              "Say 'stop recording' when done",
              { view: ViewType.MAIN, durationMs: 3000 }
            );
          } 
          else if (text.includes('stop recording')) {
            const recording = Array.from(this.activeRecordings.values())
              .find(r => r.sessionId === sessionId && r.userId === userId);
              
            if (recording) {
              await this.stopRecording(recording.recordingId);
              session.layouts.showReferenceCard(
                "Recording Stopped",
                "Processing your recording...",
                { view: ViewType.MAIN, durationMs: 3000 }
              );
            }
          }
        }
      });
      console.log('Transcription handler set up successfully');
    } catch (error) {
      console.error('Error setting up transcription handler:', error);
    }
  }
  
  /**
   * Start a new recording
   */
  async startRecording(userId: string, sessionId: string): Promise<string> {
    console.log(`[RECORDING] Starting recording for user ${userId}, session ${sessionId}`);
    
    // Check if already recording in this session
    const existingRecording = Array.from(this.activeRecordings.values())
      .find(r => r.sessionId === sessionId && r.userId === userId);
      
    if (existingRecording) {
      console.log(`[RECORDING] Already recording with ID ${existingRecording.recordingId}`);
      return existingRecording.recordingId;
    }
    
    // Create a new recording ID
    const recordingId = `rec_${Date.now()}_${uuidv4().substring(0, 8)}`;
    
    try {
      // Initialize upload to storage service
      await storageService.beginStreamingUpload(userId, recordingId);
      
      // Create recording in store
      const newRecording: RecordingI = {
        id: recordingId,
        userId,
        sessionId,
        title: `Recording ${new Date().toLocaleString()}`,
        isRecording: true,
        status: RecordingStatus.RECORDING,
        transcript: '',
        duration: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      store.recordings.createRecording(newRecording);
      
      // Track this recording
      this.activeRecordings.set(recordingId, {
        recordingId,
        userId,
        sessionId,
        startTime: Date.now()
      });
      
      // Notify clients
      streamService.broadcastToUser(userId, 'recording-status', {
        id: recordingId,
        isRecording: true,
        duration: 0,
        title: newRecording.title,
        transcript: '',
        createdAt: newRecording.createdAt.getTime()
      });
      
      console.log(`Started recording ${recordingId} for user ${userId}`);
      return recordingId;
    } catch (error) {
      console.error(`Error starting recording for user ${userId}:`, error);
      throw error;
    }
  }
  
  /**
   * Process an audio chunk
   */
  async processAudioChunk(recordingId: string, chunk: AudioChunk): Promise<void> {
    // Log audio chunk sizes periodically (every 10th chunk)
    if (Math.random() < 0.1) {
      console.log(`[AUDIO] Processing chunk for recording ${recordingId}, size: ${chunk.arrayBuffer.byteLength} bytes`);
    }
    
    const recording = this.activeRecordings.get(recordingId);
    
    if (!recording) {
      console.log(`[AUDIO] Received chunk for unknown recording ${recordingId}`);
      return;
    }
    
    try {
      // Stream the chunk to storage
      const partUploaded = await storageService.addChunk(recordingId, chunk.arrayBuffer);
      
      // If we uploaded a part, update the store with current duration
      if (partUploaded) {
        const currentDuration = Math.round((Date.now() - recording.startTime) / 1000);
        
        store.recordings.updateRecording(recordingId, {
          duration: currentDuration,
          updatedAt: new Date()
        });
        
        // Send update to client
        streamService.broadcastToUser(recording.userId, 'recording-status', {
          id: recordingId,
          isRecording: true,
          duration: currentDuration
        });
      }
    } catch (error) {
      console.error(`Error processing chunk for ${recordingId}:`, error);
    }
  }
  
  /**
   * Update transcript for a recording
   */
  async updateTranscript(recordingId: string, text: string): Promise<void> {
    const recording = this.activeRecordings.get(recordingId);
    
    if (!recording) return;
    
    try {
      // Update in store
      store.recordings.updateRecording(recordingId, {
        transcript: text,
        updatedAt: new Date()
      });
      
      // Send to clients
      streamService.broadcastToUser(recording.userId, 'transcript', {
        recordingId,
        text,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`Error updating transcript for ${recordingId}:`, error);
    }
  }
  
  /**
   * Stop an active recording
   */
  async stopRecording(recordingId: string): Promise<void> {
    console.log(`[RECORDING] Stopping recording ${recordingId}`);
    const recording = this.activeRecordings.get(recordingId);
    
    if (!recording) {
      console.log(`[RECORDING] No active recording found with ID ${recordingId}`);
      return;
    }
    
    try {
      // Complete the storage upload
      const fileUrl = await storageService.completeUpload(recordingId);
      
      // Update recording in store
      const duration = Math.round((Date.now() - recording.startTime) / 1000);
      
      const updatedRecording = store.recordings.updateRecording(recordingId, {
        isRecording: false,
        status: RecordingStatus.COMPLETED,
        fileUrl,
        duration,
        updatedAt: new Date()
      });
      
      // Clean up
      this.activeRecordings.delete(recordingId);
      
      // Notify clients
      streamService.broadcastToUser(recording.userId, 'recording-status', {
        id: recordingId,
        isRecording: false,
        duration,
        fileUrl,
        status: RecordingStatus.COMPLETED
      });
      
      console.log(`Stopped recording ${recordingId}, duration: ${duration}s`);
    } catch (error) {
      console.error(`Error stopping recording ${recordingId}:`, error);
      
      // Update with error status
      store.recordings.updateRecording(recordingId, {
        isRecording: false,
        status: RecordingStatus.ERROR,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date()
      });
      
      // Clean up anyway
      this.activeRecordings.delete(recordingId);
      
      // Notify clients of error
      streamService.broadcastToUser(recording.userId, 'recording-error', {
        id: recordingId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  /**
   * Create a note from a recording
   */
  async createNoteFromRecording(recordingId: string, content: string): Promise<NoteI> {
    try {
      // Find the recording
      const recording = store.recordings.findRecordingById(recordingId);
      
      if (!recording) {
        throw new Error(`Recording ${recordingId} not found`);
      }
      
      // Create a new note
      const noteId = `note_${Date.now()}_${uuidv4().substring(0, 8)}`;
      
      const note: NoteI = {
        id: noteId,
        userId: recording.userId,
        content: content || recording.transcript,
        sourceRecordingId: recordingId,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      store.notes.createNote(note);
      
      // Notify clients
      streamService.broadcastToUser(recording.userId, 'note', note);
      
      return note;
    } catch (error) {
      console.error(`Error creating note from recording ${recordingId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get recordings for a user
   */
  async getRecordingsForUser(userId: string): Promise<RecordingI[]> {
    try {
      const recordings = store.recordings.findRecordingsByUser(userId);
      return recordings;
    } catch (error) {
      console.error(`Error getting recordings for user ${userId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get a recording by ID
   */
  async getRecordingById(recordingId: string): Promise<RecordingI> {
    try {
      const recording = store.recordings.findRecordingById(recordingId);
      
      if (!recording) {
        throw new Error(`Recording ${recordingId} not found`);
      }
      
      return recording;
    } catch (error) {
      console.error(`Error getting recording ${recordingId}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete a recording
   */
  async deleteRecording(recordingId: string): Promise<void> {
    try {
      const recording = store.recordings.findRecordingById(recordingId);
      
      if (!recording) {
        throw new Error(`Recording ${recordingId} not found`);
      }
      
      // Delete the file
      await storageService.deleteFile(recording.userId, `${recordingId}.wav`);
      
      // Delete from store
      store.recordings.deleteRecording(recordingId);
      
      // Notify clients
      streamService.broadcastToUser(recording.userId, 'recording-deleted', {
        id: recordingId
      });
    } catch (error) {
      console.error(`Error deleting recording ${recordingId}:`, error);
      throw error;
    }
  }
}

export default new RecordingsService();