import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';

export function setupSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Token manquant'));
    try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { next(new Error('Token invalide')); }
  });

  function isMember(sessionId, userId) {
    return !!db.prepare('SELECT id FROM session_members WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  }
  function isDM(sessionId, userId) {
    const m = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
    return m?.role === 'dm';
  }

  io.on('connection', (socket) => {
    console.log(`✅ ${socket.user.username} connected`);

    socket.on('join-session', (sessionId) => {
      if (!isMember(sessionId, socket.user.id)) { socket.emit('error', { message: 'Accès refusé' }); return; }
      socket.join(sessionId);
      socket.sessionId = sessionId;
      socket.to(sessionId).emit('user-joined', { username: socket.user.username, id: socket.user.id });
    });

    socket.on('leave-session', (sessionId) => {
      socket.leave(sessionId);
      socket.to(sessionId).emit('user-left', { username: socket.user.username, id: socket.user.id });
    });

    // ---- Dice ----
    socket.on('dice-roll', (data) => {
      const { sessionId, expression, results, total } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      const roll = {
        id: uuidv4(), session_id: sessionId, user_id: socket.user.id,
        username: socket.user.username, expression,
        results: JSON.stringify(results), total, created_at: new Date().toISOString()
      };
      try {
        db.transaction(() => {
          db.prepare('INSERT INTO dice_rolls (id, session_id, user_id, username, expression, results, total) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(roll.id, roll.session_id, roll.user_id, roll.username, roll.expression, roll.results, roll.total);
          db.prepare('INSERT INTO action_logs (id, session_id, user_id, username, action_type, description) VALUES (?, ?, ?, ?, ?, ?)')
            .run(uuidv4(), sessionId, socket.user.id, socket.user.username, 'dice', `${socket.user.username} lance ${expression} → ${total}`);
        })();
      } catch (err) { console.error('DB dice error:', err); }
      io.to(sessionId).emit('dice-result', { ...roll, results });
    });

    // ---- Chat ----
    socket.on('chat-message', (data) => {
      const { sessionId, content } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      const msg = { id: uuidv4(), session_id: sessionId, user_id: socket.user.id, username: socket.user.username, content, created_at: new Date().toISOString() };
      try { db.prepare('INSERT INTO chat_messages (id, session_id, user_id, username, content) VALUES (?, ?, ?, ?, ?)').run(msg.id, msg.session_id, msg.user_id, msg.username, msg.content); } catch {}
      io.to(sessionId).emit('chat-message', msg);
    });

    // ---- Token: ADD single token ----
    socket.on('map-token-add', (data) => {
      const { sessionId, mapId, token: newToken, allTokens } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      try {
        let tokens;
        if (Array.isArray(allTokens)) {
          // Client sends its full current list — use it directly (avoids DB read race)
          tokens = allTokens;
        } else {
          // Fallback: merge new token into DB state
          const map = db.prepare('SELECT tokens FROM maps WHERE id = ?').get(mapId);
          tokens = JSON.parse(map?.tokens || '[]');
          const idx = tokens.findIndex(t => t.id === newToken.id);
          if (idx >= 0) tokens[idx] = newToken; else tokens.push(newToken);
        }
        db.prepare('UPDATE maps SET tokens = ? WHERE id = ?').run(JSON.stringify(tokens), mapId);
        io.to(sessionId).emit('map-token-update', { mapId, tokens });
      } catch (err) { console.error('DB token-add error:', err); }
    });

    // ---- Token: MOVE/UPDATE — live=true skips DB save (real-time drag) ----
    socket.on('map-token-move', (data) => {
      const { sessionId, mapId, tokens, live } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      if (!live) {
        try { db.prepare('UPDATE maps SET tokens = ? WHERE id = ?').run(JSON.stringify(tokens), mapId); }
        catch (err) { console.error('DB token-move error:', err); }
      }
      socket.to(sessionId).emit('map-token-update', { mapId, tokens, live });
    });

    // ---- Token: DELETE single token ----
    socket.on('map-token-delete', (data) => {
      const { sessionId, mapId, tokenId } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      try {
        const map = db.prepare('SELECT tokens FROM maps WHERE id = ?').get(mapId);
        const tokens = JSON.parse(map?.tokens || '[]').filter(t => t.id !== tokenId);
        db.prepare('UPDATE maps SET tokens = ? WHERE id = ?').run(JSON.stringify(tokens), mapId);
        io.to(sessionId).emit('map-token-update', { mapId, tokens });
      } catch (err) { console.error('DB token-delete error:', err); }
    });

    // ---- Drawing: live stroke segment (no DB — broadcast only) ----
    socket.on('map-drawing-live', (data) => {
      const { sessionId, ...rest } = data;
      socket.to(sessionId).emit('map-drawing-live', rest);
    });

    // ---- Drawing: stroke finalized (broadcast clear-live signal) ----
    socket.on('map-drawing-finalize', (data) => {
      const { sessionId, pathId } = data;
      socket.to(sessionId).emit('map-drawing-finalize', { pathId });
    });

    // ---- Drawing ----
    socket.on('map-drawing', (data) => {
      const { sessionId, mapId, path } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      try {
        const map = db.prepare('SELECT drawings FROM maps WHERE id = ?').get(mapId);
        const drawings = JSON.parse(map?.drawings || '[]');
        drawings.push(path);
        db.prepare('UPDATE maps SET drawings = ? WHERE id = ?').run(JSON.stringify(drawings), mapId);
      } catch {}
      socket.to(sessionId).emit('map-drawing-update', { mapId, path });
    });

    socket.on('map-drawing-erase', (data) => {
      const { sessionId, mapId, erasedIds } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      try {
        const map = db.prepare('SELECT drawings FROM maps WHERE id = ?').get(mapId);
        const kept = JSON.parse(map?.drawings || '[]').filter(p => !erasedIds.includes(p.id));
        db.prepare('UPDATE maps SET drawings = ? WHERE id = ?').run(JSON.stringify(kept), mapId);
      } catch {}
      socket.to(sessionId).emit('map-drawings-erased', { mapId, erasedIds });
    });

    socket.on('map-drawings-clear', (data) => {
      const { sessionId, mapId } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      try { db.prepare('UPDATE maps SET drawings = ? WHERE id = ?').run('[]', mapId); } catch {}
      socket.to(sessionId).emit('map-drawings-cleared', { mapId });
    });

    // ---- Map uploaded — notify other clients to refresh their list ----
    socket.on('map-uploaded', (data) => {
      const { sessionId } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      socket.to(sessionId).emit('map-list-updated');
    });

    // ---- Map switch (per-map independent tokens) ----
    socket.on('map-change', (data) => {
      const { sessionId, mapId, currentMapId, tokens: currentTokens } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      let mapData = null;
      try {
        const newMap = db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId);
        if (newMap) {
          db.transaction(() => {
            if (currentMapId && currentTokens !== undefined)
              db.prepare('UPDATE maps SET tokens = ? WHERE id = ?').run(JSON.stringify(currentTokens), currentMapId);
            db.prepare('UPDATE maps SET is_active = 0 WHERE session_id = ?').run(newMap.session_id);
            db.prepare('UPDATE maps SET is_active = 1 WHERE id = ?').run(mapId);
          })();
          mapData = db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId);
        }
      } catch (err) { console.error('DB map-change error:', err); }
      io.to(sessionId).emit('map-changed', { mapId, map: mapData });
    });

    // ---- Map image transform (move/resize) ----
    socket.on('map-image-transform', (data) => {
      const { sessionId, mapId, img_x, img_y, img_scale } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      try {
        db.prepare('UPDATE maps SET img_x = ?, img_y = ?, img_scale = ? WHERE id = ?')
          .run(Math.round(img_x || 0), Math.round(img_y || 0), img_scale || 1.0, mapId);
      } catch (err) { console.error('DB transform error:', err); }
      socket.to(sessionId).emit('map-image-updated', { mapId, img_x, img_y, img_scale });
    });

    // ---- Map delete ----
    socket.on('map-delete', (data) => {
      const { sessionId, mapId } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      try { db.prepare('DELETE FROM maps WHERE id = ?').run(mapId); } catch {}
      socket.to(sessionId).emit('map-deleted', { mapId });
    });

    // ---- Fog of war — live preview (no DB, same pattern as map-drawing-live) ----
    socket.on('map-fog-live', (data) => {
      const { sessionId, mapId, fogCells, gridSize } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      socket.to(sessionId).emit('map-fog-live', { mapId, fogCells, gridSize });
    });

    // ---- Fog of war — final save ----
    socket.on('map-fog-paint', (data) => {
      const { sessionId, mapId, fogCells, gridSize } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      try {
        const fogData = JSON.stringify({ cells: fogCells || [], gs: gridSize || 40 });
        db.prepare('UPDATE maps SET fog_data = ? WHERE id = ?').run(fogData, mapId);
      } catch {}
      socket.to(sessionId).emit('map-fog-update', { mapId, fogCells, gridSize });
    });

    // ---- Real-time cursor positions ----
    socket.on('cursor-move', (data) => {
      const { sessionId, x, y } = data;
      socket.to(sessionId).emit('cursor-update', { userId: socket.user.id, username: socket.user.username, x, y });
    });

    // ---- Ping (click to draw attention) ----
    socket.on('map-ping', (data) => {
      const { sessionId, x, y } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      io.to(sessionId).emit('map-ping', { x, y, username: socket.user.username });
    });

    // ---- Combat ----
    socket.on('combat-update', (data) => {
      const { sessionId, encounter } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      try {
        if (encounter)
          db.prepare('UPDATE combat_encounters SET entities = ?, current_turn = ?, round = ? WHERE id = ?')
            .run(JSON.stringify(encounter.entities), encounter.current_turn, encounter.round, encounter.id);
      } catch {}
      socket.to(sessionId).emit('combat-updated', encounter);
    });

    socket.on('combat-next-turn', (data) => {
      const { sessionId, encounter } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      io.to(sessionId).emit('combat-turn-changed', encounter);
      if (encounter?.entities) {
        const entities = typeof encounter.entities === 'string' ? JSON.parse(encounter.entities) : encounter.entities;
        const active = entities[encounter.current_turn];
        if (active) io.to(sessionId).emit('notification', { type: 'turn', message: `C'est au tour de ${active.name} !`, entity: active });
      }
    });

    // ---- Character sync ----
    socket.on('character-update', (data) => {
      const { sessionId, character } = data;
      socket.to(sessionId).emit('character-updated', character);
    });

    socket.on('disconnect', () => {
      if (socket.sessionId) socket.to(socket.sessionId).emit('user-left', { username: socket.user.username, id: socket.user.id });
      console.log(`❌ ${socket.user.username} disconnected`);
    });
  });
}
