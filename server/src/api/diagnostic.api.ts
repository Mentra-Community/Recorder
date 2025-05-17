/**
 * Diagnostic API
 * Simple endpoint to provide a diagnostic HTML page
 */

import { Router } from 'express';
import { Request, Response } from 'express';
import streamService from '../services/stream.service';

const router = Router();

/**
 * GET /api/diagnostic
 * Returns an HTML diagnostic page that can be loaded directly
 */
router.get('/', (req: Request, res: Response) => {
  // Send a simple HTML page that will test loading JavaScript
  res.setHeader('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagnostic Page</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .card {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .log {
      background-color: #f5f5f5;
      padding: 10px;
      border-radius: 4px;
      max-height: 200px;
      overflow-y: auto;
      font-family: monospace;
      white-space: pre-wrap;
    }
    .success { color: green; }
    .error { color: red; }
    button {
      padding: 8px 16px;
      background-color: #0066cc;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1>Diagnostic Page</h1>
  <p>This page tests if JavaScript and API requests are working properly.</p>
  
  <div class="card">
    <h2>1. JavaScript</h2>
    <div id="js-test" class="log">Checking JavaScript execution...</div>
  </div>
  
  <div class="card">
    <h2>2. API Connection</h2>
    <button id="test-api">Test API Connection</button>
    <div id="api-test" class="log">Click the button to test API connection...</div>
  </div>
  
  <div class="card">
    <h2>3. Browser Information</h2>
    <div id="browser-info" class="log">Loading browser info...</div>
  </div>
  
  <div class="card">
    <h2>4. Environment</h2>
    <div id="env-info" class="log">Loading environment info...</div>
  </div>
  
  <script>
    // Test 1: JavaScript execution
    const jsTest = document.getElementById('js-test');
    try {
      jsTest.innerHTML = '<span class="success">✓ JavaScript is working!</span>';
      
      // Add window.onerror handler
      window.onerror = function(message, source, lineno, colno, error) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.textContent = \`Error: \${message} at \${source}:\${lineno}\`;
        jsTest.appendChild(errorDiv);
        return false;
      };
    } catch (e) {
      jsTest.innerHTML = \`<span class="error">✗ JavaScript error: \${e.message}</span>\`;
    }
    
    // Test 2: API Connection
    const apiTest = document.getElementById('api-test');
    const testApiBtn = document.getElementById('test-api');
    
    testApiBtn.addEventListener('click', async () => {
      apiTest.innerHTML = 'Testing API connection...';
      try {
        const response = await fetch('/api/transcripts');
        if (!response.ok) {
          throw new Error(\`HTTP error! Status: \${response.status}\`);
        }
        const data = await response.json();
        apiTest.innerHTML = \`<span class="success">✓ API connection successful!</span>\\n\${JSON.stringify(data, null, 2)}\`;
      } catch (e) {
        apiTest.innerHTML = \`<span class="error">✗ API connection failed: \${e.message}</span>\`;
      }
    });
    
    // Test 3: Browser Information
    const browserInfo = document.getElementById('browser-info');
    try {
      const info = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        vendor: navigator.vendor,
        language: navigator.language,
        cookiesEnabled: navigator.cookieEnabled,
        screenSize: \`\${window.screen.width}x\${window.screen.height}\`,
        windowSize: \`\${window.innerWidth}x\${window.innerHeight}\`
      };
      
      browserInfo.innerHTML = JSON.stringify(info, null, 2);
    } catch (e) {
      browserInfo.innerHTML = \`<span class="error">✗ Error getting browser info: \${e.message}</span>\`;
    }
    
    // Test 4: Environment
    const envInfo = document.getElementById('env-info');
    try {
      const info = {
        hostname: window.location.hostname,
        protocol: window.location.protocol,
        port: window.location.port,
        pathname: window.location.pathname,
        baseUrl: window.location.origin,
        headers: 'Cannot display request headers client-side',
        timestamp: new Date().toISOString()
      };
      
      envInfo.innerHTML = JSON.stringify(info, null, 2);
    } catch (e) {
      envInfo.innerHTML = \`<span class="error">✗ Error getting environment info: \${e.message}</span>\`;
    }
  </script>
</body>
</html>
  `);
});

/**
 * GET /api/diagnostic/sse
 * Returns information about active SSE connections
 */
router.get('/sse', (req: Request, res: Response) => {
  const sseStatus = streamService.getClientDetails();
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    sse: sseStatus
  });
});

/**
 * POST /api/diagnostic/broadcast-test
 * Broadcasts a test message to all SSE clients
 */
router.post('/broadcast-test', (req: Request, res: Response) => {
  const testMessage = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toISOString(),
    text: `Test broadcast message at ${new Date().toLocaleTimeString()}`,
    speakerName: 'Diagnostic API',
    durationMs: 1000
  };
  
  streamService.broadcast('transcript', testMessage);
  
  res.json({
    status: 'ok',
    message: 'Test message broadcast to all clients',
    timestamp: new Date().toISOString(),
    clientCount: streamService.getClientCount()
  });
});

export default router;