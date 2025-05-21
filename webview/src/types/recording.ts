/**
 * Recording-related type definitions
 */

export enum RecordingStatusE {
  IDLE = 'idle',
  INITIALIZING = 'initializing',
  RECORDING = 'recording',
  STOPPING = 'stopping',    // Added to match backend
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error'
}

export interface RecordingI {
  id: string;      // Keep using 'id' since the API still returns this field for compatibility
  _id?: string;    // Optional _id field in case we need it
  title: string;
  duration: number;
  transcript: string;
  isRecording: boolean;
  status?: RecordingStatusE;
  fileUrl?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  relatedNoteIds?: string[];
}

export interface TranscriptUpdateI {
  recordingId: string;
  text: string;
  timestamp: number;
}