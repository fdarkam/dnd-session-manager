import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/', authMiddleware, (req, res) => {
  try {
    const { session_id, name, entities } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id requis' });

    const member = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(session_id, req.user.id);
    if (!member || member.role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut créer un combat' });

    const id = uuidv4();
    const createCombat = db.transaction(() => {
      db.prepare('UPDATE combat_encounters SET is_active = 0 WHERE session_id = ?').run(session_id);
      db.prepare('INSERT INTO combat_encounters (id, session_id, name, entities) VALUES (?, ?, ?, ?)')
        .run(id, session_id, name || 'Combat', JSON.stringify(entities || []));
    });
    createCombat();

    const encounter = db.prepare('SELECT * FROM combat_encounters WHERE id = ?').get(id);
    res.json(encounter);
  } catch (err) {
    console.error('Create combat error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/session/:sessionId/active', authMiddleware, (req, res) => {
  try {
    const encounter = db.prepare('SELECT * FROM combat_encounters WHERE session_id = ? AND is_active = 1')
      .get(req.params.sessionId);
    res.json(encounter || null);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/:id', authMiddleware, (req, res) => {
  try {
    const encounter = db.prepare('SELECT * FROM combat_encounters WHERE id = ?').get(req.params.id);
    if (!encounter) return res.status(404).json({ error: 'Combat non trouvé' });

    const member = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(encounter.session_id, req.user.id);
    if (!member || member.role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut modifier le combat' });

    const { entities, current_turn, round, is_active } = req.body;
    const updates = [];
    const values = [];

    if (entities !== undefined) { updates.push('entities = ?'); values.push(JSON.stringify(entities)); }
    if (current_turn !== undefined) { updates.push('current_turn = ?'); values.push(current_turn); }
    if (round !== undefined) { updates.push('round = ?'); values.push(round); }
    if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active ? 1 : 0); }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE combat_encounters SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare('SELECT * FROM combat_encounters WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const encounter = db.prepare('SELECT * FROM combat_encounters WHERE id = ?').get(req.params.id);
    if (!encounter) return res.status(404).json({ error: 'Combat non trouvé' });

    const member = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(encounter.session_id, req.user.id);
    if (!member || member.role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut supprimer un combat' });

    db.prepare('DELETE FROM combat_encounters WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
