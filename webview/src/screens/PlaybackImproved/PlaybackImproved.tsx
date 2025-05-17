import React, { useEffect, useState } from 'react';
import { ChevronLeft, Share, Download, Trash2, Volume2 } from 'lucide-react';
import { RecordingI } from '../../types/recording';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { formatDuration } from '../../utils/formatters';

interface PlaybackImprovedProps {
  onBack?: () => void;
  onDelete?: (id: string) => Promise<void>;
  recordingId?: string;
  recording?: RecordingI;
  getDownloadUrl?: (id: string) => string;
}

const PlaybackImproved: React.FC<PlaybackImprovedProps> = ({ 
  recordingId, 
  recording,
  onBack, 
  onDelete,
  getDownloadUrl
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const { 
    isPlaying, 
    currentTime, 
    duration, 
    loadAudio, 
    toggle, 
    seek 
  } = useAudioPlayer();
  
  const [progress, setProgress] = useState(0);
  
  // Load audio when component mounts or recordingId changes
  useEffect(() => {
    if (!recording || !recordingId || !getDownloadUrl) {
      return;
    }
    
    setIsLoading(true);
    
    const url = getDownloadUrl(recordingId);
    
    loadAudio(url)
      .then(() => setIsLoading(false))
      .catch((err) => {
        console.error('Error loading audio:', err);
        setError('Failed to load audio');
        setIsLoading(false);
      });
  }, [recordingId, recording, getDownloadUrl, loadAudio]);
  
  // Update progress when currentTime changes
  useEffect(() => {
    if (duration > 0) {
      setProgress((currentTime / duration) * 100);
    }
  }, [currentTime, duration]);
  
  // Handle scrubber change
  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newProgress = parseInt(e.target.value);
    setProgress(newProgress);
    
    // Update current time based on progress
    if (duration > 0) {
      const newTime = (duration * newProgress) / 100;
      seek(newTime);
    }
  };

  const handleBack = () => {
    if (onBack) onBack();
  };

  const handleDelete = async () => {
    if (onDelete && recordingId) {
      try {
        await onDelete(recordingId);
      } catch (error) {
        console.error('Failed to delete recording:', error);
      }
    }
  };

  const handleDownload = () => {
    if (recordingId && getDownloadUrl) {
      const url = getDownloadUrl(recordingId);
      window.open(url, '_blank');
    }
  };

  // If we don't have a recording yet, show loading
  if (!recording) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center">
        <div className="text-center">
          {isLoading ? (
            <div>Loading recording...</div>
          ) : (
            <div className="text-red-500">{error || 'Recording not found'}</div>
          )}
          <button 
            className="mt-4 px-4 py-2 bg-gray-200 rounded" 
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
          <h1 className="text-xl font-medium">{recording.title}</h1>
        </div>
        <div className="flex items-center space-x-5">
          <button className="text-gray-600">
            <Share size={22} />
          </button>
          <button className="text-gray-600" onClick={handleDownload}>
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
          {new Date(recording.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
        <div className="flex items-center">
          <span className="text-gray-600 mr-2">{formatDuration(recording.duration)}</span>
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
          {recording.transcript || 'No transcript available'}
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
          <span className="font-mono">{formatDuration(currentTime)}</span>
        </div>
        
        <button
          onClick={toggle}
          disabled={isLoading}
          className="w-16 h-16 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-md"
        >
          {isPlaying ? (
            <div className="w-6 h-6 flex items-center justify-center">
              <div className="w-2 h-6 bg-white mx-0.5"></div>
              <div className="w-2 h-6 bg-white mx-0.5"></div>
            </div>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 4.99989L19 12L5 19.0001V4.99989Z" fill="white"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};

export default PlaybackImproved;