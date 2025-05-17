/**
 * Client-side logger that forwards logs to the server
 */

import axios from 'axios';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogPayload {
  level: LogLevel;
  message: string;
  details?: any;
  timestamp: number;
  userAgent: string;
}

// Create a separate axios instance for logging to avoid interceptors
const loggerAxios = axios.create({
  timeout: 5000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Configure error handling specifically for the logger
loggerAxios.interceptors.response.use(
  response => response,
  error => {
    // Just swallow errors from the logger to avoid infinite loops
    console.error('Logger failed to send logs to server:', error.message);
    return Promise.resolve(); // Don't reject
  }
);

/**
 * Send a log to the server
 */
async function sendLog(level: LogLevel, message: string, details?: any): Promise<void> {
  try {
    const payload: LogPayload = {
      level,
      message,
      details,
      timestamp: Date.now(),
      userAgent: navigator.userAgent
    };

    // Send asynchronously and don't wait
    loggerAxios.post('/api/logs', payload).catch(() => {
      // Errors are already handled in the interceptor
    });
  } catch (e) {
    // Catch any other errors to avoid crashing the app
    console.error('Error in logger:', e);
  }
}

// Intercept and forward console logs
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug
};

// Replace console methods with our own
// Only forward to server if specifically requested
function enhanceConsoleMethod(method: 'log' | 'info' | 'warn' | 'error' | 'debug', level: LogLevel) {
  console[method] = function(...args: any[]) {
    // Call original method first
    originalConsole[method].apply(console, args);
    
    // Check if the first argument is a string and starts with [SERVER]
    if (typeof args[0] === 'string' && args[0].startsWith('[SERVER]')) {
      const message = args[0].replace('[SERVER]', '').trim();
      const details = args.length > 1 ? args.slice(1) : undefined;
      sendLog(level, message, details);
    }
  };
}

// Setup window error listeners
function setupGlobalErrorListeners() {
  // Catch uncaught errors
  window.addEventListener('error', (event) => {
    const message = `Uncaught error: ${event.message}`;
    const details = {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error?.toString(),
      stack: event.error?.stack
    };
    sendLog('error', message, details);
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const message = 'Unhandled Promise rejection';
    const details = {
      reason: event.reason?.toString(),
      stack: event.reason?.stack
    };
    sendLog('error', message, details);
  });
}

// Initialize the logger
function init() {
  // Setup console interception
  enhanceConsoleMethod('log', 'debug');
  enhanceConsoleMethod('info', 'info');
  enhanceConsoleMethod('warn', 'warn');
  enhanceConsoleMethod('error', 'error');
  enhanceConsoleMethod('debug', 'debug');
  
  // Setup global error listeners
  setupGlobalErrorListeners();
  
  // Log initialization
  sendLog('info', 'Client logger initialized', { 
    url: window.location.href,
    platform: navigator.platform
  });
}

// Direct methods to log to the server
const logger = {
  debug: (message: string, details?: any) => sendLog('debug', message, details),
  info: (message: string, details?: any) => sendLog('info', message, details),
  warn: (message: string, details?: any) => sendLog('warn', message, details),
  error: (message: string, details?: any) => sendLog('error', message, details),
  // Special method to log to console AND server
  log: (message: string, details?: any) => {
    originalConsole.log(`[SERVER] ${message}`, details);
  }
};

// Initialize when imported
init();

export default logger;