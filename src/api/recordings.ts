/**
 * Recordings API Routes for Bun
 *
 * Handles all recording-related endpoints:
 * - GET /api/recordings - List all recordings for user
 * - GET /api/recordings/:id - Get a specific recording
 * - POST /api/recordings/start - Start a new recording
 * - POST /api/recordings/:id/stop - Stop a recording
 * - GET /api/recordings/:id/download-token - Get signed download token
 * - GET /api/recordings/:id/download-by-token - Download with token
 * - PUT /api/recordings/:id - Update a recording
 * - DELETE /api/recordings/:id - Delete a recording
 */

import crypto from "crypto";
import { requireAuth, getAuthUserId } from "./auth-helpers";
import recordingsService from "../services/recordings.service";
import storageService from "../services/storage.service";
import { RecordingDocument } from "../models/recording.models";

// Secret key for token signing
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY;
if (!MENTRAOS_API_KEY) {
  throw new Error(
    "MENTRAOS_API_KEY is not set. Please set it in your environment variables."
  );
}

/**
 * Generate a signed download token for secure file access
 */
function generateDownloadToken(
  userId: string,
  recordingId: string,
  expiresAt: number
): string {
  const payload = { userId, recordingId, expiresAt };
  const payloadStr = JSON.stringify(payload);

  const hmac = crypto.createHmac("sha256", MENTRAOS_API_KEY as string);
  hmac.update(payloadStr);
  const signature = hmac.digest("hex");

  const token = Buffer.from(payloadStr + "." + signature)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  console.log(
    `[TOKEN] Generated token for user ${userId}, recording ${recordingId}, expires ${new Date(expiresAt).toISOString()}`
  );

  return token;
}

/**
 * Verify a download token
 */
function verifyDownloadToken(
  token: string
): { userId: string; recordingId: string; expiresAt: number } | null {
  try {
    console.log(`[TOKEN] Verifying token: ${token.substring(0, 20)}...`);

    const base64Token = token.replace(/-/g, "+").replace(/_/g, "/");

    let paddedToken = base64Token;
    while (paddedToken.length % 4 !== 0) {
      paddedToken += "=";
    }

    const decoded = Buffer.from(paddedToken, "base64").toString();
    const lastDotIndex = decoded.lastIndexOf(".");

    if (lastDotIndex === -1) {
      console.log(`[TOKEN] No dot separator found in token`);
      return null;
    }

    const payloadStr = decoded.substring(0, lastDotIndex);
    const signature = decoded.substring(lastDotIndex + 1);

    if (!payloadStr || !signature) {
      console.log(`[TOKEN] Missing payload or signature`);
      return null;
    }

    const hmac = crypto.createHmac("sha256", MENTRAOS_API_KEY as string);
    hmac.update(payloadStr);
    const expectedSignature = hmac.digest("hex");

    if (signature !== expectedSignature) {
      console.log(`[TOKEN] Signature mismatch`);
      return null;
    }

    const payload = JSON.parse(payloadStr);
    console.log(
      `[TOKEN] Token valid for user ${payload.userId}, recording ${payload.recordingId}`
    );
    return payload;
  } catch (error) {
    console.error("[TOKEN] Error verifying token:", error);
    return null;
  }
}

/**
 * Format recording for API response
 */
function formatRecordingForApi(recording: RecordingDocument) {
  const plainRecord = recording.toObject ? recording.toObject() : recording;
  return {
    ...plainRecord,
    id: plainRecord._id.toString(),
    _id: undefined,
    createdAt:
      plainRecord.createdAt instanceof Date
        ? plainRecord.createdAt.getTime()
        : plainRecord.createdAt,
    updatedAt:
      plainRecord.updatedAt instanceof Date
        ? plainRecord.updatedAt.getTime()
        : plainRecord.updatedAt,
    isRecording:
      plainRecord.status === "recording" ||
      plainRecord.status === "initializing" ||
      plainRecord.status === "stopping",
  };
}

/**
 * Extract ID from URL path like /api/recordings/:id/...
 */
function extractIdFromPath(url: string): string | null {
  const match = url.match(/\/api\/recordings\/([^\/]+)/);
  return match ? match[1] : null;
}

export const recordingsRoutes = {
  // List all recordings for authenticated user
  "/api/recordings": {
    GET: requireAuth(async (req, userId) => {
      try {
        const recordings = await recordingsService.getRecordingsForUser(userId);
        const formattedRecordings = recordings.map(formatRecordingForApi);
        return Response.json(formattedRecordings);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500 }
        );
      }
    }),
  },

  // Start a new recording
  "/api/recordings/start": {
    POST: requireAuth(async (req, userId) => {
      try {
        const body = await req.json();
        const { sessionId } = body;

        if (!sessionId) {
          return Response.json(
            { error: "Session ID is required" },
            { status: 400 }
          );
        }

        const recordingId = await recordingsService.startRecording(
          userId,
          false
        );
        return Response.json({ id: recordingId }, { status: 201 });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("No active AugmentOS SDK session")
        ) {
          return Response.json(
            { error: error.message, code: "NO_ACTIVE_SESSION" },
            { status: 400 }
          );
        }
        if (
          error instanceof Error &&
          error.message.includes("already has an active recording")
        ) {
          return Response.json(
            { error: error.message, code: "RECORDING_ALREADY_ACTIVE" },
            { status: 409 }
          );
        }
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500 }
        );
      }
    }),
  },

  // Get a specific recording
  "/api/recordings/:id": {
    GET: requireAuth(async (req, userId) => {
      const id = extractIdFromPath(req.url);
      if (!id) {
        return Response.json({ error: "Recording ID required" }, { status: 400 });
      }

      try {
        const recording = await recordingsService.getRecordingById(id);

        if (recording.userId !== userId) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        const formattedRecording = formatRecordingForApi(recording);
        return Response.json(formattedRecording);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return Response.json({ error: error.message }, { status: 404 });
        }
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500 }
        );
      }
    }),

    PUT: requireAuth(async (req, userId) => {
      const id = extractIdFromPath(req.url);
      if (!id) {
        return Response.json({ error: "Recording ID required" }, { status: 400 });
      }

      try {
        const body = await req.json();
        const { title } = body;

        if (!title) {
          return Response.json({ error: "Title is required" }, { status: 400 });
        }

        const recording = await recordingsService.getRecordingById(id);

        if (recording.userId !== userId) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        const updatedRecording = await recordingsService.updateRecording(id, {
          title,
          updatedAt: new Date(),
        });

        const formattedRecording = formatRecordingForApi(updatedRecording);
        return Response.json(formattedRecording);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return Response.json({ error: error.message }, { status: 404 });
        }
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500 }
        );
      }
    }),

    DELETE: requireAuth(async (req, userId) => {
      const id = extractIdFromPath(req.url);
      if (!id) {
        return Response.json({ error: "Recording ID required" }, { status: 400 });
      }

      try {
        const recording = await recordingsService.getRecordingById(id);

        if (recording.userId !== userId) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        await recordingsService.deleteRecording(id);
        return new Response(null, { status: 204 });
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return Response.json({ error: error.message }, { status: 404 });
        }
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500 }
        );
      }
    }),
  },

  // Stop a recording
  "/api/recordings/:id/stop": {
    POST: requireAuth(async (req, userId) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const id = pathParts[3]; // /api/recordings/:id/stop

      if (!id) {
        return Response.json({ error: "Recording ID required" }, { status: 400 });
      }

      console.log(
        `[API] Stop recording request for recording ID: ${id} by user: ${userId}`
      );

      try {
        const recording = await recordingsService.getRecordingById(id);

        if (recording.userId !== userId) {
          console.log(
            `[API] Recording ${id} doesn't belong to user ${userId}`
          );
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        console.log(`[API] Proceeding to stop recording ${id}`);
        await recordingsService.stopRecording(id, false);
        console.log(`[API] Successfully stopped recording ${id}`);

        return Response.json({ success: true });
      } catch (error) {
        console.log(
          `[API] Error stopping recording ${id}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        if (error instanceof Error && error.message.includes("not found")) {
          return Response.json({ error: error.message }, { status: 404 });
        }
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500 }
        );
      }
    }),
  },

  // Generate download token
  "/api/recordings/:id/download-token": {
    GET: requireAuth(async (req, userId) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const id = pathParts[3];

      if (!id) {
        return Response.json({ error: "Recording ID required" }, { status: 400 });
      }

      try {
        const recording = await recordingsService.getRecordingById(id);

        if (!recording) {
          return Response.json(
            { error: "Recording not found" },
            { status: 404 }
          );
        }

        if (recording.userId !== userId) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        // Generate a signed token (expires in 60 minutes)
        const expirationTime = Date.now() + 60 * 60 * 1000;
        const token = generateDownloadToken(userId, id, expirationTime);

        return Response.json({
          token: token,
          downloadUrl: `/api/recordings/${id}/download-by-token?token=${token}`,
          expiresAt: expirationTime,
        });
      } catch (error) {
        console.error(`[DOWNLOAD TOKEN] Error generating token for ${id}:`, error);
        return Response.json(
          { error: "Error generating download token" },
          { status: 500 }
        );
      }
    }),
  },

  // Download by token (public endpoint - no auth required)
  "/api/recordings/:id/download-by-token": {
    async GET(req: Request) {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const id = pathParts[3];
      const token = url.searchParams.get("token");

      console.log(
        `[DOWNLOAD] Download request for recording ${id} with token: ${token ? `${token.substring(0, 20)}...` : "missing"}`
      );

      if (!token) {
        console.log(`[DOWNLOAD] Error: Missing token`);
        return Response.json(
          { error: "Missing or invalid token" },
          { status: 401 }
        );
      }

      try {
        const decodedToken = decodeURIComponent(token);
        console.log(`[DOWNLOAD] Token received - length: ${decodedToken.length}`);

        const tokenData = verifyDownloadToken(decodedToken);

        if (!tokenData) {
          console.log(`[DOWNLOAD] Error: Invalid token - verification failed`);
          return Response.json(
            { error: "Invalid token - verification failed" },
            { status: 401 }
          );
        }

        const { userId, recordingId, expiresAt } = tokenData;
        console.log(
          `[DOWNLOAD] Token verified. UserId: ${userId}, RecordingId: ${recordingId}, Expires: ${new Date(expiresAt).toISOString()}`
        );

        if (Date.now() > expiresAt) {
          console.log(
            `[DOWNLOAD] Error: Token expired at ${new Date(expiresAt).toISOString()}`
          );
          return Response.json({ error: "Token expired" }, { status: 401 });
        }

        if (recordingId !== id) {
          console.log(
            `[DOWNLOAD] Error: Token for recording ${recordingId}, but requested ${id}`
          );
          return Response.json(
            { error: "Token does not match recording ID" },
            { status: 401 }
          );
        }

        console.log(
          `[DOWNLOAD] Getting file for user: ${userId}, recording: ${id}`
        );
        const fileData = await storageService.getFile(userId, id);

        console.log(`[DOWNLOAD] Sending file - size: ${fileData.length} bytes`);

        return new Response(fileData, {
          status: 200,
          headers: {
            "Content-Type": "audio/wav",
            "Content-Disposition": `attachment; filename="${id}.wav"`,
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
          },
        });
      } catch (storageError) {
        console.log(`[DOWNLOAD] Storage service failed:`, storageError);
        return Response.json(
          {
            error: "Recording file not found",
            id: id,
            message: "The audio file for this recording could not be found.",
          },
          { status: 404 }
        );
      }
    },
  },
};
