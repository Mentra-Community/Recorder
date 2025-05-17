/**
 * Script to clean up corrupted WAV files from temp_storage
 * This automatically runs before starting the development server
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

// Path to storage directory
const STORAGE_DIR = path.join(process.cwd(), 'server/temp_storage');

// Promisify fs functions
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const exists = promisify(fs.exists);

/**
 * Check if a file is a valid WAV file
 * Valid WAV files start with "RIFF" signature
 */
async function isValidWavFile(filePath: string): Promise<boolean> {
  try {
    const fd = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(4);
    
    // Read first 4 bytes to check for RIFF header
    await fd.read(buffer, 0, 4, 0);
    await fd.close();
    
    return buffer.toString() === 'RIFF';
  } catch (error) {
    console.error(`Error checking WAV header for ${filePath}:`, error);
    return false;
  }
}

/**
 * Scan a directory for WAV files
 */
async function scanDirectory(dirPath: string): Promise<string[]> {
  try {
    if (!await exists(dirPath)) {
      return [];
    }
    
    const files = await readdir(dirPath);
    const wavFiles: string[] = [];
    
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const fileStat = await stat(fullPath);
      
      if (fileStat.isDirectory()) {
        // Recursively scan subdirectories
        const subDirFiles = await scanDirectory(fullPath);
        wavFiles.push(...subDirFiles);
      } else if (file.toLowerCase().endsWith('.wav')) {
        // Found a WAV file
        wavFiles.push(fullPath);
      }
    }
    
    return wavFiles;
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
    return [];
  }
}

/**
 * Main function to clean up corrupted WAV files
 */
async function cleanupCorruptedWavFiles() {
  console.log('=== Cleaning up corrupted WAV files ===');
  
  try {
    // Check if storage directory exists
    if (!await exists(STORAGE_DIR)) {
      console.log('No temp_storage directory found, nothing to clean.');
      return;
    }
    
    // Find all WAV files
    const wavFiles = await scanDirectory(STORAGE_DIR);
    
    if (wavFiles.length === 0) {
      console.log('No WAV files found in temp_storage.');
      return;
    }
    
    console.log(`Found ${wavFiles.length} WAV files.`);
    
    // Check each WAV file
    let corruptedCount = 0;
    
    for (const filePath of wavFiles) {
      console.log(`Checking file: ${filePath}`);
      
      const isValid = await isValidWavFile(filePath);
      
      if (!isValid) {
        console.log(`  Corrupted WAV file found: ${filePath}`);
        console.log('  Removing file...');
        
        await unlink(filePath);
        corruptedCount++;
        
        console.log('  File removed.');
      } else {
        console.log('  File appears to be a valid WAV file.');
      }
    }
    
    console.log(`=== Cleanup complete: ${corruptedCount} corrupted files removed ===`);
  } catch (error) {
    console.error('Error during WAV file cleanup:', error);
  }
}

// Run the cleanup function when script is executed
cleanupCorruptedWavFiles();