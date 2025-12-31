/**
 * Recordings service
 * Handles business logic for recordings
 *
 * Optimized for high-frequency audio chunks (~25-40ms intervals)
 * Uses in-memory caching and sequential queue processing to ensure
 * chunks are stored in order without database bottlenecks.
 */

import {
  AudioChunk,
  TpaSession,
  TranscriptionData,
  ViewType,
} from "@mentra/sdk";
import {
  RecordingStatus,
  AudioChunkI,
  TranscriptionDataI,
} from "../types/recordings.types";
import { Recording, RecordingDocument } from "../models/recording.models";
import mongoose from "mongoose";
import storageService from "./storage.service";
import streamService from "./stream.service";
import { hasActiveSession, registerActiveSession } from "../api/session.api";

/**
 * Cached active recording info to avoid DB queries on every chunk
 */
interface ActiveRecordingCache {
  recordingId: string;
  userId: string;
  createdAt: Date;
  status: RecordingStatus;
}

/**
 * Per-recording chunk queue for sequential processing
 */
interface ChunkQueue {
  chunks: ArrayBuffer[];
  processing: boolean;
  totalBytesQueued: number;
  chunksReceived: number;
  chunksProcessed: number;
  lastLogTime: number;
}

// Audio format constants (16kHz, 16-bit, mono)
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const CHANNELS = 1;
const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS; // 32000

class RecordingsService {
  /**
   * In-memory cache of active recordings per user
   * Avoids DB query on every audio chunk
   */
  private activeRecordingCache = new Map<string, ActiveRecordingCache>();

  /**
   * Per-recording chunk queues for sequential processing
   * Ensures chunks are written in order even under high frequency
   */
  private chunkQueues = new Map<string, ChunkQueue>();

  /**
   * Duration update interval timers per recording
   */
  private durationUpdateTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Duration update interval in milliseconds
   */
  private readonly DURATION_UPDATE_INTERVAL_MS = 1000;

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
          $in: [
            RecordingStatus.INITIALIZING,
            RecordingStatus.RECORDING,
            RecordingStatus.STOPPING,
          ],
        },
      }).exec();

      if (staleRecordings.length > 0) {
        console.log(
          `[CLEANUP] Found ${staleRecordings.length} stale recordings for user ${userId}`,
        );

        for (const recording of staleRecordings) {
          try {
            console.log(
              `[CLEANUP] Marking stale recording ${recording._id} as ERROR`,
            );

            // Mark as error with explanation
            await Recording.findByIdAndUpdate(recording._id, {
              status: RecordingStatus.ERROR,
              error: "Recording was interrupted by session disconnect",
              updatedAt: new Date(),
            });

            // Try to finalize storage if it was initialized
            if (recording.storage?.initialized) {
              try {
                const fileUrl = await storageService.completeUpload(
                  recording._id.toString(),
                );
                await Recording.findByIdAndUpdate(recording._id, {
                  "storage.fileUrl": fileUrl,
                });
                console.log(
                  `[CLEANUP] Finalized storage for stale recording ${recording._id}`,
                );
              } catch (storageErr) {
                console.log(
                  `[CLEANUP] Could not finalize storage for ${recording._id}:`,
                  storageErr,
                );
              }
            }
          } catch (err) {
            console.error(
              `[CLEANUP] Error cleaning up recording ${recording._id}:`,
              err,
            );
          }
        }

        // Notify clients to refresh their recording lists
        streamService.broadcastToUser(userId, "recordings-refresh", {
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      console.error(
        `[CLEANUP] Error during stale recording cleanup for user ${userId}:`,
        error,
      );
    }
  }

  /**
   * Get the active recording for a user from cache first, then DB
   */
  async getActiveRecordingForUser(
    userId: string,
  ): Promise<RecordingDocument | null> {
    try {
      // Check cache first
      const cached = this.activeRecordingCache.get(userId);
      if (cached && cached.status === RecordingStatus.RECORDING) {
        // Verify it still exists in DB (for API calls that need full doc)
        const recording = await Recording.findById(cached.recordingId).exec();
        if (recording && recording.status === RecordingStatus.RECORDING) {
          return recording;
        } else {
          // Cache is stale, clear it
          this.clearRecordingCache(userId);
        }
      }

      // Fall back to DB query
      const activeRecording = await Recording.findOne({
        userId,
        status: {
          $in: [
            RecordingStatus.INITIALIZING,
            RecordingStatus.RECORDING,
            RecordingStatus.STOPPING,
          ],
        },
      }).exec();

      return activeRecording;
    } catch (error) {
      console.error(
        `[RECORDING] Error getting active recording for user ${userId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Get cached active recording (fast, synchronous check)
   * Returns null if no cached recording or cache is invalid
   */
  private getCachedActiveRecording(
    userId: string,
  ): ActiveRecordingCache | null {
    const cached = this.activeRecordingCache.get(userId);
    if (cached && cached.status === RecordingStatus.RECORDING) {
      return cached;
    }
    return null;
  }

  /**
   * Set the active recording cache for a user
   */
  private setRecordingCache(
    userId: string,
    recordingId: string,
    createdAt: Date,
  ): void {
    this.activeRecordingCache.set(userId, {
      recordingId,
      userId,
      createdAt,
      status: RecordingStatus.RECORDING,
    });
    console.log(
      `[CACHE] Set active recording cache for user ${userId}: ${recordingId}`,
    );
  }

  /**
   * Clear the active recording cache for a user
   */
  private clearRecordingCache(userId: string): void {
    const cached = this.activeRecordingCache.get(userId);
    if (cached) {
      console.log(
        `[CACHE] Cleared active recording cache for user ${userId}: ${cached.recordingId}`,
      );
      this.activeRecordingCache.delete(userId);
    }
  }

  /**
   * Initialize chunk queue for a recording
   */
  private initChunkQueue(recordingId: string): void {
    if (!this.chunkQueues.has(recordingId)) {
      this.chunkQueues.set(recordingId, {
        chunks: [],
        processing: false,
        totalBytesQueued: 0,
        chunksReceived: 0,
        chunksProcessed: 0,
        lastLogTime: Date.now(),
      });
      console.log(
        `[QUEUE] Initialized chunk queue for recording ${recordingId}`,
      );
    }
  }

  /**
   * Add a chunk to the queue (synchronous, fast)
   */
  private enqueueChunk(recordingId: string, chunk: ArrayBuffer): void {
    const queue = this.chunkQueues.get(recordingId);
    if (!queue) {
      console.warn(
        `[QUEUE] No queue found for recording ${recordingId}, chunk dropped`,
      );
      return;
    }

    queue.chunks.push(chunk);
    queue.totalBytesQueued += chunk.byteLength;
    queue.chunksReceived++;

    // Log stats every 5 seconds
    const now = Date.now();
    if (now - queue.lastLogTime > 5000) {
      console.log(
        `[QUEUE] Recording ${recordingId}: ${queue.chunksReceived} received, ${queue.chunksProcessed} processed, ${queue.chunks.length} pending, ${queue.totalBytesQueued} bytes total`,
      );
      queue.lastLogTime = now;
    }

    // Trigger processing if not already running
    this.processChunkQueue(recordingId);
  }

  /**
   * Process chunks from the queue sequentially
   * Only one instance runs at a time per recording
   */
  private async processChunkQueue(recordingId: string): Promise<void> {
    const queue = this.chunkQueues.get(recordingId);
    if (!queue) return;

    // If already processing, the current processor will handle new chunks
    if (queue.processing) return;

    queue.processing = true;

    try {
      while (queue.chunks.length > 0) {
        const chunk = queue.chunks.shift()!;

        try {
          // Add chunk to storage (this is fast - just array push)
          await storageService.addChunk(recordingId, chunk);
          queue.chunksProcessed++;
        } catch (error) {
          console.error(
            `[QUEUE] Error processing chunk for ${recordingId}:`,
            error,
          );
          // Re-queue the chunk at the front to retry
          queue.chunks.unshift(chunk);
          // Wait a bit before retrying
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    } finally {
      queue.processing = false;
    }
  }

  /**
   * Flush remaining chunks and clean up queue
   */
  private async flushAndCleanupQueue(recordingId: string): Promise<void> {
    const queue = this.chunkQueues.get(recordingId);
    if (!queue) return;

    // Wait for any pending processing to complete
    while (queue.processing || queue.chunks.length > 0) {
      if (!queue.processing && queue.chunks.length > 0) {
        await this.processChunkQueue(recordingId);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    console.log(
      `[QUEUE] Flushed queue for ${recordingId}: ${queue.chunksProcessed} chunks processed, ${queue.totalBytesQueued} bytes`,
    );
    this.chunkQueues.delete(recordingId);
  }

  /**
   * Start periodic duration updates for a recording
   */
  private startDurationUpdates(
    recordingId: string,
    userId: string,
    createdAt: Date,
  ): void {
    // Clear any existing timer
    this.stopDurationUpdates(recordingId);

    const timer = setInterval(() => {
      const queue = this.chunkQueues.get(recordingId);
      if (!queue) {
        this.stopDurationUpdates(recordingId);
        return;
      }

      // Calculate duration from actual bytes received
      const durationFromBytes = Math.floor(
        queue.totalBytesQueued / BYTES_PER_SECOND,
      );

      // Also calculate wall-clock duration as a sanity check
      const wallClockDuration = Math.floor(
        (Date.now() - createdAt.getTime()) / 1000,
      );

      // Use the smaller of the two (bytes-based is more accurate for actual audio)
      const duration = durationFromBytes;

      // Update DB (non-blocking)
      Recording.findByIdAndUpdate(recordingId, {
        duration,
        updatedAt: new Date(),
      })
        .exec()
        .catch((err) => {
          console.error(
            `[DURATION] Error updating duration for ${recordingId}:`,
            err,
          );
        });

      // Send update to clients
      streamService.broadcastToUser(userId, "recording-status", {
        id: recordingId,
        status: RecordingStatus.RECORDING,
        duration,
      });
    }, this.DURATION_UPDATE_INTERVAL_MS);

    this.durationUpdateTimers.set(recordingId, timer);
    console.log(`[DURATION] Started duration updates for ${recordingId}`);
  }

  /**
   * Stop periodic duration updates for a recording
   */
  private stopDurationUpdates(recordingId: string): void {
    const timer = this.durationUpdateTimers.get(recordingId);
    if (timer) {
      clearInterval(timer);
      this.durationUpdateTimers.delete(recordingId);
      console.log(`[DURATION] Stopped duration updates for ${recordingId}`);
    }
  }

  /**
   * Track active SDK sessions
   */
  private activeSdkSessions = new Map<string, TpaSession>();

  /**
   * Handle new session from AugmentOS SDK
   */
  setupSDKSession(
    session: TpaSession,
    sessionId: string,
    userId: string,
  ): void {
    console.log(`[TPA SESSION] Setting up session for user ${userId}`);

    // Store session for future use
    this.activeSdkSessions.set(userId, session);

    // Clean up any stale recordings from previous sessions
    this.cleanupStaleRecordings(userId);

    // Register this as an active session
    registerActiveSession(userId);

    // IMPORTANT: Set up transcription handler FIRST, then audio handler.
    // This fixes a race condition in the SDK where subscription updates are sent
    // as each handler is added. By setting up transcription first, we ensure
    // the final subscription state includes both audio_chunk AND transcription.
    // If audio is set up first, there's a timing issue where a subsequent
    // subscription update can accidentally drop the transcription subscription.

    // Set up handlers for transcription (MUST be before audio handler)
    try {
      session.events.onTranscriptionForLanguage(
        "en-US",
        async (transcription: TranscriptionData) => {
          console.log(
            `[TRANSCRIPTION] ${transcription.isFinal ? "FINAL" : "interim"}: "${transcription.text}"`,
          );

          // Process transcription if user has an active recording
          const activeRecording = await this.getActiveRecordingForUser(userId);

          if (
            activeRecording &&
            activeRecording.status === RecordingStatus.RECORDING
          ) {
            await this.updateTranscript(
              activeRecording._id.toString(),
              transcription.text,
              transcription.isFinal,
            );
          }

          // Check for voice commands (only in final transcripts)
          if (transcription.isFinal) {
            const text = transcription.text.toLowerCase();

            if (text.includes("start recording")) {
              console.log(
                `[VOICE COMMAND] Received 'start recording' command from user ${userId}`,
              );

              try {
                // Check if user already has an active recording first
                const existingRecording =
                  await this.getActiveRecordingForUser(userId);

                if (existingRecording) {
                  console.log(
                    `[VOICE COMMAND] User ${userId} already has an active recording: ${existingRecording._id}`,
                  );

                  // Send notification to client about the existing recording
                  streamService.broadcastToUser(userId, "voice-command", {
                    command: "recording-already-active",
                    recordingId: existingRecording._id.toString(),
                    timestamp: Date.now(),
                  });

                  // Show message to user
                  this.showReferenceCard(
                    userId,
                    "Recording Already Active",
                    "You already have an active recording",
                    3000,
                  );
                } else {
                  // Notify client that we're starting a recording
                  streamService.broadcastToUser(userId, "voice-command", {
                    command: "start-recording",
                    timestamp: Date.now(),
                  });

                  // Start a new recording
                  const recordingId = await this.startRecording(userId);

                  // Show message to user
                  this.showReferenceCard(
                    userId,
                    "Recording Started",
                    "Say 'stop recording' when done",
                    3000,
                  );

                  // Send confirmation with the recording ID
                  streamService.broadcastToUser(
                    userId,
                    "recording-started-by-voice",
                    {
                      id: recordingId,
                      timestamp: Date.now(),
                    },
                  );
                }
              } catch (error) {
                console.error(
                  `[VOICE COMMAND] Error processing 'start recording' command:`,
                  error,
                );

                // Notify user of error
                this.showReferenceCard(
                  userId,
                  "Recording Failed",
                  "Unable to start recording",
                  3000,
                );
              }
            } else if (text.includes("stop recording")) {
              console.log(
                `[VOICE COMMAND] Received 'stop recording' command from user ${userId}`,
              );

              try {
                // Get the user's active recording (if any)
                const activeRecording =
                  await this.getActiveRecordingForUser(userId);

                if (activeRecording) {
                  const recordingId = activeRecording._id.toString();

                  console.log(
                    `[VOICE COMMAND] Stopping active recording ${recordingId} for user ${userId}`,
                  );

                  // Stop the recording first before sending events
                  await this.stopRecording(recordingId);

                  // Then send notification to clients
                  streamService.broadcastToUser(userId, "voice-command", {
                    command: "stop-recording",
                    timestamp: Date.now(),
                  });

                  // Show message to user
                  this.showReferenceCard(
                    userId,
                    "Recording Stopped",
                    "Processing your recording...",
                    3000,
                  );

                  // Send confirmation with the recording ID
                  streamService.broadcastToUser(
                    userId,
                    "recording-stopped-by-voice",
                    {
                      id: recordingId,
                      timestamp: Date.now(),
                    },
                  );
                } else {
                  console.log(
                    `[VOICE COMMAND] No active recording found for user ${userId}`,
                  );

                  // Show message to user
                  this.showReferenceCard(
                    userId,
                    "No Active Recording",
                    "You don't have an active recording to stop",
                    3000,
                  );
                }
              } catch (error) {
                console.error(
                  `[VOICE COMMAND] Error processing 'stop recording' command:`,
                  error,
                );

                // Notify user of error
                this.showReferenceCard(
                  userId,
                  "Error Stopping Recording",
                  "Unable to stop recording",
                  3000,
                );
              }
            }
          }
        },
      );
      console.log("Transcription handler set up successfully");
    } catch (error) {
      console.error("Error setting up transcription handler:", error);
    }

    // Set up handlers for audio chunks (AFTER transcription handler)
    // IMPORTANT: This handler is intentionally synchronous for the critical path
    // to ensure chunks are queued in arrival order
    session.events.onAudioChunk((chunk: AudioChunk) => {
      // Fast, synchronous cache lookup
      const cached = this.getCachedActiveRecording(userId);

      if (cached) {
        // Fast, synchronous queue push
        this.enqueueChunk(cached.recordingId, chunk.arrayBuffer as ArrayBuffer);
      }
    });
    console.log(
      `[TPA SESSION] ✅ Handlers registered for user ${userId} (transcription + audio)`,
    );
  }

  /**
   * Helper to show reference card on glasses, abstracted for reuse
   */
  private showReferenceCard(
    userId: string,
    title: string,
    description: string,
    durationMs: number = 3000,
  ): void {
    const session = this.activeSdkSessions.get(userId);
    if (session) {
      try {
        session.layouts.showReferenceCard(title, description, {
          view: ViewType.MAIN,
          durationMs,
        });
      } catch (error) {
        console.error(
          `[TPA] Error showing reference card to user ${userId}:`,
          error,
        );
      }
    } else {
      console.log(
        `[TPA] Cannot show reference card to user ${userId}: no active session`,
      );
    }
  }

  /**
   * Start a new recording
   *
   * This is a command handler that ensures only one active recording per user
   * and verifies that a valid TPA session exists
   */
  async startRecording(
    userId: string,
    isVoiceInitiated: boolean = false,
  ): Promise<string> {
    console.log(`[RECORDING] Starting recording for user ${userId}`);

    try {
      // First check if user already has an active recording
      const existingRecording = await this.getActiveRecordingForUser(userId);

      if (existingRecording) {
        console.log(
          `[RECORDING] User ${userId} already has an active recording: ${existingRecording._id}`,
        );
        throw new Error(
          `User already has an active recording: ${existingRecording._id}. Please stop the current recording before starting a new one.`,
        );
      }

      // Check if the user has an active TPA session - skip for voice-initiated recordings
      // as those already come from an active TPA session
      if (!isVoiceInitiated && !hasActiveSession(userId)) {
        console.log(
          `[RECORDING] Rejecting recording start - no active TPA session for user ${userId}`,
        );
        throw new Error(
          "No active AugmentOS SDK session. Please ensure your glasses are connected.",
        );
      }

      // Create new recording with INITIALIZING status
      const newRecording = new Recording({
        userId,
        title: `Recording ${new Date().toLocaleString()}`,
        transcript: "",
        transcriptChunks: [],
        duration: 0,
        storage: {
          initialized: false,
        },
        status: RecordingStatus.INITIALIZING,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Save to MongoDB - this will enforce the unique index constraint
      const savedRecording = await newRecording.save();
      const recordingId = savedRecording._id.toString();

      console.log(
        `[RECORDING] Created recording in MongoDB with ID: ${recordingId}`,
      );

      try {
        // Initialize storage
        await storageService.beginStreamingUpload(userId, recordingId);

        // Initialize chunk queue BEFORE setting cache (so chunks don't get lost)
        this.initChunkQueue(recordingId);

        // Update recording to RECORDING status and mark storage as initialized
        await Recording.findByIdAndUpdate(recordingId, {
          status: RecordingStatus.RECORDING,
          "storage.initialized": true,
          updatedAt: new Date(),
        });

        // Set the cache so audio chunks start flowing
        this.setRecordingCache(userId, recordingId, savedRecording.createdAt);

        // Start periodic duration updates
        this.startDurationUpdates(
          recordingId,
          userId,
          savedRecording.createdAt,
        );

        // Notify clients
        streamService.broadcastToUser(userId, "recording-status", {
          id: recordingId,
          status: RecordingStatus.RECORDING,
          duration: 0,
          title: savedRecording.title,
          transcript: "",
          createdAt: savedRecording.createdAt.getTime(),
        });

        // Show feedback on glasses if initiated from UI (voice already shows feedback)
        if (!isVoiceInitiated) {
          this.showReferenceCard(
            userId,
            "Recording Started",
            "Recording audio...",
            3000,
          );
        }

        console.log(
          `[RECORDING] Started recording ${recordingId} for user ${userId}`,
        );
        return recordingId;
      } catch (storageError) {
        // If storage initialization fails, update recording status to ERROR
        console.error(
          `[RECORDING] Failed to initialize storage for recording ${recordingId}:`,
          storageError,
        );

        // Clean up cache and queue
        this.clearRecordingCache(userId);
        this.chunkQueues.delete(recordingId);

        await Recording.findByIdAndUpdate(recordingId, {
          status: RecordingStatus.ERROR,
          error:
            storageError instanceof Error
              ? storageError.message
              : String(storageError),
          updatedAt: new Date(),
        });

        // Notify clients about error
        streamService.broadcastToUser(userId, "recording-error", {
          id: recordingId,
          error:
            storageError instanceof Error
              ? storageError.message
              : String(storageError),
        });

        throw storageError;
      }
    } catch (error) {
      console.error(
        `[RECORDING] Error starting recording for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Process an audio chunk - DEPRECATED
   *
   * This method is kept for backwards compatibility but is no longer used.
   * Audio chunks are now processed via the queue system (enqueueChunk/processChunkQueue).
   */
  async processAudioChunk(
    recordingId: string,
    chunk: AudioChunk,
  ): Promise<void> {
    // Just enqueue it - the queue processor will handle the rest
    this.enqueueChunk(recordingId, chunk.arrayBuffer as ArrayBuffer);
  }

  /**
   * Update transcript for a recording
   *
   * This method handles transcript updates for a recording
   */
  async updateTranscript(
    recordingId: string,
    text: string,
    isFinal: boolean = true,
  ): Promise<void> {
    try {
      // Verify recording exists and is in RECORDING state
      const recordingDoc = await Recording.findById(recordingId).exec();

      if (!recordingDoc) {
        console.error(
          `[TRANSCRIPT] Recording ${recordingId} not found for transcript update`,
        );
        return;
      }

      // Only process transcripts for recordings in RECORDING state
      if (recordingDoc.status !== RecordingStatus.RECORDING) {
        console.log(
          `[TRANSCRIPT] Ignoring transcript update for ${recordingId} - recording is in ${recordingDoc.status} state`,
        );
        return;
      }

      const currentTime = Date.now();
      const userId = recordingDoc.userId;

      if (isFinal) {
        // For final transcripts, add to chunks array
        console.log(
          `[TRANSCRIPT] Adding final transcript to recording ${recordingId}: "${text}"`,
        );

        const existingChunks = recordingDoc.transcriptChunks || [];
        const newChunk = {
          text,
          timestamp: currentTime,
          isFinal: true,
        };

        // Add the new chunk
        const updatedChunks = [...existingChunks, newChunk];

        // Build the full transcript from all chunks
        const fullTranscript = updatedChunks
          .map((chunk) => chunk.text)
          .join(" ");

        // Update MongoDB
        await Recording.findByIdAndUpdate(recordingId, {
          transcript: fullTranscript,
          transcriptChunks: updatedChunks,
          currentInterim: "", // Clear the interim when we get a final
          updatedAt: new Date(),
        });

        // Notify client of the transcript update
        streamService.broadcastToUser(userId, "transcript", {
          recordingId,
          text: fullTranscript,
          timestamp: currentTime,
        });
      } else {
        // For interim transcripts, just update the currentInterim field
        await Recording.findByIdAndUpdate(recordingId, {
          currentInterim: text,
          updatedAt: new Date(),
        });

        // For display, combine finals with current interim
        const existingChunks = recordingDoc.transcriptChunks || [];
        const finalsText = existingChunks.map((chunk) => chunk.text).join(" ");
        const displayText = finalsText ? `${finalsText} ${text}` : text;

        // Send interim to client for real-time display
        streamService.broadcastToUser(userId, "transcript", {
          recordingId,
          text: displayText,
          isInterim: true,
          timestamp: currentTime,
        });
      }
    } catch (error) {
      console.error(
        `[TRANSCRIPT] Error updating transcript for ${recordingId}:`,
        error,
      );
    }
  }

  /**
   * Stop an active recording
   *
   * This is a command handler that stops a recording
   */
  async stopRecording(
    recordingId: string,
    isVoiceInitiated: boolean = false,
  ): Promise<void> {
    console.log(`[RECORDING] Stopping recording ${recordingId}`);

    try {
      // First get the recording from the database
      const recordingDoc = await Recording.findById(recordingId).exec();

      // If recording doesn't exist, return early
      if (!recordingDoc) {
        console.log(
          `[RECORDING] Recording ${recordingId} not found in database`,
        );
        return;
      }

      // If recording is already completed or in an error state, return early
      if (
        recordingDoc.status === RecordingStatus.COMPLETED ||
        recordingDoc.status === RecordingStatus.ERROR
      ) {
        console.log(
          `[RECORDING] Recording ${recordingId} is already in ${recordingDoc.status} state`,
        );
        return;
      }

      // If recording is already in STOPPING state, just wait for it to complete
      if (recordingDoc.status === RecordingStatus.STOPPING) {
        console.log(
          `[RECORDING] Recording ${recordingId} is already in STOPPING state`,
        );
        return;
      }

      const userId = recordingDoc.userId;

      // FIRST: Clear the cache to stop new chunks from being queued
      this.clearRecordingCache(userId);

      // Stop duration updates
      this.stopDurationUpdates(recordingId);

      // Show feedback on glasses if initiated from UI (voice already shows feedback)
      if (!isVoiceInitiated) {
        this.showReferenceCard(
          userId,
          "Recording Stopped",
          "Processing your recording...",
          3000,
        );
      }

      // Mark recording as STOPPING to prevent new chunks and transcripts
      await Recording.findByIdAndUpdate(recordingId, {
        status: RecordingStatus.STOPPING,
        updatedAt: new Date(),
      });
      console.log(`[RECORDING] Marked recording ${recordingId} as STOPPING`);

      // Immediately notify clients of STOPPING state so UI can update
      streamService.broadcastToUser(userId, "recording-status", {
        id: recordingId,
        status: RecordingStatus.STOPPING,
      });

      // Flush any remaining chunks in the queue
      await this.flushAndCleanupQueue(recordingId);

      // If there's a current interim transcript, save it as a final chunk
      if (recordingDoc.currentInterim) {
        console.log(
          `[RECORDING] Saving last interim transcript as final: "${recordingDoc.currentInterim}"`,
        );

        const existingChunks = recordingDoc.transcriptChunks || [];
        const updatedChunks = [
          ...existingChunks,
          {
            text: recordingDoc.currentInterim,
            timestamp: Date.now(),
            isFinal: true,
          },
        ];

        // Rebuild the full transcript
        const fullTranscript = updatedChunks
          .map((chunk) => chunk.text)
          .join(" ");

        // Update the transcript
        await Recording.findByIdAndUpdate(recordingId, {
          transcript: fullTranscript,
          transcriptChunks: updatedChunks,
          currentInterim: "",
          updatedAt: new Date(),
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
            if (
              (storageError as Error).message &&
              (storageError as Error).message.includes("No active upload")
            ) {
              // If storage was marked as initialized but has no active upload,
              // initialize it and try again
              console.log(
                `[RECORDING] Storage marked as initialized but no active upload found`,
              );
              await storageService.beginStreamingUpload(userId, recordingId);
              fileUrl = await storageService.completeUpload(recordingId);
            } else {
              throw storageError;
            }
          }
        } else {
          // If storage was never initialized, initialize it and create an empty file
          console.log(
            `[RECORDING] Storage never initialized for ${recordingId}, creating empty file`,
          );
          await storageService.beginStreamingUpload(userId, recordingId);
          fileUrl = await storageService.completeUpload(recordingId);
        }

        // Calculate final duration from actual bytes stored
        const queue = this.chunkQueues.get(recordingId);
        const totalBytes = queue?.totalBytesQueued || 0;
        const durationFromBytes = Math.floor(totalBytes / BYTES_PER_SECOND);

        // Also get wall-clock duration as fallback
        const wallClockDuration = Math.round(
          (Date.now() - recordingDoc.createdAt.getTime()) / 1000,
        );

        // Use bytes-based duration (more accurate), fall back to wall-clock if no bytes
        const duration = totalBytes > 0 ? durationFromBytes : wallClockDuration;

        console.log(
          `[RECORDING] Final duration: ${duration}s (${totalBytes} bytes, wall-clock: ${wallClockDuration}s)`,
        );

        // Update recording to COMPLETED state
        await Recording.findByIdAndUpdate(recordingId, {
          status: RecordingStatus.COMPLETED,
          duration,
          "storage.fileUrl": fileUrl,
          updatedAt: new Date(),
        });

        console.log(
          `[RECORDING] Successfully stopped recording ${recordingId}, duration: ${duration}s`,
        );

        // Notify clients
        streamService.broadcastToUser(userId, "recording-status", {
          id: recordingId,
          status: RecordingStatus.COMPLETED,
          duration,
          fileUrl,
        });

        // Notify clients that they should refresh recordings list
        streamService.broadcastToUser(userId, "recordings-refresh", {
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error(
          `[RECORDING] Error finalizing recording ${recordingId}:`,
          error,
        );

        // Mark recording as ERROR
        await Recording.findByIdAndUpdate(recordingId, {
          status: RecordingStatus.ERROR,
          error: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        });

        // Notify clients
        streamService.broadcastToUser(userId, "recording-error", {
          id: recordingId,
          error: error instanceof Error ? error.message : String(error),
        });

        throw error;
      }
    } catch (error) {
      console.error(
        `[RECORDING] Unhandled error stopping recording ${recordingId}:`,
        error,
      );
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
      streamService.broadcastToUser(recording.userId, "recording-deleted", {
        id: recordingId, // Keep using 'id' for client-side compatibility for now
      });
    } catch (error) {
      console.error(`Error deleting recording ${recordingId}:`, error);
      throw error;
    }
  }

  /**
   * Update a recording (e.g., rename)
   */
  async updateRecording(
    recordingId: string,
    updates: Partial<RecordingDocument>,
  ): Promise<RecordingDocument> {
    try {
      // Update recording in MongoDB
      const updatedRecording = await Recording.findByIdAndUpdate(
        recordingId,
        { ...updates, updatedAt: new Date() },
        { new: true }, // Return the updated document
      ).exec();

      if (!updatedRecording) {
        throw new Error(
          `Recording ${recordingId} not found or could not be updated`,
        );
      }

      // Notify clients
      streamService.broadcastToUser(
        updatedRecording.userId,
        "recording-status",
        {
          id: recordingId, // Keep using 'id' for client-side compatibility for now
          ...updates,
          updatedAt: updates.updatedAt?.getTime() || Date.now(),
        },
      );

      return updatedRecording;
    } catch (error) {
      console.error(`Error updating recording ${recordingId}:`, error);
      throw error;
    }
  }
}

export default new RecordingsService();
