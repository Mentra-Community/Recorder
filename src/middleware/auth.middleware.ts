import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest as SDKAuthenticatedRequest } from '@augmentos/sdk';

/**
 * Middleware that enforces AugmentOS SDK authentication
 * Uses the authUserId property set by the SDK authentication middleware
 */
export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Cast the request to the SDK authenticated request type
  const authRequest = req as SDKAuthenticatedRequest;
  
  // Check if the request is authenticated via SDK
  if (!authRequest.authUserId) {
    return res.status(401).json({ error: 'Unauthorized. Please login via AugmentOS.' });
  }
  
  // Continue to the next middleware/route handler
  next();
};