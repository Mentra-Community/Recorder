# AugmentOS Audio Recorder App 🎙️🎧

A powerful audio recording application for AugmentOS smart glasses that captures audio, provides real-time transcription, and emails recordings to users.

## Features

- **Audio Recording**: Records audio from the smart glasses microphone in high-quality format
- **Transcription**: Provides real-time transcription of the recording
- **Timer Display**: Shows recording duration in the AR view
- **Email Delivery**: Automatically sends recordings to the user when complete
- **Multiple Languages**: Supports a wide range of transcription languages
- **Web Interface**: Provides a browser-based interface for managing recordings

## Requirements

- AugmentOS-compatible smart glasses
- Node.js 16+ and Bun
- AugmentOS API Key
- Resend API Key (for email delivery)

## Environment Variables

The following environment variables must be set:

- `PACKAGE_NAME`: The package name registered in the AugmentOS developer console
- `AUGMENTOS_API_KEY`: Your AugmentOS API key
- `RESEND_API_KEY`: API key for the Resend email service
- `PORT` (optional): Server port (defaults to 80)
- `CLOUD_HOST_NAME` (optional): AugmentOS cloud host (defaults to prod.augmentos.org)
- `RECORDINGS_DIR` (optional): Directory to store recordings (defaults to ~/augmentos-recordings)

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```
3. Create a `.env` file with the required environment variables.
4. Build the app:
   ```bash
   bun run build
   ```

## Development

For local development:

```bash
./scripts/docker-dev.sh
```

This will start the app in a Docker container with hot reload enabled.

## Usage

1. Launch the app on your AugmentOS-compatible glasses
2. The app will automatically start recording when opened
3. A timer will display on the glasses showing the recording duration
4. When the app is closed, the recording will be finalized and sent to your email

## Settings

The app provides several customizable settings:

- **Recording Language**: Choose from various supported languages
- **Recording Format**: Choose between WAV (high quality) and PCM (raw data)
- **Email Delivery**: Toggle automatic email delivery of recordings
- **Backup Email**: Specify an additional email to receive recordings
- **Transcript Display**: Configure line width and number of lines for the transcript

## Webview Interface

The app includes a web interface that can be accessed at `/webview`. The webview provides:

- List of all recordings with download options
- Recording playback with transcription display
- Settings management
- Recording deletion

## API Endpoints

The app exposes the following API endpoints for the webview:

- `GET /recordings/:userId`: Get a list of all recordings for a user
- `GET /recordings/:userId/:filename`: Download a specific recording
- `DELETE /recordings/:userId/:filename`: Delete a specific recording
- `POST /settings`: Update user settings

## License

[MIT License](LICENSE)

## Credits

Developed for AugmentOS by BallahTech