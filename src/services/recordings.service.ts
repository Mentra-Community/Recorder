/**
 * Recordings service
 * Handles business logic for recordings
 */

import { AudioChunk, TpaSession, TranscriptionData, ViewType } from '@mentra/sdk';
import { RecordingStatus, AudioChunkI, TranscriptionDataI } from '../types/recordings.types';
import { Recording, RecordingDocument } from '../models/recording.models';
import mongoose from 'mongoose';
import storageService from './storage.service';
import streamService from './stream.service';
import { hasActiveSession, registerActiveSession } from '../api/session.api';

class RecordingsService {
  /**
   * Clean up stale recordings from previous sessions
   */
  private async cleanupStaleRecordings(userId: string): Promise<void> {
    try {
      console.log(`[CLEANUP] Checking for stale recordings for user ${userId}`);
      
      // Find all recordings that are stuck in active states
      const staleRecordings = await Recording.find({
        userId,
        status: {
          $in: [RecordingStatus.INITIALIZING, RecordingStatus.RECORDING, RecordingStatus.STOPPING]
        }
      }).exec();
      
      if (staleRecordings.length > 0) {
        console.log(`[CLEANUP] Found ${staleRecordings.length} stale recordings for user ${userId}`);
        
        for (const recording of staleRecordings) {
          try {
            console.log(`[CLEANUP] Marking stale recording ${recording._id} as ERROR`);
            
            // Mark as error with explanation
            await Recording.findByIdAndUpdate(recording._id, {
              status: RecordingStatus.ERROR,
              error: 'Recording was interrupted by session disconnect',
              updatedAt: new Date()
            });
            
            // Try to finalize storage if it was initialized
            if (recording.storage?.initialized) {
              try {
                const fileUrl = await storageService.completeUpload(recording._id.toString());
                await Recording.findByIdAndUpdate(recording._id, {
                  'storage.fileUrl': fileUrl
                });
                console.log(`[CLEANUP] Finalized storage for stale recording ${recording._id}`);
              } catch (storageErr) {
                console.log(`[CLEANUP] Could not finalize storage for ${recording._id}:`, storageErr);
              }
            }
          } catch (err) {
            console.error(`[CLEANUP] Error cleaning up recording ${recording._id}:`, err);
          }
        }
        
        // Notify clients to refresh their recording lists
        streamService.broadcastToUser(userId, 'recordings-refresh', {
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error(`[CLEANUP] Error during stale recording cleanup for user ${userId}:`, error);
    }
  }

  /**
   * Get the active recording for a user
   * This replaces our in-memory tracking with database-driven tracking
   */
  async getActiveRecordingForUser(userId: string): Promise<RecordingDocument | null> {
    try {
      const activeRecording = await Recording.findOne({
        userId,
        status: {
          $in: [
            RecordingStatus.INITIALIZING,
            RecordingStatus.RECORDING,
            RecordingStatus.STOPPING
          ]
        }
      }).exec();
      
      return activeRecording;
    } catch (error) {
      console.error(`[RECORDING] Error getting active recording for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Track active SDK sessions
   */
  private activeSdkSessions = new Map<string, TpaSession>();

  /**
   * Handle new session from AugmentOS SDK
   */
  setupSDKSession(session: TpaSession, sessionId: string, userId: string): void {
    console.log(`[TPA SESSION] Setting up session for user ${userId}`);
    
    // Store session for future use
    this.activeSdkSessions.set(userId, session);
    
    // Clean up any stale recordings from previous sessions
    this.cleanupStaleRecordings(userId);
    
    // Register this as an active session
    registerActiveSession(userId);
    
    // Set up handlers for audio chunks
    session.events.onAudioChunk(async (chunk: AudioChunk) => {
      // Get active recording for this user from database
      const activeRecording = await this.getActiveRecordingForUser(userId);
      
      if (activeRecording && activeRecording.status === RecordingStatus.RECORDING) {
        // Only process chunks for recordings in RECORDING state
        await this.processAudioChunk(activeRecording._id.toString(), chunk);
      }
    });
    
    // Set up handlers for transcription
    try {
      session.onTranscriptionForLanguage('en-US', async (transcription: TranscriptionData) => {
        console.log(`[TRANSCRIPTION] ${transcription.isFinal ? 'FINAL' : 'interim'}: "${transcription.text}"`);
        
        // Process transcription if user has an active recording
        const activeRecording = await this.getActiveRecordingForUser(userId);
        
        if (activeRecording && activeRecording.status === RecordingStatus.RECORDING) {
          await this.updateTranscript(
            activeRecording._id.toString(), 
            transcription.text,
            transcription.isFinal
          );
        }
        
        // Check for voice commands (only in final transcripts)
        if (transcription.isFinal) {
          const text = transcription.text.toLowerCase();
          
          if (text.includes('start recording')) {
            console.log(`[VOICE COMMAND] Received 'start recording' command from user ${userId}`);
            
            try {
              // Check if user already has an active recording first
              const existingRecording = await this.getActiveRecordingForUser(userId);
              
              if (existingRecording) {
                console.log(`[VOICE COMMAND] User ${userId} already has an active recording: ${existingRecording._id}`);
                
                // Send notification to client about the existing recording
                streamService.broadcastToUser(userId, 'voice-command', {
                  command: 'recording-already-active',
                  recordingId: existingRecording._id.toString(),
                  timestamp: Date.now()
                });
                
                // Show message to user
                this.showReferenceCard(userId, 
                  "Recording Already Active",
                  "You already have an active recording",
                  3000
                );
              } else {
                // Notify client that we're starting a recording
                streamService.broadcastToUser(userId, 'voice-command', {
                  command: 'start-recording',
                  timestamp: Date.now()
                });
                
                // Start a new recording
                const recordingId = await this.startRecording(userId);
                
                // Show message to user
                this.showReferenceCard(userId,
                  "Recording Started",
                  "Say 'stop recording' when done",
                  3000
                );
                
                // Send confirmation with the recording ID
                streamService.broadcastToUser(userId, 'recording-started-by-voice', {
                  id: recordingId,
                  timestamp: Date.now()
                });
              }
            } catch (error) {
              console.error(`[VOICE COMMAND] Error processing 'start recording' command:`, error);
              
              // Notify user of error
              this.showReferenceCard(userId,
                "Recording Failed",
                "Unable to start recording",
                3000
              );
            }
          } 
          else if (text.includes('stop recording')) {
            console.log(`[VOICE COMMAND] Received 'stop recording' command from user ${userId}`);
            
            try {
              // Get the user's active recording (if any)
              const activeRecording = await this.getActiveRecordingForUser(userId);
              
              if (activeRecording) {
                const recordingId = activeRecording._id.toString();
                
                console.log(`[VOICE COMMAND] Stopping active recording ${recordingId} for user ${userId}`);
                
                // Stop the recording first before sending events
                await this.stopRecording(recordingId);
                
                // Then send notification to clients
                streamService.broadcastToUser(userId, 'voice-command', {
                  command: 'stop-recording',
                  timestamp: Date.now()
                });
                
                // Show message to user
                this.showReferenceCard(userId,
                  "Recording Stopped",
                  "Processing your recording...",
                  3000
                );
                
                // Send confirmation with the recording ID
                streamService.broadcastToUser(userId, 'recording-stopped-by-voice', {
                  id: recordingId,
                  timestamp: Date.now()
                });
              } else {
                console.log(`[VOICE COMMAND] No active recording found for user ${userId}`);
                
                // Show message to user
                this.showReferenceCard(userId,
                  "No Active Recording",
                  "You don't have an active recording to stop",
                  3000
                );
              }
            } catch (error) {
              console.error(`[VOICE COMMAND] Error processing 'stop recording' command:`, error);
              
              // Notify user of error
              this.showReferenceCard(userId,
                "Error Stopping Recording",
                "Unable to stop recording",
                3000
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
   * Helper to show reference card on glasses, abstracted for reuse
   */
  private showReferenceCard(userId: string, title: string, description: string, durationMs: number = 3000): void {
    const session = this.activeSdkSessions.get(userId);
    if (session) {
      try {
        session.layouts.showReferenceCard(
          title,
          description,
          { view: ViewType.MAIN, durationMs }
        );
      } catch (error) {
        console.error(`[TPA] Error showing reference card to user ${userId}:`, error);
      }
    } else {
      console.log(`[TPA] Cannot show reference card to user ${userId}: no active session`);
    }
  }
  
  /**
   * Start a new recording
   * 
   * This is a command handler that ensures only one active recording per user
   * and verifies that a valid TPA session exists
   */
  async startRecording(userId: string, isVoiceInitiated: boolean = false): Promise<string> {
    console.log(`[RECORDING] Starting recording for user ${userId}`);
    
    try {
      // First check if user already has an active recording
      const existingRecording = await this.getActiveRecordingForUser(userId);
      
      if (existingRecording) {
        console.log(`[RECORDING] User ${userId} already has an active recording: ${existingRecording._id}`);
        throw new Error(`User already has an active recording: ${existingRecording._id}. Please stop the current recording before starting a new one.`);
      }
      
      // Check if the user has an active TPA session - skip for voice-initiated recordings
      // as those already come from an active TPA session
      if (!isVoiceInitiated && !hasActiveSession(userId)) {
        console.log(`[RECORDING] Rejecting recording start - no active TPA session for user ${userId}`);
        throw new Error('No active AugmentOS SDK session. Please ensure your glasses are connected.');
      }
      
      // Create new recording with INITIALIZING status
      const newRecording = new Recording({
        userId,
        title: `Recording ${new Date().toLocaleString()}`,
        transcript: '',
        transcriptChunks: [],
        duration: 0,
        storage: {
          initialized: false
        },
        status: RecordingStatus.INITIALIZING,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      // Save to MongoDB - this will enforce the unique index constraint
      const savedRecording = await newRecording.save();
      const recordingId = savedRecording._id.toString();
      
      console.log(`[RECORDING] Created recording in MongoDB with ID: ${recordingId}`);
      
      try {
        // Initialize storage
        await storageService.beginStreamingUpload(userId, recordingId);
        
        // Update recording to RECORDING status and mark storage as initialized
        await Recording.findByIdAndUpdate(recordingId, {
          status: RecordingStatus.RECORDING,
          'storage.initialized': true,
          updatedAt: new Date()
        });
        
        // Notify clients
        streamService.broadcastToUser(userId, 'recording-status', {
          id: recordingId,
          status: RecordingStatus.RECORDING,
          duration: 0,
          title: savedRecording.title,
          transcript: '',
          createdAt: savedRecording.createdAt.getTime()
        });
        
        // Show feedback on glasses if initiated from UI (voice already shows feedback)
        if (!isVoiceInitiated) {
          this.showReferenceCard(userId,
            "Recording Started",
            "Recording audio...",
            3000
          );
        }
        
        console.log(`[RECORDING] Started recording ${recordingId} for user ${userId}`);
        return recordingId;
      } catch (storageError) {
        // If storage initialization fails, update recording status to ERROR
        console.error(`[RECORDING] Failed to initialize storage for recording ${recordingId}:`, storageError);
        
        await Recording.findByIdAndUpdate(recordingId, {
          status: RecordingStatus.ERROR,
          error: storageError instanceof Error ? storageError.message : String(storageError),
          updatedAt: new Date()
        });
        
        // Notify clients about error
        streamService.broadcastToUser(userId, 'recording-error', {
          id: recordingId,
          error: storageError instanceof Error ? storageError.message : String(storageError)
        });
        
        throw storageError;
      }
    } catch (error) {
      console.error(`[RECORDING] Error starting recording for user ${userId}:`, error);
      throw error;
    }
  }
  
  /**
   * Process an audio chunk
   * 
   * This method handles audio chunks for a recording
   */
  async processAudioChunk(recordingId: string, chunk: AudioChunk): Promise<void> {
    try {
      // Verify recording exists and is in RECORDING state
      const recordingDoc = await Recording.findById(recordingId).exec();
      
      if (!recordingDoc) {
        console.log(`[AUDIO] Ignoring chunk for non-existent recording ${recordingId}`);
        return;
      }
      
      if (recordingDoc.status !== RecordingStatus.RECORDING) {
        console.log(`[AUDIO] Ignoring chunk for recording ${recordingId} - recording is in ${recordingDoc.status} state`);
        return;
      }
      
      // Log audio chunk sizes periodically
      if (Math.random() < 0.1) {
        console.log(`[AUDIO] Processing chunk for recording ${recordingId}, size: ${chunk.arrayBuffer.byteLength} bytes`);
      }
      
      // Verify storage is initialized
      if (!recordingDoc.storage || !recordingDoc.storage.initialized) {
        console.log(`[AUDIO] Recording ${recordingId} has uninitialized storage, initializing now`);
        
        // Initialize storage if needed
        await storageService.beginStreamingUpload(recordingDoc.userId, recordingId);
        
        // Update recording to mark storage as initialized
        await Recording.findByIdAndUpdate(recordingId, {
          'storage.initialized': true,
          updatedAt: new Date()
        });
      }
      
      // Try to add the chunk to storage
      try {
        // Check if storage has active upload
        if (!storageService.hasActiveUpload(recordingId)) {
          console.log(`[AUDIO] No active upload for ${recordingId}, reinitializing storage`);
          await storageService.beginStreamingUpload(recordingDoc.userId, recordingId);
        }
        
        // Add chunk to storage
        const chunkProcessed = await storageService.addChunk(recordingId, chunk.arrayBuffer);
        
        // If a significant amount of data was processed, update duration
        if (chunkProcessed) {
          // Get the current time minus the creation time to calculate duration
          const currentDuration = Math.round(
            (Date.now() - recordingDoc.createdAt.getTime()) / 1000
          );
          
          // Update recording duration in MongoDB
          await Recording.findByIdAndUpdate(recordingId, {
            duration: currentDuration,
            updatedAt: new Date()
          });
          
          // Send update to clients
          streamService.broadcastToUser(recordingDoc.userId, 'recording-status', {
            id: recordingId,
            status: RecordingStatus.RECORDING,
            duration: currentDuration
          });
        }
      } catch (storageError: unknown) {
        console.error(`[AUDIO] Error processing chunk for recording ${recordingId}:`, storageError);

        // If this is a critical error, mark the recording as ERROR
        if ((storageError as Error).message && (storageError as Error).message.includes('No active upload')) {
          console.log(`[AUDIO] Critical storage error for ${recordingId}, marking recording as ERROR`);

          await Recording.findByIdAndUpdate(recordingId, {
            status: RecordingStatus.ERROR,
            error: `Storage error: ${(storageError as Error).message}`,
            updatedAt: new Date()
          });

          // Notify clients about error
          streamService.broadcastToUser(recordingDoc.userId, 'recording-error', {
            id: recordingId,
            error: `Storage error: ${(storageError as Error).message}`
          });
        }
      }
    } catch (error) {
      console.error(`[AUDIO] Unhandled error processing chunk for ${recordingId}:`, error);
    }
  }
  
  /**
   * Update transcript for a recording
   * 
   * This method handles transcript updates for a recording
   */
  async updateTranscript(recordingId: string, text: string, isFinal: boolean = true): Promise<void> {
    try {
      // Verify recording exists and is in RECORDING state
      const recordingDoc = await Recording.findById(recordingId).exec();
      
      if (!recordingDoc) {
        console.error(`[TRANSCRIPT] Recording ${recordingId} not found for transcript update`);
        return;
      }
      
      // Only process transcripts for recordings in RECORDING state
      if (recordingDoc.status !== RecordingStatus.RECORDING) {
        console.log(`[TRANSCRIPT] Ignoring transcript update for ${recordingId} - recording is in ${recordingDoc.status} state`);
        return;
      }
      
      const currentTime = Date.now();
      const userId = recordingDoc.userId;
      
      if (isFinal) {
        console.log(`[TRANSCRIPT] Adding final transcript for ${recordingId}: "${text}"`);
        
        // Get existing transcript chunks
        const existingChunks = recordingDoc.transcriptChunks || [];
        
        // Create the new chunk
        const newChunk = { 
          text,
          timestamp: currentTime,
          isFinal: true
        };
        
        // Add the new chunk to the array
        const updatedChunks = [...existingChunks, newChunk];
        
        // Build full transcript by joining all chunks with spaces
        const fullTranscript = updatedChunks.map(chunk => chunk.text).join(' ');
        
        // Update the recording with the new transcript and chunks
        await Recording.findByIdAndUpdate(recordingId, {
          transcript: fullTranscript,
          transcriptChunks: updatedChunks,
          currentInterim: '', // Clear interim since we now have a final
          updatedAt: new Date()
        });
        
        // Send the full transcript to clients
        streamService.broadcastToUser(userId, 'transcript', {
          recordingId,
          text: fullTranscript,
          timestamp: currentTime
        });
      } else {
        // For interim transcripts, just update the currentInterim field
        console.log(`[TRANSCRIPT] Updating interim transcript for ${recordingId}: "${text}"`);
        
        await Recording.findByIdAndUpdate(recordingId, {
          currentInterim: text,
          updatedAt: new Date()
        });
        
        // Build the text to display to the user (all final chunks + current interim)
        const existingChunks = recordingDoc.transcriptChunks || [];
        const finalsText = existingChunks.map(chunk => chunk.text).join(' ');
        const displayText = finalsText ? `${finalsText} ${text}` : text;
        
        // Send the combined transcript + interim to clients
        streamService.broadcastToUser(userId, 'transcript', {
          recordingId,
          text: displayText,
          isInterim: true,
          timestamp: currentTime
        });
      }
    } catch (error) {
      console.error(`[TRANSCRIPT] Error updating transcript for ${recordingId}:`, error);
    }
  }
  
  /**
   * Stop an active recording
   * 
   * This is a command handler that stops a recording
   */
  async stopRecording(recordingId: string, isVoiceInitiated: boolean = false): Promise<void> {
    console.log(`[RECORDING] Stopping recording ${recordingId}`);
    
    try {
      // First get the recording from the database
      const recordingDoc = await Recording.findById(recordingId).exec();
      
      // If recording doesn't exist, return early
      if (!recordingDoc) {
        console.log(`[RECORDING] Recording ${recordingId} not found in database`);
        return;
      }
      
      // If recording is already completed or in an error state, return early
      if (recordingDoc.status === RecordingStatus.COMPLETED || 
          recordingDoc.status === RecordingStatus.ERROR) {
        console.log(`[RECORDING] Recording ${recordingId} is already in ${recordingDoc.status} state`);
        return;
      }
      
      // If recording is already in STOPPING state, just wait for it to complete
      if (recordingDoc.status === RecordingStatus.STOPPING) {
        console.log(`[RECORDING] Recording ${recordingId} is already in STOPPING state`);
        return;
      }
      
      const userId = recordingDoc.userId;
      
      // Show feedback on glasses if initiated from UI (voice already shows feedback)
      if (!isVoiceInitiated) {
        this.showReferenceCard(userId,
          "Recording Stopped",
          "Processing your recording...",
          3000
        );
      }
      
      // Mark recording as STOPPING to prevent new chunks and transcripts
      await Recording.findByIdAndUpdate(recordingId, {
        status: RecordingStatus.STOPPING,
        updatedAt: new Date()
      });
      console.log(`[RECORDING] Marked recording ${recordingId} as STOPPING`);
      
      // Immediately notify clients of STOPPING state so UI can update
      streamService.broadcastToUser(userId, 'recording-status', {
        id: recordingId,
        status: RecordingStatus.STOPPING
      });
      
      // If there's a current interim transcript, save it as a final chunk
      if (recordingDoc.currentInterim) {
        console.log(`[RECORDING] Saving last interim transcript as final: "${recordingDoc.currentInterim}"`);
        
        const existingChunks = recordingDoc.transcriptChunks || [];
        const updatedChunks = [...existingChunks, { 
          text: recordingDoc.currentInterim,
          timestamp: Date.now(),
          isFinal: true
        }];
        
        // Rebuild the full transcript
        const fullTranscript = updatedChunks.map(chunk => chunk.text).join(' ');
        
        // Update the transcript
        await Recording.findByIdAndUpdate(recordingId, {
          transcript: fullTranscript,
          transcriptChunks: updatedChunks,
          currentInterim: '',
          updatedAt: new Date()
        });
      }
      
      // Now finalize the storage
      try {
        let fileUrl;
        
        // Check if storage was initialized
        if (recordingDoc.storage && recordingDoc.storage.initialized) {
          try {
            // Try to complete the upload
            fileUrl = await storageService.completeUpload(recordingId);
          } catch (storageError) {
            if ((storageError as Error).message && (storageError as Error).message.includes('No active upload')) {
              // If storage was marked as initialized but has no active upload,
              // initialize it and try again
              console.log(`[RECORDING] Storage marked as initialized but no active upload found`);
              await storageService.beginStreamingUpload(userId, recordingId);
              fileUrl = await storageService.completeUpload(recordingId);
            } else {
              throw storageError;
            }
          }
        } else {
          // If storage was never initialized, initialize it and create an empty file
          console.log(`[RECORDING] Storage never initialized for ${recordingId}, creating empty file`);
          await storageService.beginStreamingUpload(userId, recordingId);
          fileUrl = await storageService.completeUpload(recordingId);
        }
        
        // Calculate final duration
        const duration = Math.round(
          (Date.now() - recordingDoc.createdAt.getTime()) / 1000
        );
        
        // Update recording to COMPLETED state
        await Recording.findByIdAndUpdate(recordingId, {
          status: RecordingStatus.COMPLETED,
          duration,
          'storage.fileUrl': fileUrl,
          updatedAt: new Date()
        });
        
        console.log(`[RECORDING] Successfully stopped recording ${recordingId}, duration: ${duration}s`);
        
        // Notify clients
        streamService.broadcastToUser(userId, 'recording-status', {
          id: recordingId,
          status: RecordingStatus.COMPLETED,
          duration,
          fileUrl,
        });
        
        // Notify clients that they should refresh recordings list
        streamService.broadcastToUser(userId, 'recordings-refresh', {
          timestamp: Date.now()
        });
      } catch (error) {
        console.error(`[RECORDING] Error finalizing recording ${recordingId}:`, error);
        
        // Mark recording as ERROR
        await Recording.findByIdAndUpdate(recordingId, {
          status: RecordingStatus.ERROR,
          error: error instanceof Error ? error.message : String(error),
          updatedAt: new Date()
        });
        
        // Notify clients
        streamService.broadcastToUser(userId, 'recording-error', {
          id: recordingId,
          error: error instanceof Error ? error.message : String(error)
        });
        
        throw error;
      }
    } catch (error) {
      console.error(`[RECORDING] Unhandled error stopping recording ${recordingId}:`, error);
      throw error;
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
      await storageService.deleteFile(recording.userId, recordingId);
      
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