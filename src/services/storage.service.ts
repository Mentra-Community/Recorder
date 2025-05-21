/**
 * Storage service
 * Handles file storage with Cloudflare R2
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

class StorageService {
  private r2Client: S3Client;
  private bucketName: string;

  // Active uploads
  private activeUploads: Map<string, {
    userId: string;
    chunks: Buffer[];
    totalBytes: number;
  }> = new Map();

  constructor() {
    // Initialize R2 client
    try {
      const r2Config = {
        region: 'auto',
        endpoint: process.env.R2_ENDPOINT || 'https://8cb61bb5d20701a402f3ebc7d2153347.r2.cloudflarestorage.com',
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
        }
      };

      this.r2Client = new S3Client(r2Config);
      this.bucketName = process.env.R2_BUCKET_NAME || 'recorder';
      console.log('[STORAGE] R2 client initialized successfully');
    } catch (error) {
      console.error('[STORAGE] Failed to initialize R2 client:', error);
      throw new Error('Failed to initialize R2 client');
    }
  }

  /**
   * Begin streaming upload - called when starting a recording
   */
  async beginStreamingUpload(userId: string, recordingId: string): Promise<void> {
    console.log(`[STORAGE] Beginning streaming upload for recording ${recordingId}`);

    // Make sure we don't already have an upload for this ID
    if (this.activeUploads.has(recordingId)) {
      console.log(`[STORAGE] Upload already exists for recording ${recordingId}, resetting`);
      this.activeUploads.delete(recordingId);
    }

    // Create a new upload
    this.activeUploads.set(recordingId, {
      userId,
      chunks: [],
      totalBytes: 0
    });
  }

  /**
   * Add an audio chunk to the active recording
   */
  async addChunk(recordingId: string, chunk: ArrayBuffer): Promise<boolean> {
    const upload = this.activeUploads.get(recordingId);
    if (!upload) {
      throw new Error(`[STORAGE] No active upload for ${recordingId}`);
    }

    try {
      // Convert ArrayBuffer to Buffer
      const buffer = Buffer.from(chunk);

      // Add to buffer
      upload.chunks.push(buffer);
      upload.totalBytes += buffer.length;

      // Return true if we've accumulated enough data to be significant
      const SIGNIFICANT_DATA_THRESHOLD = 10 * 1024; // 10KB
      return upload.totalBytes >= SIGNIFICANT_DATA_THRESHOLD;
    } catch (error) {
      console.error(`[STORAGE] Error adding chunk to ${recordingId}:`, error);
      return false;
    }
  }

  /**
   * Complete the upload - called when stopping a recording
   */
  async completeUpload(recordingId: string): Promise<string> {
    console.log(`[STORAGE] Completing upload for recording ${recordingId}`);

    const upload = this.activeUploads.get(recordingId);
    if (!upload) {
      throw new Error(`[STORAGE] No active upload for ${recordingId}`);
    }

    const userId = upload.userId;
    const fileName = `${recordingId}.wav`;

    try {
      // Combine all chunks into a single buffer with WAV header
      let finalBuffer: Buffer;
      let dataSize = 0;

      // Check if we have any chunks at all
      if (upload.chunks.length > 0) {
        dataSize = upload.totalBytes;
        const header = this.createWavHeader(dataSize);

        // Combine all chunks with header
        finalBuffer = Buffer.concat([header, ...upload.chunks]);
      } else {
        // No chunks - create an empty WAV file
        console.log(`[STORAGE] No chunks recorded, creating empty WAV for ${recordingId}`);
        dataSize = 0;
        finalBuffer = this.createWavHeader(dataSize);
      }

      // Log file size
      console.log(`[STORAGE] Final WAV file for ${recordingId} is ${finalBuffer.length} bytes (${dataSize} bytes of audio data)`);

      // Upload to R2
      const r2Key = `${userId}/${fileName}`;

      await this.r2Client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: r2Key,
        Body: finalBuffer,
        ContentType: 'audio/wav'
      }));

      const r2Url = `${process.env.R2_PUBLIC_URL || `https://${this.bucketName}.${process.env.R2_ENDPOINT}`}/${r2Key}`;
      console.log(`[STORAGE] Uploaded to R2: ${r2Url}`);

      // Clean up
      this.activeUploads.delete(recordingId);

      return r2Url;
    } catch (error) {
      console.error(`[STORAGE] Error completing upload for ${recordingId}:`, error);

      // Ensure we always clean up the active upload, even on error
      this.activeUploads.delete(recordingId);

      throw error;
    }
  }

  /**
   * Create WAV header for audio data
   */
  private createWavHeader(totalBytes: number): Buffer {
    // WAV header is 44 bytes
    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write('RIFF', 0);                                // ChunkID
    header.writeUInt32LE(36 + totalBytes, 4);               // ChunkSize: 4 + (8 + SubChunk1Size) + (8 + SubChunk2Size)
    header.write('WAVE', 8);                                // Format

    // "fmt " sub-chunk
    header.write('fmt ', 12);                               // Subchunk1ID
    header.writeUInt32LE(16, 16);                           // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20);                            // AudioFormat (1 for PCM)
    header.writeUInt16LE(1, 22);                            // NumChannels (1 for mono)
    header.writeUInt32LE(16000, 24);                        // SampleRate (standard rate for speech)
    header.writeUInt32LE(16000 * 2, 28);                    // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    header.writeUInt16LE(2, 32);                            // BlockAlign (NumChannels * BitsPerSample/8)
    header.writeUInt16LE(16, 34);                           // BitsPerSample (16 bits)

    // "data" sub-chunk
    header.write('data', 36);                               // Subchunk2ID
    header.writeUInt32LE(totalBytes, 40);                   // Subchunk2Size (number of bytes in the data)

    return header;
  }

  /**
   * Get a file - used for downloads
   */
  async getFile(userId: string, recordingId: string): Promise<Buffer> {
    const filePath = `${userId}/${recordingId}.wav`;

    try {
      console.log(`[STORAGE] Fetching file from R2: ${filePath}`);
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: filePath
      });

      const response = await this.r2Client.send(command);
      if (!response.Body) {
        throw new Error('[STORAGE] No file data returned from R2');
      }

      const stream = response.Body as Readable;
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
      });
    } catch (error) {
      console.error(`[STORAGE] Error retrieving file from R2: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(userId: string, recordingId: string): Promise<void> {
    const key = `${userId}/${recordingId}.wav`;
    console.log(`[STORAGE] Deleting file from R2: ${key}`);

    try {
      await this.r2Client.send(new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      }));
    } catch (error) {
      console.error(`[STORAGE] Error deleting file from R2: ${key}`, error);
      throw error;
    }
  }

  /**
   * Check if an upload exists for a recording
   */
  hasActiveUpload(recordingId: string): boolean {
    return this.activeUploads.has(recordingId);
  }
}

// Create and export singleton instance
export default new StorageService();