/**
 * Migration script to update any existing recordings
 * Copies 'id' to '_id' field and removes old 'id' field
 */

import mongoose from 'mongoose';
import * as mongodbConnection from '../connections/mongodb.connection';
import { Recording } from '../models/recording.models';

async function migrateRecords() {
  try {
    // Connect to MongoDB
    await mongodbConnection.init();
    console.log('Connected to MongoDB');

    // Get all existing recordings that still have the legacy 'id' field
    const recordingsToMigrate = await mongoose.connection.db.collection('recordings').find({ id: { $exists: true } }).toArray();

    console.log(`Found ${recordingsToMigrate.length} recordings to migrate`);

    for (const oldRecording of recordingsToMigrate) {
      console.log(`Migrating recording: ${oldRecording.id} -> ${oldRecording._id}`);

      try {
        // Update the record to remove the id field
        await mongoose.connection.db.collection('recordings').updateOne(
          { _id: oldRecording._id },
          { $unset: { id: "" } }
        );

        console.log(`  Migrated recording: ${oldRecording._id}`);
      } catch (updateError) {
        console.error(`  Error updating recording ${oldRecording._id}:`, updateError);
      }
    }

    console.log('Migration completed');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
migrateRecords();