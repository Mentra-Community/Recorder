/**
 * Development API
 * Endpoints for development utilities like remote logging
 */

import { Router } from 'express';
import { Request, Response } from 'express';

const router = Router();

// Simple console log endpoint for development
router.post('/log', (req: Request, res: Response) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Remote logging only available in development' });
  }

  const { level = 'log', message, data } = req.body;
  
  const timestamp = new Date().toISOString();
  const prefix = `[WEBVIEW] [${level.toUpperCase()}]`;
  
  // Log to console with color coding
  switch (level) {
    case 'error':
      console.error(`\x1b[31m${prefix} ${timestamp}:\x1b[0m`, message, data || '');
      break;
    case 'warn':
      console.warn(`\x1b[33m${prefix} ${timestamp}:\x1b[0m`, message, data || '');
      break;
    case 'debug':
      console.log(`\x1b[36m${prefix} ${timestamp}:\x1b[0m`, message, data || '');
      break;
    default:
      console.log(`${prefix} ${timestamp}:`, message, data || '');
  }
  
  res.status(200).json({ success: true });
});

export default router;