/**
 * Centralized API for all server communication
 */

import axios from 'axios';
import { NoteI, RecordingI, CreateNoteRequestI, UpdateNoteRequestI } from './types';

// Since we're using a proxy, we can always use a relative URL
// This works regardless of whether we're in development or production
const API_BASE_URL = '/api';

// Create axios instance
const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  // Include credentials for cookie-based auth from AugmentOS SDK
  withCredentials: true,
});

// Empty auth headers function - AugmentOS SDK handles auth via cookies
// No more mock user IDs - consistent auth across all environments
const getAuthHeader = (): Record<string, string> => {
  // No custom auth headers needed - SDK handles auth
  return {};
};

// Handler for SSE connections
let eventSourceInstance: EventSource | null = null;
const eventListeners: Record<string, ((event: MessageEvent) => void)[]> = {};

const api = {
  // Notes endpoints
  notes: {
    getAll: async (): Promise<NoteI[]> => {
      const response = await axiosInstance.get('/api/notes', {
        headers: getAuthHeader()
      });
      
      // Convert Date strings to numbers for consistency
      return response.data.map((note: any) => ({
        ...note,
        createdAt: new Date(note.createdAt).getTime(),
        updatedAt: new Date(note.updatedAt).getTime()
      }));
    },
    
    getById: async (id: string): Promise<NoteI> => {
      const response = await axiosInstance.get(`/api/notes/${id}`, {
        headers: getAuthHeader()
      });
      
      // Convert Date strings to numbers
      return {
        ...response.data,
        createdAt: new Date(response.data.createdAt).getTime(),
        updatedAt: new Date(response.data.updatedAt).getTime()
      };
    },
    
    create: async (noteData: CreateNoteRequestI): Promise<NoteI> => {
      const response = await axiosInstance.post('/api/notes', noteData, {
        headers: getAuthHeader()
      });
      
      // Convert Date strings to numbers
      return {
        ...response.data,
        createdAt: new Date(response.data.createdAt).getTime(),
        updatedAt: new Date(response.data.updatedAt).getTime()
      };
    },
    
    update: async (id: string, noteData: UpdateNoteRequestI): Promise<NoteI> => {
      const response = await axiosInstance.put(`/api/notes/${id}`, noteData, {
        headers: getAuthHeader()
      });
      
      // Convert Date strings to numbers
      return {
        ...response.data,
        createdAt: new Date(response.data.createdAt).getTime(),
        updatedAt: new Date(response.data.updatedAt).getTime()
      };
    },
    
    delete: async (id: string): Promise<void> => {
      await axiosInstance.delete(`/api/notes/${id}`, {
        headers: getAuthHeader()
      });
    }
  },
  
  // Recordings endpoints
  recordings: {
    getAll: async (): Promise<RecordingI[]> => {
      const response = await axiosInstance.get('/api/recordings', {
        headers: getAuthHeader()
      });
      
      // Convert Date strings to numbers
      return response.data.map((recording: any) => ({
        ...recording,
        createdAt: new Date(recording.createdAt).getTime(),
        updatedAt: new Date(recording.updatedAt).getTime()
      }));
    },
    
    getById: async (id: string): Promise<RecordingI> => {
      const response = await axiosInstance.get(`/api/recordings/${id}`, {
        headers: getAuthHeader()
      });
      
      // Convert Date strings to numbers
      return {
        ...response.data,
        createdAt: new Date(response.data.createdAt).getTime(),
        updatedAt: new Date(response.data.updatedAt).getTime()
      };
    },
    
    startRecording: async (sessionId: string): Promise<string> => {
      const response = await axiosInstance.post('/api/recordings/start', { sessionId }, {
        headers: getAuthHeader()
      });
      
      return response.data.id;
    },
    
    stopRecording: async (id: string): Promise<void> => {
      await axiosInstance.post(`/api/recordings/${id}/stop`, {}, {
        headers: getAuthHeader()
      });
    },
    
    createNoteFromRecording: async (recordingId: string, content: string): Promise<NoteI> => {
      const response = await axiosInstance.post(`/api/recordings/${recordingId}/notes`, { content }, {
        headers: getAuthHeader()
      });
      
      // Convert Date strings to numbers
      return {
        ...response.data,
        createdAt: new Date(response.data.createdAt).getTime(),
        updatedAt: new Date(response.data.updatedAt).getTime()
      };
    },
    
    getDownloadUrl: (id: string): string => {
      // With proxy, we can use relative URL
      return `/api/recordings/${id}/download`;
    },
    
    delete: async (id: string): Promise<void> => {
      await axiosInstance.delete(`/api/recordings/${id}`, {
        headers: getAuthHeader()
      });
    }
  },
  
  // Events (SSE) endpoints
  events: {
    connect: (): EventSource | null => {
      if (eventSourceInstance && eventSourceInstance.readyState !== EventSource.CLOSED) {
        return eventSourceInstance;
      }
      
      // With proxy, we can use relative URL for SSE
      const eventUrl = '/api/events';
      
      console.log('Connecting to SSE at:', eventUrl);
      
      // Create a new EventSource with the appropriate URL
      // withCredentials ensures auth cookies are sent
      eventSourceInstance = new EventSource(eventUrl, { withCredentials: true });
      
      // Handle connection events
      eventSourceInstance.onopen = () => {
        console.log('SSE connection established');
      };
      
      eventSourceInstance.onerror = (error) => {
        console.error('SSE connection error:', error);
        
        // Auto-reconnect if closed
        if (eventSourceInstance?.readyState === EventSource.CLOSED) {
          console.log('Attempting to reconnect...');
          eventSourceInstance = null;
          setTimeout(() => api.events.connect(), 3000);
        }
      };
      
      // Re-attach any existing listeners
      Object.entries(eventListeners).forEach(([eventName, listeners]) => {
        listeners.forEach(listener => {
          eventSourceInstance?.addEventListener(eventName, listener as EventListener);
        });
      });
      
      return eventSourceInstance;
    },
    
    addEventListener: (eventName: string, callback: (event: MessageEvent) => void): void => {
      if (!eventListeners[eventName]) {
        eventListeners[eventName] = [];
      }
      
      eventListeners[eventName].push(callback);
      
      // Make sure we have a connection
      const source = api.events.connect();
      source?.addEventListener(eventName, callback as EventListener);
    },
    
    removeEventListener: (eventName: string, callback: (event: MessageEvent) => void): void => {
      if (eventListeners[eventName]) {
        eventListeners[eventName] = eventListeners[eventName].filter(cb => cb !== callback);
      }
      
      eventSourceInstance?.removeEventListener(eventName, callback as EventListener);
    },
    
    close: (): void => {
      if (eventSourceInstance) {
        eventSourceInstance.close();
        eventSourceInstance = null;
      }
      
      // Clear listeners
      Object.keys(eventListeners).forEach(key => {
        eventListeners[key] = [];
      });
    }
  }
};

export default api;