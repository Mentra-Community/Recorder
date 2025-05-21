import React, { useState, useEffect } from 'react';
import { MoreVertical, Mic, Pencil, Trash2, AlertCircle } from 'lucide-react';
import { RecordingI, RecordingStatusE } from '../../types/recording';
import RenameDialog from './RenameDialog';
import { formatDuration } from '../../utils/formatters';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

interface RecordingsListImprovedProps {
  recordings: RecordingI[];
  onRecordingSelect: (id: string) => void;
  onNewRecording: () => void;
  onRenameRecording?: (id: string, title: string) => Promise<void>;
  onDeleteRecording?: (id: string) => Promise<void>;
  onRefresh?: () => void;
  sessionConnected?: boolean | null;
}

const RecordingsListImproved: React.FC<RecordingsListImprovedProps> = ({ 
  recordings,
  onRecordingSelect,
  onNewRecording,
  onRenameRecording,
  onDeleteRecording,
  onRefresh,
  sessionConnected
}) => {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [selectedRecording, setSelectedRecording] = useState<RecordingI | null>(null);

  const handleOpenRenameDialog = (recording: RecordingI, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedRecording(recording);
    setRenameDialogOpen(true);
  };

  const handleCloseRenameDialog = () => {
    setRenameDialogOpen(false);
    setSelectedRecording(null);
  };

  const handleRename = async (newTitle: string) => {
    if (selectedRecording && onRenameRecording) {
      try {
        await onRenameRecording(selectedRecording.id, newTitle);
      } catch (error) {
        console.error('Failed to rename recording:', error);
      }
    }
  };
  
  // Call refresh when the component mounts
  useEffect(() => {
    if (onRefresh) {
      onRefresh();
    }
  }, [onRefresh]);

  const handleDelete = async (recording: RecordingI, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDeleteRecording) {
      try {
        await onDeleteRecording(recording.id);
      } catch (error) {
        console.error('Failed to delete recording:', error);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      {/* Header with title */}
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
                className={`bg-white rounded-lg p-4 cursor-pointer shadow-xs border ${
                  recording.status === RecordingStatusE.STOPPING ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200'
                }`}
                onClick={() => onRecordingSelect(recording.id)}
              >
                <div className="flex justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-base text-gray-900">{recording.title}</h3>
                      {recording.status === RecordingStatusE.STOPPING && (
                        <div className="text-xs text-yellow-600 bg-yellow-100 rounded-full px-2 py-0.5 flex items-center">
                          <span className="animate-pulse rounded-full h-2 w-2 bg-yellow-500 mr-1"></span>
                          Processing
                        </div>
                      )}
                      {recording.status === RecordingStatusE.ERROR && (
                        <div className="text-xs text-red-600 bg-red-100 rounded-full px-2 py-0.5 flex items-center">
                          <AlertCircle size={12} className="mr-1" />
                          Error
                        </div>
                      )}
                    </div>
                    <div className="flex mt-1 text-xs text-gray-500">
                      <span>{new Date(recording.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      <span className="mx-2">•</span>
                      <span>{formatDuration(recording.duration)}</span>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button 
                          className="text-gray-500 p-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical size={16} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem 
                          onClick={(e) => handleOpenRenameDialog(recording, e as unknown as React.MouseEvent)}
                          disabled={recording.status === RecordingStatusE.STOPPING}
                        >
                          <Pencil size={16} className="mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={(e) => handleDelete(recording, e as unknown as React.MouseEvent)}
                          disabled={recording.status === RecordingStatusE.STOPPING}
                        >
                          <Trash2 size={16} className="mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recording button at bottom */}
      <div className="fixed bottom-0 left-0 right-0 pb-6 pt-3 bg-gray-50 flex flex-col items-center border-t border-gray-300">
        <div className="relative">
          <button 
            className={`${sessionConnected ? "flex" : "hidden"} w-16 h-16 rounded-full ${sessionConnected === false ? 'bg-gray-400' : 'bg-blue-600'} text-white items-center justify-center shadow-md`}
            onClick={onNewRecording}
            disabled={sessionConnected === false}
          >
            <Mic size={24} />
          </button>
          
          {sessionConnected === false && (
            <div className="absolute top-full mt-2 -translate-x-1/2 left-1/2 whitespace-nowrap bg-red-100 text-red-800 text-xs p-1.5 rounded-lg border border-red-200 shadow-sm">
              Glasses not connected
            </div>
          )}
        </div>
      </div>

      {/* Rename Dialog */}
      {selectedRecording && (
        <RenameDialog
          isOpen={renameDialogOpen}
          currentTitle={selectedRecording.title}
          onClose={handleCloseRenameDialog}
          onRename={handleRename}
        />
      )}
    </div>
  );
};

export default RecordingsListImproved;