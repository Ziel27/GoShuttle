const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    const maxPoolSize = parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10', 10);
    const minPoolSize = parseInt(process.env.MONGODB_MIN_POOL_SIZE || '2', 10);

    const conn = await mongoose.connect(mongoUri, {
      maxPoolSize,
      minPoolSize,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 10000,
      retryWrites: true,
      w: 'majority',
    });

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
    console.log(`   Pool size: ${minPoolSize}-${maxPoolSize} connections`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
