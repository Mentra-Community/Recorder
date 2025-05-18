import React, { useEffect, useState, useRef } from 'react';
import { ChevronLeft, Share, Download, Trash2, Volume2, Play, Pause } from 'lucide-react';
import { RecordingI } from '../../types/recording';
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
  // Component state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  
  // References
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<number | null>(null);
  
  // Initialize audio on mount and cleanup on unmount
  useEffect(() => {
    // Create audio element
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;
    
    // Set up event listeners
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('loadedmetadata', handleMetadataLoaded);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    
    // Cleanup function
    return () => {
      // Stop playback and progress tracking
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      // Remove event listeners
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('loadedmetadata', handleMetadataLoaded);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, []);
  
  // Load audio when recordingId changes
  useEffect(() => {
    if (!recordingId || !getDownloadUrl || !audioRef.current) return;
    
    // Reset state
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setProgress(0);
    setIsLoading(true);
    setError(null);
    
    // Stop progress tracking
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    
    try {
      // Get the download URL with a cache buster
      const timestamp = Date.now();
      const url = `${getDownloadUrl(recordingId)}?t=${timestamp}`;
      console.log(`[PLAYER] Loading audio from URL: ${url}`);
      
      // Load the audio
      const audio = audioRef.current;
      audio.src = url;
      audio.load();
      
      // Set a fallback timeout in case events don't fire
      setTimeout(() => {
        if (isLoading && audioRef.current) {
          console.log('[PLAYER] Using fallback timeout to enable playback');
          setIsLoading(false);
        }
      }, 5000);
    } catch (err) {
      console.error('[PLAYER] Error setting audio source:', err);
      setError('Failed to load audio');
      setIsLoading(false);
    }
  }, [recordingId, getDownloadUrl]);
  
  // Event handlers
  const handleCanPlay = () => {
    console.log('[PLAYER] Audio can play');
    setIsLoading(false);
  };
  
  const handleMetadataLoaded = () => {
    const audio = audioRef.current;
    if (audio) {
      console.log(`[PLAYER] Metadata loaded, duration: ${audio.duration}s`);
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    }
  };
  
  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio) {
      setCurrentTime(audio.currentTime);
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    }
  };
  
  const handleEnded = () => {
    console.log('[PLAYER] Playback ended');
    setIsPlaying(false);
    setCurrentTime(0);
    setProgress(0);
    
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };
  
  const handleError = (e: Event) => {
    const audio = audioRef.current as HTMLAudioElement;
    const errorCode = audio.error ? audio.error.code : 'unknown';
    const errorMessage = audio.error ? audio.error.message : 'unknown error';
    
    console.error(`[PLAYER] Audio error: code=${errorCode}, message=${errorMessage}`);
    setError(`Failed to load audio: ${errorMessage}`);
    setIsLoading(false);
  };
  
  // Playback controls
  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    
    try {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
        
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
      } else {
        console.log('[PLAYER] Starting playback');
        await audio.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.error('[PLAYER] Playback error:', err);
      setError('Failed to play audio');
    }
  };
  
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newProgress = parseInt(e.target.value);
    setProgress(newProgress);
    
    const audio = audioRef.current;
    if (!audio) return;
    
    if (duration && isFinite(duration) && duration > 0) {
      const newTime = (duration * newProgress) / 100;
      audio.currentTime = newTime;
      setCurrentTime(newTime);
    } else {
      // Fallback for when duration isn't available
      const estimatedDuration = 20; // Assume 20 seconds
      const newTime = (estimatedDuration * newProgress) / 100;
      audio.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };
  
  const handleLoadAudioAgain = () => {
    if (!recordingId || !getDownloadUrl || !audioRef.current) return;
    
    try {
      // Get the download URL with a new cache buster
      const timestamp = Date.now();
      const url = `${getDownloadUrl(recordingId)}?retry=true&t=${timestamp}`;
      console.log(`[PLAYER] Retrying audio load from URL: ${url}`);
      
      // Load the audio
      const audio = audioRef.current;
      audio.src = url;
      audio.load();
      
      // Try playing after loading
      setTimeout(() => {
        audio.play()
          .then(() => {
            setIsPlaying(true);
            setIsLoading(false);
          })
          .catch(err => {
            console.error('[PLAYER] Auto-play failed:', err);
            setIsLoading(false);
          });
      }, 1000);
    } catch (err) {
      console.error('[PLAYER] Error reloading audio:', err);
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
    // Always use the backend API for downloads
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
        {/* Debug info and reload button */}
        {(isLoading || error) && (
          <div className="mb-2 text-center">
            <div className="mb-1 text-xs text-gray-500">
              {error ? `Error: ${error}` : 'Loading audio...'}
            </div>
            <button 
              onClick={handleLoadAudioAgain}
              className="px-3 py-1 bg-gray-200 text-gray-800 rounded text-xs"
            >
              Try Again
            </button>
          </div>
        )}
        
        {/* Audio scrubber */}
        <div className="w-full px-4 mb-2">
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={progress} 
            onChange={handleSeek}
            disabled={isLoading}
            className={`w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-900`}
          />
        </div>
        
        <div className="text-center mb-2">
          <span className="font-mono">{formatDuration(currentTime)}</span>
          {duration > 0 && (
            <span className="font-mono text-gray-500"> / {formatDuration(duration)}</span>
          )}
        </div>
        
        <button
          onClick={togglePlayback}
          disabled={isLoading}
          className={`w-16 h-16 rounded-full ${isLoading ? 'bg-gray-400' : 'bg-gray-900'} text-white flex items-center justify-center shadow-md`}
        >
          {isPlaying ? (
            <Pause size={24} />
          ) : (
            <Play size={24} fill="white" />
          )}
        </button>
      </div>
    </div>
  );
};

export default PlaybackImproved;