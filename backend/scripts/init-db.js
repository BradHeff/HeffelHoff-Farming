// DB initialization — MongoDB doesn't need explicit table creation but it
// DOES benefit from explicit indexes. Run with `node scripts/init-db.js`
// after a fresh MongoDB to create the users collection + unique email index.
import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/User.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hefflhoff';

async function main() {
  console.log(`[init-db] connecting to ${MONGO_URI} ...`);
  await mongoose.connect(MONGO_URI);
  const conn = mongoose.connection;

  // Ensure the `users` collection exists. Mongoose normally creates it
  // lazily on first insert; this makes it explicit for a fresh DB.
  const existing = await conn.db.listCollections({ name: 'users' }).toArray();
  if (existing.length === 0) {
    console.log('[init-db] creating users collection');
    await conn.db.createCollection('users');
  } else {
    console.log('[init-db] users collection already exists');
  }

  // Build schema indexes (unique email etc.)
  console.log('[init-db] syncing indexes on User model');
  await User.syncIndexes();

  // Sanity: count users so you can see the DB is reachable
  const count = await User.countDocuments();
  console.log(`[init-db] users in DB: ${count}`);

  await mongoose.disconnect();
  console.log('[init-db] done');
}

main().catch((err) => {
  console.error('[init-db] failed:', err);
  process.exit(1);
});
