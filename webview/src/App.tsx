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
    getDownloadUrl
  } = useRecordings();
  
  // Listen for voice commands via SSE
  useEffect(() => {
    const handleVoiceCommand = (data: { command: string, timestamp: number }) => {
      console.log(`[APP] Received voice command: ${data.command}`);
      
      if (data.command === 'start-recording' && currentScreen !== 'recording') {
        console.log('[APP] Voice command is starting a recording');
        navigateToRecording();
      } else if (data.command === 'stop-recording' && currentScreen === 'recording') {
        console.log('[APP] Voice command is stopping a recording');
        // The actual stop will be handled by the recording component
      }
    };
    
    // Set up event listener using our centralized API
    console.log('[APP] Setting up voice command listener');
    api.events.connect(); // Ensure connection is established
    api.events.addEventListener('voice-command', (event) => {
      try {
        const data = JSON.parse(event.data);
        handleVoiceCommand(data);
      } catch (error) {
        console.error('[APP] Error handling voice command event:', error);
      }
    });
    
    return () => {
      // No need to remove listener explicitly as it will be handled by the central API
    };
  }, [currentScreen]);

  // Navigation handlers
  const navigateToList = () => {
    setCurrentScreen('list');
    setSelectedRecordingId(null);
    setSelectedRecording(null);
  };

  const navigateToRecording = () => {
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
              onClick={fetchRecordings}
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