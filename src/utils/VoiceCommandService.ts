/**
 * Service to detect and process voice commands from transcription data
 */
export class VoiceCommandService {
  private commandCallbacks: Map<string, (() => void)[]> = new Map();
  private lastProcessedTimestamp: number = 0;
  private sensitivityThreshold: number = 1000; // Minimum ms between processing commands
  private commandDetectionEnabled: boolean = true;
  private commandsToDetect: string[] = [];

  constructor() {
    // Initialize with empty command set
  }

  /**
   * Register a callback for a specific voice command
   * @param command The command phrase to listen for (case insensitive)
   * @param callback Function to call when command is detected
   * @returns Function to unregister this callback
   */
  public registerCommand(command: string, callback: () => void): () => void {
    const lowerCommand = command.toLowerCase().trim();
    
    // Add command to detection list if not already there
    if (!this.commandsToDetect.includes(lowerCommand)) {
      this.commandsToDetect.push(lowerCommand);
    }
    
    // Initialize callback array if needed
    if (!this.commandCallbacks.has(lowerCommand)) {
      this.commandCallbacks.set(lowerCommand, []);
    }
    
    // Add callback to array
    const callbacks = this.commandCallbacks.get(lowerCommand) || [];
    callbacks.push(callback);
    this.commandCallbacks.set(lowerCommand, callbacks);
    
    // Return unregister function
    return () => {
      const callbackArray = this.commandCallbacks.get(lowerCommand) || [];
      const index = callbackArray.indexOf(callback);
      if (index !== -1) {
        callbackArray.splice(index, 1);
        this.commandCallbacks.set(lowerCommand, callbackArray);
      }
    };
  }

  /**
   * Process transcription data to detect commands
   * @param transcriptionData The transcription data to process
   */
  public processTranscription(transcriptionData: { 
    text: string, 
    isFinal: boolean,
    timestamp?: number 
  }): void {
    // Only process final transcriptions
    if (!transcriptionData.isFinal || !this.commandDetectionEnabled) {
      return;
    }
    
    const now = transcriptionData.timestamp || Date.now();
    
    // Prevent processing too frequently
    if (now - this.lastProcessedTimestamp < this.sensitivityThreshold) {
      return;
    }
    
    const transcriptText = transcriptionData.text.toLowerCase().trim();
    
    // Check for each registered command
    for (const command of this.commandsToDetect) {
      if (transcriptText.includes(command)) {
        // Execute all callbacks for this command
        const callbacks = this.commandCallbacks.get(command) || [];
        callbacks.forEach(callback => callback());
        
        // Update timestamp
        this.lastProcessedTimestamp = now;
        return; // Only trigger one command at a time
      }
    }
  }

  /**
   * Enable or disable command detection
   */
  public setEnabled(enabled: boolean): void {
    this.commandDetectionEnabled = enabled;
  }

  /**
   * Set the sensitivity threshold (minimum ms between processing commands)
   */
  public setSensitivityThreshold(thresholdMs: number): void {
    this.sensitivityThreshold = thresholdMs;
  }

  /**
   * Get the current list of registered commands
   */
  public getRegisteredCommands(): string[] {
    return [...this.commandsToDetect];
  }
}