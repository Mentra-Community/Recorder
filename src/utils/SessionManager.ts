import { TpaSession, StreamType, createTranscriptionStream } from '@augmentos/sdk';
import { AudioManager } from './AudioManager';
import { TimerManager } from './TimerManager';
import { TranscriptionManager, TranscriptionData } from './TranscriptionManager';

/**
 * Manages resources for a single user session
 */
export class SessionManager {
  private session: TpaSession;
  private sessionId: string;
  private userId: string;
  private audioManager: AudioManager;
  private timerManager: TimerManager;
  private transcriptionManager: TranscriptionManager;
  private isRecording: boolean = false;
  private settings: any = {};
  
  constructor(session: TpaSession, sessionId: string, userId: string) {
    this.session = session;
    this.sessionId = sessionId;
    this.userId = userId;
    this.audioManager = new AudioManager(sessionId, userId);
    this.timerManager = new TimerManager(session);
    this.transcriptionManager = new TranscriptionManager();
  }

  /**
   * Initialize the session and start recording
   */
  public async initialize(settings: any = {}): Promise<void> {
    console.log(`Initializing recording session - User: ${this.userId}, Session: ${this.sessionId}`);
    this.settings = settings;
    
    try {
      // Apply settings to managers
      if (settings.audioFormat) {
        this.audioManager = new AudioManager(
          this.sessionId, 
          this.userId, 
          settings.audioFormat
        );
      }
      
      if (settings.language) {
        this.transcriptionManager.setLanguage(settings.language);
      }
      
      // Subscribe to audio chunks
      this.session.subscribe(StreamType.AUDIO_CHUNK);
      
      // Set up audio chunk handler
      this.session.events.onAudioChunk((data) => {
        this.audioManager.addAudioChunk(data);
      });
      
      // Create a transcription stream for the configured language
      const locale = settings.language || 'en-US';
      const transcriptionStream = createTranscriptionStream(locale);
      this.session.subscribe(transcriptionStream);
      
      // Set up transcription handler
      this.session.events.onTranscription((data: TranscriptionData) => {
        this.transcriptionManager.addTranscription(data);
      });
      
      // Start timer and display
      this.timerManager.startTimer();
      this.isRecording = true;
      
      console.log(`Recording started for session ${this.sessionId}`);
    } catch (error) {
      console.error('Error initializing session:', error);
      throw error;
    }
  }

  /**
   * Finalize the recording and return the results
   */
  public async finalize(): Promise<{ 
    filePath?: string, 
    transcriptText: string, 
    duration: string 
  }> {
    console.log(`Finalizing recording for session ${this.sessionId}`);
    
    // Stop timer
    const duration = this.timerManager.stopTimer();
    this.isRecording = false;
    
    // Save recording
    let filePath: string | undefined;
    try {
      filePath = await this.audioManager.saveRecording();
      console.log(`Recording saved to ${filePath}`);
    } catch (error) {
      console.error('Error saving recording:', error);
    }
    
    // Get final transcript text
    const transcriptText = this.transcriptionManager.getFormattedTranscript();
    
    // Clean up resources
    this.cleanup();
    
    return { 
      filePath, 
      transcriptText, 
      duration 
    };
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.timerManager.cleanup();
  }

  /**
   * Check if recording is in progress
   */
  public isActive(): boolean {
    return this.isRecording;
  }

  /**
   * Get current recording duration as formatted string
   */
  public getCurrentDuration(): string {
    return this.timerManager.getFormattedTime();
  }

  /**
   * Get the current transcript text
   */
  public getCurrentTranscriptText(): string {
    return this.transcriptionManager.getTranscriptText();
  }

  /**
   * Pause the recording
   */
  public pauseRecording(): void {
    if (this.isRecording) {
      this.timerManager.pauseTimer();
      this.isRecording = false;
    }
  }

  /**
   * Resume a paused recording
   */
  public resumeRecording(): void {
    if (!this.isRecording) {
      this.timerManager.resumeTimer();
      this.isRecording = true;
    }
  }

  /**
   * Get audio recording size in bytes
   */
  public getRecordingSize(): number {
    return this.audioManager.getTotalSize();
  }
}