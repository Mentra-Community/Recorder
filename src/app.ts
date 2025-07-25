/**
 * Simplified AugmentOS Recorder App Server
 * Main application entry point
 */

import { AppServer, AuthenticatedRequest, AppSession } from '@mentra/sdk';
import path from 'path';
import cors from 'cors';
import express, { Express, Request, Response, NextFunction } from 'express';
import recordingsApi from './api/recordings.api';
import transcriptsApi from './api/transcripts.api';
import filesApi from './api/files.api';
import eventsApi from './api/events.api';
import sessionApi from './api/session.api';
import devApi from './api/dev.api';
import streamService from './services/stream.service';
import recordingsService from './services/recordings.service';
import * as mongodbConnection from './connections/mongodb.connection';

/**
 * Custom App Server for the Recorder App
 * Extends the base AppServer with application-specific functionality
 */
class RecorderServer extends AppServer {
  private expressApp: Express;

  constructor() {
    // Initialize with our configuration
    super({
      packageName: process.env.PACKAGE_NAME || 'com.mentra.recorder',
      apiKey: process.env.MENTRAOS_API_KEY || 'development-key',
      port: parseInt(process.env.PORT || '8069', 10),
    });

    // Get the Express app instance
    this.expressApp = this.getExpressApp();
    this.setupExpressApp();
  }

  /**
   * Configure the Express application
   */
  private setupExpressApp(): void {
    const app = this.getExpressApp();

    // Configure request parsing with increased limits for headers
    app.use(express.json({ 
      limit: '50mb',
    }));
    
    app.use(express.urlencoded({ 
      limit: '50mb', 
      extended: true,
      parameterLimit: 50000,
    }));

    // Debug middleware for development
    app.use(this.debugMiddleware);

    // Set up CORS
    this.setupCors();

    // Serve static files in production
    if (process.env.NODE_ENV === 'production') {
      app.use(express.static(path.join(__dirname, '../webview/dist')));
    }

    // Set up API routes
    this.setupApiRoutes();
  }

  /**
   * Debug middleware for development authentication
   * Only applies when no real authentication is present
   */
  private debugMiddleware = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    if (process.env.NODE_ENV === 'development') {
      // Only set debug user if no real authentication is present
      if (!req.authUserId) {
        req.authUserId = 'isaiah@mentra.glass';
        console.log('[DEBUG] Using debug auth for user:', req.authUserId);
      } else {
        console.log('[DEBUG] Real auth detected for user:', req.authUserId);
      }
    }
    next();
  };

  /**
   * Configure CORS for separate frontend/backend deployment
   */
  private setupCors(): void {
    const app = this.getExpressApp();

    // Parse allowed origins from environment
    const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:5173', // Vite dev server
      'http://localhost:5174', // Vite dev server
      'http://localhost:8069', // Backend server
      'http://localhost:3000',  // Local testing
      'https://recorder-webview.ngrok.app', // Vite dev server
      'https://isaiah-webview.ngrok.app', // Actual webview ngrok URL
      'https://isaiah-tpa.ngrok.app',
      'https://recorder.mentra.glass',
    ];

    // CORS configuration for separate servers
    app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);

        // Check if origin is in allowed list
        if (ALLOWED_ORIGINS.includes(origin)) {
          return callback(null, true);
        }

        // Log rejected origins for debugging
        console.warn(`CORS blocked origin: ${origin}`);
        return callback(new Error('Not allowed by CORS'), false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin'
      ],
      exposedHeaders: ['Content-Type', 'Authorization']
    }));

    // Handle preflight requests
    app.options('*', cors());
  }

  /**
   * Set up API routes
   */
  private setupApiRoutes(): void {
    const app = this.getExpressApp();

    // Root API endpoint with status info
    app.get('/api', (req: Request, res: Response) => {
      res.json({
        message: 'MentraOS Recorder API',
        version: '0.1.0',
        status: 'development'
      });
    });

    // Health check endpoint
    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Core API routes for Recorder app
    app.use('/api/recordings', recordingsApi);
    app.use('/api/transcripts', transcriptsApi);
    app.use('/api/files', filesApi);
    app.use('/api/events', eventsApi);
    app.use('/api/session', sessionApi);
    
    // Development utilities
    if (process.env.NODE_ENV === 'development') {
      app.use('/api/dev', devApi);
    }

    // Catch-all route for React app (in production)
    if (process.env.NODE_ENV === 'production') {
      app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../webview/dist/index.html'));
      });
    }
  }


  /**
   * Handle new TPA session
   * This is called automatically by the AppServer base class
   */
  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    console.log(`New TPA session: ${sessionId} for user ${userId}`);

    // Set up SDK session handlers for audio and transcription
    recordingsService.setupSDKSession(session, sessionId, userId);

    // Show welcome message on glasses
    session.layouts.showTextWall("MentraOS Recorder App - Open the webview to manage recordings!");
  }

  /**
   * Handle session stop
   * This is called automatically by the AppServer base class
   */
  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    console.log(`TPA session stopped: ${sessionId} for user ${userId}, reason: ${reason}`);
    
    // Clean up any active recordings for this user
    try {
      const activeRecording = await recordingsService.getActiveRecordingForUser(userId);
      if (activeRecording) {
        console.log(`[CLEANUP] Stopping active recording ${activeRecording._id} for disconnected user ${userId}`);
        await recordingsService.stopRecording(activeRecording._id.toString());
      }
    } catch (error) {
      console.error(`[CLEANUP] Error stopping recording for user ${userId}:`, error);
    }
  }
}

// Create and start the server
const server = new RecorderServer();

mongodbConnection.init().then(() => {
  console.log('MongoDB connection established');
  server.start().then(() => {
    console.log(`[STARTUP] MentraOS Recorder server running on port ${process.env.PORT || 8069} for ${process.env.PACKAGE_NAME}`);
  }).catch(serverError => {
    console.error('[ERROR] Failed to start server:', serverError);
    process.exit(1);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

export default server.getExpressApp();