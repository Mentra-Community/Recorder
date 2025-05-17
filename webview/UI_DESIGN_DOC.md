# Voice Recorder UI Design Documentation

This document provides a comprehensive overview of the Voice Recorder application's user interface design, including implementation code and navigation flow.

## Overview

The Voice Recorder app features a mobile-first design with three primary screens:

1. **Recordings List View** - Displays all user recordings with metadata
2. **Recording Screen** - Shows real-time recording interface with transcript
3. **Playback Screen** - Provides audio playback controls and transcript display

## Screen Implementations

### 1. Recordings List View

This screen displays all recordings in a scrollable list, with each recording showing title, location, date, and duration.

```jsx
import React from 'react';
import { ChevronLeft, MoreVertical, Mic, Search, Filter } from 'lucide-react';

const RecordingsListImproved = ({ recordings, onRecordingSelect, onNewRecording }) => {
  const handleBack = () => {
    // In a real app, this might close the app or navigate back
    console.log('Back button pressed');
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      {/* Header with title and search */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-gray-50">
        <div className="flex items-center">
          <button className="text-gray-600 mr-2" onClick={handleBack}>
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-medium">Recordings</h1>
        </div>
        <div className="flex items-center space-x-4">
          <button className="text-gray-600">
            <Search size={22} />
          </button>
          <button className="text-gray-600">
            <Filter size={22} />
          </button>
          <button className="text-gray-600">
            <MoreVertical size={22} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-grow overflow-y-auto p-4 pb-24">
        {/* Recording List */}
        <div className="space-y-3">
          {recordings.length === 0 ? (
            <div className="bg-white rounded-lg p-6 text-center text-gray-500 shadow-sm border border-gray-200">
              <p>No recordings yet. Tap the microphone button to start recording.</p>
            </div>
          ) : (
            recordings.map(recording => (
              <div 
                key={recording.id} 
                className="bg-white rounded-lg p-4 cursor-pointer shadow-sm border border-gray-200" 
                onClick={() => onRecordingSelect(recording.id)}
              >
                <div className="flex justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-base text-gray-900">{recording.title}</h3>
                    <p className="text-gray-600 text-sm">{recording.location}</p>
                    <div className="flex mt-1 text-xs text-gray-500">
                      <span>{recording.date}</span>
                      <span className="mx-2">•</span>
                      <span>{recording.duration}</span>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <button className="text-gray-500 p-1">
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recording button at bottom */}
      <div className="fixed bottom-0 left-0 right-0 pb-6 pt-3 bg-gray-50 flex flex-col items-center border-t border-gray-300">
        <button 
          className="w-16 h-16 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md"
          onClick={onNewRecording}
        >
          <Mic size={24} />
        </button>
      </div>
    </div>
  );
};
```

### 2. Recording Screen

This screen is shown during active recording, featuring a timer, a live transcript display, and recording controls.

```jsx
import React, { useState, useEffect } from 'react';
import { ChevronLeft, Share, Download, Trash2, Square, Mic } from 'lucide-react';

const RecordingImproved = ({ onBack, onStop }) => {
  const [recordingTime, setRecordingTime] = useState(0);
  const [transcriptText, setTranscriptText] = useState(
    "I think we need to focus on improving our user interface for the voice recording app..."
  );
  
  // Simulate recording timer
  useEffect(() => {
    const timer = setInterval(() => {
      setRecordingTime(prev => prev + 0.1);
    }, 100);
    
    return () => {
      clearInterval(timer);
    };
  }, []);
  
  // Format seconds to MM:SS.S
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const tenths = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
  };
  
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      {/* Header with title and actions */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-gray-50">
        <div className="flex items-center">
          <button className="text-gray-600 mr-2" onClick={onBack}>
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-medium">Recording</h1>
        </div>
        <div className="flex items-center space-x-5">
          <button className="text-gray-600">
            <Share size={22} />
          </button>
          <button className="text-gray-600">
            <Download size={22} />
          </button>
          <button className="text-gray-600">
            <Trash2 size={22} />
          </button>
        </div>
      </header>
      
      {/* Large Timer Display with accent background */}
      <div className="px-4 py-8 border-b border-gray-300 flex flex-col items-center justify-center bg-gray-100">
        <div className="flex items-center mb-2">
          <Mic size={24} className="text-red-500 mr-3" />
          <div className="text-4xl font-mono font-medium text-gray-800">
            {formatTime(recordingTime)}
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
          {transcriptText}
        </p>
      </div>
      
      {/* Recording controls at bottom */}
      <div className="fixed bottom-0 left-0 right-0 pb-6 pt-3 bg-gray-50 flex flex-col items-center border-t border-gray-300">
        <button
          className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md"
          onClick={onStop}
        >
          <Square size={24} />
        </button>
      </div>
    </div>
  );
};
```

### 3. Playback Screen

This screen allows users to play back a recording, with controls for playback and transcript viewing.

```jsx
import React, { useState } from 'react';
import { ChevronLeft, Share, Download, Trash2, Volume2, Play, Pause } from 'lucide-react';

const PlaybackImproved = ({ recordingId, onBack, onDelete }) => {
  const [currentTime, setCurrentTime] = useState("00:46.5");
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(60); // Progress percentage (0-100)
  
  // Mock data for the recording
  const recording = {
    id: recordingId,
    title: "News Recording",
    location: "Conway Springs, Kansas",
    date: "Dec 18",
    duration: "02:34",
    transcript: "above the law and he should be impeached for this as well. Congress cannot wait for the next election to address this misconduct. President Trump has demonstrated the clear pattern of wrongdoing. This is not the first time he has solicited foreign interference in an election, has been exposed and has attempted to obstruct the resulting investigation. We cannot rely on the next election as a remedy for presidential misconduct when the president threatens the very integrity of that election."
  };

  // Toggle play/pause
  const togglePlayback = () => {
    setIsPlaying(!isPlaying);
  };
  
  // Handle scrubber change
  const handleScrubberChange = (e) => {
    const newProgress = parseInt(e.target.value);
    setProgress(newProgress);
    
    // Update current time based on progress
    // This is a mock calculation; in a real app, this would convert based on actual duration
    const totalSeconds = 154; // 2:34 in seconds
    const currentSeconds = Math.floor(totalSeconds * (newProgress / 100));
    const minutes = Math.floor(currentSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(currentSeconds % 60).toString().padStart(2, '0');
    const tenths = Math.floor(Math.random() * 10); // Random for demo
    setCurrentTime(`${minutes}:${seconds}.${tenths}`);
  };
  
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      {/* Header with title and actions */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-gray-50">
        <div className="flex items-center">
          <button className="text-gray-600 mr-2" onClick={onBack}>
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-medium">{recording.title}</h1>
        </div>
        <div className="flex items-center space-x-5">
          <button className="text-gray-600">
            <Share size={22} />
          </button>
          <button className="text-gray-600">
            <Download size={22} />
          </button>
          <button className="text-gray-600" onClick={() => onDelete(recording.id)}>
            <Trash2 size={22} />
          </button>
        </div>
      </header>
      
      {/* Recording metadata */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-300 bg-gray-50">
        <div className="text-gray-600">
          {recording.date} • {recording.location}
        </div>
        <div className="flex items-center">
          <span className="text-gray-600 mr-2">{recording.duration}</span>
          <button className="w-8 h-8 flex items-center justify-center rounded-full bg-white shadow-sm border border-gray-300">
            <Volume2 size={16} className="text-gray-600" />
          </button>
        </div>
      </div>
      
      {/* Transcript text with language indicator inline */}
      <div className="px-4 py-4 flex-1 overflow-y-auto bg-gray-50">
        <div className="flex items-center mb-2">
          <h3 className="text-sm font-medium text-gray-600 uppercase mr-3">Transcript</h3>
          <span className="text-xs text-gray-400">English (US)</span>
        </div>
        <p className="text-gray-800 leading-relaxed">
          {recording.transcript}
        </p>
      </div>
      
      {/* Playback controls at bottom */}
      <div className="fixed bottom-0 left-0 right-0 pb-6 pt-3 bg-gray-50 flex flex-col items-center border-t border-gray-300">
        {/* Audio scrubber */}
        <div className="w-full px-4 mb-2">
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={progress} 
            onChange={handleScrubberChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-900"
          />
        </div>
        
        <div className="text-center mb-2">
          <span className="font-mono">{currentTime}</span>
        </div>
        
        <button
          onClick={togglePlayback}
          className="w-16 h-16 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-md"
        >
          {isPlaying ? (
            <div className="w-6 h-6 flex items-center justify-center">
              <div className="w-2 h-6 bg-white mx-0.5"></div>
              <div className="w-2 h-6 bg-white mx-0.5"></div>
            </div>
          ) : (
            <Pause size={24} />
          )}
        </button>
      </div>
    </div>
  );
};
```

## Navigation Flow

The application has a simple, linear navigation flow:

1. **Recordings List View** is the default landing screen
   - Tapping on the microphone button navigates to the Recording Screen
   - Tapping on a recording item navigates to the Playback Screen

2. **Recording Screen**
   - Accessed from the microphone button on the Recordings List
   - Back button returns to the Recordings List
   - Stop button ends recording and returns to the Recordings List
   - Share, Download, and Trash buttons provide additional options

3. **Playback Screen**
   - Accessed by tapping on a recording in the Recordings List
   - Back button returns to the Recordings List
   - Trash button deletes the recording after confirmation
   - Play/Pause button controls audio playback
   - Audio scrubber allows seeking through the recording
   - Volume control adjusts playback volume

## Implementation Notes

### Color Scheme
- Primary background: `bg-gray-50`
- Secondary background: `bg-gray-100`
- Accent color for recording: `bg-red-500`
- Accent color for playback: `bg-gray-900`
- Accent color for new recording: `bg-blue-600`
- Text colors: `text-gray-900`, `text-gray-800`, `text-gray-600`, `text-gray-500`, `text-gray-400`

### Typography
- Headings: `text-xl font-medium`
- Body text: `text-base text-gray-800 leading-relaxed`
- Metadata: `text-sm` or `text-xs`
- Labels: `text-sm font-medium text-gray-600 uppercase`
- Timer display: `text-4xl font-mono font-medium` (recording) or `font-mono` (playback)

### Layout
- Consistent header style across all screens with border-bottom separation
- Well-defined sections separated by borders
- Footer area with consistent styling for main action buttons
- Proper spacing between elements for readability
- Fixed position controls at the bottom of the screen
- Consistent use of padding and margins

### Components
1. **Header Component** - Shared across all screens
   - Left-aligned back button and title
   - Right-aligned action buttons

2. **Recording Card** - Used in the Recordings List
   - Shows title, location, date, and duration
   - Clean layout with proper text hierarchy
   - Three-line design with visually separated metadata

3. **Audio Scrubber** - Unique to Playback screen
   - Range input for seeking through audio
   - Styled to match the application design

4. **Transcript Display** - Used in both Recording and Playback screens
   - Includes language indicator
   - Clear typography for readability
   - Scrollable container for long transcripts

5. **Action Buttons** - Contextual to each screen
   - Recording screen: Red stop button
   - Playback screen: Play/pause toggle with custom pause bars
   - List screen: Blue microphone button for new recordings

6. **Footer Area** - Shared design across screens
   - Fixed to the bottom of the viewport
   - Contains main action buttons
   - Includes scrubber in Playback view

## Integration with Backend

These UI components will need to integrate with the backend API for:

1. Fetching the list of recordings
2. Streaming audio data during recording
3. Receiving real-time transcription during recording
4. Playing back recorded audio
5. Deleting recordings
6. Sharing and downloading recordings

## Responsive Design Considerations

While the design is mobile-first, these considerations apply for larger screens:
- Max width container for content on larger screens
- Potentially two-column layout on desktop for the Playback screen
- Larger touch targets on mobile
- Scrollable areas for transcript text