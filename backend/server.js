import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from './models/User.js';

const PORT = process.env.PORT || 5001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hefflhoff';
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '512kb' }));

// ---------- auth helpers ----------
function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), email: user.email }, JWT_SECRET, {
    expiresIn: '365d',
  });
}

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// ---------- routes ----------
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
    if (password.length < 4) return res.status(400).json({ error: 'password_too_short' });
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: 'email_taken' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email: email.toLowerCase().trim(), passwordHash });
    return res.json({ token: signToken(user), user: user.toSafeJSON() });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'bad_credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'bad_credentials' });
    return res.json({ token: signToken(user), user: user.toSafeJSON() });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Return the current user's game state (null if none yet).
app.get('/api/save', authRequired, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  return res.json({ gameState: user.gameState || null, savedAt: user.savedAt });
});

// Overwrite the current user's game state.
app.put('/api/save', authRequired, async (req, res) => {
  const { gameState } = req.body || {};
  if (!gameState || typeof gameState !== 'object') {
    return res.status(400).json({ error: 'invalid_state' });
  }
  const now = new Date();
  await User.findByIdAndUpdate(req.userId, {
    $set: { gameState, savedAt: now },
  });
  return res.json({ ok: true, savedAt: now });
});

// Reset the save slot — e.g. "start over" button.
app.delete('/api/save', authRequired, async (req, res) => {
  await User.findByIdAndUpdate(req.userId, {
    $set: { gameState: null, savedAt: null },
  });
  return res.json({ ok: true });
});

// ---------- boot ----------
async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`[hefflhoff-backend] Mongo connected: ${MONGO_URI}`);
  app.listen(PORT, () => {
    console.log(`[hefflhoff-backend] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('startup error:', err);
  process.exit(1);
});
