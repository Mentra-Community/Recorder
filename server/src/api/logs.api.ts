/**
 * Client Logs API
 * Endpoint to receive and log client-side logs/errors
 */

import { Router } from 'express';
import { Request, Response } from 'express';

const router = Router();

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

/**
 * Log client messages to the server console
 * This will receive logs from the client and display them in the server terminal
 */
router.post('/', (req: Request, res: Response) => {
  const { level, message, details, timestamp, userAgent } = req.body;
  
  const time = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
  const agent = userAgent || 'Unknown Client';
  
  // Select color based on log level
  let color = colors.white;
  let prefix = '[CLIENT]';
  switch (level) {
    case 'error':
      color = colors.red;
      prefix = '[CLIENT ERROR]';
      break;
    case 'warn':
      color = colors.yellow;
      prefix = '[CLIENT WARN]';
      break;
    case 'info':
      color = colors.green;
      prefix = '[CLIENT INFO]';
      break;
    case 'debug':
      color = colors.blue;
      prefix = '[CLIENT DEBUG]';
      break;
    default:
      color = colors.white;
      prefix = '[CLIENT LOG]';
  }
  
  // Log to server console
  console.log(`${color}${prefix} ${time} - ${message}${colors.reset}`);
  
  // Log details if available
  if (details) {
    try {
      // If details is an object, stringify it nicely
      if (typeof details === 'object') {
        console.log(`${color}Details: ${JSON.stringify(details, null, 2)}${colors.reset}`);
      } else {
        console.log(`${color}Details: ${details}${colors.reset}`);
      }
    } catch (e) {
      console.log(`${color}Details: ${details}${colors.reset}`);
    }
  }
  
  // Log user agent only for errors
  if (level === 'error') {
    console.log(`${colors.cyan}User Agent: ${agent}${colors.reset}`);
    console.log(''); // Add empty line for better readability
  }
  
  // Send successful response
  res.status(200).json({
    status: 'success',
    message: 'Log received'
  });
});

export default router;