/**
 * Recording-related type definitions
 */

export enum RecordingStatus {
  IDLE = 'idle',
  RECORDING = 'recording',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error'
}

export interface RecordingI {
  id: string;
  userId: string;
  sessionId: string;
  title: string;
  transcript: string;
  duration: number;
  fileUrl?: string;
  isRecording: boolean;
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