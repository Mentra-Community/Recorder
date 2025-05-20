/**
 * Recording-related type definitions
 */

export enum RecordingStatus {
  INITIALIZING = 'initializing', // New status for recording being set up
  RECORDING = 'recording',
  STOPPING = 'stopping', // Recording in the process of being stopped
  COMPLETED = 'completed',
  ERROR = 'error'
}

export interface TranscriptChunk {
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface StorageMetadata {
  initialized: boolean;
  fileUrl?: string;
  size?: number;
}

export interface RecordingI {
  _id: string;
  userId: string; // This is the user's email from TPA session
  title: string;
  transcript: string; // Concatenated transcript for backwards compatibility
  transcriptChunks: TranscriptChunk[]; // Array of transcript chunks
  currentInterim?: string; // Current interim transcript
  duration: number;
  storage: StorageMetadata;
  status: RecordingStatus;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AudioChunkI {
  arrayBuffer: ArrayBuffer;
  sampleRate?: number;
  timestamp?: number;
}

export interface TranscriptionDataI {
  text: string;
  isFinal: boolean;
  language: string;
  startTime: number;
  endTime?: number;
}

export interface TranscriptUpdateI {
  recordingId: string;
  text: string;
  timestamp: number;
}