# Audio Recorder TPA Design Document

## Overview

This document outlines the design for an Audio Recorder TPA (Third-Party Application) for Augment smart glasses. The application will:

1. Display "Recording Audio" text using a reference card
2. Show an incremental timer on the next line
3. Capture audio chunks and save them to a file
4. Collect transcripts of the audio during recording
5. Email the recording and transcripts to the user when the session ends using Resend

## System Architecture

The TPA will be built using the @augmentos/sdk and will have the following components:

1. **AudioRecorderApp**: Main application class that extends `TpaServer`
2. **AudioManager**: Class for handling audio chunks and saving to file
3. **TimerManager**: Class for managing and displaying the timer
4. **TranscriptionManager**: Class for collecting and processing transcriptions
5. **EmailService**: Class for sending email with the recording attachment and transcripts
6. **SessionManager**: Class to manage per-session resources

## Component Details

### AudioRecorderApp

The main application class that handles:
- Session initialization
- Subscription to audio streams
- Display management
- Session termination

```typescript
class AudioRecorderApp extends TpaServer {
  // Maps to store per-session instances
  private sessionManagers: Map<string, SessionManager> = new Map();
  private emailService: EmailService;
  
  constructor() {
    super({
      packageName: PACKAGE_NAME as string,
      apiKey: AUGMENTOS_API_KEY as string,
      port: PORT,
      publicDir: PUBLIC_DIR,
    });
    
    this.emailService = new EmailService(RESEND_API_KEY as string);
  }
  
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    // Create managers for this specific session
    const sessionManager = new SessionManager(session, sessionId, userId);
    this.sessionManagers.set(sessionId, sessionManager);
    
    // Initialize recording session
    await sessionManager.initialize();
  }
  
  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    // Get session-specific manager
    const sessionManager = this.sessionManagers.get(sessionId);
    if (!sessionManager) {
      console.error(`Session ${sessionId} not found`);
      return;
    }
    
    try {
      // Finalize the recording
      const result = await sessionManager.finalize();
      
      // Send email (userId is the user's email)
      if (result.filePath) {
        await this.emailService.sendRecordingEmail(
          userId, // userId is the email address
          result.filePath,
          {
            userId,
            sessionId,
            duration: result.duration,
            timestamp: new Date().toISOString()
          }
        );
      }
      
      // Clean up
      this.sessionManagers.delete(sessionId);
    } catch (error) {
      console.error(`Error finalizing session ${sessionId}:`, error);
    }
  }
}
```

### SessionManager

Manages per-session resources:

```typescript
class SessionManager {
  private session: TpaSession;
  private sessionId: string;
  private userId: string;
  private audioManager: AudioManager;
  private timerManager: TimerManager;
  private transcriptionManager: TranscriptionManager;
  
  constructor(session: TpaSession, sessionId: string, userId: string) {
    this.session = session;
    this.sessionId = sessionId;
    this.userId = userId;
    this.audioManager = new AudioManager(sessionId, userId);
    this.timerManager = new TimerManager(session);
    this.transcriptionManager = new TranscriptionManager();
  }
  
  public async initialize(): Promise<void> {
    // Subscribe to audio chunks and transcription stream
    this.session.subscribe(StreamType.AUDIO_CHUNK);
    
    // Create a transcription stream for the default language (English)
    const transcriptionStream = createTranscriptionStream('en-US');
    this.session.subscribe(transcriptionStream);
    
    // Start timer and show initial display
    this.timerManager.startTimer();
    
    // Set up audio chunk handler
    this.session.events.onAudioChunk((data) => {
      this.audioManager.addAudioChunk(data);
    });
    
    // Set up transcription handler
    this.session.events.onTranscription((data) => {
      this.transcriptionManager.addTranscription(data);
    });
  }
  
  public async finalize(): Promise<{ filePath?: string, transcriptText: string, duration: string }> {
    // Stop timer
    const duration = this.timerManager.stopTimer();
    
    // Save recording
    let filePath: string | undefined;
    try {
      filePath = await this.audioManager.saveRecording();
    } catch (error) {
      console.error('Error saving recording:', error);
    }
    
    // Get final transcript text
    const transcriptText = this.transcriptionManager.getFormattedTranscript();
    
    return { filePath, transcriptText, duration };
  }
}
```

### AudioManager

Handles the collection and processing of audio chunks:

```typescript
class AudioManager {
  private audioChunks: ArrayBuffer[] = [];
  private sampleRate: number = 16000; // Default, will be updated from chunks
  private sessionId: string;
  private userId: string;
  
  constructor(sessionId: string, userId: string) {
    this.sessionId = sessionId;
    this.userId = userId;
  }
  
  public addAudioChunk(chunk: AudioChunk): void {
    this.audioChunks.push(chunk.arrayBuffer);
    if (chunk.sampleRate) {
      this.sampleRate = chunk.sampleRate;
    }
  }
  
  public async saveRecording(): Promise<string> {
    // Combine audio chunks into a WAV file
    // Save to disk
    // Return file path
  }
}
```

### TimerManager

Manages the recording timer and its display:

```typescript
class TimerManager {
  private startTime: number | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private session: TpaSession;
  private elapsedTime: number = 0;
  
  constructor(session: TpaSession) {
    this.session = session;
  }
  
  public startTimer(): void {
    this.startTime = Date.now();
    
    // Initial display
    this.updateTimerDisplay(0);
    
    // Update timer display every second
    this.updateInterval = setInterval(() => {
      if (this.startTime) {
        this.elapsedTime = Date.now() - this.startTime;
        this.updateTimerDisplay(this.elapsedTime);
      }
    }, 1000);
  }
  
  private updateTimerDisplay(elapsedMs: number): void {
    const timerText = this.formatTime(elapsedMs);
    
    // Update the reference card with the timer
    this.session.layouts.showReferenceCard("Recording Audio", timerText, {
      view: ViewType.MAIN
    });
  }
  
  private formatTime(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  
  public stopTimer(): string {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Return the final duration formatted as string
    return this.formatTime(this.elapsedTime);
  }
}
```

### TranscriptionManager

Manages transcriptions from the audio stream:

```typescript
class TranscriptionManager {
  private transcriptions: TranscriptionData[] = [];
  
  constructor() {}
  
  public addTranscription(data: TranscriptionData): void {
    // Only store final transcriptions to avoid duplicates
    if (data.isFinal) {
      this.transcriptions.push(data);
    }
  }
  
  public getFormattedTranscript(): string {
    if (this.transcriptions.length === 0) {
      return "No transcription available";
    }
    
    // Sort transcriptions by time
    const sortedTranscriptions = [...this.transcriptions].sort((a, b) => a.startTime - b.startTime);
    
    // Format each transcription with timestamp
    const formattedTranscriptions = sortedTranscriptions.map(t => {
      const timestamp = new Date(t.startTime).toISOString().substr(11, 8); // HH:MM:SS
      return `[${timestamp}] ${t.text}`;
    });
    
    return formattedTranscriptions.join('\n');
  }
  
  public getTranscriptSummary(): string {
    // Get the full text of all transcriptions combined
    return this.transcriptions
      .map(t => t.text)
      .join(' ');
  }
}

### EmailService

Handles sending the recording via email:

```typescript
class EmailService {
  private resendApiKey: string;
  
  constructor(resendApiKey: string) {
    this.resendApiKey = resendApiKey;
  }
  
  public async sendRecordingEmail(
    toEmail: string, 
    audioFilePath: string, 
    metadata: { 
      userId: string, 
      sessionId: string, 
      duration: string, 
      timestamp: string,
      transcriptText: string
    }
  ): Promise<boolean> {
    try {
      // Use Resend SDK to send email with audio attachment
      // Return success status
      console.log(`Sending recording to email: ${toEmail}`);
      
      // Email would include:
      // 1. WAV file attachment
      // 2. Transcript text in the email body
      // 3. Recording metadata (duration, timestamp)
      
      // Implementation using Resend SDK would go here
      
      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }
}
```

## Data Flow

1. User starts the TPA
2. `onSession` is called:
   - A new SessionManager is created for this specific session
   - SessionManager initializes new AudioManager, TimerManager, and TranscriptionManager instances
   - App subscribes to `AUDIO_CHUNK` stream and transcription stream
   - TimerManager starts and displays initial reference card
   - App displays "Recording Audio" with timer at 00:00:00

3. During recording:
   - Audio chunks are received and stored in the session's AudioManager
   - Transcriptions are received and stored in the TranscriptionManager
   - Timer updates every second
   - Reference card is updated with new timer value

4. When user stops the TPA:
   - `onStop` is called
   - SessionManager finalizes the recording process
   - TimerManager stops and returns the final duration
   - AudioManager saves the recording as a WAV file
   - TranscriptionManager formats the collected transcriptions
   - EmailService sends the recording and transcript to the user's email (using userId as the email address)
   - Session resources are cleaned up and removed from the map

## Configuration

The TPA will need the following environment variables:
- `PORT`: Server port
- `CLOUD_HOST_NAME`: AugmentOS cloud host
- `PACKAGE_NAME`: TPA package name
- `AUGMENTOS_API_KEY`: API key for AugmentOS
- `RESEND_API_KEY`: API key for Resend email service
- `DEFAULT_EMAIL`: Default email to send recordings to (optional, can be configured per user)

## User Settings

The TPA will have the following user settings in `tpa_config.json`:

```json
{
  "name": "Audio Recorder",
  "description": "Records audio and emails the recording when finished",
  "version": "1.0.0",
  "settings": [
    {
      "key": "backup_email",
      "type": "text",
      "label": "Backup email for recordings (optional)",
      "defaultValue": ""
    },
    {
      "key": "audio_format",
      "type": "select",
      "label": "Recording format",
      "defaultValue": "wav",
      "options": [
        {
          "label": "WAV",
          "value": "wav"
        },
        {
          "label": "MP3",
          "value": "mp3"
        }
      ]
    }
  ]
}
```

## Audio Processing

Audio chunks will be received as `ArrayBuffer` objects with PCM audio data. The steps for processing:

1. Collect all chunks during the session
2. On session end, combine chunks into a single buffer
3. Create a WAV file header appropriate for the sample rate and bit depth
4. Combine header with audio data
5. Write to disk with appropriate file naming
6. Attach the file to email

## Email Service Integration

We'll use Resend for sending emails. The implementation will:
1. Create an email template with app branding
2. Attach the audio file
3. Include metadata about the recording (duration, date, etc.)
4. Send to the user's configured email address

## Challenges and Considerations

1. **Memory usage**: Long recordings may consume significant memory. Consider chunking the file saving process.
2. **Error handling**: Implement robust error handling, especially for network-related operations.
3. **User experience**: Ensure the timer display is accurate and the reference card is clearly visible.
4. **File sizes**: Large audio files might be problematic for email. Consider compression options.
5. **Email delivery**: Handle cases where the email address is invalid or email delivery fails.

## Implementation Plan

1. Set up basic TPA structure following the AudioRecorderApp template
2. Implement timer display with reference card
3. Add audio chunk collection functionality
4. Develop file saving capability
5. Integrate Resend for email delivery
6. Test with various recording durations
7. Add error handling and edge cases
8. Finalize and deploy

## Success Criteria

1. The TPA successfully displays "Recording Audio" with an accurate timer
2. Audio chunks are correctly captured and saved to a file
3. The recording is properly formatted as a WAV file
4. Emails are successfully delivered with the recording attached
5. The app handles errors gracefully, including network issues

## Sample Implementation Snippets

### Audio Chunk Processing

```typescript
// From AudioManager class
public async saveRecording(): Promise<string> {
  if (this.audioChunks.length === 0) {
    throw new Error('No audio data to save');
  }
  
  // Calculate total length
  let totalLength = 0;
  this.audioChunks.forEach(chunk => {
    totalLength += chunk.byteLength;
  });
  
  // Create WAV header (44 bytes)
  const wavHeader = this.createWavHeader(totalLength, this.sampleRate);
  
  // Combine header with audio data
  const completeFile = new Uint8Array(44 + totalLength);
  completeFile.set(new Uint8Array(wavHeader), 0);
  
  let offset = 44;
  this.audioChunks.forEach(chunk => {
    completeFile.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  });
  
  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `audio_${this.userId}_${timestamp}.wav`;
  const filePath = path.join(os.tmpdir(), fileName);
  
  // Write to file
  await fs.promises.writeFile(filePath, completeFile);
  
  return filePath;
}

private createWavHeader(dataLength: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  
  // RIFF identifier
  this.writeString(view, 0, 'RIFF');
  // File length minus RIFF identifier length and file description length
  view.setUint32(4, 36 + dataLength, true);
  // WAVE identifier
  this.writeString(view, 8, 'WAVE');
  // Format chunk identifier
  this.writeString(view, 12, 'fmt ');
  // Format chunk length
  view.setUint32(16, 16, true);
  // Sample format (1 is PCM)
  view.setUint16(20, 1, true);
  // Channel count
  view.setUint16(22, 1, true);
  // Sample rate
  view.setUint32(24, sampleRate, true);
  // Byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // Block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // Bits per sample
  view.setUint16(34, 16, true);
  // Data chunk identifier
  this.writeString(view, 36, 'data');
  // Data chunk length
  view.setUint32(40, dataLength, true);
  
  return buffer;
}

private writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
```

### Session Initialization

```typescript
// In SessionManager class
public async initialize(): Promise<void> {
  console.log(`Initializing session - User: ${this.userId}, Session: ${this.sessionId}`);
  
  try {
    // Subscribe to audio chunks
    this.session.subscribe(StreamType.AUDIO_CHUNK);
    
    // Set up event handler for audio chunks
    this.session.events.onAudioChunk((data) => {
      this.audioManager.addAudioChunk(data);
    });
    
    // Start timer display
    this.timerManager.startTimer();
    
    console.log(`Recording started for session ${this.sessionId}`);
  } catch (error) {
    console.error('Error initializing session:', error);
    throw error;
  }
}
```

### Session Termination

```typescript
// In AudioRecorderApp class
protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
  console.log(`Session ${sessionId} stopped: ${reason}`);
  
  const sessionManager = this.sessionManagers.get(sessionId);
  if (!sessionManager) {
    console.error(`No session manager found for session ${sessionId}`);
    return;
  }
  
  try {
    // Finalize recording and get results
    const result = await sessionManager.finalize();
    console.log(`Recording finalized, duration: ${result.duration}`);
    
    if (result.filePath) {
      console.log(`Recording saved to ${result.filePath}`);
      
      // Send to user's email (userId is the email)
      const metadata = {
        userId,
        sessionId,
        duration: result.duration,
        timestamp: new Date().toISOString(),
        transcriptText: result.transcriptText
      };
      
      const emailSent = await this.emailService.sendRecordingEmail(
        userId, // Primary email (userId is the email)
        result.filePath,
        metadata
      );
      
      console.log(`Email ${emailSent ? 'sent successfully' : 'failed to send'} to ${userId}`);
      console.log(`Transcript length: ${result.transcriptText.length} characters`);
    } else {
      console.log(`No recording file was created for session ${sessionId}`);
    }
  } catch (error) {
    console.error(`Error during session cleanup: ${error}`);
  } finally {
    // Always clean up session resources
    this.sessionManagers.delete(sessionId);
    console.log(`Session ${sessionId} resources cleaned up`);
  }
}
```

## Next Steps

After your approval of this design, I will implement the full TPA according to this specification, with appropriate error handling and optimization.