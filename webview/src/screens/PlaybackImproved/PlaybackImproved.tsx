import React, { useState } from 'react';
import { ChevronLeft, Share, Download, Trash2, Volume2, Play, Pause } from 'lucide-react';

interface PlaybackImprovedProps {
  onBack?: () => void;
  onDelete?: (id: number) => void;
  recordingId?: number;
}

interface RecordingData {
  id: number;
  title: string;
  location: string;
  date: string;
  duration: string;
  transcript: string;
}

const PlaybackImproved: React.FC<PlaybackImprovedProps> = ({ 
  recordingId = 3, 
  onBack, 
  onDelete 
}) => {
  const [currentTime, setCurrentTime] = useState("00:46.5");
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(60); // Progress percentage (0-100)
  
  // Mock data for the recording
  const recording: RecordingData = {
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

  const handleBack = () => {
    if (onBack) onBack();
  };

  const handleDelete = () => {
    if (onDelete) onDelete(recording.id);
  };

  // Handle scrubber change
  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          <button className="text-gray-600 mr-2" onClick={handleBack}>
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
          <button className="text-gray-600" onClick={handleDelete}>
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

export default PlaybackImproved;