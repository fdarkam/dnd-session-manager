import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function getRole(sessionId, userId) {
  const m = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  return m?.role || null;
}

router.get('/session/:sessionId', authMiddleware, (req, res) => {
  try {
    const role = getRole(req.params.sessionId, req.user.id);
    if (!role) return res.status(403).json({ error: 'Accès refusé' });
    const quests = role === 'dm'
      ? db.prepare('SELECT * FROM quests WHERE session_id = ? ORDER BY created_at DESC').all(req.params.sessionId)
      : db.prepare('SELECT * FROM quests WHERE session_id = ? AND is_private = 0 ORDER BY created_at DESC').all(req.params.sessionId);
    res.json(quests);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/', authMiddleware, (req, res) => {
  try {
    const { session_id, title, description, is_private } = req.body;
    if (!session_id || !title) return res.status(400).json({ error: 'session_id et title requis' });
    const role = getRole(session_id, req.user.id);
    if (role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut créer des quêtes' });
    const id = uuidv4();
    db.prepare('INSERT INTO quests (id, session_id, title, description, is_private, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, session_id, title, description || '', is_private ? 1 : 0, req.user.id);
    res.json(db.prepare('SELECT * FROM quests WHERE id = ?').get(id));
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.put('/:id', authMiddleware, (req, res) => {
  try {
    const quest = db.prepare('SELECT * FROM quests WHERE id = ?').get(req.params.id);
    if (!quest) return res.status(404).json({ error: 'Quête non trouvée' });
    const role = getRole(quest.session_id, req.user.id);
    if (role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut modifier une quête' });
    const { title, description, is_private, status } = req.body;
    const updates = [], vals = [];
    if (title !== undefined) { updates.push('title = ?'); vals.push(title); }
    if (description !== undefined) { updates.push('description = ?'); vals.push(description); }
    if (is_private !== undefined) { updates.push('is_private = ?'); vals.push(is_private ? 1 : 0); }
    if (status !== undefined) { updates.push('status = ?'); vals.push(status); }
    if (updates.length) { vals.push(req.params.id); db.prepare(`UPDATE quests SET ${updates.join(', ')} WHERE id = ?`).run(...vals); }
    res.json(db.prepare('SELECT * FROM quests WHERE id = ?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const quest = db.prepare('SELECT * FROM quests WHERE id = ?').get(req.params.id);
    if (!quest) return res.status(404).json({ error: 'Quête non trouvée' });
    if (getRole(quest.session_id, req.user.id) !== 'dm') return res.status(403).json({ error: 'Accès refusé' });
    db.prepare('DELETE FROM quests WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

export default router;
