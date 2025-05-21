/**
 * Simplified AugmentOS Recorder App Server
 * Main application entry point
 */

import { TpaServer, TpaSession, ViewType } from '@augmentos/sdk';
import path from 'path';
import cors from 'cors';
import express, { Express, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import recordingsApi from './api/recordings.api';
import transcriptsApi from './api/transcripts.api';
import filesApi from './api/files.api';
import eventsApi from './api/events.api';
import sessionApi from './api/session.api';
import streamService from './services/stream.service';
import recordingsService from './services/recordings.service';
import * as mongodbConnection from './connections/mongodb.connection';

/**
 * Custom TPA Server for the Recorder App
 * Extends the base TpaServer with application-specific functionality
 */
class RecorderServer extends TpaServer {
  private expressApp: Express;

  constructor() {
    // Initialize with our configuration
    super({
      packageName: process.env.PACKAGE_NAME || 'com.augmentos.recorder',
      apiKey: process.env.AUGMENTOS_API_KEY || 'development-key',
      port: parseInt(process.env.PORT || '8069', 10),
      publicDir: path.join(__dirname, '../webview/dist')
    });

    // Get the Express app instance
    this.expressApp = this.getExpressApp();
    this.setupExpressApp();
  }

  /**
   * Configure the Express application
   */
  private setupExpressApp(): void {
    // Apply CORS middleware
    this.expressApp.use(cors({
      origin: '*',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // Parse JSON for request bodies
    this.expressApp.use(express.json());

    // Parse URL-encoded request bodies (forms)
    this.expressApp.use(express.urlencoded({ extended: true }));

    // Add auto-auth for development
    this.setupDevAuth();

    // Set up API routes
    this.setupApiRoutes();

    // Serve static files
    this.setupStaticFileServing();
  }

  /**
   * Set up auto-authentication for development
   */
  private setupDevAuth(): void {
    // Development middleware to auto-auth from localhost
    this.expressApp.use((req: Request, res: Response, next: NextFunction) => {
      // Check if this is a request from localhost
      const isLocalhost = req.hostname === 'localhost' ||
        req.hostname === '127.0.0.1' ||
        req.ip === '127.0.0.1' ||
        req.ip === '::1';

      if (isLocalhost) {
        // Auto-inject auth for local development
        const userEmail = 'isaiah@mentra.glass';
        console.log(`[DEV] Auto-authenticating as ${userEmail}`);

        // Set auth user ID for API routes
        (req as any).authUserId = userEmail;

        // For non-API routes, need to inject auth token into HTML
        if (!req.path.startsWith('/api/') && req.path !== '/api') {
          // Will inject auth token in the static file middleware
          (req as any).autoAuth = true;
          (req as any).userEmail = userEmail;
        }
      }

      next();
    });
  }

  /**
   * Set up API routes
   */
  private setupApiRoutes(): void {
    // Root API endpoint with status info
    this.expressApp.get('/api', (req: Request, res: Response) => {
      res.json({
        message: 'AugmentOS Recorder API',
        version: '0.1.0',
        status: 'development'
      });
    });

    // Core API routes for Recorder app
    this.expressApp.use('/api/recordings', recordingsApi);
    this.expressApp.use('/api/transcripts', transcriptsApi);
    this.expressApp.use('/api/files', filesApi);
    this.expressApp.use('/api/events', eventsApi);
    this.expressApp.use('/api/session', sessionApi);
  }

  /**
   * Set up static file serving
   */
  private setupStaticFileServing(): void {
    const staticFilesPath = path.join(__dirname, '../webview/dist');
    console.log(`[SERVER] Serving static files from: ${staticFilesPath}`);

    // Root redirect to webview
    this.expressApp.get('/', (req: Request, res: Response) => {
      res.redirect('/webview');
    });

    // Special handling for webview to inject auth
    this.expressApp.get('/webview', (req: Request, res: Response) => {
      console.log(`[SERVER] Webview request received from ${req.ip}`);

      const filePath = path.join(staticFilesPath, 'index.html');

      try {
        let html = fs.readFileSync(filePath, 'utf8');

        // Add auto auth for local development
        if ((req as any).autoAuth && (req as any).userEmail) {
          console.log(`[DEV] Injecting auth for ${(req as any).userEmail}`);

          html = html.replace(
            '<head>',
            `<head>
    <script>
      // Auto-authentication for local development
      window.AUTH_TOKEN = "dev_auto_auth_token";
      window.USER_EMAIL = "${(req as any).userEmail}";
      
      // Intercept fetch to add auth token
      const originalFetch = window.fetch;
      window.fetch = function(url, options) {
        // Add auth headers to all requests
        options = options || {};
        options.headers = options.headers || {};
        options.headers['X-Auth-User'] = window.USER_EMAIL;
        return originalFetch(url, options);
      };
      console.log('Auto-auth configured for local development');
    </script>`
          );
        }

        res.type('text/html').send(html);
      } catch (error) {
        console.error('[ERROR] Failed to serve webview HTML:', error);
        res.status(500).send('Error serving webview');
      }
    });

    // Serve static files with caching disabled in development
    this.expressApp.use(express.static(staticFilesPath, {
      maxAge: 0,
      etag: false,
      lastModified: false
    }));

    // Catch-all route for client-side routing
    this.expressApp.get('*', (req: Request, res: Response, next: NextFunction) => {
      // Skip API routes
      if (req.path.startsWith('/api/')) {
        return next();
      }

      // For all other routes, serve the index.html
      const indexPath = path.join(staticFilesPath, 'index.html');

      if (fs.existsSync(indexPath)) {
        try {
          let html = fs.readFileSync(indexPath, 'utf8');

          // Auto-inject auth for localhost
          if ((req as any).autoAuth && (req as any).userEmail) {
            console.log(`[DEV] Injecting auth for path: ${req.path}`);

            html = html.replace(
              '<head>',
              `<head>
    <script>
      // Auto-authentication for local development
      window.AUTH_TOKEN = "dev_auto_auth_token";
      window.USER_EMAIL = "${(req as any).userEmail}";
      
      // Intercept fetch to add auth token
      const originalFetch = window.fetch;
      window.fetch = function(url, options) {
        // Add auth headers to all requests
        options = options || {};
        options.headers = options.headers || {};
        options.headers['X-Auth-User'] = window.USER_EMAIL;
        return originalFetch(url, options);
      };
    </script>`
            );
          }

          res.type('text/html').send(html);
        } catch (err) {
          console.error(`[ERROR] Failed to serve index.html: ${err}`);
          next(err);
        }
      } else {
        next(); // Let the next middleware handle it
      }
    });
  }

  /**
   * Handle new TPA session
   * This is called automatically by the TpaServer base class
   */
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    console.log(`New TPA session: ${sessionId} for user ${userId}`);

    // Set up SDK session handlers for audio and transcription
    recordingsService.setupSDKSession(session, sessionId, userId);

    // Show welcome message on glasses
    session.layouts.showReferenceCard(
      "Recorder App",
      "Start recording with the web interface or say 'start recording'",
      { view: ViewType.MAIN, durationMs: 5000 }
    );
  }

  /**
   * Handle session stop
   * This is called automatically by the TpaServer base class
   */
  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    console.log(`TPA session stopped: ${sessionId} for user ${userId}, reason: ${reason}`);
    // Clean up any active recordings or resources
  }
}

// Create and start the server
const server = new RecorderServer();

mongodbConnection.init().then(() => {
  console.log('MongoDB connection established');
  // Try to start the server anyway
  server.start().then(() => {
    console.log(`[STARTUP] TPA server running on port ${process.env.PORT || 8069} for ${process.env.PACKAGE_NAME}`);
  }).catch(serverError => {
    console.error('[ERROR] Failed to start server:', serverError);
    process.exit(1);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

export default server.getExpressApp();