import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// Multer config for PDF uploads
const pdfDir = path.join(__dirname, '..', 'uploads', 'pdfs');
if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

const pdfStorage = multer.diskStorage({
  destination: pdfDir,
  filename: (req, file, cb) => cb(null, uuidv4() + '.pdf')
});
const uploadPdf = multer({
  storage: pdfStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf');
  }
});

function getMemberRole(sessionId, userId) {
  const member = db.prepare('SELECT role FROM session_members WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  return member ? member.role : null;
}

// ---- Parse PDF text into character data ----
function parsePdfText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const data = {
    name: '', race: '', class: '', level: 1,
    ac: 10, initiative: '+0', ba: '+0',
    str: 10, dex: 10, con: 10, intel: 10, wis: 10, cha: 10,
    hp_current: 10, hp_max: 10,
    abilities: [], capacities: [], equipment: [],
    inventory: [], skills: [], history: '', notes: ''
  };

  // --- Name ---
  for (const line of lines) {
    const nameMatch = line.match(/(?:character\s*name|nom(?:\s*du\s*personnage)?)\s*[:\-]?\s*(.+)/i);
    if (nameMatch) { data.name = nameMatch[1].trim(); break; }
  }
  if (!data.name && lines.length > 0) {
    for (const line of lines.slice(0, 5)) {
      if (line.length > 1 && line.length < 60 && !/^\d+$/.test(line) && !/^(INFORMATIONS|CARACTERISTIQUES|Statistiques)/i.test(line)) {
        data.name = line; break;
      }
    }
  }

  // --- Nom: field ---
  const nomMatch = text.match(/Nom\s*:\s*(.+)/i);
  if (nomMatch) data.name = nomMatch[1].trim();

  // --- Class ---
  const classMatch = text.match(/Classe\s*:\s*(.+)/i) || text.match(/Class[e]?\s*:\s*(.+)/i);
  if (classMatch) data.class = classMatch[1].trim();

  // --- Race ---
  const raceMatch = text.match(/Race\s*:\s*(.+)/i);
  if (raceMatch) data.race = raceMatch[1].trim();

  // --- Level ---
  const lvlMatch = text.match(/Niv(?:eau)?\s*:\s*(\d+)/i) || text.match(/Level\s*:\s*(\d+)/i);
  if (lvlMatch) data.level = parseInt(lvlMatch[1]) || 1;

  // --- HP ---
  const hpMatch = text.match(/HP\s*:\s*(\d+)\s*\/\s*(\d+)/i);
  if (hpMatch) {
    data.hp_current = parseInt(hpMatch[1]);
    data.hp_max = parseInt(hpMatch[2]);
  }

  // --- AC ---
  const acMatch = text.match(/AC\s*:\s*(\d+)/i);
  if (acMatch) data.ac = parseInt(acMatch[1]);

  // --- Initiative ---
  const initMatch = text.match(/INITIATIVE\s*:\s*([+-]?\d+)/i);
  if (initMatch) data.initiative = initMatch[1];

  // --- BA (Bonus d'Attaque) ---
  const baMatch = text.match(/BA\s*:\s*([+-]?\d+)/i);
  if (baMatch) data.ba = baMatch[1];

  // --- Stats (table format: Force  11  +0  12  +1) ---
  const statPatterns = {
    str: /Force\s+(\d+)/i,
    con: /Constitution\s+(\d+)/i,
    dex: /Dext[eé]rit[eé]\s+(\d+)/i,
    intel: /Intelligence\s+(\d+)/i,
    wis: /Perception\s+(\d+)/i,
    cha: /Charisme\s+(\d+)/i
  };
  for (const [key, regex] of Object.entries(statPatterns)) {
    const match = text.match(regex);
    if (match) data[key] = Math.min(30, Math.max(1, parseInt(match[1])));
  }

  // --- Aptitudes ---
  const aptSection = text.match(/Aptitudes\n([\s\S]*?)(?=Capacit[eé]s|Capacities|$)/i);
  if (aptSection) {
    const aptLines = aptSection[1].split('\n').map(l => l.trim()).filter(l => l.length > 3);
    data.abilities = aptLines.slice(0, 20);
  }

  // --- Capacités ---
  const capSection = text.match(/Capacit[eé]s\n([\s\S]*?)(?=EQUIPEMENTS|[ÉE]QUIPEMENT|$)/i);
  if (capSection) {
    const capLines = capSection[1].split('\n').map(l => l.trim()).filter(l => l.length > 3);
    data.capacities = capLines.slice(0, 30);
  }

  // --- Équipements ---
  const eqSection = text.match(/[ÉE]QUIPEMENTS?\n([\s\S]*?)(?=LEXIQUE|HISTOIRE|$)/i);
  if (eqSection) {
    const eqLines = eqSection[1].split('\n').map(l => l.trim()).filter(l => l.length > 3);
    data.equipment = eqLines.slice(0, 30);
  }

  // --- Histoire ---
  const histSection = text.match(/(?:HISTOIRE\s*&\s*PERSONNALIT[EÉ]|Histoire)\n([\s\S]*?)(?=DERNIERS|$)/i);
  if (histSection) {
    data.history = histSection[1].trim().substring(0, 5000);
  }

  // --- Skills / Aptitudes ---
  data.skills = data.abilities;

  // --- Store the full extracted text as notes ---
  data.notes = '--- Texte extrait du PDF ---\n' + text.substring(0, 5000);

  return data;
}

const ALL_FIELDS = ['name', 'race', 'class', 'level', 'hp_current', 'hp_max',
  'ac', 'initiative', 'ba', 'str', 'dex', 'con', 'intel', 'wis', 'cha',
  'abilities', 'capacities', 'equipment', 'history', 'inventory', 'skills', 'notes',
  'assigned_user_id'];

const INSERT_FIELDS = ALL_FIELDS.filter(f => f !== 'assigned_user_id');

function insertCharacter(id, session_id, user_id, data) {
  db.prepare(`INSERT INTO characters (id, session_id, user_id, name, race, class, level,
    hp_current, hp_max, ac, initiative, ba, str, dex, con, intel, wis, cha,
    abilities, capacities, equipment, history, inventory, skills, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, session_id, user_id,
      data.name || 'Nouveau Personnage',
      data.race || '', data.class || '', data.level || 1,
      data.hp_current || 10, data.hp_max || 10,
      data.ac || 10, data.initiative || '+0', data.ba || '+0',
      data.str || 10, data.dex || 10, data.con || 10,
      data.intel || 10, data.wis || 10, data.cha || 10,
      JSON.stringify(data.abilities || []),
      JSON.stringify(data.capacities || []),
      JSON.stringify(data.equipment || []),
      data.history || '',
      JSON.stringify(data.inventory || []),
      JSON.stringify(data.skills || []),
      data.notes || '');
}

// ========================
// ROUTES
// ========================

// CREATE — DM only
router.post('/', authMiddleware, (req, res) => {
  try {
    const { session_id, name } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id requis' });

    const role = getMemberRole(session_id, req.user.id);
    if (role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut créer un personnage' });

    const id = uuidv4();
    db.prepare(`INSERT INTO characters (id, session_id, user_id, name) VALUES (?, ?, ?, ?)`)
      .run(id, session_id, req.user.id, name || 'Nouveau Personnage');

    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    res.json(character);
  } catch (err) {
    console.error('Create character error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET characters for a session
router.get('/session/:sessionId', authMiddleware, (req, res) => {
  try {
    const role = getMemberRole(req.params.sessionId, req.user.id);
    if (!role) return res.status(403).json({ error: 'Accès refusé' });

    let characters;
    if (role === 'dm') {
      characters = db.prepare(`
        SELECT c.*, u.username as player_name,
          (SELECT u2.username FROM users u2 WHERE u2.id = c.assigned_user_id) as assigned_player_name
        FROM characters c
        JOIN users u ON c.user_id = u.id
        WHERE c.session_id = ?
      `).all(req.params.sessionId);
    } else {
      // Players see only characters assigned to them
      characters = db.prepare(`
        SELECT c.*, u.username as player_name,
          (SELECT u2.username FROM users u2 WHERE u2.id = c.assigned_user_id) as assigned_player_name
        FROM characters c
        JOIN users u ON c.user_id = u.id
        WHERE c.session_id = ? AND c.assigned_user_id = ?
      `).all(req.params.sessionId, req.user.id);
    }

    res.json(characters);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET session members (for DM to assign players)
router.get('/session/:sessionId/members', authMiddleware, (req, res) => {
  try {
    const role = getMemberRole(req.params.sessionId, req.user.id);
    if (role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut voir la liste des joueurs' });

    const members = db.prepare(`
      SELECT sm.user_id, u.username, sm.role
      FROM session_members sm
      JOIN users u ON sm.user_id = u.id
      WHERE sm.session_id = ?
    `).all(req.params.sessionId);

    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// UPDATE — DM only
router.put('/:id', authMiddleware, (req, res) => {
  try {
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
    if (!character) return res.status(404).json({ error: 'Personnage non trouvé' });

    const role = getMemberRole(character.session_id, req.user.id);
    if (role !== 'dm') {
      return res.status(403).json({ error: 'Seul le MJ peut modifier les personnages' });
    }

    const updates = [];
    const values = [];
    for (const field of ALL_FIELDS) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(typeof req.body[field] === 'object' ? JSON.stringify(req.body[field]) : req.body[field]);
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(req.params.id);
      db.prepare(`UPDATE characters SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Update character error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ASSIGN — DM assigns a character to a player
router.put('/:id/assign', authMiddleware, (req, res) => {
  try {
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
    if (!character) return res.status(404).json({ error: 'Personnage non trouvé' });

    const role = getMemberRole(character.session_id, req.user.id);
    if (role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut assigner un personnage' });

    const { assigned_user_id } = req.body;

    // Verify the target user is a member of the session
    if (assigned_user_id) {
      const targetMember = getMemberRole(character.session_id, assigned_user_id);
      if (!targetMember) return res.status(400).json({ error: 'Ce joueur n\'est pas dans la session' });
    }

    db.prepare('UPDATE characters SET assigned_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(assigned_user_id || null, req.params.id);

    const updated = db.prepare(`
      SELECT c.*, u.username as player_name,
        (SELECT u2.username FROM users u2 WHERE u2.id = c.assigned_user_id) as assigned_player_name
      FROM characters c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `).get(req.params.id);

    res.json(updated);
  } catch (err) {
    console.error('Assign character error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE — DM only
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
    if (!character) return res.status(404).json({ error: 'Personnage non trouvé' });

    const role = getMemberRole(character.session_id, req.user.id);
    if (role !== 'dm') {
      return res.status(403).json({ error: 'Seul le MJ peut supprimer un personnage' });
    }

    db.prepare('DELETE FROM characters WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// EXPORT
router.get('/:id/export', authMiddleware, (req, res) => {
  try {
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
    if (!character) return res.status(404).json({ error: 'Personnage non trouvé' });

    const role = getMemberRole(character.session_id, req.user.id);
    if (!role && character.user_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

    const { id, session_id, user_id, assigned_user_id, ...exportData } = character;
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// IMPORT JSON — DM only
router.post('/import', authMiddleware, (req, res) => {
  try {
    const { session_id, character_data } = req.body;
    if (!session_id || !character_data) return res.status(400).json({ error: 'Données requises' });

    const role = getMemberRole(session_id, req.user.id);
    if (role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut importer un personnage' });

    const id = uuidv4();
    const data = typeof character_data === 'string' ? JSON.parse(character_data) : character_data;
    insertCharacter(id, session_id, req.user.id, data);

    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    res.json(character);
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Erreur import' });
  }
});

// ===========================
// PDF UPLOAD & PARSE — DM only
// ===========================
router.post('/import-pdf', authMiddleware, uploadPdf.single('pdf'), async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id || !req.file) return res.status(400).json({ error: 'Session et fichier PDF requis' });

    const role = getMemberRole(session_id, req.user.id);
    if (role !== 'dm') return res.status(403).json({ error: 'Seul le MJ peut importer un personnage' });

    // Extract text from PDF using pdf-parse v2 API
    const pdfBuffer = fs.readFileSync(req.file.path);
    const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
    const pdfData = await parser.getText();
    await parser.destroy();
    const extractedText = pdfData.text;

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({
        error: 'Aucun texte extractible dans ce PDF. Le fichier est peut-être un scan/image.',
        rawText: ''
      });
    }

    // Parse extracted text into character fields
    const parsed = parsePdfText(extractedText);

    // Create character from parsed data
    const id = uuidv4();
    insertCharacter(id, session_id, req.user.id, parsed);

    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    res.json({
      character,
      rawText: extractedText,
      parsedFields: parsed,
      message: 'PDF importé ! Vérifiez et ajustez les champs si nécessaire.'
    });
  } catch (err) {
    console.error('PDF import error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'import PDF: ' + err.message });
  }
});

// ===========================
// TRANSFER CHARACTER TO ANOTHER SESSION — DM only
// ===========================
router.post('/:id/transfer', authMiddleware, (req, res) => {
  try {
    const { target_session_id } = req.body;
    if (!target_session_id) return res.status(400).json({ error: 'target_session_id requis' });

    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
    if (!character) return res.status(404).json({ error: 'Personnage non trouvé' });

    const sourceRole = getMemberRole(character.session_id, req.user.id);
    if (sourceRole !== 'dm') {
      return res.status(403).json({ error: 'Seul le MJ peut transférer un personnage' });
    }

    const targetRole = getMemberRole(target_session_id, req.user.id);
    if (!targetRole) return res.status(403).json({ error: 'Vous n\'êtes pas membre de la session cible' });

    const newId = uuidv4();
    insertCharacter(newId, target_session_id, character.user_id, character);

    const newCharacter = db.prepare('SELECT * FROM characters WHERE id = ?').get(newId);

    db.prepare(`INSERT INTO action_logs (id, session_id, user_id, username, action_type, description)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), target_session_id, req.user.id, req.user.username, 'character',
        `${character.name} transféré depuis une autre session`);

    res.json({
      character: newCharacter,
      message: `${character.name} a été copié dans la session cible.`
    });
  } catch (err) {
    console.error('Transfer error:', err);
    res.status(500).json({ error: 'Erreur lors du transfert' });
  }
});

export default router;
