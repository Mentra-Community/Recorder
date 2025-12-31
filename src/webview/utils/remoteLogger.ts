/**
 * Remote logging utility for development
 * Sends console logs to the backend so they appear in the terminal
 */

const isDevEnvironment = import.meta.env.DEV;

interface LogData {
  level: 'log' | 'error' | 'warn' | 'debug';
  message: string;
  data?: any;
}

class RemoteLogger {
  private queue: LogData[] = [];
  private isProcessing = false;
  private maxRetries = 3;

  private async sendLog(logData: LogData): Promise<void> {
    if (!isDevEnvironment) return;

    try {
      const baseUrl = import.meta.env.DEV ? '' : import.meta.env.VITE_BACKEND_URL || '';
      await fetch(`${baseUrl}/api/dev/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(logData),
      });
    } catch (error) {
      // Silently fail - we don't want logging to break the app
      // Using the original console to avoid recursion
      if (this.originalConsole) {
        this.originalConsole.error('Failed to send remote log:', error);
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    
    this.isProcessing = true;
    
    while (this.queue.length > 0) {
      const logData = this.queue.shift();
      if (logData) {
        await this.sendLog(logData);
      }
    }
    
    this.isProcessing = false;
  }

  private originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
  };

  log(message: string, ...args: any[]): void {
    // Always log to local console using the original method
    this.originalConsole.log(message, ...args);
    
    // Queue for remote logging
    this.queue.push({
      level: 'log',
      message,
      data: args.length > 0 ? args : undefined,
    });
    
    this.processQueue();
  }

  error(message: string, ...args: any[]): void {
    this.originalConsole.error(message, ...args);
    
    this.queue.push({
      level: 'error',
      message,
      data: args.length > 0 ? args : undefined,
    });
    
    this.processQueue();
  }

  warn(message: string, ...args: any[]): void {
    this.originalConsole.warn(message, ...args);
    
    this.queue.push({
      level: 'warn',
      message,
      data: args.length > 0 ? args : undefined,
    });
    
    this.processQueue();
  }

  debug(message: string, ...args: any[]): void {
    this.originalConsole.log(message, ...args);
    
    this.queue.push({
      level: 'debug',
      message,
      data: args.length > 0 ? args : undefined,
    });
    
    this.processQueue();
  }
}

// Create singleton instance
const remoteLogger = new RemoteLogger();

// Export both the instance and a console-like interface
export default remoteLogger;

// Also export a function to override console methods globally (optional)
export function enableRemoteConsole(): void {
  if (!isDevEnvironment) return;
  
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
  };
  
  console.log = (...args: any[]) => {
    originalConsole.log(...args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    remoteLogger.log(message);
  };
  
  console.error = (...args: any[]) => {
    originalConsole.error(...args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    remoteLogger.error(message);
  };
  
  console.warn = (...args: any[]) => {
    originalConsole.warn(...args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    remoteLogger.warn(message);
  };
}