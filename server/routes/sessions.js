import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

router.post('/', authMiddleware, (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom de session requis' });

    const id = uuidv4();
    const invite_code = generateInviteCode();

    const createSession = db.transaction(() => {
      db.prepare('INSERT INTO sessions (id, name, description, invite_code, dm_id) VALUES (?, ?, ?, ?, ?)')
        .run(id, name, description || '', invite_code, req.user.id);
      const memberId = uuidv4();
      db.prepare('INSERT INTO session_members (id, session_id, user_id, role) VALUES (?, ?, ?, ?)')
        .run(memberId, id, req.user.id, 'dm');
      db.prepare('INSERT INTO action_logs (id, session_id, user_id, username, action_type, description) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), id, req.user.id, req.user.username, 'session', `Session "${name}" créée`);
    });
    createSession();

    res.json({ id, name, description, invite_code, dm_id: req.user.id });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/', authMiddleware, (req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT s.*, u.username as dm_name,
        (SELECT COUNT(*) FROM session_members WHERE session_id = s.id) as member_count
      FROM sessions s
      JOIN users u ON s.dm_id = u.id
      JOIN session_members sm ON sm.session_id = s.id
      WHERE sm.user_id = ?
      ORDER BY s.created_at DESC
    `).all(req.user.id);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:id', authMiddleware, (req, res) => {
  try {
    const session = db.prepare(`
      SELECT s.*, u.username as dm_name FROM sessions s
      JOIN users u ON s.dm_id = u.id
      WHERE s.id = ?
    `).get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session non trouvée' });

    const isMember = db.prepare('SELECT id FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!isMember) return res.status(403).json({ error: 'Accès refusé' });

    const members = db.prepare(`
      SELECT sm.role, u.id, u.username, u.avatar FROM session_members sm
      JOIN users u ON sm.user_id = u.id
      WHERE sm.session_id = ?
    `).all(req.params.id);

    res.json({ ...session, members });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/join', authMiddleware, (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code d\'invitation requis' });

    const session = db.prepare('SELECT * FROM sessions WHERE invite_code = ?').get(code.toUpperCase());
    if (!session) return res.status(404).json({ error: 'Code invalide' });

    const existing = db.prepare('SELECT id FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(session.id, req.user.id);
    if (existing) return res.status(400).json({ error: 'Vous êtes déjà dans cette session' });

    const joinSession = db.transaction(() => {
      const memberId = uuidv4();
      db.prepare('INSERT INTO session_members (id, session_id, user_id, role) VALUES (?, ?, ?, ?)')
        .run(memberId, session.id, req.user.id, 'player');
      db.prepare('INSERT INTO action_logs (id, session_id, user_id, username, action_type, description) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), session.id, req.user.id, req.user.username, 'session', `${req.user.username} a rejoint la session`);
    });
    joinSession();

    res.json({ id: session.id, name: session.name });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session non trouvée' });
    if (session.dm_id !== req.user.id) return res.status(403).json({ error: 'Seul le MJ peut supprimer la session' });

    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
