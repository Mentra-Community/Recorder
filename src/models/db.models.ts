/**
 * MongoDB models
 */

import mongoose, { Schema, Document } from 'mongoose';
import { RecordingStatus } from '../types/recordings.types';

// Interface for Recording document
export interface RecordingDocument extends Document {
  userId: string;
  sessionId: string;
  title: string;
  transcript: string;
  duration: number;
  fileUrl?: string;
  isRecording: boolean;
  status: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Recording Schema
const RecordingSchema = new Schema({
  // Using MongoDB's default _id as the primary identifier
  // No need for a separate 'id' field
  userId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true },
  title: { type: String, required: true },
  transcript: { type: String, default: '' },
  duration: { type: Number, default: 0 },
  fileUrl: { type: String },
  isRecording: { type: Boolean, default: false },
  status: { 
    type: String, 
    enum: Object.values(RecordingStatus),
    default: RecordingStatus.IDLE
  },
  error: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for efficient queries
RecordingSchema.index({ userId: 1, createdAt: -1 });

// Create models
export const Recording = mongoose.model<RecordingDocument>('Recording', RecordingSchema);