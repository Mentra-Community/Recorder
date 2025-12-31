/**
 * Hook for audio playback
 */

import { useState, useRef, useEffect } from 'react';

interface UseAudioPlayerOptions {
  onEnded?: () => void;
  onError?: (error: Error) => void;
}

export function useAudioPlayer(options?: UseAudioPlayerOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isReady, setIsReady] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  
  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);
  
  // Load audio from a URL
  const loadAudio = async (url: string): Promise<void> => {
    // Reset state
    setIsReady(false);
    pendingSeekRef.current = null;
    try {
      setIsLoading(true);
      console.log(`[AUDIO] Loading audio from URL: ${url}`);
      
      // Stop any playing audio
      if (audioRef.current) {
        console.log('[AUDIO] Stopping previous audio');
        audioRef.current.pause();
        audioRef.current.src = ""; // Clear source
        audioRef.current.load(); // Important for cleanup
        
        if (intervalRef.current) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
      
      // DEBUGGING - Test if the URL is accessible directly using fetch
      try {
        console.log('[AUDIO] Testing URL accessibility via fetch');
        const response = await fetch(url, { method: 'HEAD' });
        console.log(`[AUDIO] Fetch HEAD response status: ${response.status}`);
        
        if (response.status >= 200 && response.status < 300) {
          console.log('[AUDIO] URL is accessible');
        } else {
          console.warn(`[AUDIO] URL returned status ${response.status}`);
        }
      } catch (fetchError) {
        console.error('[AUDIO] Error testing URL:', fetchError);
      }
      
      // Create new audio element or reuse existing
      let audio: HTMLAudioElement;
      if (audioRef.current) {
        audio = audioRef.current;
        // Add cache buster to URL to prevent browser caching issues
        const cacheBuster = url.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
        audio.src = url + cacheBuster;
      } else {
        // Add cache buster to URL
        const cacheBuster = url.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
        audio = new Audio(url + cacheBuster);
      }
      audioRef.current = audio;
      
      // Set crossOrigin attribute to handle CORS for R2
      if (url.includes('r2.cloudflarestorage.com') || url.includes('.r2.dev')) {
        audio.crossOrigin = 'anonymous';
      }
      
      // Set up event listeners
      audio.preload = "auto"; // Force preloading
      
      // Add logging for better debugging
      audio.addEventListener('canplay', () => {
        console.log('[AUDIO] Can play event fired');
        
        // Also set ready here as an additional fallback
        if (!isReady) {
          console.log('[AUDIO] Setting ready state on canplay');
          setIsReady(true);
        }
      });
      
      audio.addEventListener('canplaythrough', () => {
        console.log('[AUDIO] Can play through event fired');
        setIsReady(true);
        
        // Apply any pending seek operation
        if (pendingSeekRef.current !== null) {
          const seekTarget = pendingSeekRef.current;
          console.log(`[AUDIO] Applying pending seek to ${seekTarget}s`);
          
          // Apply the seek directly to avoid circular reference
          if (audioRef.current) {
            const safeTime = Math.max(0, seekTarget);
            audioRef.current.currentTime = safeTime;
            setCurrentTime(safeTime);
            pendingSeekRef.current = null;
          }
        }
      });
      
      audio.onloadedmetadata = () => {
        console.log(`[AUDIO] Metadata loaded, duration: ${audio.duration}s`);
        // Check for valid duration (not Infinity, NaN, or negative)
        if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        } else {
          console.log('[AUDIO] Duration not available yet, will try again when can play');
          setDuration(0); // Set a default
        }
        setIsLoading(false);
      };
      
      // Also try to get duration when can play
      audio.addEventListener('canplay', () => {
        if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
          console.log(`[AUDIO] Duration updated: ${audio.duration}s`);
          setDuration(audio.duration);
        }
      });
      
      audio.onerror = (e) => {
        const errorCode = audio.error ? audio.error.code : 'unknown';
        const errorMessage = audio.error ? audio.error.message : 'unknown error';
        console.error(e, `[AUDIO] Error loading audio: code=${errorCode}, message=${errorMessage}`);
        
        setIsLoading(false);
        const error = new Error(`Error loading audio: ${errorCode} - ${errorMessage}`);
        
        if (options?.onError) {
          options.onError(error);
        } else {
          console.error(error);
        }
      };
      
      audio.onended = () => {
        console.log('[AUDIO] Playback ended');
        setIsPlaying(false);
        setCurrentTime(0);
        
        if (intervalRef.current) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        
        if (options?.onEnded) {
          options.onEnded();
        }
      };
      
      // Start loading with timeout
      console.log('[AUDIO] Starting to load audio');
      const loadingPromise = new Promise<void>((resolve) => {
        const loadTimeout = setTimeout(() => {
          console.log('[AUDIO] Load timeout reached, continuing anyway');
          // Consider audio ready even if timeout is reached
          setIsReady(true);
          resolve();
        }, 5000); // 5s timeout
        
        audio.oncanplaythrough = () => {
          clearTimeout(loadTimeout);
          console.log('[AUDIO] Audio can play through');
          setIsReady(true);
          resolve();
        };
        
        // Also resolve on loadeddata as a fallback
        audio.onloadeddata = () => {
          console.log('[AUDIO] Audio data loaded');
          // Set a shorter timeout after data is loaded
          setTimeout(() => {
            if (!isReady) {
              console.log('[AUDIO] Setting ready state after loadeddata');
              setIsReady(true);
            }
          }, 1000);
        };
      });
      
      try {
        await loadingPromise;
        console.log('[AUDIO] Audio loading completed');
        
        // Set a final timeout to ensure ready state is set
        // This is a last-resort fallback in case none of the events fired
        setTimeout(() => {
          if (!isReady && audioRef.current) {
            console.log('[AUDIO] Setting ready state via final timeout');
            setIsReady(true);
          }
        }, 2000);
      } catch (loadError) {
        console.warn('[AUDIO] Audio loading issue:', loadError);
        // Continue anyway, might still be playable
        
        // Set ready state even if there was an error
        // The audio might still be playable
        setTimeout(() => {
          if (!isReady && audioRef.current) {
            console.log('[AUDIO] Setting ready state after error');
            setIsReady(true);
          }
        }, 1000);
      }
    } catch (error) {
      setIsLoading(false);
      
      if (options?.onError) {
        options.onError(error instanceof Error ? error : new Error('Unknown error'));
      } else {
        console.error('Error loading audio:', error);
      }
    }
  };
  
  // Play the loaded audio
  const play = async (): Promise<void> => {
    if (!audioRef.current) {
      console.warn('[AUDIO] Cannot play - no audio element');
      return;
    }
    
    try {
      console.log('[AUDIO] Starting playback');
      
      // Check if we need to update duration
      if (!duration || !isFinite(duration) || duration <= 0) {
        if (audioRef.current.duration && isFinite(audioRef.current.duration)) {
          console.log(`[AUDIO] Updating duration on play: ${audioRef.current.duration}s`);
          setDuration(audioRef.current.duration);
        }
      }
      
      // Force set ready state if audio is actually ready
      if (!isReady && audioRef.current.readyState >= 2) {
        console.log('[AUDIO] Audio is actually ready but state not updated - fixing on play');
        setIsReady(true);
      }
      
      // Start playback
      await audioRef.current.play();
      setIsPlaying(true);
      
      // Start progress tracking
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      
      intervalRef.current = window.setInterval(() => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
          
          // Also update duration if it becomes available
          if (audioRef.current.duration && isFinite(audioRef.current.duration) && 
              (!duration || !isFinite(duration) || duration <= 0)) {
            console.log(`[AUDIO] Duration updated during playback: ${audioRef.current.duration}s`);
            setDuration(audioRef.current.duration);
          }
        }
      }, 100);
    } catch (error) {
      setIsPlaying(false);
      console.error('[AUDIO] Playback error:', error);
      
      if (options?.onError) {
        options.onError(error instanceof Error ? error : new Error('Playback failed'));
      } else {
        console.error('[AUDIO] Error playing audio:', error);
      }
    }
  };
  
  // Pause playback
  const pause = (): void => {
    if (!audioRef.current) {
      return;
    }
    
    audioRef.current.pause();
    setIsPlaying(false);
    
    // Stop progress tracking
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };
  
  // Seek to a specific time
  const seek = (time: number): void => {
    if (!audioRef.current) {
      console.warn('[AUDIO] Cannot seek - no audio element');
      // Store the seek target for when audio becomes available
      pendingSeekRef.current = time;
      return;
    }
    
    // Ensure time is valid
    if (time < 0) time = 0;
    
    // If we have a duration, make sure we don't seek past it
    if (duration && isFinite(duration) && duration > 0) {
      if (time > duration) time = duration;
    }
    
    console.log(`[AUDIO] Seeking to ${time.toFixed(2)}s`);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
    // Clear any pending seek
    pendingSeekRef.current = null;
  };
  
  // Toggle play/pause
  const toggle = async (): Promise<void> => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  };
  
  return {
    isPlaying,
    isLoading,
    duration,
    currentTime,
    isReady,
    loadAudio,
    play,
    pause,
    seek,
    toggle
  };
}