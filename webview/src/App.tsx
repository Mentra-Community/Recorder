import React, { useState, useEffect } from 'react';
import RecordingsListImproved from './screens/RecordingsListImproved';
import RecordingImproved from './screens/RecordingImproved';
import PlaybackImproved from './screens/PlaybackImproved';

type Screen = 'list' | 'recording' | 'playback';

// Mock recording data
const mockRecordings = [
  { id: 1, title: 'Weather Livingston', location: 'Conway Springs, Kansas', date: 'Dec 18', duration: '01:00' },
  { id: 2, title: 'Interview with Claire', location: 'Cleveland, Ohio', date: 'Dec 16', duration: '35:00' },
  { id: 3, title: 'Meeting notes with team Indigo', location: 'Lexington, Massachusetts', date: 'Dec 14', duration: '25:00' },
  { id: 4, title: 'How to configure your augmented reality workspace', location: 'Raleigh, North Carolina', date: 'Dec 13', duration: '05:00' },
  { id: 5, title: 'AR games discussion', location: 'Houston, Texas', date: 'Dec 12', duration: '17:00' },
];

const ImprovedApp: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>('list');
  const [selectedRecordingId, setSelectedRecordingId] = useState<number | null>(null);
  const [recordings, setRecordings] = useState(mockRecordings);
  const [isRecording, setIsRecording] = useState(false);

  // Navigation handlers
  const navigateToList = () => {
    setCurrentScreen('list');
    setSelectedRecordingId(null);
  };

  const navigateToRecording = () => {
    setIsRecording(true);
    setCurrentScreen('recording');
  };

  const navigateToPlayback = (id: number) => {
    setSelectedRecordingId(id);
    setCurrentScreen('playback');
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    // Simulate adding a new recording
    const newRecording = {
      id: recordings.length + 1,
      title: `Recording ${new Date().toLocaleString()}`,
      location: 'Current location',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      duration: '00:45'
    };
    setRecordings([newRecording, ...recordings]);
    navigateToList();
  };

  const handleDeleteRecording = (id: number) => {
    // Remove recording from state
    setRecordings(recordings.filter(recording => recording.id !== id));
    // Navigate back to list
    navigateToList();
  };

  // Render the appropriate screen
  const renderScreen = () => {
    switch (currentScreen) {
      case 'recording':
        return (
          <RecordingImproved 
            onBack={navigateToList} 
            onStop={handleStopRecording} 
          />
        );
      case 'playback':
        return (
          <PlaybackImproved 
            recordingId={selectedRecordingId || undefined} 
            onBack={navigateToList} 
            onDelete={handleDeleteRecording} 
          />
        );
      case 'list':
      default:
        return (
          <RecordingsListImproved 
            recordings={recordings}
            onRecordingSelect={navigateToPlayback}
            onNewRecording={navigateToRecording}
          />
        );
    }
  };

  return (
    <div>
      {/* <UIToggle /> */}
      {renderScreen()}
    </div>
  );
};

export default ImprovedApp;