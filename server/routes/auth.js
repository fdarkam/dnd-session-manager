import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { JWT_SECRET, authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Pseudo et mot de passe requis' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Le pseudo doit contenir au moins 3 caractères' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(400).json({ error: 'Ce pseudo est déjà pris' });
    }

    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (id, username, password) VALUES (?, ?, ?)').run(id, username, hashedPassword);

    const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, username } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Pseudo et mot de passe requis' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(400).json({ error: 'Pseudo ou mot de passe incorrect' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Pseudo ou mot de passe incorrect' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, avatar, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Update username
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || username.trim().length < 3)
      return res.status(400).json({ error: 'Le pseudo doit contenir au moins 3 caractères' });
    const trimmed = username.trim();
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(trimmed, req.user.id);
    if (existing) return res.status(400).json({ error: 'Ce pseudo est déjà pris' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(trimmed, req.user.id);
    // Re-issue token with new username so client stays valid
    const newToken = jwt.sign({ id: req.user.id, username: trimmed }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token: newToken, user: { id: req.user.id, username: trimmed } });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Change password (requires current password verification)
router.put('/password', authMiddleware, async (req, res) => {
  try {
    const { current, newPassword } = req.body;
    if (!current || !newPassword)
      return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
    if (newPassword.length < 4)
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 4 caractères' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const valid = await bcrypt.compare(current, user.password);
    if (!valid) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    const hashed = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Reset a user's password using a reset code (configured via RESET_CODE env var)
router.post('/reset-password', async (req, res) => {
  try {
    const { username, newPassword, resetCode } = req.body;
    if (!username || !newPassword || !resetCode)
      return res.status(400).json({ error: 'Pseudo, nouveau mot de passe et code requis' });
    if (newPassword.length < 4)
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères' });

    const expected = process.env.RESET_CODE || 'dndmaster';
    if (resetCode !== expected)
      return res.status(403).json({ error: 'Code de réinitialisation incorrect' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const hashed = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
