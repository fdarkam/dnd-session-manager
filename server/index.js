import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import db from './db.js';
import authRoutes, { setAuthIo } from './routes/auth.js';
import sessionRoutes from './routes/sessions.js';
import characterRoutes, { setIo as setCharacterIo } from './routes/characters.js';
import mapRoutes from './routes/maps.js';
import combatRoutes from './routes/combat.js';
import questRoutes from './routes/quests.js';
import wikiRoutes, { setWikiIo } from './routes/wiki.js';
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
app.use('/api/quests', questRoutes);
app.use('/api/wiki', wikiRoutes);

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
// Le MJ voit tous les messages (y compris les privés).
// Un joueur ne voit que les messages publics + les privés qui lui sont destinés ou qu'il a envoyés.
app.get('/api/chat/:sessionId', authMiddleware, (req, res) => {
  try {
    const member = db.prepare(
      'SELECT role FROM session_members WHERE session_id = ? AND user_id = ?'
    ).get(req.params.sessionId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Accès refusé' });

    let messages;
    if (member.role === 'dm') {
      // MJ : tout voir
      messages = db.prepare(
        'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 200'
      ).all(req.params.sessionId);
    } else {
      // Joueur : messages publics + messages privés le concernant
      messages = db.prepare(`
        SELECT * FROM chat_messages
        WHERE session_id = ?
          AND (target_user_id IS NULL OR target_user_id = ? OR user_id = ?)
        ORDER BY created_at ASC LIMIT 200
      `).all(req.params.sessionId, req.user.id, req.user.id);
    }

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
setCharacterIo(io);
setWikiIo(io);
setAuthIo(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🐉 DND Server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.IO ready\n`);
});
