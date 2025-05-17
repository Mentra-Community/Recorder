/**
 * Stream service
 * Manages SSE (Server-Sent Events) connections for real-time updates
 */

import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

class StreamService {
  private clients: Map<string, Response> = new Map();
  
  /**
   * Add a client connection
   */
  addClient(userId: string, res: Response): string {
    // Generate a unique client ID
    const clientId = `${userId}:${uuidv4()}`;
    
    // Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable Nginx buffering
    });
    
    // Send initial connection confirmation
    res.write('event: connected\ndata: {}\n\n');
    
    // Add to clients map
    this.clients.set(clientId, res);
    
    // Handle client disconnect
    res.on('close', () => {
      this.clients.delete(clientId);
      console.log(`Client disconnected: ${clientId}`);
    });
    
    console.log(`New SSE client connected: ${clientId}`);
    return clientId;
  }
  
  /**
   * Broadcast to all clients
   */
  broadcast(event: string, data: any): void {
    const eventString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    
    this.clients.forEach(client => {
      client.write(eventString);
    });
  }
  
  /**
   * Broadcast to specific user's clients
   */
  broadcastToUser(userId: string, event: string, data: any): void {
    const eventString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    
    this.clients.forEach((client, clientId) => {
      if (clientId.startsWith(`${userId}:`)) {
        client.write(eventString);
      }
    });
  }
  
  /**
   * Get active client count
   */
  getClientCount(): number {
    return this.clients.size;
  }
  
  /**
   * Get client details for debugging
   */
  getClientDetails(): object {
    const clientsByUser: Record<string, number> = {};
    
    // Count clients by user ID
    this.clients.forEach((_, clientId) => {
      const userId = clientId.split(':')[0];
      clientsByUser[userId] = (clientsByUser[userId] || 0) + 1;
    });
    
    return {
      totalCount: this.clients.size,
      userCounts: clientsByUser
    };
  }
  
  /**
   * Check if a user has active connections
   */
  hasActiveConnections(userId: string): boolean {
    for (const clientId of this.clients.keys()) {
      if (clientId.startsWith(`${userId}:`)) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Send a ping to all clients to keep connections alive
   * This is useful for proxies that might close inactive connections
   */
  sendKeepAlive(): void {
    this.clients.forEach(client => {
      client.write(': ping\n\n');
    });
  }
}

// Create a singleton instance
const streamServiceInstance = new StreamService();

// Set up keep-alive pings every 30 seconds
setInterval(() => {
  streamServiceInstance.sendKeepAlive();
}, 30000);

// Export the singleton instance
export default streamServiceInstance;