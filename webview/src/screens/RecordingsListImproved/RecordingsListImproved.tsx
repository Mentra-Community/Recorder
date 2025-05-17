import React from 'react';
import { MoreVertical, Mic } from 'lucide-react';

interface Recording {
  id: number;
  title: string;
  location: string;
  date: string;
  duration: string;
}

interface RecordingsListImprovedProps {
  recordings: Recording[];
  onRecordingSelect: (id: number) => void;
  onNewRecording: () => void;
}

const RecordingsListImproved: React.FC<RecordingsListImprovedProps> = ({ 
  recordings,
  onRecordingSelect,
  onNewRecording
}) => {

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      {/* Header with title and search */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-gray-50">
        <div className="flex items-center">
          <h1 className="text-xl font-medium">Recordings</h1>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-grow overflow-y-auto p-4 pb-24">
        {/* Recording List */}
        <div className="space-y-3 pb-10">
          {recordings.length === 0 ? (
            <div className="bg-white rounded-lg p-6 text-center text-gray-500 shadow-sm border border-gray-200">
              <p>No recordings yet. Tap the microphone button to start recording.</p>
            </div>
          ) : (
            recordings.map(recording => (
              <div 
                key={recording.id} 
                className="bg-white rounded-lg p-4 cursor-pointer shadow-xs border border-gray-200" 
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
                    <button 
                      className="text-gray-500 p-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log('Options for recording:', recording.id);
                      }}
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recording controls at bottom - similar to other screens */}
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

export default RecordingsListImproved;