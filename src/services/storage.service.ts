/**
 * Storage service
 * Handles file storage (temporary implementation)
 * Will be replaced with Cloudflare R2 in Phase 2
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

// Promisify fs functions
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const appendFile = promisify(fs.appendFile);
const readFile = promisify(fs.readFile);
const exists = promisify(fs.exists);

// Base directory for temporary file storage
const STORAGE_DIR = path.join(process.cwd(), 'temp_storage');

// Make sure storage directory exists
const ensureStorageDir = async (): Promise<void> => {
  if (!await exists(STORAGE_DIR)) {
    await mkdir(STORAGE_DIR, { recursive: true });
  }
};

/**
 * Create WAV header for audio data
 * @param totalBytes Size of audio data in bytes
 * @returns Buffer containing WAV header
 */
const createWavHeader = (totalBytes: number): Buffer => {
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
};

class StorageService {
  private activeUploads: Map<string, {
    filePath: string;
    chunks: Buffer[];
    totalBytes: number;
    headerWritten: boolean;
  }> = new Map();
  
  constructor() {
    // Ensure storage directory exists
    ensureStorageDir().catch(err => {
      console.error('Error creating storage directory:', err);
    });
  }
  
  /**
   * Begin a new file upload
   */
  async beginStreamingUpload(userId: string, recordingId: string): Promise<string> {
    try {
      // Create user directory if it doesn't exist
      const userDir = path.join(STORAGE_DIR, userId);
      if (!await exists(userDir)) {
        await mkdir(userDir, { recursive: true });
      }
      
      // Define file path
      const filePath = path.join(userDir, `${recordingId}.wav`);
      
      // Initialize empty file (we'll write header later when we have data)
      await writeFile(filePath, Buffer.from([]), { flag: 'w' });
      
      // Store upload info
      this.activeUploads.set(recordingId, {
        filePath,
        chunks: [],
        totalBytes: 0,
        headerWritten: false
      });
      
      return recordingId;
    } catch (error) {
      console.error(`Error beginning file upload for ${recordingId}:`, error);
      throw error;
    }
  }
  
  /**
   * Add chunk to an active upload
   */
  async addChunk(recordingId: string, chunk: ArrayBuffer): Promise<boolean> {
    const upload = this.activeUploads.get(recordingId);
    
    if (!upload) {
      console.warn(`Tried to add chunk to unknown recording: ${recordingId}`);
      return false;
    }
    
    try {
      // Convert ArrayBuffer to Buffer
      const buffer = Buffer.from(chunk);
      
      // Add to buffer
      upload.chunks.push(buffer);
      upload.totalBytes += buffer.length;
      
      // Write to file when we have enough data
      // For memory efficiency, we'll write to disk after 1MB
      const WRITE_THRESHOLD = 1 * 1024 * 1024; // 1MB
      
      if (upload.totalBytes >= WRITE_THRESHOLD) {
        await this.flushChunks(recordingId, upload);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Error adding chunk to ${recordingId}:`, error);
      throw error;
    }
  }
  
  /**
   * Write accumulated chunks to file
   */
  private async flushChunks(recordingId: string, upload: any): Promise<void> {
    try {
      // Combine all chunks
      const combinedBuffer = Buffer.concat(upload.chunks);
      
      // If this is the first write, we need to include a WAV header
      if (!upload.headerWritten) {
        // Create a placeholder header based on current data
        // Note: We'll update this header at the end with the final size
        const header = createWavHeader(upload.totalBytes);
        
        // Write header and data
        await writeFile(upload.filePath, Buffer.concat([header, combinedBuffer]));
        upload.headerWritten = true;
      } else {
        // Append new data to the file (after the header)
        await appendFile(upload.filePath, combinedBuffer);
      }
      
      // Reset chunks
      upload.chunks = [];
    } catch (error) {
      console.error(`Error flushing chunks for ${recordingId}:`, error);
      throw error;
    }
  }
  
  /**
   * Complete a file upload
   */
  async completeUpload(recordingId: string): Promise<string> {
    const upload = this.activeUploads.get(recordingId);
    
    if (!upload) {
      throw new Error(`Tried to complete unknown upload: ${recordingId}`);
    }
    
    try {
      // Flush any remaining chunks
      if (upload.chunks.length > 0) {
        await this.flushChunks(recordingId, upload);
      }
      
      // Update the WAV header with the final size if any data was written
      if (upload.headerWritten) {
        // Read the whole file
        const fileData = await readFile(upload.filePath);
        
        // Get the data size (total file size minus 44 byte header)
        const dataSize = fileData.length - 44;
        
        // Update the header with the final size
        const header = createWavHeader(dataSize);
        
        // Write the updated header back to the file
        await fs.promises.write(fs.openSync(upload.filePath, 'r+'), header, 0, 44, 0);
      } else if (upload.totalBytes === 0) {
        // If no data was written, create an empty WAV file with just a header
        const header = createWavHeader(0);
        await writeFile(upload.filePath, header);
      }
      
      // Generate a URL for the file
      // In production this would be a CDN URL
      const fileUrl = `/api/files/${path.basename(upload.filePath)}`;
      
      // Clean up
      this.activeUploads.delete(recordingId);
      
      return fileUrl;
    } catch (error) {
      console.error(`Error completing upload for ${recordingId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get a file by path
   */
  async getFile(filePath: string): Promise<Buffer> {
    try {
      const fullPath = path.join(STORAGE_DIR, filePath);
      return await readFile(fullPath);
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete a file
   */
  async deleteFile(userId: string, fileId: string): Promise<void> {
    try {
      const filePath = path.join(STORAGE_DIR, userId, fileId);
      
      if (await exists(filePath)) {
        await promisify(fs.unlink)(filePath);
      }
    } catch (error) {
      console.error(`Error deleting file ${fileId}:`, error);
      throw error;
    }
  }
}

export default new StorageService();