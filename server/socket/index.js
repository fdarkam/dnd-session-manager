import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';

export function setupSocket(io) {
  // Auth middleware for sockets
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Token manquant'));
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Token invalide'));
    }
  });

  // Helper: check session membership from socket
  function isMember(sessionId, userId) {
    return !!db.prepare('SELECT id FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(sessionId, userId);
  }

  function isDM(sessionId, userId) {
    const m = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(sessionId, userId);
    return m?.role === 'dm';
  }

  io.on('connection', (socket) => {
    console.log(`✅ ${socket.user.username} connected`);

    // --- Room management ---
    socket.on('join-session', (sessionId) => {
      if (!isMember(sessionId, socket.user.id)) {
        socket.emit('error', { message: 'Accès refusé à cette session' });
        return;
      }
      socket.join(sessionId);
      socket.sessionId = sessionId;
      socket.to(sessionId).emit('user-joined', {
        username: socket.user.username,
        id: socket.user.id
      });
    });

    socket.on('leave-session', (sessionId) => {
      socket.leave(sessionId);
      socket.to(sessionId).emit('user-left', {
        username: socket.user.username,
        id: socket.user.id
      });
    });

    // --- Dice rolling ---
    socket.on('dice-roll', (data) => {
      const { sessionId, expression, results, total } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      const roll = {
        id: uuidv4(),
        session_id: sessionId,
        user_id: socket.user.id,
        username: socket.user.username,
        expression,
        results: JSON.stringify(results),
        total,
        created_at: new Date().toISOString()
      };

      try {
        const saveDiceRoll = db.transaction(() => {
          db.prepare(`INSERT INTO dice_rolls (id, session_id, user_id, username, expression, results, total)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(roll.id, roll.session_id, roll.user_id, roll.username, roll.expression, roll.results, roll.total);
          db.prepare(`INSERT INTO action_logs (id, session_id, user_id, username, action_type, description)
            VALUES (?, ?, ?, ?, ?, ?)`)
            .run(uuidv4(), sessionId, socket.user.id, socket.user.username, 'dice',
              `${socket.user.username} lance ${expression} → ${total}`);
        });
        saveDiceRoll();
      } catch (err) {
        console.error('DB dice error:', err);
      }

      io.to(sessionId).emit('dice-result', { ...roll, results });
    });

    // --- Chat ---
    socket.on('chat-message', (data) => {
      const { sessionId, content } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      const msg = {
        id: uuidv4(),
        session_id: sessionId,
        user_id: socket.user.id,
        username: socket.user.username,
        content,
        created_at: new Date().toISOString()
      };

      try {
        db.prepare(`INSERT INTO chat_messages (id, session_id, user_id, username, content)
          VALUES (?, ?, ?, ?, ?)`)
          .run(msg.id, msg.session_id, msg.user_id, msg.username, msg.content);
      } catch (err) {
        console.error('DB chat error:', err);
      }

      io.to(sessionId).emit('chat-message', msg);
    });

    // --- Map updates ---
    socket.on('map-token-move', (data) => {
      const { sessionId, mapId, tokens } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      socket.to(sessionId).emit('map-token-update', { mapId, tokens });
    });

    socket.on('map-drawing', (data) => {
      const { sessionId } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      socket.to(sessionId).emit('map-drawing-update', data);
    });

    socket.on('map-change', (data) => {
      const { sessionId, mapId, tokens } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      let mapData = null;
      try {
        const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId);
        if (map) {
          const switchMap = db.transaction(() => {
            if (tokens) {
              db.prepare('UPDATE maps SET tokens = ? WHERE id = ?').run(JSON.stringify(tokens), mapId);
            }
            db.prepare('UPDATE maps SET is_active = 0 WHERE session_id = ?').run(map.session_id);
            db.prepare('UPDATE maps SET is_active = 1 WHERE id = ?').run(mapId);
          });
          switchMap();
          mapData = db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId);
        }
      } catch (err) {
        console.error('DB map-change error:', err);
      }
      socket.to(sessionId).emit('map-changed', { mapId, map: mapData });
    });

    // --- Combat ---
    socket.on('combat-update', (data) => {
      const { sessionId, encounter } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      try {
        if (encounter) {
          db.prepare('UPDATE combat_encounters SET entities = ?, current_turn = ?, round = ? WHERE id = ?')
            .run(JSON.stringify(encounter.entities), encounter.current_turn, encounter.round, encounter.id);
        }
      } catch (err) {
        console.error('DB combat error:', err);
      }
      socket.to(sessionId).emit('combat-updated', encounter);
    });

    socket.on('combat-next-turn', (data) => {
      const { sessionId, encounter } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      io.to(sessionId).emit('combat-turn-changed', encounter);

      // Notification for active entity
      if (encounter && encounter.entities) {
        const entities = typeof encounter.entities === 'string'
          ? JSON.parse(encounter.entities) : encounter.entities;
        const active = entities[encounter.current_turn];
        if (active) {
          io.to(sessionId).emit('notification', {
            type: 'turn',
            message: `C'est au tour de ${active.name} !`,
            entity: active
          });
        }
      }
    });

    // --- Fog of war ---
    socket.on('map-fog-toggle', (data) => {
      const { sessionId, mapId, enabled } = data;
      try {
        db.prepare('UPDATE maps SET fog_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, mapId);
      } catch (err) {
        console.error('DB fog error:', err);
      }
      socket.to(sessionId).emit('map-fog-update', { mapId, enabled });
    });

    // --- Character live sync ---
    socket.on('character-update', (data) => {
      const { sessionId, character } = data;
      socket.to(sessionId).emit('character-updated', character);
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
      if (socket.sessionId) {
        socket.to(socket.sessionId).emit('user-left', {
          username: socket.user.username,
          id: socket.user.id
        });
      }
      console.log(`❌ ${socket.user.username} disconnected`);
    });
  });
}
