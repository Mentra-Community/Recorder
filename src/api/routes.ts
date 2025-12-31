/**
 * API Routes for Recorder App
 *
 * This file combines all API routes for the Bun server.
 * Authentication is handled via headers forwarded from Express:
 * - x-auth-user-id: The authenticated user's ID
 * - x-has-active-session: Whether the user has an active MentraOS session
 */

import { requireAuth, optionalAuth, getAuthInfo } from "./auth-helpers";
import { recordingsRoutes } from "./recordings";
import { eventsRoutes } from "./events";

export const routes = {
  // Merge all route modules
  ...recordingsRoutes,
  ...eventsRoutes,

  // Auth info endpoint
  "/api/me": {
    async GET(req: Request) {
      const authInfo = getAuthInfo(req);
      return Response.json(authInfo);
    },
  },

  // Health check endpoint
  "/api/health": {
    async GET(_req: Request) {
      return Response.json({
        status: "ok",
        timestamp: Date.now(),
      });
    },
  },

  // API root endpoint
  "/api": {
    async GET(_req: Request) {
      return Response.json({
        message: "MentraOS Recorder API",
        version: "1.0.0",
        status: "ok",
      });
    },
  },

  // Example protected route
  "/api/protected-example": requireAuth(async (req, userId) => {
    return Response.json({
      message: "This route requires authentication",
      userId,
      timestamp: new Date().toISOString(),
    });
  }),

  // Example optional auth route
  "/api/optional-auth-example": optionalAuth(async (req, userId) => {
    if (userId) {
      return Response.json({
        message: "Hello, authenticated user!",
        userId,
      });
    }
    return Response.json({
      message: "Hello, anonymous user!",
    });
  }),
};
