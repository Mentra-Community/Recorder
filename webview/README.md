# Augment Recorder App

## Overview

The Augment Recorder App is a voice recording application for Augment smart glasses that allows users to create, manage, and play back audio recordings. The app features a web-based interface built with React and TypeScript, communicating with a Node.js backend server that interfaces with the AugmentOS SDK.

## Features

- **Voice-Activated Recording**: Start and stop recordings using voice commands through smart glasses
- **UI-Initiated Recording**: Start and stop recordings through the web interface
- **Real-Time Status Updates**: See recording status in real-time across devices
- **Secure Authentication**: Token-based authentication for API requests
- **Transcript View**: View transcriptions of recordings
- **Download Support**: Download recordings for offline listening
- **Recording Management**: Rename, delete, and organize recordings

## Architecture

The app consists of three main components:

1. **Web Interface (React/TypeScript)**: User-facing application for managing recordings
2. **Backend Server (Node.js/Express)**: API for recording management and storage
3. **AugmentOS SDK Integration**: Connects to smart glasses for recording and voice commands

### Web Interface

The webview is built with:
- React 18
- TypeScript
- shadcn/ui components
- Vite for bundling

Key features of the front-end:
- Real-time updates via SSE (Server-Sent Events)
- Responsive design that works across devices
- Audio playback with waveform visualization
- Token-based secure file downloads

### Backend Server

The server provides:
- RESTful API for recording management
- SSE for real-time updates
- Secure file storage and retrieval
- Token-based authentication
- Voice command processing
- AugmentOS SDK integration

## Project Structure

```
webview/
├── src/
│   ├── screens/                   # Main application screens
│   │   ├── PlaybackImproved/      # Audio playback screen
│   │   ├── RecordingImproved/     # Recording creation screen
│   │   └── RecordingsListImproved/# Recordings list screen
│   ├── components/                # Shared UI components
│   ├── hooks/                     # Custom React hooks
│   │   ├── useAudioPlayer.ts      # Audio playback logic
│   │   ├── useAuth.ts             # Authentication logic
│   │   ├── useRecordings.ts       # Recording management
│   │   ├── useRealTimeEvents.ts   # SSE event handling
│   │   └── useWebSocket.ts        # WebSocket connection
│   ├── utils/                    
│   │   ├── formatters.ts          # Date and time formatting
│   │   ├── logger.ts              # Logging utilities
│   │   └── storage.ts             # Local storage helpers
│   ├── types/                     # TypeScript type definitions
│   ├── context/                   # React context providers
│   ├── services/                  # API service integration
│   ├── App.tsx                    # Main app component with routing
│   ├── Api.ts                     # Centralized API client
│   └── main.tsx                   # Entry point
```

## Authentication Flow

The app uses a secure token-based authentication system:

1. **API Authentication**: Uses the AugmentOS SDK for authenticating API requests
2. **File Downloads**: Uses signed tokens with expiration dates for secure file access
3. **Real-Time Updates**: Authenticated SSE connections for live updates

## Security Features

- **Token Expiration**: Download tokens expire after 60 minutes
- **URL-Safe Encoding**: Tokens are URL-safe base64 encoded for browser compatibility
- **HMAC Signatures**: Cryptographically signed tokens prevent tampering
- **CORS Headers**: Proper CORS configuration for cross-origin requests

## Development Notes

### Local Development

1. Install dependencies: `npm install`
2. Start the development server: `npm run dev`
3. Open [http://localhost:5173](http://localhost:5173) in your browser

### Building for Production

```bash
npm run build
```

### Deployment

The webview is designed to be embedded in the AugmentOS SDK environment but can also be served as a standalone application.

## Known Issues and Solutions

### Token-Based Downloads

The application uses a secure token-based system for file downloads to ensure that only authenticated users can access recordings. This approach:

1. Generates a signed token on the server
2. Embeds the token in download URLs
3. Verifies the token when the file is requested

If download tokens expire or are invalid, check:
- Clock synchronization between client and server
- Token encoding/decoding in the browser
- CORS configuration for cross-origin requests

## Future Improvements

- Enhanced transcript viewing with timestamps
- Advanced search capabilities
- Sharing recordings with other users
- Integration with more AugmentOS services
- Offline support for recording playback