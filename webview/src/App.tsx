import React, { useState, useEffect } from 'react';
import { useMentraAuth } from '@mentra/react';
import RecordingsListImproved from './screens/RecordingsListImproved/RecordingsListImproved';
import RecordingImproved from './screens/RecordingImproved/RecordingImproved';
import PlaybackImproved from './screens/PlaybackImproved/PlaybackImproved';
import { useRecordings } from './hooks/useRecordings';
import { RecordingI } from './types/recording';
import api, { setFrontendToken, getBackendUrl } from './Api';

type Screen = 'list' | 'recording' | 'playback';

const App: React.FC = () => {
  const { userId, isLoading, error: authError, isAuthenticated, frontendToken } = useMentraAuth();
  const [currentScreen, setCurrentScreen] = useState<Screen>('list');
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [selectedRecording, setSelectedRecording] = useState<RecordingI | null>(null);

  // Set the frontend token for API calls whenever it changes
  useEffect(() => {
    console.log('[APP] Setting frontend token for API calls:', frontendToken ? 'token available' : 'no token');
    setFrontendToken(frontendToken);
  }, [frontendToken]);
  
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
    getPlaybackUrl,
    getDownloadUrl,
    checkRefreshNeeded,
    sessionConnected,
    checkSessionStatus
  } = useRecordings();
  
  // Listen for voice commands via SSE
  useEffect(() => {
    // Only set up voice commands if authenticated and have frontend token
    if (!isAuthenticated || !frontendToken) return;

    const handleVoiceCommand = (data: { command: string, timestamp: number }) => {
      console.log(`[APP] [DEBUG] Received voice command: ${data.command}, timestamp: ${data.timestamp}`);
      console.log(`[APP] [DEBUG] Current screen: ${currentScreen}`);
      
      if (data.command === 'start-recording') {
        console.log('[APP] [DEBUG] Voice command is starting a recording');
        if (currentScreen !== 'recording') {
          console.log('[APP] [DEBUG] Navigating to recording screen for voice-started recording');
          navigateToRecording();
        } else {
          console.log('[APP] [DEBUG] Already on recording screen, not navigating');
        }
      } else if (data.command === 'stop-recording' && currentScreen === 'recording') {
        console.log('[APP] [DEBUG] Voice command is stopping a recording');
        console.log('[APP] [DEBUG] ⚠️ Received stop-recording command - this is just UI notification, backend already stopped recording');
      }
    };
    
    const handleRecordingStopped = (data: { id: string, timestamp: number }) => {
      console.log(`[APP] [DEBUG] Received recording-stopped-by-voice event for recording: ${data.id}`);
    };
    
    console.log('[APP] [DEBUG] Setting up voice command listeners');
    api.events.connect();
    
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
  }, [currentScreen, isAuthenticated, frontendToken]);

  // Navigation handlers
  const navigateToList = () => {
    setCurrentScreen('list');
    setSelectedRecordingId(null);
    setSelectedRecording(null);
    checkRefreshNeeded();
  };

  const navigateToRecording = async () => {
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
      navigateToList();
      throw error;
    }
  };

  const handleStopRecording = async (recordingId: string) => {
    try {
      await stopRecording(recordingId);
      navigateToList();
    } catch (error) {
      console.error('Failed to stop recording:', error);
      navigateToList();
      throw error;
    }
  };

  const handleDeleteRecording = async (id: string) => {
    try {
      await deleteRecording(id);
      if (id === selectedRecordingId) {
        navigateToList();
      }
    } catch (error) {
      console.error('Failed to delete recording:', error);
      throw error;
    }
  };

  // Handle authentication loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100">
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <div className="w-10 h-10 border-3 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
          <p className="text-gray-600">Loading authentication...</p>
        </div>
      </div>
    );
  }

  // Handle authentication error
  if (authError) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-100">
        <div className="flex flex-col items-center justify-center min-h-screen text-center p-8">
          <h2 className="text-red-600 text-2xl font-semibold mb-4">Authentication Error</h2>
          <p className="text-red-600 font-medium mb-2">{authError}</p>
          <p className="text-gray-600 text-sm">
            Please ensure you are opening this page from the MentraOS app.
          </p>
        </div>
      </div>
    );
  }

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
            getPlaybackUrl={getPlaybackUrl}
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
      {/* Debug info for development - only show in dev mode */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed top-0 right-0 z-50 bg-black bg-opacity-75 text-white text-xs p-2 rounded-bl-lg">
          <div>User: {userId}</div>
          <div>Token: {frontendToken ? `${frontendToken.substring(0, 8)}...` : 'none'}</div>
          <div>Backend: {getBackendUrl()}</div>
          <div>Mode: {import.meta.env.DEV ? 'proxy' : 'direct'}</div>
        </div>
      )}
      {renderScreen()}
    </div>
  );
};

export default App;