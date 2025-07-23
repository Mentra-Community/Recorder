/**
 * Centralized API for all server communication
 */

import axios from 'axios';
import { RecordingI } from './types';
import logger from './utils/remoteLogger';

/**
 * Get the backend URL from environment variables
 */
export const getBackendUrl = (): string => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://isaiah-tpa.ngrok.app';
  return backendUrl.replace(/\/$/, ''); // Remove trailing slash
};

// Use backend URL for production, proxy for development
const API_BASE_URL = import.meta.env.DEV ? '' : getBackendUrl();

// Store the current frontend token for API calls
let currentFrontendToken: string | null = null;

// Function to set the frontend token from MentraOS auth
export const setFrontendToken = (token: string | null): void => {
  currentFrontendToken = token;
};

// Create axios instance
const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  // Include credentials for cookie-based auth from MentraOS SDK
  withCredentials: true,
});

// Add response interceptor for debugging
axiosInstance.interceptors.response.use(
  (response) => {
    logger.debug(`[API] Response ${response.config.method?.toUpperCase()} ${response.config.url} - Status: ${response.status}`);
    return response;
  },
  (error) => {
    if (axios.isAxiosError(error)) {
      logger.error(`[API] Error ${error.config?.method?.toUpperCase()} ${error.config?.url} - Status: ${error.response?.status}`);
      logger.error('[API] Error response:', error.response?.data);
    }
    return Promise.reject(error);
  }
);

// Get auth headers with MentraOS frontend token
const getAuthHeader = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  
  // Add MentraOS frontend token if available
  if (currentFrontendToken) {
    headers['Authorization'] = `Bearer ${currentFrontendToken}`;
  }
  
  return headers;
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
      return response.data.map((recording: RecordingI) => ({
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
      logger.log(`[API] Starting recording with sessionId: ${sessionId}`);
      logger.log('[API] Auth headers:', JSON.stringify(getAuthHeader()));
      
      try {
        const response = await axiosInstance.post('/api/recordings/start', { sessionId }, {
          headers: getAuthHeader()
        });
        
        logger.log(`[API] Start recording response status: ${response.status}`);
        logger.log(`[API] Start recording response data:`, response.data);
        
        return response.data.id;
      } catch (error) {
        logger.error('[API] Start recording request failed:', error);
        if (axios.isAxiosError(error)) {
          logger.error('[API] Response status:', error.response?.status);
          logger.error('[API] Response data:', error.response?.data);
          logger.error('[API] Response headers:', error.response?.headers);
        }
        throw error;
      }
    },
    
    stopRecording: async (id: string): Promise<void> => {
      await axiosInstance.post(`/api/recordings/${id}/stop`, {}, {
        headers: getAuthHeader()
      });
    },
    
    getPlaybackUrl: async (id: string): Promise<string> => {
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
        console.error('Error getting playback URL:', error);
        // Return a special error indicator
        return 'error:failed-to-get-recording';
      }
    },
    
    getDownloadUrl: async (id: string): Promise<string> => {
      try {
        console.log(`[API] Requesting download token for recording ${id}`);
        
        // Add a timestamp to prevent caching
        const cacheBuster = Date.now();
        
        // Get a signed download token from the API with fresh credentials
        const response = await axiosInstance.get(`/api/recordings/${id}/download-token?t=${cacheBuster}`, {
          headers: getAuthHeader()
        });
        
        // Log token details for debugging
        const expiresAt = response.data.expiresAt ? new Date(response.data.expiresAt).toISOString() : 'unknown';
        console.log(`[API] Received download token. Expires at: ${expiresAt}`);
        console.log(`[API] Token length: ${response.data.token ? response.data.token.length : 0}`);
        
        // The token is already URL-safe from the server
        // No need to use encodeURIComponent on the token itself
        const token = response.data.token;
        
        // Construct absolute URL with origin
        const origin = window.location.origin;
        // This URL will be opened in an external browser
        const downloadUrl = `${origin}/api/recordings/${id}/download-by-token?token=${token}`;
        
        console.log(`[API] Created download URL (length: ${downloadUrl.length})`);
        return downloadUrl;
      } catch (error) {
        console.error('[API] Error getting download URL:', error);
        // Fallback to direct download URL (may not work in browser)
        const origin = window.location.origin;
        const directUrl = `${origin}/api/recordings/${id}/download`;
        console.log(`[API] Using fallback direct download URL: ${directUrl}`);
        return directUrl;
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
        console.log('[API] SSE already connected, reusing existing connection');
        return eventSourceInstance;
      }
      
      // Build SSE URL with frontend token for authentication (like Flash app)
      const baseUrl = import.meta.env.DEV ? '' : getBackendUrl();
      let eventUrl = `${baseUrl}/api/events`;
      
      // Add frontend token as query parameter if available
      if (currentFrontendToken) {
        eventUrl += `?token=${encodeURIComponent(currentFrontendToken)}`;
      }
      
      console.log('Connecting to SSE at:', eventUrl.replace(/token=[^&]+/, 'token=***'));
      
      // Log network status to help with debugging
      console.log('Network status:', navigator.onLine ? 'online' : 'offline');
      console.log('Frontend token available:', !!currentFrontendToken);
      
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