# Audio Recorder: Functional Design

## Smart Glasses TPA

### Core Functionality
- Records audio from glasses microphone
- Captures speech transcription
- Processes voice commands via transcription
- Displays recording status and timer
- Saves recordings when stopped or app is closed
- Stores recordings for access via webview

### User Interactions
- Launch app: Displays "Say 'start recording' to begin"
- Voice command "start recording": Begins recording
- Voice command "stop recording": Ends recording
- Close app: Automatically stops and saves recording

### Display Elements
- "Recording" text displayed on glasses
- Timer showing elapsed recording time (HH:MM:SS)
- Transcription text below timer (when available)

**Example display:**
```
Recording: 00:00:30

Hello this is a recording
```

### Recording Flow
1. User opens app → prompt to start recording appears
2. User says "start recording" → recording begins
3. Timer displays and increments while recording
4. Live transcription appears below timer
5. User says "stop recording" or closes app → recording stops
6. Recording is processed and saved asynchronously (non-blocking)
7. Recording becomes available in webview

## Webview Interface

### Authentication Flow
- Email verification system for secure access
- Two-factor authentication using verification codes

#### Authentication Screens
1. **Login Screen**:
   - Email input field
   - Request verification code button
2. **Verification Screen**:
   - Code input field
   - Verification button

#### Authentication Flow
1. User enters email address
2. Server generates verification code
   - If user has active glasses session: Code appears on glasses
   - If no active session: Code is emailed to user
3. User enters verification code in webview
4. Server verifies code and generates JWT
5. JWT stored in secure cookie (`augmentos_auth_token`)
6. User is redirected to Live Control Panel

### Core Functionality
- Live control of recording session via WebSocket
- Real-time transcript display during recording
- Lists all user recordings
- Plays back audio recordings
- Displays transcripts
- Allows recording management (rename, delete)
- Provides email delivery on demand
- Configures recording settings

### User Interactions
- Start/stop recording from webview
- View real-time transcription
- Tap recording to play/view
- Use player controls to navigate audio
- Tap buttons to manage recordings
- Request email delivery of selected recordings
- Adjust settings via form controls

### Display Elements
- Authentication forms
- Live recording status and controls
- Real-time transcript display
- Chronological list of recordings
- Audio player with basic controls
- Transcript text display
- Email/share button
- Settings form

### Main Screens

#### Live Control Panel
- WebSocket connection to TPA
- Current recording status indicator
- Timer showing recording duration
- Start/Stop recording button
- Real-time transcript display with:
  - Auto-scrolling capability
  - Scroll-back to review earlier content
  - Clear visual distinction for final vs. draft transcripts

#### Recordings List Screen
- Recording items showing:
  - Date/time recorded
  - Duration
  - Title (default is timestamp)
- Sort by date (newest first)
- Delete button for each recording

#### Recording Detail Screen
- Audio player with:
  - Play/pause button
  - Seek bar
  - Time display
- Full transcript display
- Delete and rename options

#### Settings Screen
- Recording language selection
- Recording format option (WAV/PCM)
- Voice command sensitivity options
- Backup email input field

### Key Flows

#### Authentication
1. User opens webview
2. User enters email address
3. Verification code is generated and delivered
4. User enters verification code
5. Upon verification, JWT generated and stored in cookie

#### Live Recording Control
1. User navigates to Live Control Panel
2. WebSocket establishes connection with TPA backend
3. User can see current recording status and transcript
4. User taps "Start Recording" to begin recording remotely
5. Live transcript appears as recording progresses
6. User taps "Stop Recording" to end recording

#### Accessing Recordings
1. User navigates to recordings list
2. Recordings list displays
3. User taps recording to view details

#### Playing Recording
1. User taps recording
2. Audio playback begins
3. User can pause or seek using controls

#### Emailing a Recording
1. User selects email option for a recording
2. Email form appears with optional message field
3. User confirms and recording is sent to their email

#### Deleting Recording
1. User selects delete option
2. Confirmation prompt appears
3. Recording is removed after confirmation

#### Adjusting Settings
1. User navigates to settings
2. User modifies desired settings
3. Settings are saved automatically

## Technical Implementation Notes

- Voice commands implemented using the SDK's transcription capability
- Create a reusable voice command service for future app integration
- Processing and saving recordings must be asynchronous/non-blocking
- Recordings stored on backend server for webview access
- Email delivery implemented as on-demand feature rather than automatic
- Mobile-responsive design for webview
- JWT-based authentication with secure cookie storage
- WebSocket connection for real-time control and status updates
- Voice command threshold should be configurable in settings