import { TpaSession } from '@augmentos/sdk';
import { 
  AudioManager, 
  TimerManager, 
  TranscriptionManager, 
  TranscriptionData 
} from './index';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

/**
 * Status of a recording
 */
export enum RecordingStatus {
  IDLE = 'idle',
  RECORDING = 'recording',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error'
}

/**
 * Recording result information
 */
export interface RecordingResult {
  filePath?: string;
  transcriptText: string;
  duration: string;
  timestamp: string;
  userId: string;
  sessionId: string;
  status: RecordingStatus;
  error?: string;
}

/**
 * Manages recording sessions with asynchronous processing
 */
export class RecordingManager extends EventEmitter {
  private audioManager: AudioManager;
  private timerManager: TimerManager;
  private transcriptionManager: TranscriptionManager;
  private session: TpaSession;
  private sessionId: string;
  private userId: string;
  private status: RecordingStatus = RecordingStatus.IDLE;
  private storageDir: string;
  private settings: any = {};
  
  constructor(
    session: TpaSession, 
    sessionId: string, 
    userId: string, 
    storageDir: string
  ) {
    super();
    this.session = session;
    this.sessionId = sessionId;
    this.userId = userId;
    this.storageDir = storageDir;
    
    // Create managers
    this.audioManager = new AudioManager(sessionId, userId);
    this.timerManager = new TimerManager(session);
    this.transcriptionManager = new TranscriptionManager();
    
    // Setup user directory
    this.setupStorageDirectory();
  }

  /**
   * Apply settings to the recording manager
   */
  public applySettings(settings: any): void {
    this.settings = settings;
    
    // Update audio format if needed
    const audioFormat = settings.audio_format || 'wav';
    this.audioManager = new AudioManager(this.sessionId, this.userId, audioFormat);
    
    // Update language if needed
    if (settings.language) {
      this.transcriptionManager.setLanguage(settings.language);
    }
  }

  /**
   * Start recording
   */
  public startRecording(): boolean {
    if (this.status === RecordingStatus.RECORDING) {
      return false; // Already recording
    }
    
    try {
      // Start timer
      this.timerManager.startTimer();
      
      // Update status
      this.status = RecordingStatus.RECORDING;
      
      // Emit event
      this.emit('recordingStarted');
      
      return true;
    } catch (error) {
      console.error('Error starting recording:', error);
      return false;
    }
  }

  /**
   * Stop recording and process asynchronously
   */
  public stopRecording(): boolean {
    if (this.status !== RecordingStatus.RECORDING) {
      return false; // Not recording
    }
    
    try {
      // Stop timer
      const duration = this.timerManager.stopTimer();
      
      // Update status
      this.status = RecordingStatus.PROCESSING;
      
      // Emit event
      this.emit('recordingStopped');
      
      // Process recording asynchronously
      this.processRecordingAsync(duration)
        .then(result => {
          this.emit('recordingProcessed', result);
        })
        .catch(error => {
          console.error('Error processing recording:', error);
          this.status = RecordingStatus.ERROR;
          this.emit('recordingError', error);
        });
      
      return true;
    } catch (error) {
      console.error('Error stopping recording:', error);
      return false;
    }
  }

  /**
   * Get current recording status
   */
  public getStatus(): RecordingStatus {
    return this.status;
  }

  /**
   * Process an audio chunk
   */
  public processAudioChunk(chunk: any): void {
    if (this.status === RecordingStatus.RECORDING) {
      this.audioManager.addAudioChunk(chunk);
    }
  }

  /**
   * Process transcription data
   */
  public processTranscription(data: TranscriptionData): void {
    if (this.status === RecordingStatus.RECORDING) {
      this.transcriptionManager.addTranscription(data);
    }
  }

  /**
   * Get the current recording duration as formatted string
   */
  public getCurrentDuration(): string {
    return this.timerManager.getFormattedTime();
  }

  /**
   * Process the recording asynchronously
   */
  private async processRecordingAsync(duration: string): Promise<RecordingResult> {
    try {
      // Save the recording file
      const filePath = await this.audioManager.saveRecording();
      
      // Get the transcript
      const transcriptText = this.transcriptionManager.getFormattedTranscript();
      
      // Move the file to permanent storage
      const finalFilePath = await this.moveToStorage(filePath);
      
      // Update status
      this.status = RecordingStatus.COMPLETED;
      
      // Return the result
      return {
        filePath: finalFilePath,
        transcriptText,
        duration,
        timestamp: new Date().toISOString(),
        userId: this.userId,
        sessionId: this.sessionId,
        status: RecordingStatus.COMPLETED
      };
    } catch (error) {
      this.status = RecordingStatus.ERROR;
      return {
        transcriptText: this.transcriptionManager.getFormattedTranscript(),
        duration,
        timestamp: new Date().toISOString(),
        userId: this.userId,
        sessionId: this.sessionId,
        status: RecordingStatus.ERROR,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Move the recording to permanent storage
   */
  private async moveToStorage(tempFilePath: string): Promise<string> {
    // Create timestamp-based filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `recording_${this.sessionId}_${timestamp}.${path.extname(tempFilePath).substring(1)}`;
    const finalPath = path.join(this.storageDir, this.userId, fileName);
    
    // Create directory if needed
    const userDir = path.join(this.storageDir, this.userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    
    // Copy file
    fs.copyFileSync(tempFilePath, finalPath);
    
    // Remove temp file
    try {
      fs.unlinkSync(tempFilePath);
    } catch (error) {
      console.error('Error removing temp file:', error);
      // Non-fatal error, continue
    }
    
    return finalPath;
  }

  /**
   * Setup storage directory for user
   */
  private setupStorageDirectory(): void {
    const userDir = path.join(this.storageDir, this.userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
  }

  /**
   * Reset to idle state
   */
  public reset(): void {
    this.status = RecordingStatus.IDLE;
    this.audioManager = new AudioManager(this.sessionId, this.userId, this.settings.audio_format || 'wav');
    this.transcriptionManager = new TranscriptionManager(this.settings.language || 'en-US');
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    this.timerManager.cleanup();
    // Stop any active recording
    if (this.status === RecordingStatus.RECORDING) {
      this.stopRecording();
    }
    
    // Remove all listeners
    this.removeAllListeners();
  }
}