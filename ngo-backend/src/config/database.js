const mongoose = require('mongoose');

/**
 * Connects to MongoDB using MONGODB_URL from the environment.
 * Resolves once the connection is open; throws on failure so the
 * caller (server.js) can decide how to handle a failed bootstrap.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URL;
  if (!uri) {
    throw new Error('MONGODB_URL is not set in the environment');
  }

  mongoose.set('strictQuery', true);

  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
  });

  console.log(`MongoDB connected: ${conn.connection.host}`);

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });

  return conn;
}

module.exports = connectDB;
