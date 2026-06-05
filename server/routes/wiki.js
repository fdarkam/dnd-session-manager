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
    const pages = db.prepare('SELECT * FROM wiki_pages WHERE session_id = ? ORDER BY category, title').all(req.params.sessionId);
    res.json(pages);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/', authMiddleware, (req, res) => {
  try {
    const { session_id, title, category, content } = req.body;
    if (!session_id || !title) return res.status(400).json({ error: 'session_id et title requis' });
    const role = getRole(session_id, req.user.id);
    if (role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut créer des pages' });
    const id = uuidv4();
    db.prepare('INSERT INTO wiki_pages (id, session_id, title, category, content, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, session_id, title, category || 'Général', content || '', req.user.id);
    res.json(db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(id));
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.put('/:id', authMiddleware, (req, res) => {
  try {
    const page = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(req.params.id);
    if (!page) return res.status(404).json({ error: 'Page non trouvée' });
    if (getRole(page.session_id, req.user.id) !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut modifier les pages' });
    const { title, category, content } = req.body;
    const updates = ['updated_at = CURRENT_TIMESTAMP'], vals = [];
    if (title !== undefined) { updates.push('title = ?'); vals.push(title); }
    if (category !== undefined) { updates.push('category = ?'); vals.push(category); }
    if (content !== undefined) { updates.push('content = ?'); vals.push(content); }
    vals.push(req.params.id);
    db.prepare(`UPDATE wiki_pages SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    res.json(db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const page = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(req.params.id);
    if (!page) return res.status(404).json({ error: 'Page non trouvée' });
    if (getRole(page.session_id, req.user.id) !== 'dm') return res.status(403).json({ error: 'Accès refusé' });
    db.prepare('DELETE FROM wiki_pages WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

export default router;
