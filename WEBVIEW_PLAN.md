# Recorder App Webview Plan

This document outlines the design and implementation plan for the Recorder app's webview interface.

## Overview

The Recorder app webview will provide a browser-based interface for users to:

1. View and download their recorded audio files
2. See transcripts of their recordings
3. Manage recording settings
4. Start/stop recording sessions remotely

## System Architecture

The webview will consist of:

1. **React Frontend**: User interface built with React, TypeScript, and Tailwind CSS
2. **API Integration**: Communication with the Recorder app backend
3. **Authentication System**: Ensuring secure access to user recordings
4. **Audio Playback**: In-browser player for recorded audio files
5. **Real-time Updates**: WebSocket connection for live status updates during recording

## Frontend Pages & Components

### 1. Dashboard / Home Page

- Summary of recent recordings
- Quick access to start new recording
- Stats (total recordings, total recording time, etc.)

### 2. Recordings Library

- List view of all recordings with:
  - Recording date/time
  - Duration
  - Optional title/label
  - Language
  - Preview of transcript
- Filter and search functionality
- Sort options (date, duration, etc.)

### 3. Recording Detail Page

- Audio player with waveform visualization
- Full transcript with timestamps
- Metadata (date, duration, language, etc.)
- Download options (audio file, transcript text)
- Edit options (rename, add notes, delete)
- Share options (generate link, email)

### 4. Settings Page

- Recording preferences:
  - Default language
  - Audio quality
  - Email delivery settings
- Account preferences
- App connection status

### 5. Live Recording Control

- Remote start/stop recording on connected glasses
- Real-time status display
- Live transcript preview during recording
- Timer display

## API Integration

The webview will communicate with the Recorder app backend through:

1. **REST API Endpoints**:
   - `GET /recordings` - List all recordings
   - `GET /recordings/:id` - Get details of a specific recording
   - `DELETE /recordings/:id` - Delete a recording
   - `PUT /recordings/:id` - Update recording metadata
   - `GET /settings` - Get user settings
   - `PUT /settings` - Update user settings
   - `POST /recording/start` - Start a new recording session
   - `POST /recording/stop` - Stop the current recording session

2. **WebSocket Connection**:
   - Real-time updates during recording (timer, status, transcript)
   - Connection status of glasses

## Data Models

### Recording

```typescript
interface Recording {
  id: string;
  userId: string;
  timestamp: string;
  duration: string; // in format "HH:MM:SS"
  language: string;
  title?: string;
  notes?: string;
  audioUrl: string;
  transcriptText: string;
  transcriptions: {
    text: string;
    startTime: number;
    endTime: number;
    isFinal: boolean;
  }[];
  status: 'processing' | 'completed' | 'error';
}
```

### User Settings

```typescript
interface UserSettings {
  defaultLanguage: string;
  audioQuality: 'standard' | 'high';
  emailDelivery: boolean;
  backupEmail?: string;
  audioFormat: 'wav' | 'mp3';
}
```

### Session Status

```typescript
interface SessionStatus {
  isRecording: boolean;
  currentDuration: string; // in format "HH:MM:SS"
  currentTranscript: string;
  deviceConnected: boolean;
  batteryLevel?: number;
}
```

## UI Components

### Core Components

1. **Header**: App logo, navigation, user menu
2. **Sidebar**: Main navigation (Dashboard, Recordings, Settings)
3. **Audio Player**: Custom player with waveform visualization
4. **Recording Card**: Card view of recording with basic metadata and actions
5. **Transcript Display**: Formatted display of transcript with timestamps
6. **Status Indicator**: Shows connection status with the glasses
7. **Recording Timer**: Displays current recording duration in real-time
8. **Confirmation Dialogs**: For delete and other destructive actions

### Design System

- Will utilize existing Tailwind CSS configuration
- Modern, clean interface with focus on readability
- Mobile-responsive design for all screens

## Authentication & Security

- Integration with existing authentication system
- JWT-based API access
- Secure storage of recordings and user data
- Permissions model to control access to recordings

## Implementation Plan

### Phase 1: Core Infrastructure

1. Set up project structure
2. Configure routing system
3. Create authentication integration
4. Implement API service layer
5. Design global state management

### Phase 2: Main Views

1. Develop Recordings Library view
2. Create Recording Detail page with audio player
3. Implement Settings page
4. Build Dashboard with summary stats

### Phase 3: Real-time Features

1. Implement WebSocket connection
2. Develop live recording control interface
3. Create real-time transcript display
4. Build status monitoring components

### Phase 4: Polish & Optimization

1. Refine UI/UX across all pages
2. Improve mobile responsiveness
3. Optimize performance
4. Add animations and transitions
5. Implement error handling and fallbacks

## Technical Considerations

1. **Browser Compatibility**: Target modern browsers with WebAudio API support
2. **Performance**: Optimize for handling large audio files and transcripts
3. **Offline Support**: Consider implementing Progressive Web App features
4. **Accessibility**: Ensure keyboard navigation and screen reader support
5. **Error Handling**: Robust error reporting and recovery

## Next Steps

1. Create detailed wireframes for each screen
2. Set up basic project structure and dependencies
3. Implement the API service layer
4. Begin development of the recordings library view