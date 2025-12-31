/**
 * Recorder App - Two Server Architecture
 *
 * Port BUN_PORT (Express + 1) - Serves React webview + custom API routes
 * Port PORT (Express)         - Handles MentraOS AppServer + proxies to Bun
 *
 * Flow:
 * - User visits localhost:PORT → Express proxies to Bun → Gets React app
 * - MentraOS Cloud calls /session-start → Express handles it
 * - Browser requests /api/* → Express proxies to Bun (except SSE)
 * - Auth headers (x-auth-user-id) are forwarded from Express to Bun
 *
 * API Patterns:
 * - Express routes: Use (req as any).authUserId - authenticated by middleware
 * - Bun routes: Use req.headers.get('x-auth-user-id') - forwarded from Express
 */

import { serve } from "bun";
import type { Request, Response } from "express";

import { routes } from "./api/routes";
import RecorderApp from "./app";
import streamService from "./services/stream.service";
import * as mongodbConnection from "./connections/mongodb.connection";
import indexDev from "./webview/index.html";
import indexProd from "./webview/index.prod.html";

// Configuration
const PORT = parseInt(process.env.PORT || "8069", 10);
const BUN_PORT = PORT + 1;
const PACKAGE_NAME = process.env.PACKAGE_NAME || "com.mentra.recorder";
const API_KEY = process.env.MENTRAOS_API_KEY || "";

if (!API_KEY) {
  console.error("❌ MENTRAOS_API_KEY environment variable is not set");
  process.exit(1);
}

if (!PACKAGE_NAME) {
  console.error("❌ PACKAGE_NAME environment variable is not set");
  process.exit(1);
}

console.log("🚀 Starting Recorder App...\n");

// ============================================
// Step 1: Connect to MongoDB
// ============================================

console.log("📦 Connecting to MongoDB...");
try {
  await mongodbConnection.init();
  console.log("✅ MongoDB connection established\n");
} catch (err) {
  console.error("❌ Failed to connect to MongoDB:", err);
  process.exit(1);
}

// ============================================
// Step 2: Start Bun Server (Port BUN_PORT)
// ============================================

console.log(`📦 Starting Bun server on port ${BUN_PORT}...`);
const isDevelopment = process.env.NODE_ENV !== "production";

const bunServer = serve({
  development: isDevelopment && {
    hmr: true,
  },
  port: BUN_PORT,
  routes: {
    // Custom API routes
    ...routes,

    // Serve webview as fallback
    "/*": isDevelopment ? indexDev : indexProd,
  },
});

console.log(`✅ Bun server running at ${bunServer.url}`);
console.log(`   - Webview: ${bunServer.url}`);
console.log(`   - API: ${bunServer.url}api/health\n`);

// ============================================
// Step 3: Start Express/AppServer (Port PORT)
// ============================================

console.log(`📱 Starting MentraOS AppServer on port ${PORT}...`);

const recorderApp = new RecorderApp({
  packageName: PACKAGE_NAME,
  apiKey: API_KEY,
  port: PORT,
});

// Start AppServer first (registers all MentraOS routes)
await recorderApp.start();

// Get Express app instance AFTER starting (routes are registered)
const expressApp = recorderApp.getExpressApp();

// ============================================
// SSE Stream Route (bypasses proxy)
// ============================================

expressApp.get("/api/events", (req: Request, res: Response) => {
  const authReq = req as any;
  const userId = authReq.authUserId;

  console.log(`[SSE] /api/events request - userId: ${userId}`);

  if (!userId) {
    console.log("[SSE] Unauthorized - no userId");
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Set up SSE connection
  streamService.addClient(userId, res);
});

// ============================================
// Proxy: Forward unmatched routes to Bun
// ============================================

expressApp.all("*", async (req: Request, res: Response) => {
  try {
    const bunUrl = `http://localhost:${BUN_PORT}${req.originalUrl || req.url}`;

    // Debug logging for API requests
    if (req.originalUrl?.startsWith("/api/")) {
      const authReq = req as any;
      console.log(
        `[PROXY] ${req.method} ${req.originalUrl} - authUserId: ${authReq.authUserId || "NONE"}`,
      );
    }

    // Build headers - forward existing headers AND add auth info
    const proxyHeaders: Record<string, string> = {};

    // Copy existing headers
    Object.entries(req.headers).forEach(([key, value]) => {
      if (value) {
        proxyHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
      }
    });

    // Forward authenticated user from Express middleware to Bun
    const authReq = req as any;
    if (authReq.authUserId) {
      proxyHeaders["x-auth-user-id"] = authReq.authUserId;
    }

    if (authReq.activeSession) {
      proxyHeaders["x-has-active-session"] = "true";
    }

    // Proxy request to Bun
    const response = await fetch(bunUrl, {
      method: req.method,
      headers: proxyHeaders as HeadersInit,
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? JSON.stringify(req.body)
          : undefined,
    });

    // Copy response headers
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Send response
    res.status(response.status);

    // Handle binary responses (like file downloads)
    const contentType = response.headers.get("content-type") || "";
    if (
      contentType.includes("audio/") ||
      contentType.includes("application/octet-stream")
    ) {
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } else {
      res.send(await response.text());
    }
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).send("Proxy error");
  }
});

console.log(`✅ MentraOS AppServer running at http://localhost:${PORT}`);
console.log(`   - Session endpoints: http://localhost:${PORT}/session-start`);
console.log(`   - Webhook: http://localhost:${PORT}/webhook`);
console.log(`   - SSE: http://localhost:${PORT}/api/events`);
console.log(`   - Webview (proxied): http://localhost:${PORT}\n`);

console.log("🎉 Recorder app is ready!");
console.log(`\n📝 Access the app at: http://localhost:${PORT}\n`);

// ============================================
// Graceful Shutdown
// ============================================

const shutdown = async () => {
  console.log("\n🛑 Shutting down...");
  recorderApp.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
