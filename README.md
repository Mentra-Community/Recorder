# AugmentOS Recorder

A voice recorder application for AugmentOS glasses, providing voice recording and transcription capabilities with a clean, user-friendly interface.

## Features

- Record audio from AugmentOS glasses
- Real-time transcription of recorded audio
- Voice commands for starting and stopping recordings
- Rename recordings
- View and play recordings
- Dual storage system: local filesystem + Cloudflare R2
- MongoDB database for metadata

## Architecture

### Backend (Node.js + Express)

- Built with Express and TypeScript
- Extends the AugmentOS SDK's TpaServer
- Provides REST APIs for managing recordings
- Real-time updates via Server-Sent Events (SSE)
- Integrated with AugmentOS SDK for voice commands

### Frontend (React)

- React-based webview UI
- Streamlined, accessible interface
- Real-time updates via SSE
- Clean, modern UI with Tailwind CSS

### Storage

The application uses a dual storage system:

1. **Local Filesystem**
   - Recordings are saved to the local filesystem for development and quick access
   - Files are stored in `./temp_storage/<userId>/<recordingId>.wav`

2. **Cloudflare R2**
   - Cloud storage for production use
   - S3-compatible API
   - Secure, cost-effective storage

3. **MongoDB**
   - Stores recording metadata (title, duration, transcript, etc.)
   - Provides efficient querying and indexing

## Setup

### Prerequisites

- Node.js 16+ / Bun
- MongoDB (local or remote)
- Cloudflare R2 bucket (optional for development)

### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy the example environment file and customize:
   ```
   cp .env.example .env
   ```
4. Update environment variables in `.env` file
5. Start the development server:
   ```
   npm run dev
   ```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 8069 |
| `MONGODB_URI` | MongoDB connection string | mongodb://localhost:27017/recorder |
| `USE_LOCAL_DISK` | Whether to use local filesystem | true |
| `LOCAL_STORAGE_PATH` | Path for local storage | ./temp_storage |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 access key | - |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret key | - |
| `R2_BUCKET_NAME` | R2 bucket name | recorder |
| `R2_ENDPOINT` | R2 endpoint URL | - |
| `R2_PUBLIC_URL` | Public URL for R2 bucket | - |

## Development

### Running the Development Server

```bash
npm run dev
```

This will start both the backend server and frontend development server concurrently. The backend will auto-reload when changes are made.

### Docker Development Environment

```bash
npm run docker:dev
```

This starts the application in a Docker container for an isolated development environment.

## API Endpoints

### Recordings

- `GET /api/recordings` - Get all recordings for authenticated user
- `GET /api/recordings/:id` - Get a specific recording
- `POST /api/recordings/start` - Start a new recording
- `POST /api/recordings/:id/stop` - Stop an active recording
- `PUT /api/recordings/:id` - Update recording (e.g., rename)
- `GET /api/recordings/:id/download` - Download recording audio
- `DELETE /api/recordings/:id` - Delete a recording

## Real-time Events

The application uses Server-Sent Events (SSE) for real-time updates:

- `transcript` - Real-time transcript updates
- `recording-status` - Recording status changes
- `recording-error` - Error notifications
- `recording-deleted` - Recording deletion notifications

## Voice Commands

The application supports the following voice commands via AugmentOS glasses:

- "Start recording" - Starts a new recording
- "Stop recording" - Stops the current recording

## License

[MIT License](LICENSE)