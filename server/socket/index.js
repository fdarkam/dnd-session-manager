import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';

export function setupSocket(io) {
  // Authentification JWT sur chaque connexion socket
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Token manquant'));
    try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { next(new Error('Token invalide')); }
  });

  // ─── Présence ──────────────────────────────────────────────────────────────
  // Map<sessionId, Set<userId>> — qui est connecté dans chaque session
  const sessionPresence = new Map();

  function isMember(sessionId, userId) {
    return !!db.prepare('SELECT id FROM session_members WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  }
  function isDM(sessionId, userId) {
    const m = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
    return m?.role === 'dm';
  }

  // Émet map-token-update vers chaque socket de la session avec filtrage des tokens cachés.
  // excludeSocketId: socket à ignorer (l'émetteur lors des déplacements live).
  // Préserve les tokens cachés stockés en DB quand un non-MJ envoie une liste partielle.
  // Sans cette fusion, un joueur qui déplace un token enverrait une liste sans les tokens cachés,
  // et le serveur écraserait la DB en les effaçant.
  function mergeWithHidden(mapId, receivedTokens) {
    try {
      const map = db.prepare('SELECT tokens FROM maps WHERE id = ?').get(mapId);
      const dbTokens = JSON.parse(map?.tokens || '[]');
      const hiddenTokens = dbTokens.filter(t => t.hidden);
      const receivedIds = new Set(receivedTokens.map(t => t.id));
      return [...receivedTokens, ...hiddenTokens.filter(t => !receivedIds.has(t.id))];
    } catch { return receivedTokens; }
  }

  function broadcastTokens(sessionId, mapId, allTokens, live, excludeSocketId) {
    const room = io.sockets.adapter.rooms.get(sessionId);
    if (!room) return;
    for (const socketId of room) {
      if (excludeSocketId && socketId === excludeSocketId) continue;
      const s = io.sockets.sockets.get(socketId);
      if (!s) continue;
      const tokens = isDM(sessionId, s.user.id)
        ? allTokens
        : allTokens.filter(t => !t.hidden);
      s.emit('map-token-update', { mapId, tokens, live });
    }
  }

  io.on('connection', (socket) => {
    console.log(`✅ ${socket.user.username} connecté`);

    // Rejoindre une room personnelle pour recevoir les messages privés même si dans plusieurs onglets
    socket.join(`user:${socket.user.id}`);

    // ---- Rejoindre une session ----
    socket.on('join-session', (sessionId) => {
      if (!isMember(sessionId, socket.user.id)) {
        socket.emit('error', { message: 'Accès refusé' });
        return;
      }
      socket.join(sessionId);
      socket.sessionId = sessionId;

      // Mettre à jour la présence : ajouter cet utilisateur à la session
      if (!sessionPresence.has(sessionId)) sessionPresence.set(sessionId, new Set());
      sessionPresence.get(sessionId).add(socket.user.id);

      // Envoyer au socket rejoignant la liste des utilisateurs déjà en ligne dans cette session
      socket.emit('online-users', { sessionId, userIds: [...sessionPresence.get(sessionId)] });

      // Notifier les autres membres qu'un utilisateur vient de rejoindre (avec son rôle)
      const joiningRole = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?')
        .get(sessionId, socket.user.id)?.role || 'player';
      socket.to(sessionId).emit('user-joined', { username: socket.user.username, id: socket.user.id, role: joiningRole });

      // Envoyer l'état actuel de la map active UNIQUEMENT à ce socket (pas broadcast).
      // Déclenché à chaque join-session, y compris après reconnexion automatique.
      try {
        const activeMap = db.prepare(
          'SELECT * FROM maps WHERE session_id = ? AND is_active = 1'
        ).get(sessionId);

        if (activeMap) {
          let fogCells = [];
          let gridSize = 40;
          try {
            const raw = JSON.parse(activeMap.fog_data || '[]');
            fogCells = Array.isArray(raw) ? raw : (raw.cells || []);
            gridSize = Array.isArray(raw) ? 40 : (raw.gs || 40);
          } catch {}

          const allMapTokens = JSON.parse(activeMap.tokens || '[]');
          const syncTokens = isDM(sessionId, socket.user.id)
            ? allMapTokens
            : allMapTokens.filter(t => !t.hidden);
          socket.emit('map-sync', {
            mapId:    activeMap.id,
            tokens:   syncTokens,
            drawings: JSON.parse(activeMap.drawings  || '[]'),
            fogCells,
            gridSize,
            img_x:     activeMap.img_x    || 0,
            img_y:     activeMap.img_y    || 0,
            img_scale: activeMap.img_scale || 1.0,
          });
        }
      } catch (err) {
        console.error('Erreur map-sync :', err);
      }
    });

    socket.on('leave-session', (sessionId) => {
      socket.leave(sessionId);
      // Retirer de la présence si le joueur quitte explicitement
      const users = sessionPresence.get(sessionId);
      if (users) {
        users.delete(socket.user.id);
        if (users.size === 0) sessionPresence.delete(sessionId);
      }
      socket.to(sessionId).emit('user-left', { username: socket.user.username, id: socket.user.id });
    });

    // ---- Dés ----
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
      const { sessionId, content, targetUserId } = data;
      if (!isMember(sessionId, socket.user.id)) return;

      const msg = {
        id: uuidv4(), session_id: sessionId, user_id: socket.user.id,
        username: socket.user.username, content,
        target_user_id: targetUserId || null,
        created_at: new Date().toISOString()
      };

      // Persister en DB (target_user_id stocké pour filtrage côté GET /api/chat)
      try {
        db.prepare(
          'INSERT INTO chat_messages (id, session_id, user_id, username, content, target_user_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(msg.id, msg.session_id, msg.user_id, msg.username, msg.content, msg.target_user_id);
      } catch {}

      if (targetUserId) {
        // Message privé MJ → joueur ciblé :
        //   - envoyer à la room personnelle du joueur (gère les onglets multiples)
        //   - renvoyer en retour au MJ pour qu'il voie son propre message
        io.to(`user:${targetUserId}`).emit('chat-message', msg);
        socket.emit('chat-message', msg);
      } else {
        // Message public : diffuser à toute la session
        io.to(sessionId).emit('chat-message', msg);
      }
    });

    // ---- Token : ajout ----
    socket.on('map-token-add', (data) => {
      const { sessionId, mapId, token: newToken, allTokens } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      try {
        let tokens;
        if (Array.isArray(allTokens)) {
          tokens = isDM(sessionId, socket.user.id) ? allTokens : mergeWithHidden(mapId, allTokens);
        } else {
          const map = db.prepare('SELECT tokens FROM maps WHERE id = ?').get(mapId);
          tokens = JSON.parse(map?.tokens || '[]');
          const idx = tokens.findIndex(t => t.id === newToken.id);
          if (idx >= 0) tokens[idx] = newToken; else tokens.push(newToken);
        }
        db.prepare('UPDATE maps SET tokens = ? WHERE id = ?').run(JSON.stringify(tokens), mapId);
        broadcastTokens(sessionId, mapId, tokens, false, null);
      } catch (err) { console.error('DB token-add error:', err); }
    });

    // ---- Token : déplacement — live=true ne persiste pas (drag temps réel) ----
    socket.on('map-token-move', (data) => {
      const { sessionId, mapId, tokenId, x, y, radius, tokens, live } = data;
      if (!isMember(sessionId, socket.user.id)) return;

      let finalTokens;
      if (tokenId !== undefined) {
        // Single-token format: lit la DB pour préserver les tokens hidden
        try {
          const map = db.prepare('SELECT tokens FROM maps WHERE id = ?').get(mapId);
          const dbTokens = JSON.parse(map?.tokens || '[]');
          const target = dbTokens.find(t => t.id === tokenId);
          if (!target) return;
          if (!isDM(sessionId, socket.user.id) && target.createdBy !== socket.user.id) return;
          if (target.locked && !isDM(sessionId, socket.user.id)) return;
          finalTokens = dbTokens.map(t => {
            if (t.id !== tokenId) return t;
            const upd = { ...t };
            if (x !== undefined) upd.x = x;
            if (y !== undefined) upd.y = y;
            if (radius !== undefined) upd.radius = radius;
            return upd;
          });
        } catch (err) { console.error('DB token-move read error:', err); return; }
      } else {
        // Format tableau complet (panneau édition MJ, ou legacy)
        finalTokens = !isDM(sessionId, socket.user.id)
          ? mergeWithHidden(mapId, tokens || [])
          : (tokens || []);
      }

      if (!live) {
        try { db.prepare('UPDATE maps SET tokens = ? WHERE id = ?').run(JSON.stringify(finalTokens), mapId); }
        catch (err) { console.error('DB token-move write error:', err); }
      }
      broadcastTokens(sessionId, mapId, finalTokens, live, socket.id);
    });

    // ---- Token : suppression ----
    socket.on('map-token-delete', (data) => {
      const { sessionId, mapId, tokenId } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      try {
        const map = db.prepare('SELECT tokens FROM maps WHERE id = ?').get(mapId);
        const allTokens = JSON.parse(map?.tokens || '[]');
        const target = allTokens.find(t => t.id === tokenId);
        if (!target) return;
        if (!isDM(sessionId, socket.user.id) && target.createdBy !== socket.user.id) return;
        const tokens = allTokens.filter(t => t.id !== tokenId);
        db.prepare('UPDATE maps SET tokens = ? WHERE id = ?').run(JSON.stringify(tokens), mapId);
        broadcastTokens(sessionId, mapId, tokens, false, null);
      } catch (err) { console.error('DB token-delete error:', err); }
    });

    // ---- Dessin : segment live (pas de DB — broadcast only) ----
    socket.on('map-drawing-live', (data) => {
      const { sessionId, ...rest } = data;
      socket.to(sessionId).emit('map-drawing-live', rest);
    });

    // ---- Dessin : finalisation du tracé ----
    socket.on('map-drawing-finalize', (data) => {
      const { sessionId, pathId } = data;
      socket.to(sessionId).emit('map-drawing-finalize', { pathId });
    });

    // ---- Dessin : tracé complet → DB ----
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

    // ---- Map : nouvelle image uploadée ----
    socket.on('map-uploaded', (data) => {
      const { sessionId } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      socket.to(sessionId).emit('map-list-updated');
    });

    // ---- Map : changement de map active ----
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

    // ---- Map : transformation image (position/échelle) ----
    // live=true → broadcast uniquement (pas DB), live=false → DB + broadcast
    socket.on('map-image-transform', (data) => {
      const { sessionId, mapId, img_x, img_y, img_scale, live } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      if (!live) {
        try {
          db.prepare('UPDATE maps SET img_x = ?, img_y = ?, img_scale = ? WHERE id = ?')
            .run(Math.round(img_x || 0), Math.round(img_y || 0), img_scale || 1.0, mapId);
        } catch (err) { console.error('DB transform error:', err); }
      }
      socket.to(sessionId).emit('map-image-updated', { mapId, img_x, img_y, img_scale, live: !!live });
    });

    // ---- Token : réordonnancement (amener au premier plan) ----
    socket.on('map-token-reorder', (data) => {
      const { sessionId, mapId, tokens } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      // Fusionner les tokens cachés pour les non-MJ (le joueur n'envoie que les tokens visibles)
      const finalTokens = !isDM(sessionId, socket.user.id)
        ? mergeWithHidden(mapId, tokens || [])
        : (tokens || []);
      try { db.prepare('UPDATE maps SET tokens = ? WHERE id = ?').run(JSON.stringify(finalTokens), mapId); }
      catch (err) { console.error('DB token-reorder error:', err); }
      // Exclure l'émetteur : il a déjà mis à jour son état local
      broadcastTokens(sessionId, mapId, finalTokens, false, socket.id);
    });

    // ---- Map : renommage (MJ uniquement) ----
    socket.on('map-rename', (data) => {
      const { sessionId, mapId, name } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      if (!name?.trim()) return;
      try { db.prepare('UPDATE maps SET name = ? WHERE id = ?').run(name.trim(), mapId); }
      catch (err) { console.error('DB map-rename error:', err); }
      // Informer tous les membres (y compris le MJ) du nouveau nom
      io.to(sessionId).emit('map-renamed', { mapId, name: name.trim() });
    });

    // ---- Map : suppression ----
    socket.on('map-delete', (data) => {
      const { sessionId, mapId } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      try { db.prepare('DELETE FROM maps WHERE id = ?').run(mapId); } catch {}
      socket.to(sessionId).emit('map-deleted', { mapId });
    });

    // ---- Grille : changement de taille — relay uniquement (pas de DB) ----
    socket.on('map-grid-size', (data) => {
      const { sessionId, mapId, gridSize } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      socket.to(sessionId).emit('map-grid-size', { mapId, gridSize });
    });

    // ---- Image de fond : suppression ----
    socket.on('map-image-clear', (data) => {
      const { sessionId, mapId } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      try { db.prepare("UPDATE maps SET image_path = '' WHERE id = ?").run(mapId); } catch {}
      socket.to(sessionId).emit('map-image-cleared', { mapId });
    });

    // ---- Fog of war : prévisualisation live (pas de DB) ----
    socket.on('map-fog-live', (data) => {
      const { sessionId, mapId, fogCells, gridSize } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      socket.to(sessionId).emit('map-fog-live', { mapId, fogCells, gridSize });
    });

    // ---- Fog of war : sauvegarde finale ----
    socket.on('map-fog-paint', (data) => {
      const { sessionId, mapId, fogCells, gridSize } = data;
      if (!isDM(sessionId, socket.user.id)) return;
      try {
        const fogData = JSON.stringify({ cells: fogCells || [], gs: gridSize || 40 });
        db.prepare('UPDATE maps SET fog_data = ? WHERE id = ?').run(fogData, mapId);
      } catch {}
      socket.to(sessionId).emit('map-fog-update', { mapId, fogCells, gridSize });
    });

    // ---- Curseurs en temps réel ----
    socket.on('cursor-move', (data) => {
      const { sessionId, x, y } = data;
      socket.to(sessionId).emit('cursor-update', {
        userId: socket.user.id, username: socket.user.username, x, y
      });
    });

    // ---- Ping (attirer l'attention sur la carte) ----
    socket.on('map-ping', (data) => {
      const { sessionId, x, y } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      io.to(sessionId).emit('map-ping', { x, y, username: socket.user.username });
    });

    // ---- Combat ----
    socket.on('combat-update', (data) => {
      const { sessionId, encounter } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      try {
        if (encounter)
          db.prepare('UPDATE combat_encounters SET entities = ?, current_turn = ?, round = ? WHERE id = ?')
            .run(JSON.stringify(encounter.entities), encounter.current_turn, encounter.round, encounter.id);
      } catch {}
      socket.to(sessionId).emit('combat-updated', encounter);
    });

    socket.on('combat-next-turn', (data) => {
      const { sessionId, encounter } = data;
      if (!isMember(sessionId, socket.user.id)) return;
      // Si non-MJ, vérifier que c'est bien son tour dans la DB (avant avancement)
      if (!isDM(sessionId, socket.user.id)) {
        try {
          const dbEnc = db.prepare('SELECT entities, current_turn FROM combat_encounters WHERE id = ?')
            .get(encounter?.id);
          if (!dbEnc) return;
          const entities = JSON.parse(dbEnc.entities || '[]');
          const currentEnt = entities[dbEnc.current_turn];
          const uid = socket.user.id;
          if (!currentEnt || (currentEnt.addedBy !== uid && currentEnt.userId !== uid)) return;
        } catch { return; }
      }
      io.to(sessionId).emit('combat-turn-changed', encounter);
      if (encounter?.entities) {
        const entities = typeof encounter.entities === 'string'
          ? JSON.parse(encounter.entities) : encounter.entities;
        const active = entities[encounter.current_turn];
        if (active) io.to(sessionId).emit('notification', {
          type: 'turn', message: `C'est au tour de ${active.name} !`, entity: active,
        });
      }
    });

    // ---- Sync fiche de personnage ----
    // Fix 2 — Persister hp_current en DB et broadcaster à tous (y compris l'émetteur)
    // pour que le combat tracker du même client reçoive aussi le changement
    socket.on('character-update', (data) => {
      const { sessionId, character } = data;
      if (character?.id && character?.hp_current !== undefined) {
        try {
          db.prepare('UPDATE characters SET hp_current = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(character.hp_current, character.id);
        } catch {}
      }
      io.to(sessionId).emit('character-updated', character);
    });

    socket.on('disconnect', () => {
      // Nettoyer la présence de cet utilisateur dans sa session
      if (socket.sessionId) {
        const users = sessionPresence.get(socket.sessionId);
        if (users) {
          users.delete(socket.user.id);
          if (users.size === 0) sessionPresence.delete(socket.sessionId);
        }
        socket.to(socket.sessionId).emit('user-left', {
          username: socket.user.username, id: socket.user.id
        });
      }
      console.log(`❌ ${socket.user.username} déconnecté`);
    });
  });
}
