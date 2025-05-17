import React, { useState, useEffect, useRef } from 'react';

// Simple functional component with hooks and Tailwind CSS
const SimpleApp: React.FC = () => {
  // State with hooks
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [liveTranscripts, setLiveTranscripts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  
  // Ref for EventSource
  const eventSourceRef = useRef<EventSource | null>(null);
  
  // Effect for fetching initial transcripts
  useEffect(() => {
    console.log('SimpleApp mounted');
    
    // Fetch initial transcript data
    fetchTranscripts();
    
    // Set up Server-Sent Events connection
    setupSSE();
    
    // Cleanup function
    return () => {
      // Clean up SSE connection
      if (eventSourceRef.current) {
        console.log('Closing SSE connection');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []); // Empty dependency array means this runs once on mount
  
  // Function to fetch transcripts
  const fetchTranscripts = () => {
    console.log('Fetching transcripts...');
    
    fetch('/api/transcripts')
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('Transcripts loaded:', data);
        setTranscripts(data.data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching transcripts:', err);
        setError(err.message);
        setLoading(false);
      });
  };
  
  // Function to set up SSE
  const setupSSE = () => {
    console.log('Setting up SSE connection...');
    
    try {
      // Close existing connection if any
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      
      const eventSource = new EventSource('/api/transcripts/sse');
      eventSourceRef.current = eventSource;
      
      // Connection opened
      eventSource.addEventListener('connected', () => {
        console.log('SSE connection opened');
        setConnected(true);
      });
      
      // Transcript event
      eventSource.addEventListener('transcript', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('SSE transcript received:', data);
          
          setLiveTranscripts(prev => [data, ...prev.slice(0, 9)]);
        } catch (err) {
          console.error('Error processing transcript:', err);
        }
      });
      
      // Error handling
      eventSource.onerror = (err) => {
        console.error('SSE connection error:', err);
        setConnected(false);
        
        // Try to reconnect after a delay
        setTimeout(() => {
          if (eventSourceRef.current) {
            setupSSE();
          }
        }, 5000);
      };
    } catch (err) {
      console.error('Error setting up SSE:', err);
      setConnected(false);
    }
  };

  return (
    <div className="p-5 max-w-4xl mx-auto font-sans">
      <h1 className="text-2xl font-bold mb-4">AugmentOS Recorder</h1>
      
      <div className="p-4 bg-gray-100 rounded-lg mb-6">
        <h2 className="text-xl font-semibold mb-2">Status</h2>
        <p className="mb-1">
          Connection: <span className={connected ? 'text-green-600' : 'text-red-600 font-semibold'}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </p>
        <p className="mb-1">
          API: <span className={error ? 'text-red-600' : loading ? 'text-amber-600' : 'text-green-600'}>
            {error ? 'Error' : loading ? 'Loading...' : 'Connected'}
          </span>
        </p>
        {error && <p className="text-red-600 mt-2">{error}</p>}
      </div>
      
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Live Transcripts</h2>
        {liveTranscripts.length > 0 ? (
          <ul className="list-none p-0 m-0 space-y-2">
            {liveTranscripts.map((transcript, index) => (
              <li key={transcript.id || `live-${index}`} className="p-3 border-b border-gray-200 rounded-md bg-white">
                <div><strong>{transcript.speakerName}:</strong> {transcript.text}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {new Date(transcript.timestamp).toLocaleTimeString()} 
                  ({(transcript.durationMs / 1000).toFixed(1)}s)
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500 italic">No live transcripts yet. They will appear here.</p>
        )}
      </div>
      
      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-3">Sample Transcripts</h2>
        {loading ? (
          <p className="text-amber-600">Loading transcripts...</p>
        ) : transcripts.length > 0 ? (
          <ul className="list-none p-0 m-0 space-y-2 bg-white rounded-lg border border-gray-200 p-4">
            {transcripts.map((transcript, index) => (
              <li key={transcript.id || `static-${index}`} className="p-3 border-b border-gray-100 last:border-0">
                <div className="font-semibold">{transcript.speakerName}</div>
                <div>{transcript.text}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {new Date(transcript.timestamp).toLocaleTimeString()} 
                  ({(transcript.durationMs / 1000).toFixed(1)}s)
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500 italic">No transcripts found.</p>
        )}
      </div>
    </div>
  );
};

export default SimpleApp;