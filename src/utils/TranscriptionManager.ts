/**
 * Interface for transcription data from AugmentOS SDK
 */
export interface TranscriptionData {
  text: string;
  isFinal: boolean;
  language: string;
  startTime: number;
  endTime?: number;
}

/**
 * Manages transcriptions from the audio stream
 */
export class TranscriptionManager {
  private transcriptions: TranscriptionData[] = [];
  private language: string;
  
  constructor(language: string = 'en-US') {
    this.language = language;
  }

  /**
   * Add a new transcription
   */
  public addTranscription(data: TranscriptionData): void {
    // Only store final transcriptions to avoid duplicates
    if (data.isFinal) {
      // Add end time if not provided
      if (!data.endTime) {
        data.endTime = Date.now();
      }
      
      this.transcriptions.push(data);
    }
  }

  /**
   * Get all transcriptions sorted by time
   */
  public getAllTranscriptions(): TranscriptionData[] {
    return [...this.transcriptions].sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * Get the full transcript text as a single string
   */
  public getTranscriptText(): string {
    if (this.transcriptions.length === 0) {
      return "";
    }
    
    // Sort transcriptions by time
    const sortedTranscriptions = [...this.transcriptions].sort((a, b) => a.startTime - b.startTime);
    
    // Combine all text
    return sortedTranscriptions.map(t => t.text).join(' ');
  }

  /**
   * Get formatted transcript with timestamps
   */
  public getFormattedTranscript(): string {
    if (this.transcriptions.length === 0) {
      return "No transcription available";
    }
    
    // Sort transcriptions by time
    const sortedTranscriptions = [...this.transcriptions].sort((a, b) => a.startTime - b.startTime);
    
    // Format each transcription with timestamp
    const formattedTranscriptions = sortedTranscriptions.map(t => {
      const timestamp = this.formatTimestamp(t.startTime);
      return `[${timestamp}] ${t.text}`;
    });
    
    return formattedTranscriptions.join('\n');
  }

  /**
   * Get a summary version of the transcript (limited length)
   */
  public getTranscriptSummary(maxLength: number = 200): string {
    const fullText = this.getTranscriptText();
    
    if (fullText.length <= maxLength) {
      return fullText;
    }
    
    return fullText.substring(0, maxLength) + '...';
  }

  /**
   * Get language used for transcription
   */
  public getLanguage(): string {
    return this.language;
  }

  /**
   * Set language for transcription
   */
  public setLanguage(language: string): void {
    this.language = language;
  }

  /**
   * Clear all stored transcriptions
   */
  public clear(): void {
    this.transcriptions = [];
  }

  /**
   * Format a timestamp in milliseconds to a readable string
   */
  private formatTimestamp(ms: number): string {
    const date = new Date(ms);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${hours}:${minutes}:${seconds}`;
  }
}