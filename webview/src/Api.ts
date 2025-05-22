/**
 * Centralized API for all server communication
 */

import axios from 'axios';
import { RecordingI } from './types';

// Since we're using a proxy, we can always use a relative URL
// This works regardless of whether we're in development or production
const API_BASE_URL = '';  // Changed from '/api' to avoid duplication

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
  // API endpoints
  
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
    
    getDownloadUrl: async (id: string): Promise<string> => {
      try {
        // Get a binary file directly instead of using tokens
        // This uses axios which correctly sends auth cookies
        const response = await axiosInstance.get(`/api/recordings/${id}/download`, {
          headers: getAuthHeader(),
          responseType: 'blob'
        });
        
        // Create a blob URL that can be used directly without auth
        const blob = new Blob([response.data], { type: response.headers['content-type'] || 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        
        // Return the blob URL which doesn't need auth
        return url;
      } catch (error) {
        console.error('Error getting download URL:', error);
        // Return a special error indicator
        return 'error:failed-to-get-recording';
      }
    },
    
    update: async (id: string, data: { title: string }): Promise<RecordingI> => {
      const response = await axiosInstance.put(`/api/recordings/${id}`, data, {
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
      
      // Log network status to help with debugging
      console.log('Network status:', navigator.onLine ? 'online' : 'offline');
      
      // Create a new EventSource with the appropriate URL
      // withCredentials ensures auth cookies are sent
      eventSourceInstance = new EventSource(eventUrl, { withCredentials: true });
      
      // Handle connection events
      eventSourceInstance.onopen = () => {
        console.log('SSE connection established');
      };
      
      eventSourceInstance.onerror = (error) => {
        console.error('SSE connection error:', error);
        console.log('EventSource readyState:', eventSourceInstance?.readyState);
        
        // Auto-reconnect if closed or in error state
        if (!eventSourceInstance || 
            eventSourceInstance.readyState === EventSource.CLOSED || 
            eventSourceInstance.readyState === EventSource.CONNECTING) {
          console.log('Attempting to reconnect in 3 seconds...');
          
          // Close the existing connection if it's still around
          if (eventSourceInstance) {
            eventSourceInstance.close();
          }
          
          eventSourceInstance = null;
          
          // Try to reconnect after a delay
          setTimeout(() => {
            console.log('Reconnecting to SSE...');
            api.events.connect();
          }, 3000);
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