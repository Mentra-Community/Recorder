import { TpaSession, ViewType } from '@augmentos/sdk';

/**
 * Manages the recording timer and its display
 */
export class TimerManager {
  private startTime: number | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private session: TpaSession;
  private elapsedTime: number = 0;
  private isRunning: boolean = false;

  constructor(session: TpaSession) {
    this.session = session;
  }

  /**
   * Start the timer and display it on the AR view
   */
  public startTimer(): void {
    this.startTime = Date.now();
    this.isRunning = true;
    
    // Initial display
    this.updateTimerDisplay(0);
    
    // Update timer display every second
    this.updateInterval = setInterval(() => {
      if (this.startTime && this.isRunning) {
        this.elapsedTime = Date.now() - this.startTime;
        this.updateTimerDisplay(this.elapsedTime);
      }
    }, 1000);
  }

  /**
   * Stop the timer
   * @returns The final duration formatted as a string (HH:MM:SS)
   */
  public stopTimer(): string {
    this.isRunning = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Return the final duration formatted as string
    return this.formatTime(this.elapsedTime);
  }

  /**
   * Pause the timer without resetting it
   */
  public pauseTimer(): void {
    this.isRunning = false;
  }

  /**
   * Resume a paused timer
   */
  public resumeTimer(): void {
    if (!this.isRunning && this.startTime) {
      // Adjust start time to account for the pause duration
      const pauseDuration = Date.now() - (this.startTime + this.elapsedTime);
      this.startTime = this.startTime + pauseDuration;
      this.isRunning = true;
    }
  }

  /**
   * Reset the timer to zero
   */
  public resetTimer(): void {
    this.elapsedTime = 0;
    this.startTime = null;
    this.isRunning = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Show 00:00:00 on display
    this.updateTimerDisplay(0);
  }

  /**
   * Get current elapsed time in milliseconds
   */
  public getElapsedTime(): number {
    if (this.startTime && this.isRunning) {
      return Date.now() - this.startTime;
    }
    return this.elapsedTime;
  }

  /**
   * Get current elapsed time as formatted string
   */
  public getFormattedTime(): string {
    return this.formatTime(this.getElapsedTime());
  }

  /**
   * Update the timer display on the AR view
   */
  private updateTimerDisplay(elapsedMs: number): void {
    const timerText = this.formatTime(elapsedMs);
    
    // Update the reference card with the timer
    this.session.layouts.showReferenceCard("Recording Audio", timerText, {
      view: ViewType.MAIN
    });
  }

  /**
   * Format milliseconds into a readable time string (HH:MM:SS)
   */
  private formatTime(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Clean up resources when session ends
   */
  public cleanup(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}