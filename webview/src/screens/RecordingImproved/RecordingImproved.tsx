import React, { useState, useEffect } from 'react';
import { ChevronLeft, Share, Download, Trash2, Square, Mic } from 'lucide-react';

interface RecordingImprovedProps {
  onBack?: () => void;
  onStop?: () => void;
}

const RecordingImproved: React.FC<RecordingImprovedProps> = ({ onBack, onStop }) => {
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [transcriptText, setTranscriptText] = useState<string>(
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
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const tenths = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
  };

  const handleBack = () => {
    if (onBack) onBack();
  };

  const handleStop = () => {
    if (onStop) onStop();
  };
  
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
          onClick={handleStop}
        >
          <Square size={24} />
        </button>
      </div>
    </div>
  );
};

export default RecordingImproved;