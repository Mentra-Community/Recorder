/**
 * Storage service
 * Handles file storage with support for both local filesystem and Cloudflare R2
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

// Promisify fs functions
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const appendFile = promisify(fs.appendFile);
const readFile = promisify(fs.readFile);
const exists = promisify(fs.exists);
const unlink = promisify(fs.unlink);

class StorageService {
  private localStoragePath: string;
  private r2Client: S3Client | null = null;
  private bucketName: string = '';
  
  // Storage flags
  private useR2: boolean = false;
  private useLocalDisk: boolean = true;
  
  // Active uploads
  private activeUploads: Map<string, {
    userId: string;
    chunks: Buffer[];
    totalBytes: number;
    headerWritten: boolean;
  }> = new Map();
  
  constructor() {
    // Set up local storage path
    this.localStoragePath = process.env.LOCAL_STORAGE_PATH || path.join(process.cwd(), 'temp_storage');
    
    // Determine storage strategies based on environment
    this.useR2 = !!process.env.R2_ACCESS_KEY_ID && !!process.env.R2_SECRET_ACCESS_KEY;
    this.useLocalDisk = process.env.USE_LOCAL_DISK !== 'false';
    
    // Initialize R2 client if credentials are available
    if (this.useR2) {
      this.initR2Client();
    }
    
    console.log(`[STORAGE] Storage Service initialized:
      - Local disk storage: ${this.useLocalDisk ? 'ENABLED' : 'DISABLED'}
      - R2 cloud storage: ${this.useR2 ? 'ENABLED' : 'DISABLED'}
    `);
    
    // Create local storage directory if needed
    if (this.useLocalDisk) {
      this.ensureStorageDirectoryExists();
    }
  }
  
  /**
   * Initialize R2 client
   */
  private initR2Client() {
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
      this.useR2 = false;
    }
  }
  
  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDirectoryExists() {
    try {
      if (!await exists(this.localStoragePath)) {
        await mkdir(this.localStoragePath, { recursive: true });
        console.log(`[STORAGE] Created storage directory: ${this.localStoragePath}`);
      }
    } catch (error) {
      console.error('[STORAGE] Failed to create storage directory:', error);
      this.useLocalDisk = false;
    }
  }
  
  /**
   * Get user directory path
   */
  private getUserPath(userId: string): string {
    const userPath = path.join(this.localStoragePath, userId);
    
    // Create user directory if it doesn't exist
    if (!fs.existsSync(userPath)) {
      fs.mkdirSync(userPath, { recursive: true });
    }
    
    return userPath;
  }
  
  /**
   * Begin streaming upload - called when starting a recording
   */
  async beginStreamingUpload(userId: string, recordingId: string): Promise<void> {
    console.log(`[STORAGE] Beginning streaming upload for recording ${recordingId}`);
    
    this.activeUploads.set(recordingId, {
      userId,
      chunks: [],
      totalBytes: 0,
      headerWritten: false
    });
    
    // For filesystem, ensure user directory exists
    if (this.useLocalDisk) {
      this.getUserPath(userId);
    }
  }
  
  /**
   * Add an audio chunk to the active recording
   */
  async addChunk(recordingId: string, chunk: ArrayBuffer): Promise<boolean> {
    const upload = this.activeUploads.get(recordingId);
    if (!upload) {
      console.warn(`[STORAGE] Tried to add chunk to unknown recording: ${recordingId}`);
      return false;
    }
    
    try {
      // Convert ArrayBuffer to Buffer
      const buffer = Buffer.from(chunk);
      
      // Add to buffer
      upload.chunks.push(buffer);
      upload.totalBytes += buffer.length;
      
      // Write to file when we have enough data (for memory efficiency)
      const WRITE_THRESHOLD = 1 * 1024 * 1024; // 1MB
      
      if (upload.chunks.length > 0 && (upload.totalBytes >= WRITE_THRESHOLD || upload.chunks.length > 100)) {
        await this.flushChunks(recordingId, upload);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[STORAGE] Error adding chunk to ${recordingId}:`, error);
      return false;
    }
  }
  
  /**
   * Write accumulated chunks to local file
   */
  private async flushChunks(recordingId: string, upload: any): Promise<void> {
    if (!this.useLocalDisk) return;
    
    try {
      const userId = upload.userId;
      const filePath = path.join(this.getUserPath(userId), `${recordingId}.wav`);
      
      // Combine all chunks
      const combinedBuffer = Buffer.concat(upload.chunks);
      
      // If this is the first write, we need to include a WAV header
      if (!upload.headerWritten) {
        // Create a temporary header - we'll update it when we complete the upload
        const header = this.createWavHeader(upload.totalBytes);
        
        // Write header and data
        await writeFile(filePath, Buffer.concat([header, combinedBuffer]));
        upload.headerWritten = true;
      } else {
        // Append new data to the file (after the header)
        await appendFile(filePath, combinedBuffer);
      }
      
      // Reset chunks after writing to disk
      upload.chunks = [];
    } catch (error) {
      console.error(`[STORAGE] Error flushing chunks for ${recordingId}:`, error);
      throw error;
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
      
      if (this.useLocalDisk && upload.headerWritten) {
        // If we've been writing to disk, we need to read the file and update the header
        const filePath = path.join(this.getUserPath(userId), fileName);
        let fileData = await readFile(filePath);
        
        // Add any remaining chunks
        if (upload.chunks.length > 0) {
          const remainingData = Buffer.concat(upload.chunks);
          fileData = Buffer.concat([fileData, remainingData]);
        }
        
        // Get the data size (total file size minus 44 byte header)
        const dataSize = fileData.length - 44;
        
        // Update the header with the final size
        const header = this.createWavHeader(dataSize);
        
        // Replace the header in the file data
        header.copy(fileData, 0, 0, 44);
        
        // Write the updated file back to disk
        if (this.useLocalDisk) {
          await writeFile(filePath, fileData);
        }
        
        finalBuffer = fileData;
      } else {
        // If we haven't been writing to disk, just create the file now
        const totalBytes = upload.totalBytes;
        const header = this.createWavHeader(totalBytes);
        
        // Combine all chunks
        finalBuffer = Buffer.concat([header, ...upload.chunks]);
        
        // Write to local disk if enabled
        if (this.useLocalDisk) {
          const filePath = path.join(this.getUserPath(userId), fileName);
          await writeFile(filePath, finalBuffer);
        }
      }
      
      // Upload to R2 if enabled
      let r2Url = '';
      if (this.useR2 && this.r2Client) {
        const r2Key = `${userId}/${fileName}`;
        
        await this.r2Client.send(new PutObjectCommand({
          Bucket: this.bucketName,
          Key: r2Key,
          Body: finalBuffer,
          ContentType: 'audio/wav'
        }));
        
        r2Url = `${process.env.R2_PUBLIC_URL || `https://${this.bucketName}.${process.env.R2_ENDPOINT}`}/${r2Key}`;
        console.log(`[STORAGE] Uploaded to R2: ${r2Url}`);
      }
      
      // Clean up
      this.activeUploads.delete(recordingId);
      
      // Determine URL to return
      // Prefer R2 URL if available, otherwise use local API endpoint
      const fileUrl = this.useR2 && r2Url 
        ? r2Url 
        : `/api/recordings/${recordingId}/download`;
      
      return fileUrl;
    } catch (error) {
      console.error(`[STORAGE] Error completing upload for ${recordingId}:`, error);
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
  async getFile(filePath: string): Promise<Buffer> {
    try {
      // Format validation (userId/fileName)
      const parts = filePath.split('/');
      if (parts.length !== 2) {
        throw new Error(`[STORAGE] Invalid file path format: ${filePath}`);
      }
      
      const [userId, fileName] = parts;
      
      // Try local disk first if enabled
      if (this.useLocalDisk) {
        const localFilePath = path.join(this.getUserPath(userId), fileName);
        if (await exists(localFilePath)) {
          console.log(`[STORAGE] Serving file from local disk: ${localFilePath}`);
          return readFile(localFilePath);
        }
      }
      
      // Fall back to R2 if available
      if (this.useR2 && this.r2Client) {
        console.log(`[STORAGE] Fetching file from R2: ${filePath}`);
        const command = new GetObjectCommand({
          Bucket: this.bucketName,
          Key: filePath
        });
        
        try {
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
      
      throw new Error(`[STORAGE] File not found: ${filePath}`);
    } catch (error) {
      console.error(`[STORAGE] Error getting file ${filePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete a file
   */
  async deleteFile(userId: string, fileName: string): Promise<void> {
    console.log(`[STORAGE] Deleting file ${fileName} for user ${userId}`);
    const deletePromises: Promise<any>[] = [];
    
    // Delete from local disk if enabled
    if (this.useLocalDisk) {
      const localFilePath = path.join(this.getUserPath(userId), fileName);
      if (await exists(localFilePath)) {
        deletePromises.push(unlink(localFilePath));
      }
    }
    
    // Delete from R2 if enabled
    if (this.useR2 && this.r2Client) {
      const key = `${userId}/${fileName}`;
      deletePromises.push(this.r2Client.send(new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      })));
    }
    
    // Wait for all deletes to complete
    try {
      await Promise.all(deletePromises);
    } catch (error) {
      console.error(`[STORAGE] Error deleting file ${fileName} for user ${userId}:`, error);
      throw error;
    }
  }
}

// Create and export singleton instance
export default new StorageService();