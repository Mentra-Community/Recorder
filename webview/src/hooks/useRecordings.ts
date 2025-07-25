/**
 * Custom hook for managing recordings
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../Api';
import { RecordingI, RecordingStatusE } from '../types/recording';
import { useRealTimeEvents } from './useRealTimeEvents';
import logger from '../utils/remoteLogger';

export interface UseRecordingsOptions {
  autoRefresh?: boolean;
}

export function useRecordings(options: UseRecordingsOptions = {}) {
  const [recordings, setRecordings] = useState<RecordingI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [sessionConnected, setSessionConnected] = useState<boolean | null>(null);
  const [sessionCheckLoading, setSessionCheckLoading] = useState(false);
  
  // Track if we need to refresh when returning to the list
  const needsRefresh = useRef(false);
  
  // Track if we're currently starting a recording to prevent duplicates
  const startingRecording = useRef(false);
  
  // Fetch session status - only when explicitly called
  const checkSessionStatus = useCallback(async () => {
    try {
      setSessionCheckLoading(true);
      const response = await fetch('/api/session/is-connected');
      if (!response.ok) {
        throw new Error('Failed to check session status');
      }
      const data = await response.json();
      setSessionConnected(data.connected);
      return data.connected;
    } catch (err) {
      console.error('Error checking session status:', err);
      setSessionConnected(false);
      return false;
    } finally {
      setSessionCheckLoading(false);
    }
  }, []);

  // Fetch all recordings - simple implementation
  const fetchRecordings = useCallback(async () => {
    try {
      setLoading(true);
      needsRefresh.current = false;
      const data = await api.recordings.getAll();
      setRecordings(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching recordings:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch recordings'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load - just fetch once
  useEffect(() => {
    // Use the function references directly inside the effect
    // This ensures we only run this once when the component mounts
    fetchRecordings();
    checkSessionStatus();
    
    // Empty dependency array ensures this only runs once
  }, []);

  // Listen for real-time updates to recording status
  useRealTimeEvents('recording-status', (updatedRecording: any) => {
    setRecordings((prevRecordings) => {
      // Find if we already have this recording
      const index = prevRecordings.findIndex((r) => r.id === updatedRecording.id);
      
      if (index >= 0) {
        // Update existing recording with new status
        const newRecordings = [...prevRecordings];
        newRecordings[index] = { 
          ...newRecordings[index], 
          ...updatedRecording,
          status: updatedRecording.status,
          isRecording: updatedRecording.status === RecordingStatusE.RECORDING
        };
        return newRecordings;
      } else if (
        updatedRecording.status === RecordingStatusE.RECORDING || 
        updatedRecording.status === RecordingStatusE.STOPPING ||
        updatedRecording.status === RecordingStatusE.COMPLETED
      ) {
        // Add new recording if it's in one of the valid states
        // Fetch the full recording to make sure we have all properties
        fetchRecordings();
        return prevRecordings;
      }
      return prevRecordings;
    });
  });

  // Listen for recording deletion
  useRealTimeEvents<{ id: string }>('recording-deleted', (data) => {
    setRecordings((prevRecordings) => prevRecordings.filter((r) => r.id !== data.id));
  });
  
  // Listen for refresh signals
  useRealTimeEvents('recordings-refresh', () => {
    console.log('[RECORDINGS] Received refresh signal');
    needsRefresh.current = true;
    
    // Immediately refresh if user is on recordings list
    // For other screens, we will refresh when they navigate back to the list
    if (window.location.pathname === '/' || window.location.pathname === '/recordings') {
      fetchRecordings();
    }
  });

  // Start a new recording
  const startRecording = useCallback(async (): Promise<string> => {
    // Prevent multiple simultaneous start attempts
    if (startingRecording.current) {
      logger.warn('[useRecordings] Already starting a recording, skipping duplicate attempt');
      throw new Error('Already starting a recording');
    }
    
    logger.log('[useRecordings] Setting startingRecording flag to true');
    startingRecording.current = true;
    
    try {
      // Check session status first
      logger.log('[useRecordings] Checking session status before starting recording');
      const isConnected = await checkSessionStatus();
      if (!isConnected) {
        logger.error('[useRecordings] No active session, throwing error');
        throw new Error('No active AugmentOS SDK session. Please ensure your glasses are connected.');
      }
      
      const sessionId = `session_${Date.now()}`;
      logger.log(`[useRecordings] Making API call to start recording with sessionId: ${sessionId}`);
      const recordingId = await api.recordings.startRecording(sessionId);
      logger.log(`[useRecordings] Recording started successfully with ID: ${recordingId}`);
      return recordingId;
    } catch (err) {
      logger.error('[useRecordings] Error starting recording:', err);
      logger.error('[useRecordings] Error type:', typeof err);
      logger.error('[useRecordings] Error message:', err instanceof Error ? err.message : String(err));
      
      // Special handling for session errors
      if (err instanceof Error && err.message.includes('No active AugmentOS SDK session')) {
        setSessionConnected(false);
      }
      
      // Special handling for already recording error - don't set this as a general error
      if (err instanceof Error && err.message.includes('already has an active recording')) {
        logger.warn('[useRecordings] User already has an active recording, not setting general error state');
        throw err; // Still throw so caller can handle it
      }
      
      setError(err instanceof Error ? err : new Error('Failed to start recording'));
      throw err;
    } finally {
      logger.log('[useRecordings] Setting startingRecording flag to false');
      startingRecording.current = false;
    }
  }, [checkSessionStatus]);

  // Stop recording
  const stopRecording = useCallback(async (id: string): Promise<void> => {
    try {
      await api.recordings.stopRecording(id);
      // Mark that we need a refresh when navigating back to the list
      needsRefresh.current = true;
      
      // Update the local state to show stopping status
      setRecordings(prevRecordings => 
        prevRecordings.map(rec => 
          rec.id === id ? { 
            ...rec, 
            status: RecordingStatusE.STOPPING,
            isRecording: false 
          } : rec
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to stop recording'));
      console.error('Error stopping recording:', err);
      throw err;
    }
  }, []);
  
  // Check if we need to refresh
  const checkRefreshNeeded = useCallback((): boolean => {
    if (needsRefresh.current) {
      fetchRecordings();
      return true;
    }
    return false;
  }, [fetchRecordings]);

  // Delete recording
  const deleteRecording = useCallback(async (id: string): Promise<void> => {
    try {
      await api.recordings.delete(id);
      setRecordings((prevRecordings) => prevRecordings.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to delete recording'));
      console.error('Error deleting recording:', err);
      throw err;
    }
  }, []);

  // Rename recording
  const renameRecording = useCallback(async (id: string, title: string): Promise<void> => {
    try {
      // Use the axiosInstance from api instead of raw fetch
      const response = await api.recordings.update(id, { title });
      const updatedRecording = response;
      
      setRecordings((prevRecordings) => 
        prevRecordings.map((rec) => 
          rec.id === id ? { 
            ...updatedRecording, 
            createdAt: new Date(updatedRecording.createdAt).getTime(),
            updatedAt: new Date(updatedRecording.updatedAt).getTime()
          } : rec
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to rename recording'));
      console.error('Error renaming recording:', err);
      throw err;
    }
  }, []);

  // Get playback URL for in-app audio player
  const getPlaybackUrl = useCallback(async (id: string): Promise<string> => {
    return api.recordings.getPlaybackUrl(id);
  }, []);

  // Get download URL for external download (opens in browser)
  const getDownloadUrl = useCallback(async (id: string): Promise<string> => {
    return api.recordings.getDownloadUrl(id);
  }, []);

  return {
    recordings,
    loading,
    error,
    sessionConnected,
    sessionCheckLoading,
    fetchRecordings,
    startRecording,
    stopRecording,
    deleteRecording,
    renameRecording,
    getPlaybackUrl,
    getDownloadUrl,
    checkSessionStatus,
    checkRefreshNeeded
  };
}