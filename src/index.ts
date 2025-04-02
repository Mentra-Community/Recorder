import path from 'path';
import {
  TpaServer,
  TpaSession,
  StreamType,
  ViewType,
  createTranscriptionStream,
  ExtendedStreamType,
} from '@augmentos/sdk';
import { TranscriptProcessor, languageToLocale, convertLineWidth } from './utils';
import axios from 'axios';

// Configuration constants
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 80;
const CLOUD_HOST_NAME = process.env.CLOUD_HOST_NAME || "prod.augmentos.org"; // Default to production server.
const PACKAGE_NAME = process.env.PACKAGE_NAME; // must be the same package name from the developer console: i.e: com.augmentos.livecaptions
const AUGMENTOS_API_KEY = process.env.AUGMENTOS_API_KEY; // Create an API key in the AugmentOS console and set it here. https://console.augmentos.org
const RESEND_API_KEY = process.env.RESEND_API_KEY; // Resend API key for sending emails of audio.
const MAX_FINAL_TRANSCRIPTS = 5;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Verify env vars are set.
if (!AUGMENTOS_API_KEY) {
  throw new Error('AUGMENTOS_API_KEY environment variable is required.');
}
if (!PACKAGE_NAME) {
  throw new Error('PACKAGE_NAME environment variable is required.');
}
if (!CLOUD_HOST_NAME) {
  throw new Error('CLOUD_HOST_NAME environment variable is required.');
}
if (!RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY environment variable is required.');
}

// User transcript processors map
const userTranscriptProcessors: Map<string, TranscriptProcessor> = new Map();

// For debouncing transcripts per session
interface TranscriptDebouncer {
  lastSentTime: number;
  timer: NodeJS.Timeout | null;
}

/**
 * LiveCaptionsApp - Main application class that extends TpaServer
 */
class LiveCaptionsApp extends TpaServer {
  // Session debouncers for throttling non-final transcripts
  private sessionDebouncers = new Map<string, TranscriptDebouncer>();

  constructor() {
    super({
      packageName: PACKAGE_NAME as string,
      apiKey: AUGMENTOS_API_KEY as string,
      port: PORT,
      publicDir: PUBLIC_DIR,
    });
  }

  /**
   * Called by TpaServer when a new session is created
   */
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    console.log(`\n\n🙉🚀New Debug Audio Session\n[userId]: ${userId}\n[sessionId]: ${sessionId}\n\n`);

    // Initialize transcript processor and debouncer for this session
    this.sessionDebouncers.set(sessionId, { lastSentTime: 0, timer: null });

    try {
      // Fetch and apply user settings (language, line width, etc.)
      await this.fetchAndApplySettings(session, userId);

      // Subscribe to transcription events
      session.events.onTranscription((data) => {
        this.handleTranscription(session, sessionId, userId, data);
      });
    } catch (error) {
      console.error('Error initializing session:', error);
    }
  }

  /**
   * Called by TpaServer when a session is stopped
   */
  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    console.log(`Session ${sessionId} stopped: ${reason}`);

    // Clean up session resources
    const debouncer = this.sessionDebouncers.get(sessionId);
    if (debouncer?.timer) {
      clearTimeout(debouncer.timer);
    }
    this.sessionDebouncers.delete(sessionId);
  }

  /**
   * Fetches user settings and applies them to the session
   */
  private async fetchAndApplySettings(session: TpaSession, userId: string): Promise<void> {
    try {
      const response = await axios.get(`https://${CLOUD_HOST_NAME}/tpasettings/user/${PACKAGE_NAME}`, {
        headers: { Authorization: `Bearer ${userId}` }
      });

      const settings = response.data.settings;
      console.log(`Fetched settings for user ${userId}:`, settings);

      // Extract settings
      const lineWidthSetting = settings.find((s: any) => s.key === 'line_width');
      const numberOfLinesSetting = settings.find((s: any) => s.key === 'number_of_lines');
      const transcribeLanguageSetting = settings.find((s: any) => s.key === 'transcribe_language');

      // Process language setting
      const language = transcribeLanguageSetting?.value || 'English';
      const locale = languageToLocale(language);
      const numberOfLines = numberOfLinesSetting ? Number(numberOfLinesSetting.value) : 3;

      // Calculate line width based on language
      const isChineseLanguage = locale.startsWith('zh-') || locale.startsWith('ja-');
      const lineWidth = lineWidthSetting
        ? convertLineWidth(lineWidthSetting.value, isChineseLanguage)
        : (isChineseLanguage ? 10 : 30);

      console.log(`Applied settings for user ${userId}: language=${locale}, lineWidth=${lineWidth}, numberOfLines=${numberOfLines}`);

      // Create transcript processor with these settings
      const transcriptProcessor = new TranscriptProcessor(lineWidth, numberOfLines, MAX_FINAL_TRANSCRIPTS);
      userTranscriptProcessors.set(userId, transcriptProcessor);

      // Subscribe to language-specific transcription stream
      const transcriptionStream = createTranscriptionStream(locale) as unknown as StreamType;
      session.subscribe(transcriptionStream);
      console.log(`Subscribed to ${transcriptionStream} for user ${userId}`);
    } catch (error) {
      console.error(`Error fetching settings for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Handles transcription data from the AugmentOS cloud
   */
  private handleTranscription(
    session: TpaSession,
    sessionId: string,
    userId: string,
    transcriptionData: any
  ): void {
    let transcriptProcessor = userTranscriptProcessors.get(userId);
    if (!transcriptProcessor) {
      // Create default processor if none exists
      transcriptProcessor = new TranscriptProcessor(30, 3, MAX_FINAL_TRANSCRIPTS);
      userTranscriptProcessors.set(userId, transcriptProcessor);
    }

    const isFinal = transcriptionData.isFinal;
    const newTranscript = transcriptionData.text;
    const language = transcriptionData.language;

    console.log(`[Session ${sessionId}]: Received transcription in language: ${language}`);

    // Process the transcript
    transcriptProcessor.processString(newTranscript, isFinal);

    let textToDisplay;
    if (isFinal) {
      // Get formatted history for final transcripts
      textToDisplay = transcriptProcessor.getFormattedTranscriptHistory();
      console.log(`[Session ${sessionId}]: finalTranscriptCount=${transcriptProcessor.getFinalTranscriptHistory().length}`);
    } else {
      // For non-final, get combined history plus current partial transcript
      const combinedTranscriptHistory = transcriptProcessor.getCombinedTranscriptHistory();
      const textToProcess = `${combinedTranscriptHistory} ${newTranscript}`;
      textToDisplay = transcriptProcessor.getFormattedPartialTranscript(textToProcess);
    }

    // Log and debounce the display
    console.log(`[Session ${sessionId}]: ${textToDisplay}`);
    console.log(`[Session ${sessionId}]: isFinal=${isFinal}`);

    this.debounceAndShowTranscript(session, sessionId, textToDisplay, isFinal);
  }

  /**
   * Debounces transcript display to avoid too frequent updates for non-final transcripts
   */
  private debounceAndShowTranscript(
    session: TpaSession,
    sessionId: string,
    transcript: string,
    isFinal: boolean
  ): void {
    const debounceDelay = 400; // in milliseconds
    let debouncer = this.sessionDebouncers.get(sessionId);

    if (!debouncer) {
      debouncer = { lastSentTime: 0, timer: null };
      this.sessionDebouncers.set(sessionId, debouncer);
    }

    // Clear any scheduled timer
    if (debouncer.timer) {
      clearTimeout(debouncer.timer);
      debouncer.timer = null;
    }

    const now = Date.now();

    // Show final transcripts immediately
    if (isFinal) {
      this.showTranscriptsToUser(session, transcript, isFinal);
      debouncer.lastSentTime = now;
      return;
    }

    // Throttle non-final transcripts
    if (now - debouncer.lastSentTime >= debounceDelay) {
      this.showTranscriptsToUser(session, transcript, false);
      debouncer.lastSentTime = now;
    } else {
      debouncer.timer = setTimeout(() => {
        this.showTranscriptsToUser(session, transcript, false);
        if (debouncer) {
          debouncer.lastSentTime = Date.now();
        }
      }, debounceDelay);
    }
  }

  /**
   * Displays transcript text in the AR view
   */
  private showTranscriptsToUser(
    session: TpaSession,
    transcript: string,
    isFinal: boolean
  ): void {
    session.layouts.showTextWall(transcript, {
      view: ViewType.MAIN,
      // Use a fixed duration for final transcripts (20 seconds)
      durationMs: isFinal ? 20000 : undefined
    });
  }

  /**
   * Handles settings updates (called via the /settings endpoint)
   */
  public async updateSettings(userId: string, settings: any[]): Promise<any> {
    try {
      console.log('Received settings update for user:', userId);

      // Extract settings
      const lineWidthSetting = settings.find(s => s.key === 'line_width');
      const numberOfLinesSetting = settings.find(s => s.key === 'number_of_lines');
      const transcribeLanguageSetting = settings.find(s => s.key === 'transcribe_language');

      // Process language setting
      const language = languageToLocale(transcribeLanguageSetting?.value) || 'en-US';
      const previousTranscriptProcessor = userTranscriptProcessors.get(userId);
      const previousLanguage = previousTranscriptProcessor?.getLanguage();
      const languageChanged = language !== previousLanguage;

      // Process other settings
      let lineWidth = 30; // default
      if (lineWidthSetting) {
        const isChineseLanguage = language.startsWith('zh-') || language.startsWith('ja-');
        lineWidth = convertLineWidth(lineWidthSetting.value, isChineseLanguage);
      }

      let numberOfLines = 3; // default
      if (numberOfLinesSetting) {
        numberOfLines = Number(numberOfLinesSetting.value);
        if (isNaN(numberOfLines) || numberOfLines < 1) numberOfLines = 3;
      }

      if (languageChanged) {
        console.log(`Language changed for user ${userId}: ${previousLanguage} -> ${language}`);
      }

      // Create a new processor with the updated settings
      const newProcessor = new TranscriptProcessor(
        lineWidth,
        numberOfLines,
        MAX_FINAL_TRANSCRIPTS,
        language
      );

      // Preserve transcript history if language didn't change
      if (!languageChanged && previousTranscriptProcessor) {
        const previousHistory = previousTranscriptProcessor.getFinalTranscriptHistory();
        for (const transcript of previousHistory) {
          newProcessor.processString(transcript, true);
        }
        console.log(`Preserved ${previousHistory.length} transcripts after settings change`);
      } else if (languageChanged) {
        console.log(`Cleared transcript history due to language change`);
      }

      // Update the processor
      userTranscriptProcessors.set(userId, newProcessor);

      // Get the current transcript text to display
      const displayText = newProcessor.getFormattedTranscriptHistory() || "";

      // Apply changes to active sessions for this user
      let sessionsRefreshed = false;
      // Note: Since TpaServer abstracts sessions, we'd need to access its session map
      // For now, we'll return success and let the TpaServer handle reconnection

      return {
        status: 'Settings updated successfully',
        sessionsRefreshed: sessionsRefreshed,
        languageChanged: languageChanged,
        transcriptsPreserved: !languageChanged
      };
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }
}

// Create and start the app
const liveCaptionsApp = new LiveCaptionsApp();

// Add settings endpoint
const expressApp = liveCaptionsApp.getExpressApp();
expressApp.post('/settings', async (req: any, res: any) => {
  try {
    const { userIdForSettings, settings } = req.body;

    if (!userIdForSettings || !Array.isArray(settings)) {
      return res.status(400).json({ error: 'Missing userId or settings array in payload' });
    }

    const result = await liveCaptionsApp.updateSettings(userIdForSettings, settings);
    res.json(result);
  } catch (error) {
    console.error('Error in settings endpoint:', error);
    res.status(500).json({ error: 'Internal server error updating settings' });
  }
});

// Start the server
liveCaptionsApp.start().then(() => {
  console.log(`${PACKAGE_NAME} server running on port ${PORT}`);
}).catch(error => {
  console.error('Failed to start server:', error);
});