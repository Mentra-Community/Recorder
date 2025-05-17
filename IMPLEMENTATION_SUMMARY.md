# Recorder App Implementation Plan

## Frontend-Backend Integration Plan

### Data Models

#### Recording Model
```typescript
interface RecordingI {
  id: string;                  // Format: rec_[timestamp]_[uuid]
  title: string;               // Display name, editable by user
  duration: number;            // In seconds
  transcript: string;          // Full transcript text
  isRecording: boolean;        // Whether recording is in progress
  status: RecordingStatusE;    // Current status (idle, recording, processing, completed, error)
  fileUrl?: string;            // URL to access the audio file
  error?: string;              // Error message if status is "error"
  createdAt: number;           // Creation timestamp
  updatedAt: number;           // Last update timestamp
  relatedNoteIds?: string[];   // IDs of notes created from this recording
}

enum RecordingStatusE {
  IDLE = 'idle',
  RECORDING = 'recording',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error'
}
```

#### Transcript Update Model
```typescript
interface TranscriptUpdateI {
  recordingId: string;
  text: string;
  timestamp: number;
}
```

### REST API Endpoints

#### Recordings Endpoints
| Endpoint                     | Method | Description                           | Request Body                        | Response                       |
|------------------------------|--------|---------------------------------------|-------------------------------------|--------------------------------|
| `/api/recordings`            | GET    | Get all recordings for current user   | -                                   | RecordingI[]                   |
| `/api/recordings/:id`        | GET    | Get recording by ID                   | -                                   | RecordingI                     |
| `/api/recordings/start`      | POST   | Start a new recording                 | `{ sessionId: string }`             | `{ id: string }`               |
| `/api/recordings/:id/stop`   | POST   | Stop an active recording              | -                                   | `{ success: boolean }`         |
| `/api/recordings/:id`        | PUT    | Update recording metadata (e.g. title)| `{ title: string }`                 | RecordingI                     |
| `/api/recordings/:id/download`| GET   | Download recording audio file         | -                                   | Audio file (WAV)               |
| `/api/recordings/:id`        | DELETE | Delete a recording                    | -                                   | 204 No Content                 |

#### Notes Endpoints (For Future Use)
| Endpoint                     | Method | Description                           |
|------------------------------|--------|---------------------------------------|
| `/api/recordings/:id/notes`  | POST   | Create a note from recording          |

### Real-Time Events (SSE)

#### SSE Event Types
| Event Type          | Data Format                                        | Description                         |
|---------------------|---------------------------------------------------|-------------------------------------|
| `transcript`        | `{ recordingId: string, text: string, timestamp: number }` | Real-time transcript updates        |
| `recording-status`  | `{ id: string, isRecording: boolean, duration: number, status: RecordingStatusE, ... }` | Recording status changes |
| `recording-error`   | `{ id: string, error: string }`                     | Recording errors                   |
| `recording-deleted` | `{ id: string }`                                    | Notification of deleted recordings |

## Multi-Storage Solution

### Dual Storage System

We need a storage system that:
1. Always uses MongoDB for metadata storage
2. Uses both local filesystem AND Cloudflare R2 for files
3. When running locally, writes to both disk and R2
4. In production, may only use R2 depending on environment

### MongoDB Integration

#### MongoDB Schema Models

##### Recording Schema
```typescript
const RecordingSchema = new Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true },
  title: { type: String, required: true },
  transcript: { type: String, default: '' },
  duration: { type: Number, default: 0 },
  fileUrl: { type: String },
  isRecording: { type: Boolean, default: false },
  status: { 
    type: String, 
    enum: ['idle', 'recording', 'processing', 'completed', 'error'],
    default: 'idle'
  },
  error: { type: String },
  relatedNoteIds: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for efficient queries
RecordingSchema.index({ userId: 1, createdAt: -1 });
RecordingSchema.index({ id: 1 });

const Recording = mongoose.model<RecordingDocument>('Recording', RecordingSchema);
```

##### Note Schema
```typescript
const NoteSchema = new Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  content: { type: String, required: true },
  sourceRecordingId: { type: String, index: true },
  tags: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for efficient queries
NoteSchema.index({ userId: 1, createdAt: -1 });
NoteSchema.index({ sourceRecordingId: 1 });

const Note = mongoose.model<NoteDocument>('Note', NoteSchema);
```

#### Database Service

Create a database service to handle MongoDB interactions:

```typescript
class DatabaseService {
  private connected: boolean = false;
  
  constructor() {
    this.connect();
  }
  
  private async connect() {
    try {
      // Connect to MongoDB - use environment variable or default local connection
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/recorder');
      this.connected = true;
      console.log('Connected to MongoDB');
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw new Error('Failed to connect to MongoDB');
    }
  }
  
  // Recording methods
  async getRecordings(userId: string): Promise<RecordingDocument[]> {
    return Recording.find({ userId })
      .sort({ createdAt: -1 })
      .exec();
  }
  
  async getRecordingById(id: string): Promise<RecordingDocument | null> {
    return Recording.findOne({ id }).exec();
  }
  
  async createRecording(data: RecordingI): Promise<RecordingDocument> {
    const recording = new Recording(data);
    return recording.save();
  }
  
  async updateRecording(id: string, updates: Partial<RecordingI>): Promise<RecordingDocument | null> {
    return Recording.findOneAndUpdate(
      { id },
      { ...updates, updatedAt: new Date() },
      { new: true }
    ).exec();
  }
  
  async deleteRecording(id: string): Promise<boolean> {
    const result = await Recording.deleteOne({ id }).exec();
    return result.deletedCount === 1;
  }
  
  // Note methods
  async getNotes(userId: string): Promise<NoteDocument[]> {
    return Note.find({ userId })
      .sort({ createdAt: -1 })
      .exec();
  }
  
  async getNoteById(id: string): Promise<NoteDocument | null> {
    return Note.findOne({ id }).exec();
  }
  
  async createNote(data: NoteI): Promise<NoteDocument> {
    const note = new Note(data);
    return note.save();
  }
  
  async updateNote(id: string, updates: Partial<NoteI>): Promise<NoteDocument | null> {
    return Note.findOneAndUpdate(
      { id },
      { ...updates, updatedAt: new Date() },
      { new: true }
    ).exec();
  }
  
  async deleteNote(id: string): Promise<boolean> {
    const result = await Note.deleteOne({ id }).exec();
    return result.deletedCount === 1;
  }
  
  // Health check method for startup
  async healthCheck(): Promise<boolean> {
    try {
      await mongoose.connection.db.admin().ping();
      return true;
    } catch (error) {
      return false;
    }
  }
}
```

### Enhanced Storage Service

The storage service will be enhanced to support writing to both filesystem and R2:

```typescript
// Storage.service.ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const exists = promisify(fs.exists);

class StorageService {
  private localStoragePath: string;
  private r2Client: S3Client | null = null;
  private bucketName: string = '';
  private useR2: boolean = false;
  private useLocalDisk: boolean = true;
  private activeUploads: Map<string, { userId: string, chunks: Buffer[] }> = new Map();
  
  constructor() {
    // Set up local storage path
    this.localStoragePath = process.env.LOCAL_STORAGE_PATH || path.join(__dirname, '../temp_storage');
    
    // Determine storage strategies based on environment
    this.useR2 = !!process.env.R2_ACCESS_KEY_ID && !!process.env.R2_SECRET_ACCESS_KEY;
    this.useLocalDisk = process.env.USE_LOCAL_DISK !== 'false';
    
    // Initialize R2 client if credentials are available
    if (this.useR2) {
      this.initR2Client();
    }
    
    console.log(`Storage Service initialized with:
      - Local disk storage: ${this.useLocalDisk ? 'ENABLED' : 'DISABLED'}
      - R2 cloud storage: ${this.useR2 ? 'ENABLED' : 'DISABLED'}
    `);
    
    // Create local storage directory if needed
    if (this.useLocalDisk) {
      this.ensureStorageDirectoryExists();
    }
  }
  
  /**
   * Initialize R2 client
   */
  private initR2Client() {
    const r2Config = {
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT || 'https://8cb61bb5d20701a402f3ebc7d2153347.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
      }
    };
    
    try {
      this.r2Client = new S3Client(r2Config);
      this.bucketName = process.env.R2_BUCKET_NAME || 'recorder';
      console.log('R2 client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize R2 client:', error);
      this.useR2 = false;
    }
  }
  
  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDirectoryExists() {
    try {
      if (!fs.existsSync(this.localStoragePath)) {
        await mkdir(this.localStoragePath, { recursive: true });
        console.log(`Created storage directory: ${this.localStoragePath}`);
      }
    } catch (error) {
      console.error('Failed to create storage directory:', error);
      // Disable local storage if we can't create the directory
      this.useLocalDisk = false;
    }
  }
  
  /**
   * Get user directory path
   */
  private getUserPath(userId: string): string {
    const userPath = path.join(this.localStoragePath, userId);
    
    // Create user directory if it doesn't exist
    if (!fs.existsSync(userPath)) {
      fs.mkdirSync(userPath, { recursive: true });
    }
    
    return userPath;
  }
  
  /**
   * Begin streaming upload - called when starting a recording
   */
  async beginStreamingUpload(userId: string, recordingId: string): Promise<void> {
    this.activeUploads.set(recordingId, { userId, chunks: [] });
    
    // For filesystem, ensure user directory exists
    if (this.useLocalDisk) {
      this.getUserPath(userId);
    }
  }
  
  /**
   * Add an audio chunk to the active recording
   */
  async addChunk(recordingId: string, chunk: ArrayBuffer): Promise<boolean> {
    const upload = this.activeUploads.get(recordingId);
    if (!upload) return false;
    
    // Store chunk in memory temporarily
    upload.chunks.push(Buffer.from(chunk));
    return true;
  }
  
  /**
   * Complete the upload - called when stopping a recording
   */
  async completeUpload(recordingId: string): Promise<string> {
    const upload = this.activeUploads.get(recordingId);
    if (!upload) throw new Error(`No active upload for ${recordingId}`);
    
    // Combine all chunks into a single buffer with WAV header
    const combinedBuffer = this.combineChunksWithWavHeader(upload.chunks);
    
    // File paths and keys
    const fileName = `${recordingId}.wav`;
    const localFilePath = this.useLocalDisk ? path.join(this.getUserPath(upload.userId), fileName) : '';
    const r2Key = `${upload.userId}/${fileName}`;
    
    try {
      // Parallel uploads to both storage systems
      const uploadPromises: Promise<any>[] = [];
      
      // Local disk storage
      if (this.useLocalDisk) {
        uploadPromises.push(writeFile(localFilePath, combinedBuffer));
      }
      
      // R2 cloud storage
      if (this.useR2 && this.r2Client) {
        uploadPromises.push(this.r2Client.send(new PutObjectCommand({
          Bucket: this.bucketName,
          Key: r2Key,
          Body: combinedBuffer,
          ContentType: 'audio/wav'
        })));
      }
      
      // Wait for all uploads to complete
      await Promise.all(uploadPromises);
      
      // Clean up
      this.activeUploads.delete(recordingId);
      
      // Determine URL to return
      // Prefer R2 URL if available, otherwise use local file path
      if (this.useR2) {
        return `${process.env.R2_PUBLIC_URL || `https://${this.bucketName}.${process.env.R2_ENDPOINT}`}/${r2Key}`;
      } else {
        return `/api/recordings/${recordingId}/download`;
      }
    } catch (error) {
      console.error(`Error completing upload for ${recordingId}:`, error);
      throw new Error(`Failed to complete upload: ${error.message}`);
    }
  }
  
  /**
   * Combine chunks with WAV header
   */
  private combineChunksWithWavHeader(chunks: Buffer[]): Buffer {
    // Implementation depends on your audio format requirements
    // This is a simplified version - real implementation would need proper WAV header generation
    
    // Create WAV header
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    
    // Calculate total data size
    const totalDataSize = chunks.reduce((size, chunk) => size + chunk.length, 0);
    
    // Create header buffer - simplified for example purposes
    const header = Buffer.alloc(44);
    
    // "RIFF" chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + totalDataSize, 4); // Chunk size
    header.write('WAVE', 8);
    
    // "fmt " sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1 size
    header.writeUInt16LE(1, 20); // Audio format (PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28); // Byte rate
    header.writeUInt16LE(numChannels * bitsPerSample / 8, 32); // Block align
    header.writeUInt16LE(bitsPerSample, 34);
    
    // "data" sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(totalDataSize, 40);
    
    // Combine header and chunks
    return Buffer.concat([header, ...chunks]);
  }
  
  /**
   * Get a file - used for downloads
   */
  async getFile(filePath: string): Promise<Buffer> {
    // Format: userId/fileName.wav
    const [userId, fileName] = filePath.split('/');
    if (!userId || !fileName) {
      throw new Error('Invalid file path format');
    }
    
    // Try local disk first if enabled
    if (this.useLocalDisk) {
      const localFilePath = path.join(this.getUserPath(userId), fileName);
      if (await exists(localFilePath)) {
        return readFile(localFilePath);
      }
    }
    
    // Fall back to R2 if available
    if (this.useR2 && this.r2Client) {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: filePath
      });
      
      try {
        const response = await this.r2Client.send(command);
        if (!response.Body) {
          throw new Error('No file data returned from R2');
        }
        
        const stream = response.Body as Readable;
        return new Promise((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
      } catch (error) {
        console.error(`Error retrieving file from R2: ${filePath}`, error);
        throw new Error(`Failed to retrieve file: ${error.message}`);
      }
    }
    
    throw new Error(`File not found: ${filePath}`);
  }
  
  /**
   * Delete a file
   */
  async deleteFile(userId: string, fileName: string): Promise<void> {
    const deletePromises: Promise<any>[] = [];
    
    // Delete from local disk if enabled
    if (this.useLocalDisk) {
      const localFilePath = path.join(this.getUserPath(userId), fileName);
      if (await exists(localFilePath)) {
        deletePromises.push(unlink(localFilePath));
      }
    }
    
    // Delete from R2 if enabled
    if (this.useR2 && this.r2Client) {
      const key = `${userId}/${fileName}`;
      deletePromises.push(this.r2Client.send(new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      })));
    }
    
    // Wait for all deletes to complete
    try {
      await Promise.all(deletePromises);
    } catch (error) {
      console.error(`Error deleting file ${fileName} for user ${userId}:`, error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }
}

// Create and export singleton instance
export default new StorageService();
```

### Storage Service Configuration

Required environment variables:
```
# Storage configuration
USE_LOCAL_DISK=true  # Set to false to disable local disk storage in production
LOCAL_STORAGE_PATH=/path/to/storage  # Optional, defaults to temp_storage

# MongoDB configuration
MONGODB_URI=mongodb://localhost:27017/recorder

# Cloudflare R2 configuration
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=recorder
R2_ENDPOINT=https://8cb61bb5d20701a402f3ebc7d2153347.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://8cb61bb5d20701a402f3ebc7d2153347.r2.cloudflarestorage.com/recorder
```

## Recording Service Refactoring

The RecordingsService will be modified to use the MongoDB database for all metadata storage:

```typescript
class RecordingsService {
  private activeRecordings = new Map<string, {
    recordingId: string;
    userId: string;
    sessionId: string;
    startTime: number;
  }>();
  
  /**
   * Start a new recording
   */
  async startRecording(userId: string, sessionId: string): Promise<string> {
    console.log(`[RECORDING] Starting recording for user ${userId}, session ${sessionId}`);
    
    // Check if already recording in this session
    const existingRecording = Array.from(this.activeRecordings.values())
      .find(r => r.sessionId === sessionId && r.userId === userId);
      
    if (existingRecording) {
      console.log(`[RECORDING] Already recording with ID ${existingRecording.recordingId}`);
      return existingRecording.recordingId;
    }
    
    // Create a new recording ID
    const recordingId = `rec_${Date.now()}_${uuidv4().substring(0, 8)}`;
    
    try {
      // Initialize upload to storage service
      await storageService.beginStreamingUpload(userId, recordingId);
      
      // Create recording in database
      const newRecording: RecordingI = {
        id: recordingId,
        userId,
        sessionId,
        title: `Recording ${new Date().toLocaleString()}`,
        isRecording: true,
        status: RecordingStatus.RECORDING,
        transcript: '',
        duration: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Save to MongoDB
      await databaseService.createRecording(newRecording);
      
      // Track this recording
      this.activeRecordings.set(recordingId, {
        recordingId,
        userId,
        sessionId,
        startTime: Date.now()
      });
      
      // Notify clients
      streamService.broadcastToUser(userId, 'recording-status', {
        id: recordingId,
        isRecording: true,
        duration: 0,
        title: newRecording.title,
        transcript: '',
        createdAt: newRecording.createdAt.getTime()
      });
      
      console.log(`Started recording ${recordingId} for user ${userId}`);
      return recordingId;
    } catch (error) {
      console.error(`Error starting recording for user ${userId}:`, error);
      throw error;
    }
  }
  
  /**
   * Process an audio chunk
   */
  async processAudioChunk(recordingId: string, chunk: AudioChunk): Promise<void> {
    // Log audio chunk sizes periodically
    if (Math.random() < 0.1) {
      console.log(`[AUDIO] Processing chunk for recording ${recordingId}, size: ${chunk.arrayBuffer.byteLength} bytes`);
    }
    
    const recording = this.activeRecordings.get(recordingId);
    
    if (!recording) {
      console.log(`[AUDIO] Received chunk for unknown recording ${recordingId}`);
      return;
    }
    
    try {
      // Stream the chunk to storage
      const partUploaded = await storageService.addChunk(recordingId, chunk.arrayBuffer);
      
      // If we uploaded a part, update the database with current duration
      if (partUploaded) {
        const currentDuration = Math.round((Date.now() - recording.startTime) / 1000);
        
        // Update in MongoDB
        await databaseService.updateRecording(recordingId, {
          duration: currentDuration,
          updatedAt: new Date()
        });
        
        // Send update to client
        streamService.broadcastToUser(recording.userId, 'recording-status', {
          id: recordingId,
          isRecording: true,
          duration: currentDuration
        });
      }
    } catch (error) {
      console.error(`Error processing chunk for ${recordingId}:`, error);
    }
  }
  
  /**
   * Update transcript for a recording
   */
  async updateTranscript(recordingId: string, text: string): Promise<void> {
    const recording = this.activeRecordings.get(recordingId);
    
    if (!recording) return;
    
    try {
      // Update in MongoDB
      await databaseService.updateRecording(recordingId, {
        transcript: text,
        updatedAt: new Date()
      });
      
      // Send to clients
      streamService.broadcastToUser(recording.userId, 'transcript', {
        recordingId,
        text,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`Error updating transcript for ${recordingId}:`, error);
    }
  }
  
  /**
   * Stop an active recording
   */
  async stopRecording(recordingId: string): Promise<void> {
    console.log(`[RECORDING] Stopping recording ${recordingId}`);
    const recording = this.activeRecordings.get(recordingId);
    
    if (!recording) {
      console.log(`[RECORDING] No active recording found with ID ${recordingId}`);
      return;
    }
    
    try {
      // Complete the storage upload
      const fileUrl = await storageService.completeUpload(recordingId);
      
      // Update recording in database
      const duration = Math.round((Date.now() - recording.startTime) / 1000);
      
      await databaseService.updateRecording(recordingId, {
        isRecording: false,
        status: RecordingStatus.COMPLETED,
        fileUrl,
        duration,
        updatedAt: new Date()
      });
      
      // Clean up
      this.activeRecordings.delete(recordingId);
      
      // Notify clients
      streamService.broadcastToUser(recording.userId, 'recording-status', {
        id: recordingId,
        isRecording: false,
        duration,
        fileUrl,
        status: RecordingStatus.COMPLETED
      });
      
      console.log(`Stopped recording ${recordingId}, duration: ${duration}s`);
    } catch (error) {
      console.error(`Error stopping recording ${recordingId}:`, error);
      
      // Update with error status
      await databaseService.updateRecording(recordingId, {
        isRecording: false,
        status: RecordingStatus.ERROR,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date()
      });
      
      // Clean up anyway
      this.activeRecordings.delete(recordingId);
      
      // Notify clients of error
      streamService.broadcastToUser(recording.userId, 'recording-error', {
        id: recordingId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  /**
   * Get recordings for a user
   */
  async getRecordingsForUser(userId: string): Promise<RecordingI[]> {
    try {
      // Fetch from MongoDB
      const recordings = await databaseService.getRecordings(userId);
      return recordings;
    } catch (error) {
      console.error(`Error getting recordings for user ${userId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get a recording by ID
   */
  async getRecordingById(recordingId: string): Promise<RecordingI> {
    try {
      // Fetch from MongoDB
      const recording = await databaseService.getRecordingById(recordingId);
      
      if (!recording) {
        throw new Error(`Recording ${recordingId} not found`);
      }
      
      return recording;
    } catch (error) {
      console.error(`Error getting recording ${recordingId}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete a recording
   */
  async deleteRecording(recordingId: string): Promise<void> {
    try {
      // Get recording from database first
      const recording = await databaseService.getRecordingById(recordingId);
      
      if (!recording) {
        throw new Error(`Recording ${recordingId} not found`);
      }
      
      // Delete the file from storage
      await storageService.deleteFile(recording.userId, `${recordingId}.wav`);
      
      // Delete from database
      await databaseService.deleteRecording(recordingId);
      
      // Notify clients
      streamService.broadcastToUser(recording.userId, 'recording-deleted', {
        id: recordingId
      });
    } catch (error) {
      console.error(`Error deleting recording ${recordingId}:`, error);
      throw error;
    }
  }
  
  /**
   * Rename/update a recording
   */
  async updateRecording(recordingId: string, updates: Partial<RecordingI>): Promise<RecordingI> {
    try {
      // Update in MongoDB
      const updatedRecording = await databaseService.updateRecording(recordingId, {
        ...updates,
        updatedAt: new Date()
      });
      
      if (!updatedRecording) {
        throw new Error(`Recording ${recordingId} not found`);
      }
      
      // Notify clients
      streamService.broadcastToUser(updatedRecording.userId, 'recording-status', {
        id: recordingId,
        ...updates,
        updatedAt: new Date().getTime()
      });
      
      return updatedRecording;
    } catch (error) {
      console.error(`Error updating recording ${recordingId}:`, error);
      throw error;
    }
  }
}
```

## Frontend Components Integration

### RecordingsListImproved
```typescript
interface RecordingsListImprovedProps {
  recordings: RecordingI[];
  onRecordingSelect: (id: string) => void;
  onNewRecording: () => void;
}
```

**Changes Needed:**
1. Remove `location` field from UI
2. Add "Rename" option to the options menu (MoreVertical button)
3. Connect to real API data using `api.recordings.getAll()`
4. Add rename dialog/modal
5. Integrate with SSE for real-time updates
6. Add loading/error states

### RecordingImproved
```typescript
interface RecordingImprovedProps {
  onBack: () => void;
  onStop: () => void;
  sessionId: string;
  currentRecordingId: string | null;
}
```

**Changes Needed:**
1. Connect to real API for starting/stopping recordings
2. Subscribe to SSE for real-time transcript updates
3. Display actual recording duration from server
4. Handle recording errors
5. Show loading indicators during processing

### PlaybackImproved
```typescript
interface PlaybackImprovedProps {
  onBack: () => void;
  onDelete: (id: string) => void;
  recordingId: string;
}
```

**Changes Needed:**
1. Remove `location` field from UI
2. Add "Rename" option to the header
3. Connect to real API for fetching recording data
4. Implement actual audio playback using HTML5 Audio
5. Connect scrubber to actual playback position
6. Add loading/error states

## Feature Update: Rename Recordings

### Backend Changes Needed
1. Add a new endpoint in `recordings.api.ts`:
   ```typescript
   // Update a recording (e.g. rename)
   router.put('/:id', isaiahMiddleware, async (req: AuthenticatedRequest, res: Response) => {
     const userId = req.userId;
     const { id } = req.params;
     const { title } = req.body;
     
     if (!userId) {
       return res.status(401).json({ error: 'Unauthorized' });
     }
     
     if (!title) {
       return res.status(400).json({ error: 'Title is required' });
     }
     
     try {
       // Verify recording exists and belongs to user
       const recording = await recordingsService.getRecordingById(id);
       
       if (recording.userId !== userId) {
         return res.status(403).json({ error: 'Forbidden' });
       }
       
       const updatedRecording = await recordingsService.updateRecording(id, { title });
       res.json(updatedRecording);
     } catch (error) {
       if (error instanceof Error && error.message.includes('not found')) {
         return res.status(404).json({ error: error.message });
       }
       res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
     }
   });
   ```

### Frontend Changes Needed

1. Add update method to `Api.ts`:
   ```typescript
   updateRecording: async (id: string, updates: { title: string }): Promise<RecordingI> => {
     const response = await axiosInstance.put(`/api/recordings/${id}`, updates, {
       headers: getAuthHeader()
     });
     
     // Convert Date strings to numbers
     return {
       ...response.data,
       createdAt: new Date(response.data.createdAt).getTime(),
       updatedAt: new Date(response.data.updatedAt).getTime()
     };
   },
   ```

2. Add rename dialog component:
   ```typescript
   interface RenameDialogProps {
     recording: RecordingI;
     onRename: (id: string, newTitle: string) => void;
     onCancel: () => void;
     isOpen: boolean;
   }
   
   const RenameDialog: React.FC<RenameDialogProps> = ({ 
     recording, 
     onRename, 
     onCancel, 
     isOpen 
   }) => {
     const [title, setTitle] = useState(recording?.title || '');
     
     if (!isOpen) return null;
     
     return (
       <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
         <div className="bg-white rounded-lg p-4 w-80">
           <h3 className="text-lg font-medium mb-4">Rename Recording</h3>
           <input
             type="text"
             className="w-full border border-gray-300 rounded px-3 py-2 mb-4"
             value={title}
             onChange={(e) => setTitle(e.target.value)}
             placeholder="Enter new title"
           />
           <div className="flex justify-end space-x-2">
             <button
               className="px-4 py-2 border border-gray-300 rounded text-gray-700"
               onClick={onCancel}
             >
               Cancel
             </button>
             <button
               className="px-4 py-2 bg-blue-600 text-white rounded"
               onClick={() => onRename(recording.id, title)}
               disabled={!title.trim()}
             >
               Rename
             </button>
           </div>
         </div>
       </div>
     );
   };
   ```

3. Implement rename functionality in App.tsx:
   ```typescript
   const handleRenameRecording = async (id: string, newTitle: string) => {
     try {
       await api.recordings.updateRecording(id, { title: newTitle });
       // Update local state
       setRecordings(recordings.map(rec => 
         rec.id === id ? { ...rec, title: newTitle } : rec
       ));
       setShowRenameDialog(false);
     } catch (err) {
       console.error('Failed to rename recording:', err);
       // Show error message
     }
   };
   ```

## Implementation Strategy and Timeline

### Phase 1: MongoDB Database Setup (1-2 days)
1. Set up Mongoose schemas and database service
2. Create database connection handling
3. Modify recordings service to use MongoDB
4. Test database operations

### Phase 2: Multi-Storage Implementation (2-3 days)
1. Implement enhanced storage service with dual storage
2. Add R2 client integration with AWS SDK
3. Test file uploads to both local and cloud storage
4. Implement secure file retrieval

### Phase 3: Basic Frontend Integration (1-2 days)
1. Update the data model types to match server
2. Connect RecordingsListImproved to the real API
3. Add loading and error states to all components
4. Implement audio playback in PlaybackImproved

### Phase 4: Real-time Features (1-2 days)
1. Implement SSE subscription for real-time updates
2. Connect RecordingImproved to start/stop APIs
3. Display real-time transcripts during recording
4. Ensure voice commands work properly

### Phase 5: Rename Feature (1 day)
1. Implement the backend update endpoint
2. Add rename dialog to frontend
3. Add rename functionality to RecordingsListImproved and PlaybackImproved

### Phase 6: Testing and Refinement (1-2 days)
1. Test with both filesystem and R2 storage
2. Test database operations and queries
3. Fix any bugs or edge cases
4. Improve error handling and retry logic
5. Add recovery mechanisms for network issues

## Summary

By following this plan, we'll have a fully functional recorder app that:
- Uses MongoDB for all metadata storage in all environments
- Stores audio files to both local filesystem and R2 when running locally
- Can be configured to use only R2 in production if needed
- Shows a list of all recordings with rename capability
- Allows starting new recordings from the UI
- Shows real-time transcripts during recording
- Allows playback of completed recordings
- Works with voice commands from AugmentOS glasses
- Updates in real-time as recordings are created/modified

This implementation removes the location field as requested and creates a flexible, production-ready system that can scale with user demand while maintaining local backups when running on a local machine.

## Required Dependencies

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.287.0",
    "mongoose": "^6.10.0"
  }
}
```