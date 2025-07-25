import React from 'react';
import ReactDOM from 'react-dom/client';
import { MentraAuthProvider } from '@mentra/react';
import App from './App';
import './index.css';
// import { enableRemoteConsole } from './utils/remoteLogger';

// Enable remote logging in development
// Disabled for now due to recursion issues
// if (import.meta.env.DEV) {
//   enableRemoteConsole();
//   console.log('[MAIN] Remote console logging enabled for development');
// }

/**
 * Application entry point that provides MentraOS authentication context
 * to the entire React component tree
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  // <React.StrictMode>
    <MentraAuthProvider>
      <App />
    </MentraAuthProvider>
  // </React.StrictMode>,
);