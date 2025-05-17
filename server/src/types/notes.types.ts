/**
 * Note-related type definitions
 */

export interface NoteI {
  id: string;
  userId: string;
  content: string;
  sourceRecordingId?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNoteDtoI {
  content: string;
  sourceRecordingId?: string;
  tags?: string[];
}

export interface UpdateNoteDtoI {
  content?: string;
  tags?: string[];
}