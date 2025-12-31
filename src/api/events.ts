/**
 * Events API Routes for Bun
 *
 * Note: SSE streaming is handled in Express (src/index.ts) because
 * it requires direct access to the response object for streaming.
 * This file just provides placeholder routes for documentation.
 *
 * The actual SSE endpoint is: GET /api/events (handled by Express)
 */

export const eventsRoutes = {
  // SSE endpoint documentation
  // Actual implementation is in src/index.ts (Express)
  "/api/events/info": {
    async GET(_req: Request) {
      return Response.json({
        message: "SSE streaming endpoint",
        endpoint: "/api/events",
        description: "Connect to receive real-time updates for recordings",
        events: [
          "recording-status",
          "transcript",
          "recording-error",
          "recordings-refresh",
          "recording-deleted",
          "voice-command",
          "recording-started-by-voice",
          "recording-stopped-by-voice",
        ],
        note: "This endpoint is handled by Express for SSE support",
      });
    },
  },
};
