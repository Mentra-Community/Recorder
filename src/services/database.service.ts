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
      // Use the MongoDB connection from the connections module
      // The connection should be already established in app.ts
      if (mongoose.connection.readyState === 1) {
        this.connected = true;
        console.log('[DATABASE] Using existing MongoDB connection');
      } else {
        // Fallback direct connection if needed
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/recorder';
        console.log('[DATABASE] Connecting to MongoDB:', uri);
        await mongoose.connect(uri);
        this.connected = true;
        console.log('[DATABASE] Connected to MongoDB');
      }
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
      id: doc._id.toString(), // Use MongoDB's _id as our primary identifier
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
      // Check if this is a valid MongoDB ObjectId
      if (!id.match(/^[0-9a-f]{24}$/i)) {
        console.log(`[DATABASE] Invalid MongoDB ObjectId: ${id}`);
        return null;
      }
      
      // Find by MongoDB's _id field
      const recording = await Recording.findById(id).exec();
      
      if (!recording) {
        console.log(`[DATABASE] Recording not found with id: ${id}`);
        return null;
      }
      
      console.log(`[DATABASE] Found recording with title: ${recording.title}`);
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
      // Remove the id field from the data, as MongoDB will generate _id
      const { id, ...recordingData } = data;
      
      // Create and save the new recording
      const recording = new Recording(recordingData);
      await recording.save();
      
      console.log(`[DATABASE] Created recording with MongoDB _id: ${recording._id}`);
      
      // Map back to our interface format
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
      // Remove id from updates if present
      const { id: _, ...updateData } = updates;
      
      const updated = await Recording.findByIdAndUpdate(
        id,
        { ...updateData, updatedAt: new Date() },
        { new: true }
      ).exec();
      
      if (!updated) {
        console.log(`[DATABASE] Recording not found for update: ${id}`);
        return null;
      }
      
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
      const result = await Recording.findByIdAndDelete(id).exec();
      return !!result;
    } catch (error) {
      console.error(`[DATABASE] Error deleting recording ${id}:`, error);
      throw error;
    }
  }
  
  
}

// Create and export singleton instance
export default new DatabaseService();