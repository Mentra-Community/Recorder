import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, Square, Mic } from 'lucide-react';
import { useRealTimeEvents } from '../../hooks/useRealTimeEvents';
import { RecordingStatusE } from '../../types/recording';
import { formatDuration } from '../../utils/formatters';
import api from '../../Api';
import logger from '../../utils/remoteLogger';
import axios from 'axios';

interface RecordingImprovedProps {
  onBack?: () => void;
  onStop?: (recordingId: string) => Promise<void>;
  onStartRecording?: () => Promise<string>;
}

interface TranscriptUpdate {
  recordingId: string;
  text: string;
  timestamp: number;
  isInterim?: boolean;
}

type RecordingState = 'loading' | 'ready-to-record' | 'starting' | 'recording' | 'stopping' | 'error';

const RecordingImproved: React.FC<RecordingImprovedProps> = ({ 
  onBack, 
  onStop,
  onStartRecording 
}) => {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>('loading');

  // Debug state changes
  useEffect(() => {
    logger.debug(`[UI] Recording state changed to: ${recordingState}, recordingId: ${recordingId}`);
  }, [recordingState, recordingId]);
  
  // Listen for recordings that were started by voice
  useRealTimeEvents('recording-started-by-voice', (data: { id: string, timestamp: number }) => {
    console.log(`[UI] [DEBUG] Recording started by voice command: ${data.id}`);
    
    if (recordingState !== 'recording') {
      console.log(`[UI] [DEBUG] Using voice-started recording ID: ${data.id}`);
      setRecordingId(data.id);
      setRecordingState('recording');
      setRecordingStartTime(data.timestamp);
      setError(null);
      
      // Fetch initial transcript for this recording
      fetchInitialTranscript(data.id);
    } else if (recordingId !== data.id) {
      console.log(`[UI] [DEBUG] ⚠️ Voice command started a different recording (${data.id}) than what we have (${recordingId})`);
    }
  });
  
  // Helper function to fetch initial transcript
  const fetchInitialTranscript = useCallback(async (id: string) => {
    try {
      console.log(`[UI] [DEBUG] Getting initial transcript for recording ${id}`);
      const recording = await api.recordings.getById(id);
      console.log(`[UI] [DEBUG] Initial transcript: "${recording.transcript}"`);
      if (recording.transcript) {
        setTranscriptText(recording.transcript);
      }
      
      // Set recording start time for timer calculation
      if (recording.createdAt) {
        setRecordingStartTime(recording.createdAt);
      }
    } catch (err) {
      console.error(`[UI] [DEBUG] Error fetching initial transcript:`, err);
    }
  }, []);

  // Prevent multiple simultaneous recording attempts
  const startingRecording = useRef(false);

  // First check if there's already an active recording when component mounts
  useEffect(() => {
    const checkActiveRecording = async () => {
      try {
        logger.log('[UI] Checking for active recording on mount');
        const recordings = await api.recordings.getAll();
        const activeRecording = recordings.find(r => r.isRecording);
        
        if (activeRecording) {
          logger.log(`[UI] Found active recording: ${activeRecording.id}`);
          setRecordingId(activeRecording.id);
          setRecordingStartTime(activeRecording.createdAt);
          setTranscriptText(activeRecording.transcript || "");
          setRecordingState('recording');
          
          // Fetch the latest transcript
          fetchInitialTranscript(activeRecording.id);
        } else {
          logger.log('[UI] No active recording found, will start new one');
          setRecordingState('ready-to-record');
        }
      } catch (error) {
        logger.error('[UI] Error checking for active recording:', error);
        setRecordingState('ready-to-record');
      }
    };
    
    checkActiveRecording();
  }, [fetchInitialTranscript]);

  // Auto-start recording when component is ready and no recording exists
  useEffect(() => {
    let isMounted = true;
    
    // Only auto-start if we're in ready-to-record state
    if (recordingState !== 'ready-to-record') {
      return;
    }
    
    logger.log('[UI] Ready to record - will auto-start recording');
    
    // Add delay to prevent race conditions
    const startDelay = setTimeout(() => {
      if (!isMounted || recordingState !== 'ready-to-record') {
        return;
      }
      
      const autoStartRecording = async () => {
        if (!onStartRecording) {
          logger.debug('[UI] No onStartRecording function provided');
          return;
        }
        
        // Prevent multiple simultaneous start attempts
        if (startingRecording.current) {
          logger.warn('[UI] Already starting recording, skipping duplicate attempt');
          return;
        }
        
        // Double-check we don't have a recording ID
        if (recordingId) {
          logger.debug('[UI] Already have recording ID, not starting new one');
          return;
        }
        
        logger.log('[UI] Setting startingRecording flag to true');
        startingRecording.current = true;
        setRecordingState('starting');
        
        try {
          logger.log('[UI] About to call onStartRecording to auto-start');
          const id = await onStartRecording();
          
          if (!isMounted) {
            logger.debug('[UI] Component unmounted during start');
            return;
          }
          
          logger.log(`[UI] Auto-started recording with ID: ${id}`);
          setRecordingId(id);
          setRecordingStartTime(Date.now());
          setTranscriptText("");
          setRecordingState('recording');
        } catch (err) {
          logger.error('[UI] Error auto-starting recording:', err);
          
          if (!isMounted) {
            logger.debug('[UI] Component unmounted during error handling');
            return;
          }
          
          // For 409 errors, try to fetch the active recording
          if (axios.isAxiosError(err) && err.response?.status === 409) {
            logger.warn('[UI] Got 409 error - checking for existing recording');
            try {
              const recordings = await api.recordings.getAll();
              const activeRecording = recordings.find(r => r.isRecording);
              if (activeRecording) {
                logger.log(`[UI] Found existing active recording: ${activeRecording.id}`);
                setRecordingId(activeRecording.id);
                setRecordingStartTime(activeRecording.createdAt);
                setTranscriptText(activeRecording.transcript || "");
                setRecordingState('recording');
                fetchInitialTranscript(activeRecording.id);
                return;
              }
            } catch (fetchError) {
              logger.error('[UI] Error fetching recordings after 409:', fetchError);
            }
          }
          
          // For any other error, show ready-to-record state
          setRecordingState('ready-to-record');
          setError(null); // Don't show error on auto-start failure
        } finally {
          logger.log('[UI] Setting startingRecording flag to false');
          startingRecording.current = false;
        }
      };
      
      autoStartRecording();
    }, 500); // Slightly longer delay to ensure proper state
    
    return () => {
      isMounted = false;
      clearTimeout(startDelay);
    };
  }, [recordingState, recordingId, onStartRecording, fetchInitialTranscript]); // Dependencies for auto-start
  
  // Update recording timer based on actual start time
  useEffect(() => {
    if (recordingState !== 'recording' || !recordingStartTime) {
      return;
    }
    
    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      setRecordingTime(elapsed);
    };
    
    // Update immediately
    updateTimer();
    
    // Update every second
    const timer = setInterval(updateTimer, 1000);
    
    return () => {
      clearInterval(timer);
    };
  }, [recordingState, recordingStartTime]);
  
  // Listen for real-time transcript updates
  const handleTranscriptUpdate = useCallback((update: TranscriptUpdate) => {
    if (update.recordingId === recordingId) {
      console.log(`[UI] [DEBUG] Received transcript update for ${recordingId}: "${update.text}" (${update.isInterim ? 'interim' : 'final'})`);
      setTranscriptText(update.text);
      
      // If this is an interim transcript, we could show it differently (e.g., italics)
      // but for now we'll just display it the same way
    }
  }, [recordingId]);
  
  useRealTimeEvents<TranscriptUpdate>('transcript', handleTranscriptUpdate);
  
  // Handle start recording button click
  const handleStartRecording = useCallback(async () => {
    if (recordingState !== 'ready-to-record' || !onStartRecording) {
      console.log('[UI] [DEBUG] Cannot start recording:', { recordingState, hasStartFunction: !!onStartRecording });
      return;
    }
    
    // Prevent multiple simultaneous start attempts
    if (startingRecording.current) {
      console.log('[UI] [DEBUG] Already starting recording via button, skipping duplicate');
      return;
    }
    
    startingRecording.current = true;
    setRecordingState('starting');
    setError(null);
    
    try {
      console.log('[UI] Starting new recording via button click');
      const id = await onStartRecording();
      console.log(`[UI] Recording started with ID: ${id}`);
      
      setRecordingId(id);
      setRecordingStartTime(Date.now());
      setTranscriptText(""); // Clear any old transcript
      setRecordingState('recording');
      
      console.log(`[UI] [DEBUG] Successfully started recording, state should be 'recording'`);
    } catch (err) {
      console.error('[UI] Failed to start recording:', err);
      
      if (err instanceof Error && err.message.includes('already has an active recording')) {
        console.log('[UI] User already has an active recording, showing error to user');
        setError('You have an active recording from a previous session. Please go back and stop it first.');
      } else {
        setError('Failed to start recording. Please try again.');
      }
      
      setRecordingState('error');
    } finally {
      startingRecording.current = false;
    }
  }, [recordingState, onStartRecording]);
  
  // Listen for recording status updates
  useRealTimeEvents('recording-status', (update: { id: string, status: RecordingStatusE }) => {
    console.log(`[RECORDING] [DEBUG] Received recording status update for ${update.id}: ${update.status}`);
    console.log(`[RECORDING] [DEBUG] Current recordingId: ${recordingId}, current state: ${recordingState}`);
    
    if (update.id === recordingId) {
      console.log(`[RECORDING] [DEBUG] Status update matches current recording`);
      
      if (update.status === RecordingStatusE.RECORDING && recordingState !== 'recording') {
        console.log(`[RECORDING] [DEBUG] Backend confirms recording is active, updating to recording state`);
        setRecordingState('recording');
      } else if (update.status === RecordingStatusE.STOPPING) {
        setRecordingState('stopping');
      } else if (update.status === RecordingStatusE.ERROR) {
        console.log(`[RECORDING] [DEBUG] Recording error detected`);
        setError('Recording failed. Please try again.');
        setRecordingState('error');
      } else if (update.status === RecordingStatusE.COMPLETED) {
        console.log(`[RECORDING] [DEBUG] Recording completed via SSE notification`);
        setRecordingState('ready-to-record');
        // Navigate back after a short delay to show completion
        setTimeout(() => {
          if (onBack) onBack();
        }, 1000);
      }
    }
  });
  
  // Listen specifically for voice commands to stop recording
  useRealTimeEvents('voice-command', (data: { command: string, timestamp: number }) => {
    console.log(`[RECORDING] [DEBUG] Received voice command: ${data.command}`);
    
    if (data.command === 'stop-recording' && recordingState === 'recording') {
      console.log(`[RECORDING] [DEBUG] Voice command to stop recording received`);
      console.log(`[RECORDING] [DEBUG] ⚠️ Not calling API to stop recording - backend is handling it`);
      // Don't call API here - backend is already handling the stop
      // Just update the UI state to show stopping
      setRecordingState('stopping');
    }
  });
  
  // Listen for voice-initiated recording stop events
  useRealTimeEvents('recording-stopped-by-voice', (data: { id: string, timestamp: number }) => {
    console.log(`[RECORDING] [DEBUG] Recording stopped by voice command: ${data.id}`);
    
    if (data.id === recordingId) {
      console.log(`[RECORDING] [DEBUG] ⚠️ This matches our current recording - navigating back`);
      setRecordingState('ready-to-record');
      // Navigate back to the list since the recording was stopped by voice command
      if (onBack) {
        setTimeout(() => {
          console.log(`[RECORDING] [DEBUG] Navigating back to list after voice stop`);
          onBack();
        }, 500);
      }
    }
  });

  const handleBack = () => {
    if (onBack) onBack();
  };

  const handleStop = async () => {
    if (recordingId && onStop && recordingState === 'recording') {
      setRecordingState('stopping');
      try {
        console.log(`[UI] Stopping recording with ID: ${recordingId}`);
        await onStop(recordingId);
        console.log('[UI] Recording stopped successfully');
        // The state will be updated by SSE events, we'll navigate back then
      } catch (err) {
        console.error('[UI] Failed to stop recording:', err);
        setError('Failed to stop recording. Please try again.');
        setRecordingState('error');
        
        // Still show a message to the user that we're navigating away
        setTimeout(() => {
          if (onBack) {
            console.log('[UI] Navigating back despite error');
            onBack();
          }
        }, 2000);
      }
    } else {
      console.log('[UI] Not stopping recording: ' + 
        (!recordingId ? 'No recordingId. ' : '') + 
        (!onStop ? 'No onStop function. ' : '') + 
        (recordingState !== 'recording' ? 'Not currently recording. ' : ''));
      
      if (onBack) {
        onBack(); // Navigate back if we can't stop properly
      }
    }
  };
  
  // Loading state
  if (recordingState === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-gray-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-gray-600">Initializing recording...</div>
        </div>
      </div>
    );
  }

  // Error state
  if (recordingState === 'error' || error) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">{error || 'An error occurred'}</div>
          <button 
            className="px-4 py-2 bg-gray-200 rounded" 
            onClick={handleBack}
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Ready to record state - show start button
  if (recordingState === 'ready-to-record') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-gray-50">
          <div className="flex items-center">
            <button className="text-gray-600 mr-2" onClick={handleBack}>
              <ChevronLeft size={24} />
            </button>
            <h1 className="text-xl font-medium">Recording</h1>
          </div>
        </header>
        
        {/* Ready to record content */}
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="text-center mb-8">
            <Mic size={48} className="text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-medium text-gray-800 mb-2">Ready to Record</h2>
            <p className="text-gray-600">Tap the button below to start recording audio</p>
          </div>
          
          {/* Start recording button */}
          <button
            className="w-20 h-20 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors"
            onClick={handleStartRecording}
          >
            <Mic size={32} />
          </button>
        </div>
      </div>
    );
  }

  // Starting state
  if (recordingState === 'starting') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-gray-300 border-t-red-600 rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-gray-600">Starting recording...</div>
        </div>
      </div>
    );
  }
  
  // Recording or stopping state - show recording interface
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      {/* Header with title and actions */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-gray-50">
        <div className="flex items-center">
          <button className="text-gray-600 mr-2" onClick={handleBack}>
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-medium">Recording</h1>
        </div>
        <div className="flex items-center space-x-5" />
      </header>
      
      {/* Large Timer Display with accent background */}
      <div className="px-4 py-8 border-b border-gray-300 flex flex-col items-center justify-center bg-gray-100">
        <div className="flex items-center mb-2">
          <Mic size={24} className={`mr-3 ${recordingState === 'recording' ? 'text-red-500' : 'text-gray-400'}`} />
          <div className="text-4xl font-mono font-medium text-gray-800">
            {formatDuration(recordingTime)}
          </div>
        </div>
        <div className="text-sm text-gray-500 mt-1">
          {recordingState === 'recording' ? 'Recording in progress' : 'Stopping recording...'}
        </div>
      </div>
      
      {/* Live transcript text with English indicator inline */}
      <div className="px-4 py-4 flex-1 overflow-y-auto bg-gray-50">
        <div className="flex items-center mb-2">
          <h3 className="text-sm font-medium text-gray-600 uppercase mr-3">Live Transcript</h3>
          <span className="text-xs text-gray-400">English (US)</span>
        </div>
        <p className="text-gray-800 leading-relaxed">
          {transcriptText || "Waiting for transcript..."}
        </p>
      </div>
      
      {/* Recording controls at bottom */}
      <div className="fixed bottom-0 left-0 right-0 pb-6 pt-3 bg-gray-50 flex flex-col items-center border-t border-gray-300">
        <button
          className={`w-16 h-16 rounded-full text-white flex items-center justify-center shadow-md transition-colors ${
            recordingState === 'stopping' 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-red-500 hover:bg-red-600'
          }`}
          onClick={handleStop}
          disabled={recordingState === 'stopping'}
        >
          {recordingState === 'stopping' ? (
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <Square size={24} />
          )}
        </button>
      </div>
    </div>
  );
};

export default RecordingImproved;