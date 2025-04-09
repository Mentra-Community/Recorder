import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Audio chunk interface to match AugmentOS SDK data
interface AudioChunk {
  arrayBuffer: ArrayBuffer;
  sampleRate?: number;
  timestamp?: number;
}

/**
 * Manages the collection and processing of audio chunks
 */
export class AudioManager {
  private audioChunks: ArrayBuffer[] = [];
  private sampleRate: number = 16000; // Default, will be updated from chunks
  private sessionId: string;
  private userId: string;
  private startTime: number;
  private audioFormat: string;

  constructor(sessionId: string, userId: string, audioFormat: string = 'wav') {
    this.sessionId = sessionId;
    this.userId = userId;
    this.startTime = Date.now();
    this.audioFormat = audioFormat;
  }

  /**
   * Add an audio chunk to the collection
   */
  public addAudioChunk(chunk: AudioChunk): void {
    this.audioChunks.push(chunk.arrayBuffer);
    if (chunk.sampleRate) {
      this.sampleRate = chunk.sampleRate;
    }
  }

  /**
   * Get the total duration of recorded audio in milliseconds
   */
  public getDuration(): number {
    // Calculate based on audio sample rate and data size
    // Each sample is 2 bytes (16-bit PCM)
    let totalSamples = 0;
    
    for (const chunk of this.audioChunks) {
      totalSamples += chunk.byteLength / 2; // 16-bit = 2 bytes per sample
    }
    
    // Duration = totalSamples / sampleRate (in seconds) * 1000 (to get ms)
    return (totalSamples / this.sampleRate) * 1000;
  }

  /**
   * Save the recorded audio to a file
   * @returns Path to the saved file
   */
  public async saveRecording(): Promise<string> {
    if (this.audioChunks.length === 0) {
      throw new Error('No audio data to save');
    }
    
    // Calculate total length
    let totalLength = 0;
    this.audioChunks.forEach(chunk => {
      totalLength += chunk.byteLength;
    });
    
    // Create file data based on format
    let completeFile: Uint8Array;
    let fileExtension: string;
    
    if (this.audioFormat === 'wav') {
      // Create WAV header (44 bytes)
      const wavHeader = this.createWavHeader(totalLength, this.sampleRate);
      
      // Combine header with audio data
      completeFile = new Uint8Array(44 + totalLength);
      completeFile.set(new Uint8Array(wavHeader), 0);
      
      let offset = 44;
      this.audioChunks.forEach(chunk => {
        completeFile.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      });
      
      fileExtension = 'wav';
    } else if (this.audioFormat === 'mp3') {
      // For now, we'll just save the raw PCM data with mp3 extension
      // In a real implementation, you would use a library like lame.js to encode MP3
      completeFile = new Uint8Array(totalLength);
      
      let offset = 0;
      this.audioChunks.forEach(chunk => {
        completeFile.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      });
      
      fileExtension = 'pcm'; // Use PCM extension since we're not actually encoding MP3
    } else {
      // Default to raw PCM
      completeFile = new Uint8Array(totalLength);
      
      let offset = 0;
      this.audioChunks.forEach(chunk => {
        completeFile.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      });
      
      fileExtension = 'pcm';
    }
    
    // Generate filename with timestamp and session info
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `audio_${this.userId}_${this.sessionId}_${timestamp}.${fileExtension}`;
    const filePath = path.join(os.tmpdir(), fileName);
    
    // Write to file
    await fs.promises.writeFile(filePath, completeFile);
    
    return filePath;
  }

  /**
   * Reset the audio manager, clearing all audio chunks
   */
  public reset(): void {
    this.audioChunks = [];
    this.startTime = Date.now();
  }

  /**
   * Get total size of recorded audio in bytes
   */
  public getTotalSize(): number {
    return this.audioChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  }

  /**
   * Creates a WAV header for the given parameters
   * @param dataLength Length of audio data in bytes
   * @param sampleRate Sample rate of the audio
   * @returns ArrayBuffer containing the WAV header
   */
  private createWavHeader(dataLength: number, sampleRate: number): ArrayBuffer {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    
    // RIFF identifier
    this.writeString(view, 0, 'RIFF');
    // File length minus RIFF identifier length and file description length
    view.setUint32(4, 36 + dataLength, true);
    // WAVE identifier
    this.writeString(view, 8, 'WAVE');
    // Format chunk identifier
    this.writeString(view, 12, 'fmt ');
    // Format chunk length
    view.setUint32(16, 16, true);
    // Sample format (1 is PCM)
    view.setUint16(20, 1, true);
    // Channel count
    view.setUint16(22, 1, true);
    // Sample rate
    view.setUint32(24, sampleRate, true);
    // Byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * 2, true);
    // Block align (channel count * bytes per sample)
    view.setUint16(32, 2, true);
    // Bits per sample
    view.setUint16(34, 16, true);
    // Data chunk identifier
    this.writeString(view, 36, 'data');
    // Data chunk length
    view.setUint32(40, dataLength, true);
    
    return buffer;
  }

  /**
   * Helper to write a string to a DataView
   */
  private writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}