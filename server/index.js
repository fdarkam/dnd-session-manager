import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import db from './db.js';
import authRoutes from './routes/auth.js';
import sessionRoutes from './routes/sessions.js';
import characterRoutes from './routes/characters.js';
import mapRoutes from './routes/maps.js';
import combatRoutes from './routes/combat.js';
import { setupSocket } from './socket/index.js';
import { authMiddleware } from './middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => cb(null, true),
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

// Ensure upload directories exist
const uploadsDir = path.join(__dirname, 'uploads', 'maps');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/maps', mapRoutes);
app.use('/api/combat', combatRoutes);

// Action logs endpoint
app.get('/api/logs/:sessionId', authMiddleware, (req, res) => {
  try {
    const logs = db.prepare(`SELECT * FROM action_logs WHERE session_id = ? ORDER BY created_at DESC LIMIT 100`)
      .all(req.params.sessionId);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Chat history endpoint
app.get('/api/chat/:sessionId', authMiddleware, (req, res) => {
  try {
    const messages = db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 200`)
      .all(req.params.sessionId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Dice history endpoint
app.get('/api/dice/:sessionId', authMiddleware, (req, res) => {
  try {
    const rolls = db.prepare(`SELECT * FROM dice_rolls WHERE session_id = ? ORDER BY created_at DESC LIMIT 50`)
      .all(req.params.sessionId);
    res.json(rolls);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Setup Socket.IO
setupSocket(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🐉 DND Server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.IO ready\n`);
});
