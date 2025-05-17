import { Request, Response, NextFunction } from 'express';

// Define the extended request interface
export interface AuthenticatedRequest extends Request {
    userId?: string;
}

// Create the middleware
export const isaiahMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    // Cast the request to AuthenticatedRequest
    (req as AuthenticatedRequest).userId = 'isaiah@mentra.glass';
    
    // Continue to the next middleware/route handler
    next();
};