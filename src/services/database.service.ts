/**
 * Database service
 * Handles MongoDB interactions
 */

import mongoose from 'mongoose';
import { Recording, RecordingDocument } from '../models/db.models';
import { RecordingI } from '../types/recordings.types';

class DatabaseService {
  private connected: boolean = false;
  
  constructor() {
    this.connect();
  }
  
  /**
   * Connect to MongoDB
   */
  private async connect() {
    try {
      // Connect to MongoDB - use environment variable or default local connection
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/recorder');
      this.connected = true;
      console.log('[DATABASE] Connected to MongoDB');
    } catch (error) {
      console.error('[DATABASE] MongoDB connection error:', error);
      console.log('[DATABASE] Will use in-memory store as fallback');
    }
  }
  
  /**
   * Convert MongoDB document to standard interface
   */
  private documentToInterface(doc: RecordingDocument): RecordingI {
    return {
      id: doc.id,
      userId: doc.userId,
      sessionId: doc.sessionId,
      title: doc.title,
      transcript: doc.transcript,
      duration: doc.duration,
      fileUrl: doc.fileUrl,
      isRecording: doc.isRecording,
      status: doc.status as any, // Type safety handled in schema validation
      error: doc.error,
      relatedNoteIds: doc.relatedNoteIds,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }
  
  
  /**
   * Check if database is connected
   */
  async isConnected(): Promise<boolean> {
    if (!this.connected) return false;
    
    try {
      await mongoose.connection.db.admin().ping();
      return true;
    } catch (error) {
      return false;
    }
  }
  
  // Recording methods
  
  /**
   * Get all recordings for a user
   */
  async getRecordings(userId: string): Promise<RecordingI[]> {
    if (!this.connected) throw new Error('Database not connected');
    
    try {
      const recordings = await Recording.find({ userId })
        .sort({ createdAt: -1 })
        .exec();
      
      return recordings.map(doc => this.documentToInterface(doc));
    } catch (error) {
      console.error(`[DATABASE] Error getting recordings for user ${userId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get a recording by ID
   */
  async getRecordingById(id: string): Promise<RecordingI | null> {
    if (!this.connected) throw new Error('Database not connected');
    
    try {
      const recording = await Recording.findOne({ id }).exec();
      
      if (!recording) return null;
      
      return this.documentToInterface(recording);
    } catch (error) {
      console.error(`[DATABASE] Error getting recording ${id}:`, error);
      throw error;
    }
  }
  
  /**
   * Create a new recording
   */
  async createRecording(data: RecordingI): Promise<RecordingI> {
    if (!this.connected) throw new Error('Database not connected');
    
    try {
      const recording = new Recording(data);
      await recording.save();
      
      return this.documentToInterface(recording);
    } catch (error) {
      console.error('[DATABASE] Error creating recording:', error);
      throw error;
    }
  }
  
  /**
   * Update a recording
   */
  async updateRecording(id: string, updates: Partial<RecordingI>): Promise<RecordingI | null> {
    if (!this.connected) throw new Error('Database not connected');
    
    try {
      const updated = await Recording.findOneAndUpdate(
        { id },
        { ...updates, updatedAt: new Date() },
        { new: true }
      ).exec();
      
      if (!updated) return null;
      
      return this.documentToInterface(updated);
    } catch (error) {
      console.error(`[DATABASE] Error updating recording ${id}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete a recording
   */
  async deleteRecording(id: string): Promise<boolean> {
    if (!this.connected) throw new Error('Database not connected');
    
    try {
      const result = await Recording.deleteOne({ id }).exec();
      return result.deletedCount === 1;
    } catch (error) {
      console.error(`[DATABASE] Error deleting recording ${id}:`, error);
      throw error;
    }
  }
  
  
}

// Create and export singleton instance
export default new DatabaseService();