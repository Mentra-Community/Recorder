# Separate Server Deployment Guide - Recorder App

This guide covers deploying the MentraOS Recorder App when you want to run the **frontend** and **backend** on separate servers or hosting platforms. This architecture provides greater flexibility, better scaling options, and allows different teams to manage frontend and backend deployments independently.

## Architecture Overview

In a separate server deployment:

```
┌─────────────────────┐    HTTPS      ┌─────────────────────┐
│   Frontend Server   │ ────────────► │   Backend Server    │
│  (React/Vite App)   │   API Calls   │ (Express/Bun API)   │
│                     │               │                     │
│ • Static files      │               │ • /api/* routes     │
│ • HTML/CSS/JS       │               │ • SSE endpoints     │
│ • Served by CDN/    │               │ • MentraOS SDK      │
│   Static hosting    │               │ • Recording API     │
└─────────────────────┘               │ • Audio Storage     │
           │                          └─────────────────────┘
           │                                     │
           ▼                                     │
┌─────────────────────┐               ┌─────────────────────┐
│  MentraOS Manager   │               │   Storage (S3/R2)   │
│       App           │               │   & Database        │
└─────────────────────┘               └─────────────────────┘
```

## Prerequisites

- **Two separate hosting environments** (e.g., Vercel + Railway, Netlify + Render)
- **Custom domains or known URLs** for both frontend and backend
- **HTTPS enabled** on both servers (required for MentraOS)
- **CORS configuration** properly set up
- **MongoDB database** (Atlas or self-hosted)
- **Storage service** (AWS S3, Cloudflare R2, etc.)

## Step-by-Step Configuration

### 1. Backend Server Configuration

#### Environment Variables

Copy `.env.production.example` to `.env` and configure for your production environment:

```env
# Core MentraOS Configuration
PACKAGE_NAME=cloud.augmentos.recorder
MENTRAOS_API_KEY=your_production_api_key_here
PORT=8069
NODE_ENV=production

# CORS Configuration
ALLOWED_ORIGINS=https://your-recorder-app.vercel.app,https://your-recorder-staging.vercel.app

# MongoDB Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/recorder

# Storage Configuration
USE_LOCAL_DISK=false
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=recorder
R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://your-account.r2.cloudflarestorage.com/recorder
```

#### Backend Deployment Scripts

The backend is already configured for separate deployment. Key files:

- **`src/app.ts`**: Main server with MentraOS SDK integration
- **`src/api/`**: All API endpoints for recordings, transcripts, files, etc.
- **`src/services/`**: Recording management, storage, streaming services

### 2. Frontend Server Configuration

#### Environment Variables

Create `webview/.env.production` for your frontend:

```env
# Backend API URL (change to your deployed backend URL)
VITE_BACKEND_URL=https://your-recorder-backend.railway.app

# Environment indicator
VITE_ENVIRONMENT=production
```

#### Update Frontend Package.json

The frontend `webview/package.json` is already configured for separate deployment with:

```json
{
  "dependencies": {
    "@mentra/react": "^0.2.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
    // ... UI dependencies only
  }
}
```

### 3. Deployment Options

#### Backend Deployment: Railway

1. **Connect Repository:**
   - Go to [railway.app](https://railway.app)
   - Create new project from GitHub repo
   - Set root directory to `/` (or backend folder if in monorepo)

2. **Environment Variables:**
   ```env
   PACKAGE_NAME=cloud.augmentos.recorder
   MENTRAOS_API_KEY=your_api_key_here
   NODE_ENV=production
   PORT=8069
   ALLOWED_ORIGINS=https://your-recorder-app.vercel.app
   MONGODB_URI=mongodb+srv://...
   R2_ACCESS_KEY_ID=your_r2_key
   R2_SECRET_ACCESS_KEY=your_r2_secret
   R2_BUCKET_NAME=recorder
   R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com
   ```

3. **Deployment Settings:**
   - Build Command: `bun install`
   - Start Command: `bun run start:prod`

#### Frontend Deployment: Vercel

1. **Connect Repository:**
   - Go to [vercel.com](https://vercel.com)
   - Import your repository
   - Set root directory to `webview/`

2. **Build Settings:**
   - Framework Preset: `Vite`
   - Build Command: `bun run build`
   - Output Directory: `dist`

3. **Environment Variables:**
   ```env
   VITE_BACKEND_URL=https://your-recorder-backend.railway.app
   VITE_ENVIRONMENT=production
   ```

### 4. Key Implementation Details

#### API Authentication Flow

The frontend uses MentraOS authentication with proper token passing:

```typescript
// Frontend gets token from MentraOS auth
const { frontendToken } = useMentraAuth();

// API calls include Bearer token
headers: {
  'Authorization': `Bearer ${frontendToken}`
}

// SSE connections use token as query parameter
const eventSource = new EventSource(`${backendUrl}/api/events?token=${frontendToken}`);
```

#### Development vs Production

```typescript
// Automatic switching between proxy (dev) and direct calls (prod)
const API_BASE_URL = import.meta.env.DEV ? '' : getBackendUrl();

// SSE URL construction
const baseUrl = import.meta.env.DEV ? '' : getBackendUrl();
let eventUrl = `${baseUrl}/api/events`;
```

#### CORS Configuration

Backend properly handles CORS for separate servers:

```typescript
// Dynamic CORS based on allowed origins
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`CORS blocked origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true
}));
```

### 5. Testing the Deployment

#### Backend Testing

```bash
# Test health endpoint
curl https://your-recorder-backend.railway.app/api/health

# Test with CORS headers
curl -H "Origin: https://your-recorder-app.vercel.app" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     https://your-recorder-backend.railway.app/api/recordings
```

#### Frontend Testing

1. **Local Testing with Remote Backend:**
   ```bash
   # Set backend URL in webview/.env.local
   echo "VITE_BACKEND_URL=https://your-recorder-backend.railway.app" > webview/.env.local
   
   # Run frontend locally
   cd webview && bun run dev
   ```

2. **Production Testing:**
   - Open your deployed frontend URL
   - Check browser console for CORS errors
   - Test authentication flow through MentraOS app
   - Verify recording functionality and SSE connections

### 6. Monitoring and Troubleshooting

#### Debug Information

The frontend includes debug info in development mode (top-right corner):
- User ID
- Frontend token status
- Backend URL being used
- Connection mode (proxy vs direct)

#### Common Issues

**CORS Errors:**
- Ensure `ALLOWED_ORIGINS` includes your frontend domain
- Check browser Network tab for preflight requests

**SSE Connection Issues:**
- Verify token is being passed in query parameter
- Check backend logs for authentication errors
- Ensure CORS headers are set for SSE endpoint

**Recording/Playback Issues:**
- Verify storage configuration (S3/R2)
- Check MongoDB connection
- Test audio file uploads/downloads

#### Health Monitoring

**Backend Endpoints:**
- `/api/health` - Basic health check
- `/api/recordings` - Test database connectivity
- `/api/session/is-connected` - Test MentraOS SDK connection

**Frontend Monitoring:**
- Monitor API call success rates
- Track authentication token refresh
- Watch for SSE connection drops