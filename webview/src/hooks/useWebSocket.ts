import { useState, useEffect, useCallback, useRef } from 'react';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

type MessageHandler = (data: any) => void;

interface UseWebSocketOptions {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (event: Event) => void;
  reconnectInterval?: number;
  reconnectAttempts?: number;
}

export function useWebSocket(
  url: string,
  token?: string,
  options: UseWebSocketOptions = {}
) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const messageHandlersRef = useRef<Record<string, MessageHandler[]>>({});
  
  const {
    onOpen,
    onClose,
    onError,
    reconnectInterval = 3000,
    reconnectAttempts = 5
  } = options;

  // Connect to WebSocket
  const connect = useCallback(() => {
    // Close existing connection if any
    if (webSocketRef.current) {
      webSocketRef.current.close();
    }

    try {
      // Append token as query parameter if provided
      const wsUrl = token ? `${url}?token=${token}` : url;
      
      const ws = new WebSocket(wsUrl);
      webSocketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        onOpen?.();
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        onClose?.();
        
        // Attempt to reconnect if not a normal closure
        if (event.code !== 1000 && event.code !== 1001) {
          attemptReconnect();
        }
      };

      ws.onerror = (event) => {
        setError(new Error('WebSocket connection error'));
        onError?.(event);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type } = data;
          
          // Call registered handlers for this message type
          if (type && messageHandlersRef.current[type]) {
            messageHandlersRef.current[type].forEach(handler => handler(data));
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to connect to WebSocket'));
      attemptReconnect();
    }
  }, [url, token, onOpen, onClose, onError]);

  // Attempt to reconnect
  const attemptReconnect = useCallback(() => {
    if (
      reconnectAttemptsRef.current < reconnectAttempts &&
      !reconnectTimeoutRef.current
    ) {
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = null;
        connect();
      }, reconnectInterval);
    }
  }, [connect, reconnectAttempts, reconnectInterval]);

  // Send a message
  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (webSocketRef.current && isConnected) {
      webSocketRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, [isConnected]);

  // Register a message handler
  const addMessageHandler = useCallback((type: string, handler: MessageHandler) => {
    if (!messageHandlersRef.current[type]) {
      messageHandlersRef.current[type] = [];
    }
    messageHandlersRef.current[type].push(handler);
    
    // Return function to remove this handler
    return () => {
      if (messageHandlersRef.current[type]) {
        messageHandlersRef.current[type] = messageHandlersRef.current[type].filter(h => h !== handler);
      }
    };
  }, []);

  // Initialize connection
  useEffect(() => {
    connect();
    
    // Cleanup on unmount
    return () => {
      if (webSocketRef.current) {
        webSocketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect, url, token]);

  return {
    isConnected,
    error,
    sendMessage,
    addMessageHandler,
    reconnect: connect
  };
}