# MentraOS Recorder App Development Guide

## Commands
- **Dev**: `bun run dev` - Starts with hot reloading (watches src/index.ts)
- **Start**: `bun run start` - Builds webview then starts the app
- **Build Webview**: `bun run build:webview` - Compiles React frontend with Tailwind
- **Ngrok**: `bun run ngrok` - Expose local server via ngrok

## Architecture

This app uses a **two-server hybrid architecture**:

1. **Express Server (Port 8069)** - "Front Door"
   - MentraOS AppServer integration
   - Authentication middleware
   - Session/webhook endpoints
   - SSE streaming endpoint (`/api/events`)
   - API routes (recordings, transcripts, files, session)
   - Proxies unmatched routes to Bun

2. **Bun Server (Port 8070)** - "Backend"
   - React webview with hot reload
   - Static file serving
   - JSX/Tailwind processing

## Project Structure

```
src/
├── index.ts              # Main entry - coordinates both servers
├── app/                  # MentraOS App Logic
│   └── index.ts          # RecorderApp class (AppServer)
├── api/                  # Express API routes
│   ├── auth-helpers.ts   # Auth utilities for Bun routes
│   ├── session.api.ts    # Session status endpoints
│   ├── recordings.api.ts # Recording CRUD operations
│   ├── recordings.ts     # Bun route definitions (unused)
│   ├── transcripts.api.ts
│   ├── files.api.ts
│   └── events.api.ts     # SSE streaming
├── services/             # Business logic
│   ├── recordings.service.ts  # Recording management + audio chunk processing
│   ├── storage.service.ts     # R2/S3 file storage
│   └── stream.service.ts      # SSE client management
├── models/               # MongoDB models
│   └── recording.models.ts
├── connections/          # Database connections
│   └── mongodb.connection.ts
└── webview/              # React Frontend
    ├── index.html        # Dev entry
    ├── index.prod.html   # Production entry
    ├── frontend.tsx      # React root with HMR
    ├── App.tsx           # Main component
    ├── Api.ts            # API client with auth
    ├── components/       # UI components (shadcn/ui)
    ├── hooks/            # React hooks
    │   ├── useRecordings.ts   # Recording state management
    │   └── useRealTimeEvents.ts
    ├── screens/          # Page components
    └── lib/              # Utilities
```

## Code Style Guidelines
- **TypeScript**: Strict mode enabled, ESNext target
- **Formatting**: Use Prettier defaults
- **Modules**: ES Modules (`"type": "module"`)
- **Imports**: Use `@/` alias for webview imports
- **Naming**: camelCase for variables/functions, PascalCase for classes/components
- **Types**: Always define return types and parameter types

## Key Patterns

### Audio Chunk Processing
The recordings service uses an optimized pattern for high-frequency audio chunks (~25-40ms):
- **In-memory cache** for active recording lookups (avoids DB queries per chunk)
- **Sequential chunk queue** ensures chunks are stored in arrival order
- **Duration from bytes** - calculated from actual PCM data, not wall-clock time

### Authentication
- Express middleware sets `req.authUserId` from JWT token
- Bun routes receive `x-auth-user-id` header (forwarded from Express)
- Use `api.session.isConnected()` to check TPA session status

### SSE Streaming
- Endpoint: `/api/events`
- Handled in Express (not proxied to Bun)
- Broadcasts: recording-status, transcript, recording-error, recordings-refresh

### Session Tracking
- `registerActiveSession(userId)` called when TPA session starts
- `hasActiveSession(userId)` checks if user has connected glasses
- In-memory Map (not persisted)

## Environment Variables
- `PORT` - Server port (default: 8069)
- `PACKAGE_NAME` - MentraOS package name
- `MENTRAOS_API_KEY` - API key from console (required)
- `NODE_ENV` - development/production
- `MONGODB_URI` - MongoDB connection string
- `R2_ENDPOINT` - Cloudflare R2 endpoint
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key
- `R2_BUCKET_NAME` - R2 bucket name

## Dependencies
- Runtime: @mentra/sdk, @mentra/react, React 18, Radix UI, Tailwind, Mongoose
- Storage: @aws-sdk/client-s3 (for R2)
- Dev: TypeScript, Bun types, bun-plugin-tailwind