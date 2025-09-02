/**
 * Recordings service
 * Handles business logic for recordings
 */

import { AppSession, AudioChunk, TpaSession, TranscriptionData, ViewType } from '@mentra/sdk';
import { RecordingStatus, AudioChunkI, TranscriptionDataI } from '../types/recordings.types';
import { Recording, RecordingDocument } from '../models/recording.models';
import mongoose from 'mongoose';
import storageService from './storage.service';
import streamService from './stream.service';
import { hasActiveSession, registerActiveSession } from '../api/session.api';

class RecordingsService {
  /**
   * In-memory cache for active recordings (single-process only)
   * Keyed by recordingId
   */
  private activeRecordingsCache = new Map<string, RecordingDocument>();
  /**
   * Fast lookup of a user's active recordingId
   */
  private activeRecordingByUser = new Map<string, string>();
  /**
   * Clean up stale recordings from previous sessions
   */
  private async cleanupStaleRecordings(userId: string): Promise<void> {
    try {
      console.log(`[CLEANUP] Checking for stale recordings for user ${userId}`);
      // Only consider recordings that have been inactive beyond a threshold
      const staleThresholdMs = Number(process.env.RECORDER_STALE_THRESHOLD_MS || 2 * 60 * 1000); // default 2 minutes
      const cutoff = new Date(Date.now() - staleThresholdMs);
      
      // Find all recordings that are stuck in active states
      const staleRecordings = await Recording.find({
        userId,
        status: {
          $in: [RecordingStatus.INITIALIZING, RecordingStatus.RECORDING, RecordingStatus.STOPPING]
        },
        updatedAt: { $lt: cutoff }
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

            // Ensure cache cleanup
            this.activeRecordingsCache.delete(recording._id.toString());
            // Remove mapping if it points to this recording
            const current = this.activeRecordingByUser.get(userId);
            if (current === recording._id.toString()) {
              this.activeRecordingByUser.delete(userId);
            }
            
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
      // 1) Try cache first
      for (const rec of this.activeRecordingsCache.values()) {
        if (
          rec.userId === userId &&
          [RecordingStatus.INITIALIZING, RecordingStatus.RECORDING, RecordingStatus.STOPPING].includes(rec.status)
        ) {
          return rec;
        }
      }

      // 2) Fallback to DB
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

      // 3) Populate cache if found
      if (activeRecording) {
        this.activeRecordingsCache.set(activeRecording._id.toString(), activeRecording);
      }

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
   * Per-recording processing chains to serialize audio chunk handling (FIFO)
   */
  private processingChains = new Map<string, Promise<void>>();

  /**
   * Remove any user mapping that points to this recording ID
   */
  private clearActiveMappingForRecording(recordingId: string): void {
    for (const [uid, rid] of this.activeRecordingByUser.entries()) {
      if (rid === recordingId) this.activeRecordingByUser.delete(uid);
    }
  }

  /**
   * Enqueue an audio chunk for ordered processing for a specific recording
   */
  private enqueueAudioChunk(recordingId: string, chunk: AudioChunk): void {
    const prev = this.processingChains.get(recordingId) || Promise.resolve();
    const task = prev
      .then(() => this.processAudioChunk(recordingId, chunk))
      .catch((err) => {
        console.error(`[AUDIO] Error in queued processing for ${recordingId}:`, err);
      });

    // Store the new tail of the chain
    this.processingChains.set(recordingId, task);

    // Optional cleanup: remove entry when this task is the current tail and finishes
    task.finally(() => {
      const current = this.processingChains.get(recordingId);
      if (current === task) {
        this.processingChains.delete(recordingId);
      }
    });
  }

  /**
   * Handle new session from AugmentOS SDK
   */
  setupSDKSession(session: AppSession, sessionId: string, userId: string): void {
    console.log(`[TPA SESSION] Setting up session for user ${userId}`);
    
    // Store session for future use
    this.activeSdkSessions.set(userId, session);
    
    // Clean up any stale recordings from previous sessions
    this.cleanupStaleRecordings(userId);
    
    // Register this as an active session
    registerActiveSession(userId);
    
    // Diagnostics for AUDIO_CHUNK flow (even when not recording)
    let diagChunkCount = 0;
    let diagByteTotal = 0;
    let diagStartWall = Date.now();
  session.events.onAudioChunk(async (chunk: AudioChunk) => {
      try {
        // Per-chunk diagnostics every 100 chunks
        diagChunkCount++;
        const size = chunk.arrayBuffer?.byteLength || 0;
        diagByteTotal += size;
        if (diagChunkCount % 100 === 0) {
          const elapsed = (Date.now() - diagStartWall) / 1000;
          const expectedBytes = Math.round(elapsed * 16000 * 2);
          const head = Buffer.from(chunk.arrayBuffer as ArrayBufferLike).subarray(0, Math.min(10, size));
          console.log(`[AUDIO:DIAG] user=${userId} chunks=${diagChunkCount} bytes=${diagByteTotal} elapsedSec=${elapsed.toFixed(1)} expectedAt16k=${expectedBytes} head10=[${Array.from(head)}]`);
        }
      } catch (e) {
        console.warn(`[AUDIO:DIAG] error computing diagnostics:`, e);
      }

      try {
        // Fast-path: use in-memory mapping to avoid DB/cached scans per chunk
        const recordingId = this.activeRecordingByUser.get(userId);
        if (recordingId) {
          this.enqueueAudioChunk(recordingId, chunk);
        }
      } catch (err) {
        console.error(`[AUDIO] Error scheduling chunk for user ${userId}:`, err);
      }
    });

    // Non-fatal SDK error handling: ignore benign unknown-type messages
    session.events.onError((err: any) => {
      const message = err?.message || String(err);
      if (message?.includes('Unrecognized message type: capabilities_update')) {
        console.warn(`[SDK:WARN] Ignoring unsupported message 'capabilities_update' (update SDK/cloud if needed)`);
        return;
      }
      if (message?.startsWith('Unrecognized message type:')) {
        console.warn(`[SDK:WARN] ${message} (non-fatal)`);
        return;
      }
      console.warn(`[SDK:ERROR] Non-fatal error event:`, err);
    });
    
    // Set up handlers for transcription
    try {
  session.onTranscriptionForLanguage('en-US', async (transcription: TranscriptionData) => {
        console.log(`[TRANSCRIPTION] ${transcription.isFinal ? 'FINAL' : 'interim'}: "${transcription.text}"`);
        
        // Process transcription if user has an active recording (fast-path)
        const recordingId = this.activeRecordingByUser.get(userId);
        if (recordingId) {
          await this.updateTranscript(
            recordingId,
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
              // Check if user already has an active recording first (fast-path)
              const existingId = this.activeRecordingByUser.get(userId);
              let existingRecording: RecordingDocument | null = null;
              if (!existingId) {
                // Fallback to DB/cached check if not in map
                existingRecording = await this.getActiveRecordingForUser(userId);
              }
              
              if (existingId || existingRecording) {
                const rid = existingId ?? existingRecording?._id.toString();
                console.log(`[VOICE COMMAND] User ${userId} already has an active recording: ${rid}`);
                
                // Send notification to client about the existing recording
                streamService.broadcastToUser(userId, 'voice-command', {
                  command: 'recording-already-active',
                  recordingId: rid,
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
              // Get the user's active recording (if any) from map first
              const mappedId = this.activeRecordingByUser.get(userId);
              const recordingId = mappedId || (await (async () => {
                const r = await this.getActiveRecordingForUser(userId);
                return r?._id.toString();
              })());
              
              if (recordingId) {
                
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

  // Cache it immediately and track active map
  this.activeRecordingsCache.set(recordingId, savedRecording);
  this.activeRecordingByUser.set(userId, recordingId);

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

        // Update cache to reflect status/storage
        const cached = this.activeRecordingsCache.get(recordingId) || savedRecording;
        cached.status = RecordingStatus.RECORDING;
        cached.storage = { ...cached.storage, initialized: true } as any;
        cached.updatedAt = new Date();
        this.activeRecordingsCache.set(recordingId, cached);
        
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

  // Remove from cache/mapping on hard failure
  this.activeRecordingsCache.delete(recordingId);
  this.activeRecordingByUser.delete(userId);
        
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
      // Use cache first, fallback to DB
  let recordingDoc: RecordingDocument | null | undefined = this.activeRecordingsCache.get(recordingId);
      if (!recordingDoc) {
        recordingDoc = await Recording.findById(recordingId).exec();
        if (recordingDoc) {
          this.activeRecordingsCache.set(recordingId, recordingDoc);
        }
      }
      
      if (!recordingDoc) {
        console.log(`[AUDIO] Ignoring chunk for non-existent recording ${recordingId}`);
        return;
      }
      
      // Accept chunks while RECORDING or STOPPING to avoid late-frame loss
      if (
        recordingDoc.status !== RecordingStatus.RECORDING &&
        recordingDoc.status !== RecordingStatus.STOPPING
      ) {
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

        // Update cache
        recordingDoc.storage = { ...recordingDoc.storage, initialized: true } as any;
        recordingDoc.updatedAt = new Date();
        this.activeRecordingsCache.set(recordingId, recordingDoc);
      }
      
      // Try to add the chunk to storage
      try {
        // Check if storage has active upload
        if (!storageService.hasActiveUpload(recordingId)) {
          console.log(`[AUDIO] No active upload for ${recordingId}, reinitializing storage`);
          await storageService.beginStreamingUpload(recordingDoc.userId, recordingId);
        }
        
        // Add chunk to storage
        // Ensure ArrayBuffer type (not just ArrayBufferLike)
        let chunkArrayBuffer: ArrayBuffer;
        if (chunk.arrayBuffer instanceof ArrayBuffer) {
          chunkArrayBuffer = chunk.arrayBuffer as ArrayBuffer;
        } else {
          // Copy into a new ArrayBuffer to satisfy type and avoid SharedArrayBuffer issues
          const view = new Uint8Array(chunk.arrayBuffer as ArrayBufferLike);
          const copy = new Uint8Array(view.length);
          copy.set(view);
          chunkArrayBuffer = copy.buffer;
        }

        const chunkProcessed = await storageService.addChunk(recordingId, chunkArrayBuffer);
        
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

          // Update cache
          recordingDoc.duration = currentDuration;
          recordingDoc.updatedAt = new Date();
          this.activeRecordingsCache.set(recordingId, recordingDoc);
          
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

          // Remove from cache
          this.activeRecordingsCache.delete(recordingId);

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
      // Use cache first, fallback to DB
  let recordingDoc: RecordingDocument | null | undefined = this.activeRecordingsCache.get(recordingId);
      if (!recordingDoc) {
        recordingDoc = await Recording.findById(recordingId).exec();
        if (recordingDoc) {
          this.activeRecordingsCache.set(recordingId, recordingDoc);
        }
      }
      
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

        // Update cache
        recordingDoc.transcript = fullTranscript as any;
        (recordingDoc as any).transcriptChunks = updatedChunks;
        (recordingDoc as any).currentInterim = '';
        recordingDoc.updatedAt = new Date();
        this.activeRecordingsCache.set(recordingId, recordingDoc);
        
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

        // Update cache
        (recordingDoc as any).currentInterim = text;
        recordingDoc.updatedAt = new Date();
        this.activeRecordingsCache.set(recordingId, recordingDoc);
        
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
        // Ensure cache/map is clean
        this.activeRecordingsCache.delete(recordingId);
        this.clearActiveMappingForRecording(recordingId);
        return;
      }
      
      // If recording is already completed or in an error state, return early
      if (recordingDoc.status === RecordingStatus.COMPLETED || 
          recordingDoc.status === RecordingStatus.ERROR) {
        console.log(`[RECORDING] Recording ${recordingId} is already in ${recordingDoc.status} state`);
        // Ensure cache/map is clean
        this.activeRecordingsCache.delete(recordingId);
        this.clearActiveMappingForRecording(recordingId);
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

  // Update cache STOPPING
  const cached = this.activeRecordingsCache.get(recordingId) || recordingDoc;
  cached.status = RecordingStatus.STOPPING;
  cached.updatedAt = new Date();
  this.activeRecordingsCache.set(recordingId, cached);
      
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
        // Wait for any queued audio chunk processing to complete for this recording
        const inflight = this.processingChains.get(recordingId);
        if (inflight) {
          console.log(`[RECORDING] Waiting for in-flight chunk processing to finish for ${recordingId}`);
          await inflight.catch(() => {/* handled in enqueue */});
        }

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

  // Remove from cache/map
  this.activeRecordingsCache.delete(recordingId);
  this.activeRecordingByUser.delete(userId);
        
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

  // Remove from cache/map
  this.activeRecordingsCache.delete(recordingId);
  this.activeRecordingByUser.delete(userId);
        
        // Notify clients
        streamService.broadcastToUser(userId, 'recording-error', {
          id: recordingId,
          error: error instanceof Error ? error.message : String(error)
        });
        
        throw error;
      }
    } catch (error) {
      console.error(`[RECORDING] Unhandled error stopping recording ${recordingId}:`, error);
  // Ensure cache/map is clean on failure
  this.activeRecordingsCache.delete(recordingId);
  this.clearActiveMappingForRecording(recordingId);
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

  // Ensure cache/map cleanup
  this.activeRecordingsCache.delete(recordingId);
  this.clearActiveMappingForRecording(recordingId);
      
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

      // Keep cache in sync if it's an active recording
      if (this.activeRecordingsCache.has(recordingId)) {
        this.activeRecordingsCache.set(recordingId, updatedRecording);
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