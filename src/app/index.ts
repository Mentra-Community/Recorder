/**
 * RecorderApp - Main application class that extends AppServer
 *
 * This is the MentraOS App entry point that handles sessions and
 * delegates audio/transcription to the recordings service.
 */

import { AppServer, AppSession } from "@mentra/sdk";
import recordingsService from "../services/recordings.service";

/**
 * RecorderApp extends AppServer to handle MentraOS sessions
 */
export class RecorderApp extends AppServer {
  constructor(config: { packageName: string; apiKey: string; port: number }) {
    super({
      packageName: config.packageName,
      apiKey: config.apiKey,
      port: config.port,
    });
  }

  /**
   * Called by AppServer when a new session is created
   */
  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    console.log(
      `\n🎙️ New Recorder session for user ${userId}, session ${sessionId}\n`,
    );

    // Set up SDK session handlers for audio and transcription
    recordingsService.setupSDKSession(session, sessionId, userId);

    // Show welcome message on glasses
    session.layouts.showTextWall(
      "MentraOS Recorder - Open the webview to manage recordings!",
    );
  }

  /**
   * Called by AppServer when a session is stopped
   */
  protected async onStop(
    sessionId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    console.log(`Session ${sessionId} stopped for user ${userId}: ${reason}`);

    // Clean up any active recordings for this user
    try {
      const activeRecording =
        await recordingsService.getActiveRecordingForUser(userId);
      if (activeRecording) {
        console.log(
          `[CLEANUP] Stopping active recording ${activeRecording._id} for disconnected user ${userId}`,
        );
        await recordingsService.stopRecording(activeRecording._id.toString());
      }
    } catch (error) {
      console.error(
        `[CLEANUP] Error stopping recording for user ${userId}:`,
        error,
      );
    }
  }
}

export default RecorderApp;
