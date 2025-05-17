# AugmentOS Voice Recorder

A simple, mobile-friendly voice recorder application for AugmentOS with real-time transcription streaming.

## Features

- **Start/Stop Recording**: Record audio with a simple button press
- **Real-time Transcription**: See transcripts as you speak with Server-Sent Events (SSE)
- **Recordings Library**: View and play back previous recordings
- **User-specific Storage**: Recordings are saved by userId for persistence across sessions
- **Mobile-friendly Design**: Clean, responsive interface that works well on all devices

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (JavaScript runtime and package manager)
- AugmentOS SDK (automatically installed as a dependency)

### Installation

1. Clone the repository
2. Install dependencies:

```bash
# Install server dependencies
cd server
bun install

# Install webview dependencies
cd ../webview
bun install
```

## Running the Application

### Development Mode

For development with hot reloading:

```bash
# From the project root
chmod +x dev.sh
./dev.sh
```

This will:
- Start the frontend Vite dev server
- Start the backend server in watch mode
- Auto-configure for local development

### Production Build

To build and run the production version:

```bash
# From the project root
chmod +x build-and-run.sh
./build-and-run.sh
```

This will:
- Build the frontend assets
- Build the backend server
- Start the server with the production build

## Architecture

The application consists of two main parts:

1. **Backend Server** (`server/`):
   - Express.js server with AugmentOS TPA integration
   - API endpoints for recordings and transcripts
   - SSE for real-time transcript streaming
   - Local file storage organized by user

2. **Frontend App** (`webview/`):
   - React application with TypeScript
   - TailwindCSS for styling
   - Mobile-first responsive design
   - EventSource API for SSE connections

## Folder Structure

```
recorder/
├── server/                # Backend server
│   ├── src/               # Source code
│   │   ├── api/           # API endpoints
│   │   ├── services/      # Business logic
│   │   └── app.ts         # Main server entry point
│   ├── temp_storage/      # Local file storage
│   └── package.json       # Server dependencies
├── webview/               # Frontend application
│   ├── src/               # Source code
│   │   ├── components/    # React components
│   │   └── App.tsx        # Main application component
│   ├── public/            # Static assets
│   └── package.json       # Frontend dependencies
├── dev.sh                 # Development script
└── build-and-run.sh       # Production build script
```

## API Endpoints

- `GET /api/recordings` - List user recordings
- `POST /api/recordings/start` - Start a new recording
- `POST /api/recordings/:id/stop` - Stop an active recording
- `GET /api/recordings/:id/download` - Download a recording
- `DELETE /api/recordings/:id` - Delete a recording
- `GET /api/transcripts` - Get previous transcripts
- `GET /api/transcripts/sse` - SSE endpoint for real-time transcripts

## Storage

Recordings are stored on disk in the `server/temp_storage` directory, organized by userId for persistence.

## Future Improvements

- Migrate from local storage to Cloudflare R2 or similar cloud storage
- Add authentication and user management
- Implement recording categorization and tagging
- Add audio visualization during recording
- Support for multiple languages in transcription