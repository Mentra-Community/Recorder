import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, Share, Download, Trash2, Square, Mic } from 'lucide-react';
import { useRealTimeEvents } from '../../hooks/useRealTimeEvents';
import { RecordingStatusE } from '../../types/recording';
import { formatDuration } from '../../utils/formatters';

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

const RecordingImproved: React.FC<RecordingImprovedProps> = ({ 
  onBack, 
  onStop,
  onStartRecording 
}) => {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  
  // Listen for recordings that were started by voice
  useRealTimeEvents('recording-started-by-voice', (data: { id: string, timestamp: number }) => {
    console.log(`[UI] [DEBUG] Recording started by voice command: ${data.id}`);
    
    // If we don't have a recording ID yet, use this one
    if (!recordingId) {
      console.log(`[UI] [DEBUG] Using voice-started recording ID: ${data.id}`);
      setRecordingId(data.id);
      setIsRecording(true);
      setError(null);
      setInitialized(true); // Mark as initialized so we don't start a new recording
    } else if (recordingId !== data.id) {
      console.log(`[UI] [DEBUG] ⚠️ Voice command started a different recording (${data.id}) than what we have (${recordingId})`);
    }
  });
  
  // Track whether we've handled initialization
  const [initialized, setInitialized] = useState(false);
  
  // Start recording when component mounts
  useEffect(() => {
    // Skip if we've already initialized (e.g., from voice command)
    if (initialized) {
      console.log('[UI] [DEBUG] Component already initialized, skipping startup');
      return;
    }
    
    console.log('[UI] Recording screen mounted');
    
    // Set a small delay to allow voice command events to arrive first
    // This helps resolve the race condition between mount and voice command events
    const initializationDelay = setTimeout(async () => {
      // Look for any existing active recording first (that might have been started by voice)
      const checkExistingRecordings = async () => {
        try {
          console.log('[UI] [DEBUG] Checking for existing active recordings');
          const recordings = await fetch('/api/recordings').then(res => res.json());
          const activeRecording = recordings.find((r: any) => r.isRecording === true);
          
          if (activeRecording) {
            console.log(`[UI] [DEBUG] Found active recording: ${activeRecording.id}`);
            setRecordingId(activeRecording.id);
            setIsRecording(true);
            setError(null);
            setInitialized(true);
            return true;
          }
          return false;
        } catch (err) {
          console.error('[UI] [DEBUG] Error checking existing recordings:', err);
          return false;
        }
      };
      
      // Skip if we already have a recordingId (e.g., from voice command)
      if (recordingId) {
        console.log(`[UI] [DEBUG] Already have recording ID ${recordingId}, skipping new recording creation`);
        setInitialized(true);
        return;
      }
      
      const startRecording = async () => {
        if (onStartRecording) {
          try {
            // First check if there's already an active recording
            const hasExisting = await checkExistingRecordings();
            if (hasExisting) {
              console.log('[UI] [DEBUG] Using existing active recording, not starting a new one');
              return;
            }
            
            console.log('[UI] [DEBUG] No active recordings found, starting a new one');
            console.log('[UI] Calling API to start recording');
            const id = await onStartRecording();
            console.log(`[UI] Recording started with ID: ${id}`);
            setRecordingId(id);
            setIsRecording(true);
            setError(null);
            setInitialized(true);
          } catch (err) {
            console.error('[UI] Failed to start recording:', err);
            setError('Failed to start recording. Please try again.');
          }
        }
      };
      
      startRecording();
    }, 200); // Small delay to let SSE events arrive first
    
    return () => {
      clearTimeout(initializationDelay);
    };
  }, [onStartRecording, recordingId, initialized]);
  
  // Update recording timer
  useEffect(() => {
    if (!isRecording) {
      return;
    }
    
    const timer = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
    
    return () => {
      clearInterval(timer);
    };
  }, [isRecording]);
  
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
  
  // Get the initial transcript when the recording ID is set
  useEffect(() => {
    if (recordingId) {
      console.log(`[UI] [DEBUG] Getting initial transcript for recording ${recordingId}`);
      // Fetch the recording to get its current transcript
      fetch(`/api/recordings/${recordingId}`)
        .then(res => res.json())
        .then(recording => {
          console.log(`[UI] [DEBUG] Initial transcript: "${recording.transcript}"`);
          if (recording.transcript) {
            setTranscriptText(recording.transcript);
          }
        })
        .catch(err => {
          console.error(`[UI] [DEBUG] Error fetching initial transcript:`, err);
        });
    }
  }, [recordingId]);
  
  // Listen for recording status updates
  useRealTimeEvents('recording:status', (update: { id: string, status: RecordingStatusE }) => {
    console.log(`[RECORDING] [DEBUG] Received recording status update for ${update.id}: ${update.status}`);
    console.log(`[RECORDING] [DEBUG] Current recordingId: ${recordingId}`);
    
    if (update.id === recordingId) {
      console.log(`[RECORDING] [DEBUG] Status update matches current recording`);
      // If recording completes or errors, we should go back
      if (update.status === RecordingStatusE.ERROR) {
        console.log(`[RECORDING] [DEBUG] Recording error detected`);
        setError('Recording failed. Please try again.');
        if (onBack) onBack();
      } else if (update.status === RecordingStatusE.COMPLETED) {
        console.log(`[RECORDING] [DEBUG] Recording completed via SSE notification`);
        // This means the recording was already stopped on the backend
      }
    }
  });
  
  // Listen specifically for voice commands to stop recording
  useRealTimeEvents('voice-command', (data: { command: string, timestamp: number }) => {
    console.log(`[RECORDING] [DEBUG] Received voice command: ${data.command}`);
    
    if (data.command === 'stop-recording' && isRecording) {
      console.log(`[RECORDING] [DEBUG] Voice command to stop recording received`);
      console.log(`[RECORDING] [DEBUG] ⚠️ Not calling API to stop recording - backend is handling it`);
      // Don't call API here - backend is already handling the stop
      // Just update the UI state to show stopping
      setIsRecording(false);
    }
  });
  
  // Listen for voice-initiated recording stop events
  useRealTimeEvents('recording-stopped-by-voice', (data: { id: string, timestamp: number }) => {
    console.log(`[RECORDING] [DEBUG] Recording stopped by voice command: ${data.id}`);
    
    if (data.id === recordingId) {
      console.log(`[RECORDING] [DEBUG] ⚠️ This matches our current recording - navigating back`);
      setIsRecording(false);
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
    if (recordingId && onStop && isRecording) {
      setIsRecording(false);
      try {
        console.log(`[UI] Stopping recording with ID: ${recordingId}`);
        await onStop(recordingId);
        console.log('[UI] Recording stopped successfully');
      } catch (err) {
        console.error('[UI] Failed to stop recording:', err);
        setError('Failed to stop recording. Please try again.');
        
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
        (!isRecording ? 'Not currently recording. ' : ''));
      
      if (onBack) {
        onBack(); // Navigate back if we can't stop properly
      }
    }
  };
  
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">{error}</div>
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
        <div className="flex items-center space-x-5">
          <button className="text-gray-600" disabled={true}>
            <Share size={22} className="opacity-50" />
          </button>
          <button className="text-gray-600" disabled={true}>
            <Download size={22} className="opacity-50" />
          </button>
          <button className="text-gray-600" disabled={true}>
            <Trash2 size={22} className="opacity-50" />
          </button>
        </div>
      </header>
      
      {/* Large Timer Display with accent background */}
      <div className="px-4 py-8 border-b border-gray-300 flex flex-col items-center justify-center bg-gray-100">
        <div className="flex items-center mb-2">
          <Mic size={24} className="text-red-500 mr-3" />
          <div className="text-4xl font-mono font-medium text-gray-800">
            {formatDuration(recordingTime)}
          </div>
        </div>
        <div className="text-sm text-gray-500 mt-1">Recording in progress</div>
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
          className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md"
          onClick={handleStop}
        >
          <Square size={24} />
        </button>
      </div>
    </div>
  );
};

export default RecordingImproved;