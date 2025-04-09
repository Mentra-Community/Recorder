import path from 'path';
import express from 'express';
import http from 'http';
import { Server as WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import {
  TpaServer,
  TpaSession,
  StreamType,
  ViewType,
  createTranscriptionStream,
} from '@augmentos/sdk';
import { 
  languageToLocale, 
  convertLineWidth,
  EmailService,
  VoiceCommandService,
  RecordingManager,
  RecordingStatus,
  AuthService
} from './utils';
import axios from 'axios';
import * as fs from 'fs';

// Configuration constants
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 80;
const CLOUD_HOST_NAME = process.env.CLOUD_HOST_NAME || "prod.augmentos.org"; // Default to production server.
const PACKAGE_NAME = process.env.PACKAGE_NAME; // must be the same package name from the developer console: i.e: com.augmentos.recorder
const AUGMENTOS_API_KEY = process.env.AUGMENTOS_API_KEY; // Create an API key in the AugmentOS console and set it here. https://console.augmentos.org
const RESEND_API_KEY = process.env.RESEND_API_KEY; // Resend API key for sending emails of audio.
const PUBLIC_DIR = path.join(__dirname, 'public');
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(process.env.HOME || '/tmp', 'augmentos-recordings');
const COOKIE_NAME = 'augmentos_auth_token'; // Cookie name for JWT token
const JWT_SECRET = AUGMENTOS_API_KEY as string; // Use AUGMENTOS_API_KEY as JWT secret

// Verify env vars are set.
if (!AUGMENTOS_API_KEY) {
  throw new Error('AUGMENTOS_API_KEY environment variable is required.');
}
if (!PACKAGE_NAME) {
  throw new Error('PACKAGE_NAME environment variable is required.');
}
if (!CLOUD_HOST_NAME) {
  throw new Error('CLOUD_HOST_NAME environment variable is required.');
}
if (!RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY environment variable is required.');
}

// Create recordings directory if it doesn't exist
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  console.log(`Created recordings directory at ${RECORDINGS_DIR}`);
}

/**
 * AudioRecorderApp - Main application class that extends TpaServer
 */
class AudioRecorderApp extends TpaServer {
  // Maps to store per-session managers
  private recordingManagers: Map<string, RecordingManager> = new Map();
  private voiceCommandServices: Map<string, VoiceCommandService> = new Map();
  private emailService: EmailService;
  private authService: AuthService;
  private wss: WebSocketServer;
  // Map to store active WebSocket connections by user ID
  private activeConnections: Map<string, Set<WebSocket>> = new Map();
  
  constructor() {
    super({
      packageName: PACKAGE_NAME as string,
      apiKey: AUGMENTOS_API_KEY as string,
      port: PORT,
      publicDir: PUBLIC_DIR,
    });
    
    this.emailService = new EmailService(RESEND_API_KEY as string);
    this.authService = new AuthService(JWT_SECRET);
    
    // Initialize the WebSocket server on the existing Express server
    this.wss = new WebSocketServer({ 
      server: this.getServer() 
    });
    
    // Set up WebSocket connection handling
    this.setupWebSocket();
  }
  
  /**
   * Set up WebSocket server and handlers
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      console.log('WebSocket connection established');
      
      // Extract user ID from JWT in query parameter or cookie
      let userId: string | null = null;
      
      try {
        // Check for token in URL query parameter first
        const url = new URL(req.url as string, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        
        if (token) {
          const decoded = this.authService.verifyToken(token);
          if (decoded) {
            userId = decoded.email;
          }
        }
        
        // If no token in URL, try checking cookies
        if (!userId && req.headers.cookie) {
          const cookies = req.headers.cookie.split(';');
          for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === COOKIE_NAME) {
              const decoded = this.authService.verifyToken(value);
              if (decoded) {
                userId = decoded.email;
              }
              break;
            }
          }
        }
        
        if (!userId) {
          console.log('WebSocket connection rejected: No valid auth token');
          ws.close(1008, 'Unauthorized');
          return;
        }
        
        // Store connection by user ID
        if (!this.activeConnections.has(userId)) {
          this.activeConnections.set(userId, new Set());
        }
        this.activeConnections.get(userId)?.add(ws);
        
        // Send initial state
        this.sendUserState(userId, ws);
        
        // Set up message handler
        ws.on('message', (message: string) => {
          this.handleWebSocketMessage(userId as string, message.toString(), ws);
        });
        
        // Set up close handler
        ws.on('close', () => {
          console.log(`WebSocket connection closed for user ${userId}`);
          this.activeConnections.get(userId as string)?.delete(ws);
          if (this.activeConnections.get(userId as string)?.size === 0) {
            this.activeConnections.delete(userId as string);
          }
        });
        
      } catch (error) {
        console.error('Error handling WebSocket connection:', error);
        ws.close(1011, 'Internal server error');
      }
    });
  }
  
  /**
   * Handle WebSocket messages
   */
  private handleWebSocketMessage(userId: string, message: string, ws: WebSocket): void {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'start_recording':
          this.handleStartRecording(userId, data, ws);
          break;
        case 'stop_recording':
          this.handleStopRecording(userId, data, ws);
          break;
        case 'get_state':
          this.sendUserState(userId, ws);
          break;
        default:
          console.log(`Unknown message type: ${data.type}`);
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'Unknown message type' 
          }));
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'Invalid message format' 
      }));
    }
  }
  
  /**
   * Handle start recording request from WebSocket
   */
  private handleStartRecording(userId: string, data: any, ws: WebSocket): void {
    // Find an active session for this user
    let sessionId = null;
    let recordingManager = null;
    
    for (const [id, manager] of this.recordingManagers.entries()) {
      if (manager.getUserId() === userId) {
        sessionId = id;
        recordingManager = manager;
        break;
      }
    }
    
    if (!sessionId || !recordingManager) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'No active session found' 
      }));
      return;
    }
    
    // Start recording
    if (recordingManager.startRecording()) {
      ws.send(JSON.stringify({ 
        type: 'recording_started', 
        sessionId 
      }));
    } else {
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'Failed to start recording' 
      }));
    }
  }
  
  /**
   * Handle stop recording request from WebSocket
   */
  private handleStopRecording(userId: string, data: any, ws: WebSocket): void {
    // Find an active session for this user
    let sessionId = null;
    let recordingManager = null;
    
    for (const [id, manager] of this.recordingManagers.entries()) {
      if (manager.getUserId() === userId) {
        sessionId = id;
        recordingManager = manager;
        break;
      }
    }
    
    if (!sessionId || !recordingManager) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'No active session found' 
      }));
      return;
    }
    
    // Stop recording
    if (recordingManager.stopRecording()) {
      ws.send(JSON.stringify({ 
        type: 'recording_stopped', 
        sessionId 
      }));
    } else {
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'Failed to stop recording' 
      }));
    }
  }
  
  /**
   * Send current user state to WebSocket client
   */
  private sendUserState(userId: string, ws: WebSocket): void {
    // Find all active sessions for this user
    const userSessions = [];
    
    for (const [sessionId, manager] of this.recordingManagers.entries()) {
      if (manager.getUserId() === userId) {
        userSessions.push({
          sessionId,
          status: manager.getStatus(),
          duration: manager.getCurrentDuration(),
          recentTranscript: manager.getRecentTranscript()
        });
      }
    }
    
    // Send the state
    ws.send(JSON.stringify({
      type: 'state_update',
      sessions: userSessions,
      recordings: this.getRecordings(userId)
    }));
  }
  
  /**
   * Broadcast recording status update to all connected clients for a user
   */
  private broadcastUserUpdate(userId: string): void {
    const connections = this.activeConnections.get(userId);
    if (!connections || connections.size === 0) {
      return;
    }
    
    for (const ws of connections) {
      this.sendUserState(userId, ws);
    }
  }

  /**
   * Called by TpaServer when a new session is created
   */
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    console.log(`\n\n🎙️ New Audio Recording Session\n[userId]: ${userId}\n[sessionId]: ${sessionId}\n\n`);

    try {
      // Fetch user settings
      const settings = await this.fetchUserSettings(userId);
      
      // Create recording manager
      const recordingManager = new RecordingManager(session, sessionId, userId, RECORDINGS_DIR);
      recordingManager.applySettings(settings);
      this.recordingManagers.set(sessionId, recordingManager);
      
      // Create voice command service
      const voiceCommandService = new VoiceCommandService();
      this.voiceCommandServices.set(sessionId, voiceCommandService);
      
      // Register voice commands
      voiceCommandService.registerCommand('start recording', () => {
        console.log(`Voice command detected: start recording for session ${sessionId}`);
        
        if (recordingManager.startRecording()) {
          console.log(`Recording started for session ${sessionId}`);
        }
      });
      
      voiceCommandService.registerCommand('stop recording', () => {
        console.log(`Voice command detected: stop recording for session ${sessionId}`);
        
        if (recordingManager.stopRecording()) {
          console.log(`Recording stopped for session ${sessionId}`);
        }
      });
      
      // Update display with instructions
      session.layouts.showReferenceCard(
        "Audio Recorder", 
        "Say 'start recording' to begin",
        { view: ViewType.MAIN }
      );
      
      // Set up event listeners for recording status changes
      recordingManager.on('recordingStarted', () => {
        this.updateRecordingDisplay(session, recordingManager);
        this.broadcastUserUpdate(userId);
      });
      
      recordingManager.on('recordingStopped', () => {
        session.layouts.showReferenceCard(
          "Recording Stopped", 
          "Processing your recording...",
          { view: ViewType.MAIN }
        );
        this.broadcastUserUpdate(userId);
      });
      
      recordingManager.on('recordingProcessed', (result) => {
        session.layouts.showReferenceCard(
          "Recording Saved", 
          `Duration: ${result.duration}`,
          { view: ViewType.MAIN, durationMs: 5000 }
        );
        this.broadcastUserUpdate(userId);
      });
      
      recordingManager.on('recordingError', (error) => {
        session.layouts.showReferenceCard(
          "Recording Error", 
          "There was a problem saving your recording.",
          { view: ViewType.MAIN, durationMs: 5000 }
        );
        this.broadcastUserUpdate(userId);
      });
      
      // Check if this user has a pending authentication code
      const authCode = this.authService.getCodeForSession(sessionId);
      if (authCode) {
        // Display the code on glasses
        session.layouts.showReferenceCard(
          "Verification Code", 
          `Your code: ${authCode.code}`,
          { view: ViewType.MAIN, durationMs: 30000 }
        );
      }
      
      // Subscribe to needed streams
      // Audio for recording
      session.subscribe(StreamType.AUDIO_CHUNK);
      
      // Transcription for voice commands and transcript
      const transcriptionStream = createTranscriptionStream(settings.language || 'en-US');
      session.subscribe(transcriptionStream);
      
      // Set up handlers
      // Audio handler
      session.events.onAudioChunk((data) => {
        recordingManager.processAudioChunk(data);
      });
      
      // Transcription handler
      session.events.onTranscription((data) => {
        // Process for voice commands
        voiceCommandService.processTranscription({
          text: data.text,
          isFinal: data.isFinal,
          timestamp: data.startTime
        });
        
        // Process for transcript recording
        recordingManager.processTranscription(data);
        
        // If recording, update display with latest transcript
        if (recordingManager.getStatus() === RecordingStatus.RECORDING) {
          this.updateRecordingDisplay(session, recordingManager);
        }
      });
      
      console.log(`Session initialized for user ${userId}`);
    } catch (error) {
      console.error('Error initializing session:', error);
    }
  }

  /**
   * Update the recording display with timer and transcript
   */
  private updateRecordingDisplay(session: TpaSession, recordingManager: RecordingManager): void {
    const duration = recordingManager.getCurrentDuration();
    
    session.layouts.showReferenceCard(
      `Recording: ${duration}`, 
      "", // Transcription will be shown by the TPA automatically
      { view: ViewType.MAIN }
    );
  }

  /**
   * Called by TpaServer when a session is stopped
   */
  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    console.log(`Session ${sessionId} stopped: ${reason}`);

    // Get recording manager
    const recordingManager = this.recordingManagers.get(sessionId);
    if (!recordingManager) {
      console.error(`Session ${sessionId} not found`);
      return;
    }

    try {
      // Stop any active recording
      if (recordingManager.getStatus() === RecordingStatus.RECORDING) {
        recordingManager.stopRecording();
      }
      
      // Clean up resources
      recordingManager.cleanup();
      this.recordingManagers.delete(sessionId);
      this.voiceCommandServices.delete(sessionId);
      
      console.log(`Session ${sessionId} resources cleaned up`);
    } catch (error) {
      console.error(`Error stopping session ${sessionId}:`, error);
    }
  }

  /**
   * Fetches user settings from the AugmentOS cloud
   */
  private async fetchUserSettings(userId: string): Promise<any> {
    try {
      const response = await axios.get(`https://${CLOUD_HOST_NAME}/tpasettings/user/${PACKAGE_NAME}`, {
        headers: { Authorization: `Bearer ${userId}` }
      });
      
      const settingsArray = response.data.settings;
      console.log(`Fetched settings for user ${userId}:`, settingsArray);
      
      // Convert array to object
      const settings: any = {};
      for (const setting of settingsArray) {
        settings[setting.key] = setting.value;
      }
      
      // Process language setting
      const language = settings.transcribe_language || 'English';
      settings.language = languageToLocale(language);
      
      // Set default values for missing settings
      settings.audio_format = settings.audio_format || 'wav';
      
      return settings;
    } catch (error) {
      console.error(`Error fetching settings for user ${userId}:`, error);
      // Return default settings
      return {
        language: 'en-US',
        audio_format: 'wav'
      };
    }
  }

  /**
   * Get a list of recordings for a user
   */
  public getRecordings(userId: string): any[] {
    const userDir = path.join(RECORDINGS_DIR, userId);
    if (!fs.existsSync(userDir)) {
      return [];
    }
    
    try {
      // Get files
      const files = fs.readdirSync(userDir)
        .filter(file => file.endsWith('.wav') || file.endsWith('.pcm'));
      
      // Convert to recording objects
      return files.map(file => {
        const filePath = path.join(userDir, file);
        const stats = fs.statSync(filePath);
        
        // Extract info from filename
        // Expected format: recording_[sessionId]_[timestamp].[ext]
        const parts = file.split('_');
        let sessionId = '';
        let timestamp = '';
        
        if (parts.length >= 3) {
          sessionId = parts[1];
          // The rest is timestamp and extension
          timestamp = parts.slice(2).join('_').replace(/\.[^.]+$/, '');
        }
        
        return {
          id: file,
          title: file,
          path: filePath,
          userId: userId,
          sessionId: sessionId,
          timestamp: timestamp.replace(/-/g, ':'),
          size: stats.size,
          duration: '00:00:00', // TODO: Extract real duration
          format: path.extname(file).substring(1)
        };
      });
    } catch (error) {
      console.error(`Error getting recordings for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Get a specific recording
   */
  public getRecording(userId: string, fileId: string): any {
    const filePath = path.join(RECORDINGS_DIR, userId, fileId);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    try {
      const stats = fs.statSync(filePath);
      
      // Extract info from filename
      // Expected format: recording_[sessionId]_[timestamp].[ext]
      const parts = fileId.split('_');
      let sessionId = '';
      let timestamp = '';
      
      if (parts.length >= 3) {
        sessionId = parts[1];
        // The rest is timestamp and extension
        timestamp = parts.slice(2).join('_').replace(/\.[^.]+$/, '');
      }
      
      return {
        id: fileId,
        title: fileId,
        path: filePath,
        userId: userId,
        sessionId: sessionId,
        timestamp: timestamp.replace(/-/g, ':'),
        size: stats.size,
        duration: '00:00:00', // TODO: Extract real duration
        format: path.extname(fileId).substring(1)
      };
    } catch (error) {
      console.error(`Error getting recording ${fileId} for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Delete a recording
   */
  public deleteRecording(userId: string, fileId: string): boolean {
    const filePath = path.join(RECORDINGS_DIR, userId, fileId);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      console.error(`Error deleting recording ${fileId} for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Rename a recording
   */
  public renameRecording(userId: string, fileId: string, newTitle: string): boolean {
    // We can't actually rename the file since we encode metadata in the filename
    // Instead, we'll create a title mapping file
    const userDir = path.join(RECORDINGS_DIR, userId);
    const titleMapPath = path.join(userDir, 'titles.json');
    
    try {
      // Load existing titles
      let titles: Record<string, string> = {};
      if (fs.existsSync(titleMapPath)) {
        titles = JSON.parse(fs.readFileSync(titleMapPath, 'utf-8'));
      }
      
      // Update title
      titles[fileId] = newTitle;
      
      // Save titles
      fs.writeFileSync(titleMapPath, JSON.stringify(titles, null, 2));
      
      return true;
    } catch (error) {
      console.error(`Error renaming recording ${fileId} for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Send a recording via email
   */
  public async emailRecording(userId: string, fileId: string, toEmail: string): Promise<boolean> {
    const recording = this.getRecording(userId, fileId);
    if (!recording) {
      return false;
    }
    
    try {
      const result = await this.emailService.sendRecordingEmail(
        toEmail,
        recording.path,
        {
          userId: userId,
          sessionId: recording.sessionId,
          duration: recording.duration,
          timestamp: new Date().toISOString(),
          language: 'en-US' // TODO: Get actual language
        }
      );
      
      return result;
    } catch (error) {
      console.error(`Error emailing recording ${fileId} for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Update settings for a user
   */
  public async updateSettings(userId: string, settings: any[]): Promise<any> {
    try {
      console.log(`Updating settings for user ${userId}:`, settings);
      
      // Nothing to do here, as settings are fetched on session start
      return { success: true };
    } catch (error) {
      console.error(`Error updating settings for user ${userId}:`, error);
      throw error;
    }
  }
}

// Create and start the app
const audioRecorderApp = new AudioRecorderApp();

// Get Express app from TpaServer
const expressApp = audioRecorderApp.getExpressApp();

// Add middleware for parsing JSON and cookies
expressApp.use(express.json());
expressApp.use(cookieParser());

// API endpoint for listing recordings
expressApp.get('/api/recordings/:userId', (req, res) => {
  const userId = req.params.userId;
  const recordings = audioRecorderApp.getRecordings(userId);
  res.json({ recordings });
});

// API endpoint for getting a recording
expressApp.get('/api/recordings/:userId/:fileId', (req, res) => {
  const userId = req.params.userId;
  const fileId = req.params.fileId;
  const recording = audioRecorderApp.getRecording(userId, fileId);
  
  if (!recording) {
    return res.status(404).json({ error: 'Recording not found' });
  }
  
  res.json({ recording });
});

// API endpoint for downloading a recording
expressApp.get('/api/recordings/:userId/:fileId/download', (req, res) => {
  const userId = req.params.userId;
  const fileId = req.params.fileId;
  const recording = audioRecorderApp.getRecording(userId, fileId);
  
  if (!recording) {
    return res.status(404).json({ error: 'Recording not found' });
  }
  
  res.download(recording.path);
});

// API endpoint for deleting a recording
expressApp.delete('/api/recordings/:userId/:fileId', (req, res) => {
  const userId = req.params.userId;
  const fileId = req.params.fileId;
  const success = audioRecorderApp.deleteRecording(userId, fileId);
  
  if (!success) {
    return res.status(404).json({ error: 'Recording not found or could not be deleted' });
  }
  
  res.json({ success: true });
});

// API endpoint for renaming a recording
expressApp.put('/api/recordings/:userId/:fileId/rename', (req, res) => {
  const userId = req.params.userId;
  const fileId = req.params.fileId;
  const { title } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  
  const success = audioRecorderApp.renameRecording(userId, fileId, title);
  
  if (!success) {
    return res.status(500).json({ error: 'Failed to rename recording' });
  }
  
  res.json({ success: true });
});

// API endpoint for emailing a recording
expressApp.post('/api/recordings/:userId/:fileId/email', (req, res) => {
  const userId = req.params.userId;
  const fileId = req.params.fileId;
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  audioRecorderApp.emailRecording(userId, fileId, email)
    .then(success => {
      if (!success) {
        return res.status(500).json({ error: 'Failed to email recording' });
      }
      
      res.json({ success: true });
    })
    .catch(error => {
      res.status(500).json({ error: 'Failed to email recording' });
    });
});

// API endpoint for updating settings
expressApp.post('/api/settings/:userId', (req, res) => {
  const userId = req.params.userId;
  const { settings } = req.body;
  
  if (!Array.isArray(settings)) {
    return res.status(400).json({ error: 'Settings must be an array' });
  }
  
  audioRecorderApp.updateSettings(userId, settings)
    .then(result => {
      res.json(result);
    })
    .catch(error => {
      res.status(500).json({ error: 'Failed to update settings' });
    });
});

// Authentication endpoints
// Request a verification code
expressApp.post('/api/auth/request-code', (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  try {
    // Find active session for this email
    let activeSessionId = null;
    
    for (const [sessionId, manager] of audioRecorderApp.recordingManagers.entries()) {
      if (manager.getUserId() === email) {
        activeSessionId = sessionId;
        break;
      }
    }
    
    // Generate verification code
    const code = audioRecorderApp.authService.generateCode(email, activeSessionId);
    
    // If no active session, send email with code
    if (!activeSessionId) {
      // TODO: Implement email delivery of verification codes
      audioRecorderApp.emailService.sendVerificationEmail(email, code);
      
      res.json({ 
        success: true, 
        message: 'Verification code sent to your email' 
      });
    } else {
      // Code will be shown on glasses
      res.json({ 
        success: true, 
        message: 'Verification code sent to your glasses' 
      });
    }
  } catch (error) {
    console.error('Error generating verification code:', error);
    res.status(500).json({ error: 'Failed to generate verification code' });
  }
});

// Verify code and generate token
expressApp.post('/api/auth/verify-code', (req, res) => {
  const { email, code } = req.body;
  
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }
  
  try {
    // Verify code
    const isValid = audioRecorderApp.authService.verifyCode(email, code);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid or expired verification code' });
    }
    
    // Generate JWT token
    const token = audioRecorderApp.authService.generateToken(email);
    
    // Set cookie
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'strict'
    });
    
    res.json({ 
      success: true, 
      token // Also return token for clients that need it
    });
  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// Verify token
expressApp.get('/api/auth/verify', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  
  if (!token) {
    return res.status(401).json({ authenticated: false });
  }
  
  try {
    const decoded = audioRecorderApp.authService.verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ authenticated: false });
    }
    
    res.json({ 
      authenticated: true, 
      user: decoded.email 
    });
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(401).json({ authenticated: false });
  }
});

// Logout
expressApp.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

// Serve webview files
expressApp.use('/webview', express.static(path.join(__dirname, '../webview/dist')));
expressApp.get('/webview/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../webview/dist/index.html'));
});

// Basic status endpoint
expressApp.get('/', (req, res) => {
  res.send(`AugmentOS Audio Recorder is running. Access webview at /webview`);
});

// Apply middleware for securing API endpoints
// Auth middleware for protected routes
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Skip auth for auth endpoints and static files
  if (req.path.startsWith('/api/auth/') || req.path.startsWith('/webview')) {
    return next();
  }
  
  // Check for token in cookie
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const decoded = audioRecorderApp.authService.verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Add user to request object
    (req as any).user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Apply auth middleware to API routes
expressApp.use('/api', authMiddleware);

// Start the server
audioRecorderApp.start().then(() => {
  console.log(`Audio Recorder server running on port ${PORT}`);
  console.log(`Webview available at http://localhost:${PORT}/webview`);
  console.log(`WebSocket server available at ws://localhost:${PORT}`);
}).catch(error => {
  console.error('Failed to start server:', error);
});