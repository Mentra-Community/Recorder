import dotenv from "dotenv";
import mongoose from 'mongoose';

dotenv.config();
const MONGODB_URI: string | undefined = process.env.MONGODB_URI;
const NODE_ENV: string | undefined = process.env.NODE_ENV;
const IS_PROD = NODE_ENV === 'production';

// Connect to mongo db.
export async function init(): Promise<void> {
  if (!MONGODB_URI) throw "MONGODB_URI is undefined";
  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(MONGODB_URI);
    console.info('Mongoose Connected');
  }
  catch (error) {
    console.error(`Unable to connect to database(${MONGODB_URI}) ${error}`);
    throw error;
  }
}