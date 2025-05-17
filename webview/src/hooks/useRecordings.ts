/**
 * Custom hook for managing recordings
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../Api';
import { RecordingI } from '../types/recording';
import { useRealTimeEvents } from './useRealTimeEvents';

export function useRecordings() {
  const [recordings, setRecordings] = useState<RecordingI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch all recordings
  const fetchRecordings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.recordings.getAll();
      setRecordings(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch recordings'));
      console.error('Error fetching recordings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchRecordings();
  }, [fetchRecordings]);

  // Listen for real-time updates
  useRealTimeEvents<RecordingI>('recording:update', (updatedRecording) => {
    setRecordings((prevRecordings) => {
      const index = prevRecordings.findIndex((r) => r.id === updatedRecording.id);
      if (index >= 0) {
        // Update existing recording
        const newRecordings = [...prevRecordings];
        newRecordings[index] = updatedRecording;
        return newRecordings;
      } else {
        // Add new recording
        return [updatedRecording, ...prevRecordings];
      }
    });
  });

  useRealTimeEvents<{ id: string }>('recording:delete', (data) => {
    setRecordings((prevRecordings) => prevRecordings.filter((r) => r.id !== data.id));
  });

  // Start a new recording
  const startRecording = useCallback(async (): Promise<string> => {
    try {
      const sessionId = `session_${Date.now()}`;
      const recordingId = await api.recordings.startRecording(sessionId);
      return recordingId;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to start recording'));
      console.error('Error starting recording:', err);
      throw err;
    }
  }, []);

  // Stop recording
  const stopRecording = useCallback(async (id: string): Promise<void> => {
    try {
      await api.recordings.stopRecording(id);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to stop recording'));
      console.error('Error stopping recording:', err);
      throw err;
    }
  }, []);

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

  // Get download URL
  const getDownloadUrl = useCallback((id: string): string => {
    return api.recordings.getDownloadUrl(id);
  }, []);

  return {
    recordings,
    loading,
    error,
    fetchRecordings,
    startRecording,
    stopRecording,
    deleteRecording,
    renameRecording,
    getDownloadUrl
  };
}