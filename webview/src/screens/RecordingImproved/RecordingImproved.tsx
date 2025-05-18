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
  
  // Start recording when component mounts
  useEffect(() => {
    console.log('[UI] Recording screen mounted, starting recording');
    const startRecording = async () => {
      if (onStartRecording) {
        try {
          console.log('[UI] Calling API to start recording');
          const id = await onStartRecording();
          console.log(`[UI] Recording started with ID: ${id}`);
          setRecordingId(id);
          setIsRecording(true);
          setError(null);
        } catch (err) {
          console.error('[UI] Failed to start recording:', err);
          setError('Failed to start recording. Please try again.');
        }
      }
    };
    
    startRecording();
  }, [onStartRecording]);
  
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
      setTranscriptText(update.text);
    }
  }, [recordingId]);
  
  useRealTimeEvents<TranscriptUpdate>('transcript:update', handleTranscriptUpdate);
  
  // Listen for recording status updates
  useRealTimeEvents('recording:status', (update: { id: string, status: RecordingStatusE }) => {
    if (update.id === recordingId) {
      // If recording completes or errors, we should go back
      if (update.status === RecordingStatusE.ERROR) {
        setError('Recording failed. Please try again.');
        if (onBack) onBack();
      }
    }
  });

  const handleBack = () => {
    if (onBack) onBack();
  };

  const handleStop = async () => {
    if (recordingId && onStop) {
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
      console.error('[UI] Cannot stop recording: recordingId or onStop function missing');
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