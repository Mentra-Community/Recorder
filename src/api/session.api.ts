/**
 * Session API
 * Endpoints for querying TPA session status
 */

import { AuthenticatedRequest } from '@augmentos/sdk';
import { Router } from 'express';
import { Request, Response } from 'express';
// import { AuthenticatedRequest, isaiahMiddleware } from '../middleware/isaiah.middleware';

const router = Router();

// Private Map to keep track of active TPA sessions
// Key is userId, value is true if connected
const activeSessions = new Map<string, boolean>();

/**
 * Register a session as active
 */
export function registerActiveSession(userId: string): void {
  activeSessions.set(userId, true);
  console.log(`[SESSION] Registered active session for user: ${userId}`);
  console.log(`[SESSION] Active sessions: ${activeSessions.size}`);
}

/**
 * Unregister a session (when disconnected)
 */
export function unregisterSession(userId: string): void {
  activeSessions.delete(userId);
  console.log(`[SESSION] Unregistered session for user: ${userId}`);
  console.log(`[SESSION] Active sessions: ${activeSessions.size}`);
}

/**
 * Check if a user has an active session
 */
export function hasActiveSession(userId: string): boolean {
  return activeSessions.has(userId) && activeSessions.get(userId) === true;
}

/**
 * GET /api/session/is-connected
 * Check if the authenticated user has an active TPA session
 */
router.get('/is-connected', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const isConnected = hasActiveSession(userId);
  
  return res.json({
    connected: isConnected,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/session/active-sessions
 * Admin endpoint to get information about active sessions
 */
router.get('/active-sessions', (req: Request, res: Response) => {
  // In production, this would require admin authentication
  const sessions = Array.from(activeSessions.entries()).map(([userId]) => ({
    userId,
    connectedSince: new Date().toISOString() // Placeholder - could store timestamps if needed
  }));
  
  return res.json({
    count: activeSessions.size,
    sessions
  });
});

export default router;