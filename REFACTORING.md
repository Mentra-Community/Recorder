# Recorder App Refactoring

## Overview

The Recorder app has been refactored to:

1. Properly serve the React webview from the TPA server
2. Support hot reloading during development with automatic redirection
3. Prepare for the updated AugmentOS SDK authentication

## Development Workflow

### Starting the Development Environment

Run the following command from the project root:

```bash
bun run dev
```

This will:
1. Start the Vite dev server for the React webview on port 5173
2. Start the TPA server on port 8069
3. Configure the TPA server to redirect webview requests to the Vite dev server

### Accessing the App

- **Webview (via TPA server)**: http://localhost:8069/webview
  - This will redirect to the Vite dev server with hot reloading
- **Direct Vite dev server**: http://localhost:5173
  - Access the React app directly

### Using ngrok

Run the following command to expose the TPA server via ngrok:

```bash
bun run ngrok
```

This will make the TPA server (including the webview) available through your ngrok URL.

## Authentication

### Development Mode

In development mode:
- A mock user ID is used for authentication
- The custom `isaiahMiddleware` is still available for backward compatibility

### Production Mode

In production:
- The AugmentOS SDK's built-in authentication is used
- User ID is obtained from `req.authUserId` automatically
- Cookie-based authentication is used for API requests and SSE connections

## Building for Production

To build both the webview and server for production:

```bash
bun run build
```

To run the production build:

```bash
bun run start
```

## Architecture

### Server

- The TPA server extends `TpaServer` from the AugmentOS SDK
- In development mode, it redirects webview requests to the Vite dev server
- In production mode, it serves the built webview directly

### Webview

- Built with React and Vite
- In development, runs on its own server with hot reloading
- Uses relative URLs for API endpoints, making it work in both development and production

### Authentication Flow

### Smart Proxy Architecture for Development

The app uses an intelligent proxy approach that works across all environments:

1. **Development Mode**:
   - Uses device detection to handle both local and external requests correctly
   - For local desktop browsers: redirects to the Vite dev server for best developer experience
   - For mobile/external devices (via ngrok): proxies requests with URL rewriting
   - Uses a custom lightweight proxy implementation that's compatible with Bun
   - Special handling for HTML content to fix paths for external access
   - API requests are handled directly by the TPA server
   - Client-side logging sends logs back to the server for visibility

2. **Production Mode**:
   - The TPA server directly serves the built static webview files
   - All routes are handled within a single origin

### Consistent Authentication Model

The consistent origin approach ensures authentication works seamlessly:

- All API calls use relative URLs with `withCredentials: true`
- SSE connections use relative URLs with `{ withCredentials: true }`
- All route handlers use the AugmentOS SDK's auth via `req.authUserId`
- No need for complex cross-origin setup or CORS issues
- External devices can access the app through ngrok while maintaining authentication

## Client-Side Logging

A robust logging system has been implemented to help with debugging:

1. **Server-Side Logging Endpoint**:
   - `/api/logs` endpoint captures client-side logs
   - Logs are displayed in the server terminal with color coding
   - Error logs include stack traces and user agent information

2. **Client-Side Logger**:
   - Utility that sends logs to the server from the client
   - Intercepts console logs with `[SERVER]` prefix
   - Automatically captures unhandled errors and rejections
   - Debug panel component for testing error scenarios

3. **Error Boundaries**:
   - Global error boundary for React errors
   - User-friendly error display
   - All errors logged to the server

## Further Improvements

1. **Additional API Route Updates**:
   - Update the remaining API routes (recordings.api.ts, events.api.ts, files.api.ts) to use the new authMiddleware 
   - Remove any remaining references to isaiahMiddleware across the app

2. **Improve Production Asset Handling**:
   - Add content hashing for better caching in the Vite build configuration
   - Implement proper error handling for client-side routing

3. **Environment-Specific Configurations**:
   - Create `.env` files for development and production
   - Move hardcoded server URLs and ports to environment variables

4. **CORS Configuration**:
   - Refine CORS settings to only allow specific origins in production
   - Add proper handling for preflight requests in development