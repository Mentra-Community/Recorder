import axios from 'axios';
import * as fs from 'fs';

/**
 * Metadata interface for recording information
 */
interface RecordingMetadata {
  userId: string;
  sessionId: string;
  duration: string;
  timestamp: string;
  transcriptText?: string;
  language?: string;
}

/**
 * Service for sending recordings via email using Resend API
 */
export class EmailService {
  private apiKey: string;
  private fromEmail: string = 'recorder@augmentos.cloud';
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Send an email with a verification code
   * @param toEmail Email address to send to
   * @param code Verification code
   * @returns True if email was sent successfully
   */
  public async sendVerificationEmail(toEmail: string, code: string): Promise<boolean> {
    try {
      // Prepare email content
      const emailContent = this.createVerificationEmailContent(code);
      
      // Send email with Resend API
      const response = await axios.post('https://api.resend.com/emails', {
        from: this.fromEmail,
        to: toEmail,
        subject: 'Your AugmentOS Verification Code',
        html: emailContent
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`Verification email sent to ${toEmail}`);
      return true;
    } catch (error) {
      console.error('Error sending verification email:', error);
      return false;
    }
  }

  /**
   * Create verification email content
   * @param code Verification code
   * @returns HTML email content
   */
  private createVerificationEmailContent(code: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #0066cc; color: white; padding: 15px; border-radius: 5px 5px 0 0; }
          .content { padding: 20px; background-color: #fff; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
          .code { margin: 20px 0; padding: 20px; background-color: #f5f5f5; border-radius: 5px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; }
          .footer { margin-top: 20px; font-size: 12px; color: #777; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Your Verification Code</h1>
          </div>
          <div class="content">
            <p>Use the following code to verify your identity in the AugmentOS Audio Recorder webview:</p>
            <div class="code">${code}</div>
            <p>This code will expire in 5 minutes.</p>
            <p>If you didn't request this code, you can safely ignore this email.</p>
          </div>
          <div class="footer">
            <p>This is an automated message from AugmentOS Recorder App.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Send a recording via email
   * @param toEmail Recipient email address
   * @param audioFilePath Path to the audio file to attach
   * @param metadata Additional metadata about the recording
   * @returns Success status
   */
  public async sendRecordingEmail(
    toEmail: string, 
    audioFilePath: string, 
    metadata: RecordingMetadata
  ): Promise<boolean> {
    try {
      console.log(`Preparing to send recording email to ${toEmail}`);
      
      // Read the file as base64
      const fileBuffer = await fs.promises.readFile(audioFilePath);
      const fileBase64 = fileBuffer.toString('base64');
      const fileName = audioFilePath.split('/').pop() || 'recording.wav';
      
      // Format email content
      const formattedDate = new Date(metadata.timestamp).toLocaleString();
      const emailContent = this.createEmailContent(metadata, formattedDate);
      
      // Configure Resend API request
      const response = await axios.post(
        'https://api.resend.com/emails',
        {
          from: this.fromEmail,
          to: toEmail,
          subject: `Your Recording from ${formattedDate}`,
          html: emailContent,
          attachments: [
            {
              filename: fileName,
              content: fileBase64
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`Email sent successfully: ${response.data.id}`);
      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }

  /**
   * Send a notification email when there's no recording
   */
  public async sendNotificationEmail(
    toEmail: string,
    subject: string,
    message: string
  ): Promise<boolean> {
    try {
      const response = await axios.post(
        'https://api.resend.com/emails',
        {
          from: this.fromEmail,
          to: toEmail,
          subject: subject,
          html: `<p>${message}</p>`
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`Notification email sent successfully: ${response.data.id}`);
      return true;
    } catch (error) {
      console.error('Error sending notification email:', error);
      return false;
    }
  }

  /**
   * Create HTML content for the email
   */
  private createEmailContent(metadata: RecordingMetadata, formattedDate: string): string {
    const transcriptSection = metadata.transcriptText 
      ? `
        <h2>Transcript:</h2>
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 10px; white-space: pre-wrap;">
          ${metadata.transcriptText}
        </div>
      `
      : '<p>No transcript available for this recording.</p>';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #0066cc; color: white; padding: 15px; border-radius: 5px 5px 0 0; }
          .content { padding: 20px; background-color: #fff; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
          .footer { margin-top: 20px; font-size: 12px; color: #777; text-align: center; }
          .info-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          .info-table td { padding: 8px; border-bottom: 1px solid #ddd; }
          .info-table td:first-child { font-weight: bold; width: 30%; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Your Recording</h1>
          </div>
          <div class="content">
            <p>Here is your audio recording from AugmentOS Glasses.</p>
            
            <table class="info-table">
              <tr>
                <td>Date:</td>
                <td>${formattedDate}</td>
              </tr>
              <tr>
                <td>Duration:</td>
                <td>${metadata.duration}</td>
              </tr>
              ${metadata.language ? `<tr><td>Language:</td><td>${metadata.language}</td></tr>` : ''}
            </table>
            
            ${transcriptSection}
            
            <p>You can find the audio file attached to this email.</p>
          </div>
          <div class="footer">
            <p>This is an automated message from AugmentOS Recorder App.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}