/**
 * MongoDB models
 */

import mongoose, { Schema, Document } from 'mongoose';
import { RecordingStatus, RecordingI } from '../types/recordings.types';

// Export RecordingDocument as Document & RecordingI
export type RecordingDocument = Document & RecordingI;

// Recording Schema
const RecordingSchema = new Schema({
  // Using MongoDB's default _id as the primary identifier
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  transcript: { type: String, default: '' },
  transcriptChunks: [{ 
    text: { type: String, required: true },
    timestamp: { type: Number, required: true },
    isFinal: { type: Boolean, required: true }
  }],
  currentInterim: { type: String },
  duration: { type: Number, default: 0 },
  storage: {
    initialized: { type: Boolean, default: false },
    fileUrl: { type: String },
    size: { type: Number }
  },
  status: { 
    type: String, 
    enum: Object.values(RecordingStatus),
    default: RecordingStatus.INITIALIZING
  },
  error: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Add a compound index to ensure only one active recording per user
RecordingSchema.index(
  { userId: 1, status: 1 },
  { 
    unique: true, 
    partialFilterExpression: { 
      status: { 
        $in: [
          RecordingStatus.INITIALIZING,
          RecordingStatus.RECORDING, 
          RecordingStatus.STOPPING
        ] 
      } 
    }
  }
);

// Indexes for efficient queries
RecordingSchema.index({ userId: 1, createdAt: -1 });

// Create models
export const Recording = mongoose.model<RecordingDocument>('Recording', RecordingSchema);