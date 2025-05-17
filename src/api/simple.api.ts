/**
 * Simple Test API
 * Direct HTML page for debugging
 */

import { Router } from 'express';
import { Request, Response } from 'express';

const router = Router();

/**
 * GET /api/simple
 * Returns a simple HTML page for direct testing
 */
router.get('/', (req: Request, res: Response) => {
  console.log(`[SIMPLE] Request received from ${req.headers['user-agent']}`);
  
  // Send a simple HTML page that works directly (no proxying)
  res.setHeader('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Simple Test Page</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .card {
      background: #f0f0f0;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    #results {
      background: #eef;
      padding: 12px;
      border-radius: 4px;
      white-space: pre-wrap;
      font-family: monospace;
    }
    button {
      background: #0066cc;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1>Simple Test Page</h1>
  <p>This page is served directly by the server without proxying.</p>
  
  <div class="card">
    <h2>API Test</h2>
    <button id="test-btn">Test API Connection</button>
    <div id="results">Results will appear here...</div>
  </div>
  
  <div class="card">
    <h2>Browser Info</h2>
    <div id="browser-info"></div>
  </div>
  
  <script>
    console.log('Script running in simple test page');
    
    // Show browser info
    document.getElementById('browser-info').textContent = 
      navigator.userAgent + '\\n' +
      'URL: ' + window.location.href;
    
    // Set up test button
    document.getElementById('test-btn').addEventListener('click', async function() {
      const results = document.getElementById('results');
      results.textContent = 'Testing API connection...';
      
      try {
        const startTime = Date.now();
        const response = await fetch('/api/transcripts');
        const endTime = Date.now();
        
        if (!response.ok) {
          throw new Error('HTTP Error: ' + response.status);
        }
        
        const data = await response.json();
        results.textContent = 'Success! (' + (endTime - startTime) + 'ms)\\n' + 
                             JSON.stringify(data, null, 2);
      } catch (error) {
        results.textContent = 'Error: ' + error.message;
        console.error('API test error:', error);
      }
    });
  </script>
</body>
</html>
  `);
});

export default router;