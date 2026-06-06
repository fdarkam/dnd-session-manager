import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Map image storage
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'maps'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.jfif', '.jpe', '.bmp', '.tiff', '.tif', '.avif', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext) || file.mimetype.startsWith('image/'));
  }
});

// Token image storage
const tokenDir = path.join(__dirname, '..', 'uploads', 'tokens');
if (!fs.existsSync(tokenDir)) fs.mkdirSync(tokenDir, { recursive: true });

const tokenStorage = multer.diskStorage({
  destination: tokenDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const uploadToken = multer({
  storage: tokenStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.jfif', '.jpe', '.bmp', '.tiff', '.tif', '.avif'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext) || file.mimetype.startsWith('image/'));
  }
});

const router = Router();

router.post('/', authMiddleware, upload.single('image'), (req, res) => {
  try {
    const { session_id, name } = req.body;
    if (!session_id || !req.file) return res.status(400).json({ error: 'Session et image requises' });

    const member = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(session_id, req.user.id);
    if (!member || member.role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut ajouter des maps' });

    const id = uuidv4();
    db.prepare('INSERT INTO maps (id, session_id, name, image_path) VALUES (?, ?, ?, ?)')
      .run(id, session_id, name || 'Map', `/uploads/maps/${req.file.filename}`);

    const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(id);
    res.json(map);
  } catch (err) {
    console.error('Map upload error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Upload token image
router.post('/token-image', authMiddleware, (req, res) => {
  uploadToken.single('image')(req, res, (err) => {
    if (err) {
      console.error('Token upload error:', err);
      return res.status(400).json({ error: err.message || 'Erreur upload image' });
    }
    if (!req.file) return res.status(400).json({ error: 'Image requise' });
    res.json({ path: `/uploads/tokens/${req.file.filename}` });
  });
});

router.get('/session/:sessionId', authMiddleware, (req, res) => {
  try {
    const member = db.prepare('SELECT id FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(req.params.sessionId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Accès refusé' });

    const maps = db.prepare('SELECT * FROM maps WHERE session_id = ? ORDER BY created_at DESC')
      .all(req.params.sessionId);
    res.json(maps);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/:id/tokens', authMiddleware, (req, res) => {
  try {
    const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
    if (!map) return res.status(404).json({ error: 'Map non trouvée' });

    const { tokens } = req.body;
    db.prepare('UPDATE maps SET tokens = ? WHERE id = ?')
      .run(JSON.stringify(tokens || []), req.params.id);

    const updated = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Save/clear drawings
router.put('/:id/drawings', authMiddleware, (req, res) => {
  try {
    const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
    if (!map) return res.status(404).json({ error: 'Map non trouvée' });

    const { drawings } = req.body;
    db.prepare('UPDATE maps SET drawings = ? WHERE id = ?')
      .run(JSON.stringify(drawings || []), req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/:id/activate', authMiddleware, (req, res) => {
  try {
    const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
    if (!map) return res.status(404).json({ error: 'Map non trouvée' });

    const activateMap = db.transaction(() => {
      db.prepare('UPDATE maps SET is_active = 0 WHERE session_id = ?').run(map.session_id);
      db.prepare('UPDATE maps SET is_active = 1 WHERE id = ?').run(req.params.id);
    });
    activateMap();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Renommer une map — MJ uniquement
router.put('/:id/rename', authMiddleware, (req, res) => {
  try {
    const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
    if (!map) return res.status(404).json({ error: 'Map non trouvée' });

    const member = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(map.session_id, req.user.id);
    if (!member || member.role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut renommer une map' });

    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });

    db.prepare('UPDATE maps SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
    res.json({ success: true, name: name.trim() });
  } catch (err) {
    console.error('Rename map error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE map — DM only
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
    if (!map) return res.status(404).json({ error: 'Map non trouvée' });

    const member = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?')
      .get(map.session_id, req.user.id);
    if (!member || member.role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut supprimer une map' });

    // Delete image file
    if (map.image_path) {
      const filePath = path.join(__dirname, '..', map.image_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    db.prepare('DELETE FROM maps WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete map error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;


