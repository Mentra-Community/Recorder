import React, { useState, useEffect } from 'react';
import RecordingsListImproved from './screens/RecordingsListImproved';
import RecordingImproved from './screens/RecordingImproved';
import PlaybackImproved from './screens/PlaybackImproved';
import { useRecordings } from './hooks/useRecordings';
import { RecordingI } from './types/recording';
import api from './Api';

type Screen = 'list' | 'recording' | 'playback';

const ImprovedApp: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>('list');
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [selectedRecording, setSelectedRecording] = useState<RecordingI | null>(null);
  
  // Use our custom hook to manage recordings
  const { 
    recordings, 
    loading, 
    error, 
    fetchRecordings,
    startRecording,
    stopRecording,
    deleteRecording,
    renameRecording,
    getDownloadUrl,
    checkRefreshNeeded,
    sessionConnected,
    checkSessionStatus
  } = useRecordings();
  
  // Listen for voice commands via SSE
  useEffect(() => {
    const handleVoiceCommand = (data: { command: string, timestamp: number }) => {
      console.log(`[APP] [DEBUG] Received voice command: ${data.command}, timestamp: ${data.timestamp}`);
      console.log(`[APP] [DEBUG] Current screen: ${currentScreen}`);
      
      if (data.command === 'start-recording') {
        console.log('[APP] [DEBUG] Voice command is starting a recording');
        if (currentScreen !== 'recording') {
          console.log('[APP] [DEBUG] Navigating to recording screen for voice-started recording');
          // IMPORTANT: The backend already created a recording via voice command
          // We just need to navigate to the recording screen, which will pick up the existing recording
          // Do NOT call startRecording() here - the RecordingImproved component will handle finding the active recording
          navigateToRecording();
        } else {
          console.log('[APP] [DEBUG] Already on recording screen, not navigating');
        }
      } else if (data.command === 'stop-recording' && currentScreen === 'recording') {
        console.log('[APP] [DEBUG] Voice command is stopping a recording');
        // The backend is already handling the stop recording action
        // The RecordingImproved component will handle UI state changes
        // DO NOT call stopRecording() here to avoid duplicate API calls
        console.log('[APP] [DEBUG] ⚠️ Received stop-recording command - this is just UI notification, backend already stopped recording');
      }
    };
    
    // Also listen for voice-stopped events
    const handleRecordingStopped = (data: { id: string, timestamp: number }) => {
      console.log(`[APP] [DEBUG] Received recording-stopped-by-voice event for recording: ${data.id}`);
      // This is confirmation that recording was stopped on backend
    };
    
    // Set up event listener using our centralized API
    console.log('[APP] [DEBUG] Setting up voice command listeners');
    api.events.connect(); // Ensure connection is established
    
    const voiceCommandListener = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[APP] [DEBUG] Processing voice-command event: ${JSON.stringify(data)}`);
        handleVoiceCommand(data);
      } catch (error) {
        console.error('[APP] [DEBUG] ⚠️ Error handling voice command event:', error);
      }
    };
    
    const recordingStoppedListener = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[APP] [DEBUG] Processing recording-stopped-by-voice event: ${JSON.stringify(data)}`);
        handleRecordingStopped(data);
      } catch (error) {
        console.error('[APP] [DEBUG] ⚠️ Error handling recording stopped event:', error);
      }
    };
    
    api.events.addEventListener('voice-command', voiceCommandListener);
    api.events.addEventListener('recording-stopped-by-voice', recordingStoppedListener);
    
    return () => {
      console.log('[APP] [DEBUG] Cleaning up voice command listeners');
      api.events.removeEventListener('voice-command', voiceCommandListener);
      api.events.removeEventListener('recording-stopped-by-voice', recordingStoppedListener);
    };
  }, [currentScreen]);

  // Navigation handlers
  const navigateToList = () => {
    setCurrentScreen('list');
    setSelectedRecordingId(null);
    setSelectedRecording(null);
    
    // Check if we need to refresh the recordings list
    checkRefreshNeeded();
  };

  const navigateToRecording = async () => {
    // Check if we have an active session before navigating to recording
    await checkSessionStatus();
    setCurrentScreen('recording');
  };

  const navigateToPlayback = (id: string) => {
    setSelectedRecordingId(id);
    const recording = recordings.find(r => r.id === id) || null;
    setSelectedRecording(recording);
    setCurrentScreen('playback');
  };

  const handleStartRecording = async () => {
    try {
      const recordingId = await startRecording();
      return recordingId;
    } catch (error) {
      console.error('Failed to start recording:', error);
      // If there's an error, go back to the list
      navigateToList();
      throw error;
    }
  };

  const handleStopRecording = async (recordingId: string) => {
    try {
      await stopRecording(recordingId);
      // Once the recording is stopped, go back to the list
      navigateToList();
    } catch (error) {
      console.error('Failed to stop recording:', error);
      // If there's an error, go back to the list anyway
      navigateToList();
      throw error;
    }
  };

  const handleDeleteRecording = async (id: string) => {
    try {
      await deleteRecording(id);
      // If we're deleting the current recording, navigate back to list
      if (id === selectedRecordingId) {
        navigateToList();
      }
    } catch (error) {
      console.error('Failed to delete recording:', error);
      throw error;
    }
  };

  // Render the appropriate screen
  const renderScreen = () => {
    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="mb-4">Loading recordings...</div>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-red-500 mb-4">Error: {error.message}</div>
            <button 
              className="px-4 py-2 bg-gray-200 rounded" 
              onClick={() => fetchRecordings()}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    switch (currentScreen) {
      case 'recording':
        return (
          <RecordingImproved 
            onBack={navigateToList} 
            onStop={handleStopRecording}
            onStartRecording={handleStartRecording}
          />
        );
      case 'playback':
        return (
          <PlaybackImproved 
            recordingId={selectedRecordingId || undefined}
            recording={selectedRecording || undefined}
            onBack={navigateToList} 
            onDelete={handleDeleteRecording}
            getDownloadUrl={getDownloadUrl}
          />
        );
      case 'list':
      default:
        return (
          <RecordingsListImproved 
            recordings={recordings}
            onRecordingSelect={navigateToPlayback}
            onNewRecording={navigateToRecording}
            onRenameRecording={renameRecording}
            onDeleteRecording={handleDeleteRecording}
            onRefresh={() => checkRefreshNeeded()}
            sessionConnected={sessionConnected}
          />
        );
    }
  };

  return (
    <div>
      {renderScreen()}
    </div>
  );
};

export default ImprovedApp;