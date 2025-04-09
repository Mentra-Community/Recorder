import jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

/**
 * Interface for auth code data
 */
interface AuthCode {
  email: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  sessionId?: string;
}

/**
 * Service for handling authentication
 */
export class AuthService {
  // Map to store authentication codes: email -> AuthCode
  private authCodes: Map<string, AuthCode> = new Map();
  
  // JWT secret
  private jwtSecret: string;
  
  // Code expiration time in milliseconds (5 minutes)
  private codeExpirationMs: number = 5 * 60 * 1000;
  
  // Token expiration time in milliseconds (24 hours)
  private tokenExpirationMs: number = 24 * 60 * 60 * 1000;
  
  constructor(jwtSecret: string) {
    this.jwtSecret = jwtSecret;
    
    // Clean expired codes periodically
    setInterval(() => this.cleanExpiredCodes(), 60 * 1000);
  }
  
  /**
   * Generate an authentication code for a user
   * @param email User email
   * @param sessionId Optional active session ID
   * @returns The generated code
   */
  public generateCode(email: string, sessionId?: string): string {
    // Generate a 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    
    // Store code with expiration time
    const now = Date.now();
    this.authCodes.set(email, {
      email,
      code,
      createdAt: now,
      expiresAt: now + this.codeExpirationMs,
      sessionId
    });
    
    return code;
  }
  
  /**
   * Verify an authentication code
   * @param email User email
   * @param code Authentication code
   * @returns True if the code is valid
   */
  public verifyCode(email: string, code: string): boolean {
    const authCode = this.authCodes.get(email);
    
    // Check if code exists and is not expired
    if (!authCode || authCode.expiresAt < Date.now()) {
      return false;
    }
    
    // Check if code matches
    if (authCode.code !== code) {
      return false;
    }
    
    // Remove code after successful verification
    this.authCodes.delete(email);
    
    return true;
  }
  
  /**
   * Generate a JWT token for a user
   * @param email User email
   * @returns JWT token
   */
  public generateToken(email: string): string {
    const payload = {
      email,
      exp: Math.floor((Date.now() + this.tokenExpirationMs) / 1000)
    };
    
    return jwt.sign(payload, this.jwtSecret);
  }
  
  /**
   * Verify a JWT token
   * @param token JWT token
   * @returns The decoded token payload or null if invalid
   */
  public verifyToken(token: string): { email: string } | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as { email: string };
      return decoded;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Get authentication code for a session
   * @param sessionId Session ID
   * @returns The authentication code or null if not found
   */
  public getCodeForSession(sessionId: string): AuthCode | null {
    for (const authCode of this.authCodes.values()) {
      if (authCode.sessionId === sessionId) {
        return authCode;
      }
    }
    
    return null;
  }
  
  /**
   * Clean expired codes
   */
  private cleanExpiredCodes(): void {
    const now = Date.now();
    
    for (const [email, authCode] of this.authCodes.entries()) {
      if (authCode.expiresAt < now) {
        this.authCodes.delete(email);
      }
    }
  }
}