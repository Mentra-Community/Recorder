/**
 * Recordings service
 * Handles business logic for recordings
 */

import { AudioChunk, TpaSession, TranscriptionData, ViewType } from '@augmentos/sdk';
import { RecordingStatus, AudioChunkI, TranscriptionDataI } from '../types/recordings.types';
import { Recording, RecordingDocument } from '../models/recording.models';
import mongoose from 'mongoose';
import storageService from './storage.service';
import streamService from './stream.service';

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
            // Send event before starting recording
            streamService.broadcastToUser(userId, 'voice-command', {
              command: 'start-recording',
              timestamp: Date.now()
            });
            
            const recordingId = await this.startRecording(userId, sessionId);
            
            session.layouts.showReferenceCard(
              "Recording Started",
              "Say 'stop recording' when done",
              { view: ViewType.MAIN, durationMs: 3000 }
            );
            
            // Send additional confirmation event with the ID
            streamService.broadcastToUser(userId, 'recording-started-by-voice', {
              id: recordingId,
              timestamp: Date.now()
            });
          } 
          else if (text.includes('stop recording')) {
            // Find active recording before sending any events
            const recording = Array.from(this.activeRecordings.values())
              .find(r => r.sessionId === sessionId && r.userId === userId);
              
            // Only proceed if there is an active recording
            if (recording) {
              console.log(`[VOICE COMMAND] Processing 'stop recording' for recording ${recording.recordingId}`);
              
              // Send event before stopping recording
              streamService.broadcastToUser(userId, 'voice-command', {
                command: 'stop-recording',
                timestamp: Date.now()
              });
              
              // Stop the recording (this will also remove it from activeRecordings)
              await this.stopRecording(recording.recordingId);
              
              session.layouts.showReferenceCard(
                "Recording Stopped",
                "Processing your recording...",
                { view: ViewType.MAIN, durationMs: 3000 }
              );
              
              // Send additional confirmation event with the ID
              streamService.broadcastToUser(userId, 'recording-stopped-by-voice', {
                id: recording.recordingId,
                timestamp: Date.now()
              });
            } else {
              console.log(`[VOICE COMMAND] Ignoring 'stop recording' command as no active recording was found`);
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
    
    try {
      // Create a new recording using Mongoose model
      const newRecording = new Recording({
        userId,
        sessionId,
        title: `Recording ${new Date().toLocaleString()}`,
        isRecording: true,
        status: RecordingStatus.RECORDING,
        transcript: '',
        duration: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      // Save to MongoDB
      const savedRecording = await newRecording.save();
      
      // Convert ObjectId to string
      const recordingId = savedRecording._id.toString();
      
      console.log(`[RECORDING] Created recording in MongoDB with ID: ${recordingId}`);
      
      // Now initialize upload with the MongoDB ID
      await storageService.beginStreamingUpload(userId, recordingId);
      
      // Track this recording
      this.activeRecordings.set(recordingId, {
        recordingId,
        userId,
        sessionId,
        startTime: Date.now()
      });
      
      // Notify clients
      streamService.broadcastToUser(userId, 'recording-status', {
        id: recordingId, // Keep using 'id' for client-side compatibility for now
        isRecording: true,
        duration: 0,
        title: savedRecording.title,
        transcript: '',
        createdAt: savedRecording.createdAt.getTime()
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
    // Log audio chunk sizes periodically
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
        
        // Update recording duration in MongoDB directly
        try {
          await Recording.findByIdAndUpdate(recordingId, {
            duration: currentDuration,
            updatedAt: new Date()
          });
        } catch (error) {
          console.error('[RECORDING] Failed to update recording duration in MongoDB:', error);
        }
        
        // Send update to client
        streamService.broadcastToUser(recording.userId, 'recording-status', {
          id: recordingId, // Keep using 'id' for client-side compatibility for now
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
      // Update transcript in MongoDB directly
      await Recording.findByIdAndUpdate(recordingId, {
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
    
    // IMPORTANT: Add a debounce mechanism to prevent multiple stop attempts for the same recording
    // Remove from active recordings immediately to prevent duplicate stops
    const recordingData = this.activeRecordings.get(recordingId);
    this.activeRecordings.delete(recordingId);
    
    if (!recordingData) {
      console.log(`[RECORDING] Recording ${recordingId} was already removed from active recordings`);
      return;
    }
    
    try {
      // Complete the storage upload
      const fileUrl = await storageService.completeUpload(recordingId);
      
      // Update recording in MongoDB directly
      const duration = Math.round((Date.now() - recording.startTime) / 1000);
      await Recording.findByIdAndUpdate(recordingId, {
        isRecording: false,
        status: RecordingStatus.COMPLETED,
        fileUrl,
        duration,
        updatedAt: new Date()
      });
      
      // Clean up already happened at the start of this method
      
      // Notify clients
      streamService.broadcastToUser(recording.userId, 'recording-status', {
        id: recordingId, // Keep using 'id' for client-side compatibility for now
        isRecording: false,
        duration,
        fileUrl,
        status: RecordingStatus.COMPLETED
      });
      
      console.log(`Stopped recording ${recordingId}, duration: ${duration}s`);
    } catch (error) {
      console.error(`Error stopping recording ${recordingId}:`, error);
      
      // Update with error status
      try {
        await Recording.findByIdAndUpdate(recordingId, {
          isRecording: false,
          status: RecordingStatus.ERROR,
          error: error instanceof Error ? error.message : String(error),
          updatedAt: new Date()
        });
      } catch (dbError) {
        console.error('[RECORDING] Failed to update error status in MongoDB:', dbError);
      }
      
      // Clean up already happened at the start of this method
      
      // Notify clients of error
      streamService.broadcastToUser(recording.userId, 'recording-error', {
        id: recordingId, // Keep using 'id' for client-side compatibility for now
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  
  /**
   * Get recordings for a user
   */
  async getRecordingsForUser(userId: string): Promise<RecordingDocument[]> {
    try {
      // Find all recordings for this user from MongoDB
      const recordings = await Recording.find({ userId })
        .sort({ createdAt: -1 })
        .exec();
      
      return recordings;
    } catch (error) {
      console.error(`Error getting recordings for user ${userId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get a recording by ID
   */
  async getRecordingById(recordingId: string): Promise<RecordingDocument> {
    try {
      // Find recording by ID in MongoDB
      const recording = await Recording.findById(recordingId).exec();
      
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
      // Get recording from MongoDB
      const recording = await Recording.findById(recordingId).exec();
      
      if (!recording) {
        throw new Error(`Recording ${recordingId} not found`);
      }
      
      // Delete the file from storage
      await storageService.deleteFile(recording.userId, `${recordingId}.wav`);
      
      // Delete from MongoDB
      await Recording.findByIdAndDelete(recordingId).exec();
      
      // Notify clients
      streamService.broadcastToUser(recording.userId, 'recording-deleted', {
        id: recordingId // Keep using 'id' for client-side compatibility for now
      });
    } catch (error) {
      console.error(`Error deleting recording ${recordingId}:`, error);
      throw error;
    }
  }
  
  /**
   * Update a recording (e.g., rename)
   */
  async updateRecording(recordingId: string, updates: Partial<RecordingDocument>): Promise<RecordingDocument> {
    try {
      // Update recording in MongoDB
      const updatedRecording = await Recording.findByIdAndUpdate(
        recordingId,
        { ...updates, updatedAt: new Date() },
        { new: true } // Return the updated document
      ).exec();
      
      if (!updatedRecording) {
        throw new Error(`Recording ${recordingId} not found or could not be updated`);
      }
      
      // Notify clients
      streamService.broadcastToUser(updatedRecording.userId, 'recording-status', {
        id: recordingId, // Keep using 'id' for client-side compatibility for now
        ...updates,
        updatedAt: updates.updatedAt?.getTime() || Date.now()
      });
      
      return updatedRecording;
    } catch (error) {
      console.error(`Error updating recording ${recordingId}:`, error);
      throw error;
    }
  }
}

export default new RecordingsService();