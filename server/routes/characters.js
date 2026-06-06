import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PDFParse = require('pdf-parse');
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

let _io = null;
export function setIo(io) { _io = io; }

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
// Strategy: try multiple patterns per field, use first match found.
// Any unrecognised lines are preserved in notes so nothing is lost.
function parsePdfText(rawText) {
  // Normalize: collapse multiple spaces, keep line breaks
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const data = {
    name: '', race: '', class: '', level: 1,
    ac: 10, initiative: '+0', ba: '+0',
    str: 10, dex: 10, con: 10, intel: 10, wis: 10, cha: 10,
    hp_current: 10, hp_max: 10,
    abilities: [], capacities: [], equipment: [],
    inventory: [], skills: [], history: '', notes: ''
  };

  // Generic key:value extractor — matches "Label : Value" or "Label - Value"
  // Returns the first match for any of the provided label patterns
  function extract(labelPatterns, valuePattern = '(.+)') {
    for (const label of labelPatterns) {
      const re = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:\\-]\\s*${valuePattern}`, 'im');
      const m = text.match(re);
      if (m) return m[1].trim();
    }
    return null;
  }

  function extractInt(labelPatterns, valuePattern = '(\\d+)') {
    const val = extract(labelPatterns, valuePattern);
    return val !== null ? (parseInt(val) || null) : null;
  }

  // Handles table format with no separator: "Force14+2", "Dextérité17+3"
  // Uses [^\S\n] to prevent matching across lines (avoids picking familiar stats like "Str\n4")
  function extractStatNoSep(labelPatterns) {
    for (const label of labelPatterns) {
      const re = new RegExp(`(?:^|\\n)[^\\S\\n]*${label}[^\\S\\n]*([1-9]\\d?)(?:[+\\-]\\d+|[^\\S\\n]|$)`, 'im');
      const m = text.match(re);
      if (m) return parseInt(m[1]);
    }
    return null;
  }

  function extractSigned(labelPatterns) {
    const val = extract(labelPatterns, '([+\\-]?\\d+)');
    return val;
  }

  // --- Name ---
  const nameVal = extract([
    'Nom(?:\\s+du\\s+personnage)?',
    'Character\\s*Name',
    'Personnage',
    'Name',
    'Nom'
  ]);
  if (nameVal) {
    data.name = nameVal;
  } else {
    // Fallback: first short non-header line (skip section titles in ALL_CAPS or known headers)
    const SKIP = /^(INFORMATIONS?|CARACT[ÉE]RISTIQUES?|STATISTIQUES?|MATRICULE|EQUIPEMENTS?|APTITUDES?|CAPACIT[ÉE]S?|HISTOIRE|NOTES?|INVENTAIRE|COMP[ÉE]TENCES?)\b/i;
    for (const line of lines.slice(0, 10)) {
      if (line.length >= 2 && line.length <= 60 && !/^\d+$/.test(line) && !SKIP.test(line)) {
        data.name = line;
        break;
      }
    }
  }

  // --- Class ---
  const classVal = extract(['Classe', 'Class', 'Métier', 'Metier', 'Profession']);
  if (classVal) data.class = classVal;

  // --- Race / Espèce ---
  const raceVal = extract(['Race', 'Esp[èe]ce', 'Origine', 'Espèce']);
  if (raceVal) data.race = raceVal;

  // --- Level ---
  const lvlVal = extractInt(['Niv(?:eau)?', 'Level', 'Niveau', 'Lvl', 'Lv']);
  if (lvlVal !== null) data.level = Math.max(1, Math.min(20, lvlVal));

  // --- HP: current/max ---
  // Try "PV : 8/10", "HP : 8/10", or separate fields
  const hpSplit = text.match(/(?:PV|HP|Points?\s*de\s*vie)\s*[:\-]\s*(\d+)\s*\/\s*(\d+)/i);
  if (hpSplit) {
    data.hp_current = parseInt(hpSplit[1]);
    data.hp_max = parseInt(hpSplit[2]);
  } else {
    const hpMax = extractInt(['PV\s*max(?:imum)?', 'HP\s*max(?:imum)?', 'Points?\s*de\s*vie\s*max(?:imum)?', 'PV', 'HP']);
    if (hpMax !== null) { data.hp_current = hpMax; data.hp_max = hpMax; }
  }

  // --- AC / Armor Class / Défense ---
  const acVal = extractInt(['CA', 'AC', 'Armure', 'Classe\s*d\'armure', 'D[ée]fense']);
  if (acVal !== null) data.ac = acVal;

  // --- Initiative ---
  const initVal = extractSigned(['Initiative', 'INITIATIVE', 'Init']);
  if (initVal) data.initiative = initVal.startsWith('+') || initVal.startsWith('-') ? initVal : `+${initVal}`;

  // --- BA / Attack bonus ---
  const baVal = extractSigned(['BA', 'Bonus\s*(?:d\')?[Aa]ttaque', 'Attack\s*Bonus', 'BBA']);
  if (baVal) data.ba = baVal.startsWith('+') || baVal.startsWith('-') ? baVal : `+${baVal}`;

  // --- Ability scores — multiple aliases per stat ---
  const statDefs = [
    { key: 'str', labels: ['FOR', 'Force', 'STR', 'Strength', 'Force\\s*\\(FOR\\)'] },
    { key: 'dex', labels: ['DEX', 'Dext[eé]rit[eé]', 'Dexterity', 'Dex\\s*\\(DEX\\)'] },
    { key: 'con', labels: ['CON', 'Constitution', 'CON\\s*\\(CON\\)'] },
    { key: 'intel', labels: ['INT', 'Intelligence', 'INT\\s*\\(INT\\)'] },
    { key: 'wis', labels: ['SAG', 'Sagesse', 'WIS', 'Wisdom', 'Perception(?:\\s*\\(SAG\\))?'] },
    { key: 'cha', labels: ['CHA', 'Charisme', 'Charisma', 'CHA\\s*\\(CHA\\)'] },
  ];
  for (const { key, labels } of statDefs) {
    let val = extractInt(labels, '(\\d+)');
    if (val === null) val = extractStatNoSep(labels);
    if (val !== null) data[key] = Math.min(30, Math.max(1, val));
  }

  // --- Section extractor: grab lines between two headers ---
  function extractSection(startPatterns, endPatterns) {
    const startRe = new RegExp(`(?:^|\\n)\\s*(${startPatterns.join('|')})\\s*(?:[:\\-]\\s*)?\\n`, 'im');
    const endRe = endPatterns.length
      ? new RegExp(`(?:^|\\n)\\s*(${endPatterns.join('|')})\\s*(?:[:\\-]\\s*)?\\n`, 'im')
      : null;
    const startM = text.match(startRe);
    if (!startM) return [];
    const after = text.slice(startM.index + startM[0].length);
    const endM = endRe ? after.match(endRe) : null;
    const block = endM ? after.slice(0, endM.index) : after.slice(0, 3000);
    return block.split('\n').map(l => l.trim()).filter(l => l.length > 2).slice(0, 40);
  }

  // --- Abilities / Aptitudes ---
  data.abilities = extractSection(
    ['Aptitudes?', 'Capacit[eé]s? sp[eé]ciales?', 'Traits?', 'Abilities', 'Features?'],
    ['Capacit[eé]s?', '[ÉE]quipements?', 'Inventaire', 'Histoire', 'Notes?', 'Comp[eé]tences?']
  );

  // --- Capacities / Spells ---
  data.capacities = extractSection(
    ['Capacit[eé]s?', 'Sorts?', 'Pouvoirs?', 'Powers?', 'Spells?'],
    ['[ÉE]quipements?', 'Inventaire', 'Histoire', 'Notes?']
  );

  // --- Equipment ---
  data.equipment = extractSection(
    ['[ÉE]quipements?', 'Armes?\\s*(?:et\\s*armures?)?', 'Weapons?', 'Gear'],
    ['Inventaire', 'Histoire', 'Notes?', 'LEXIQUE']
  );

  // --- Inventory ---
  data.inventory = extractSection(
    ['Inventaire', 'Inventory', 'Objets?', 'Items?'],
    ['Histoire', 'Notes?', 'LEXIQUE']
  );

  // --- Skills / Compétences ---
  data.skills = extractSection(
    ['Comp[eé]tences?', 'Skills?', 'Ma[iî]trises?'],
    ['Aptitudes?', 'Capacit[eé]s?', 'Histoire', 'Notes?']
  );
  if (data.skills.length === 0) data.skills = data.abilities;

  // --- History / Background ---
  const histSection = extractSection(
    ['Histoire(?:\\s*&\\s*Personnalit[eé])?', 'Background', 'Biographie', 'Description', 'Backstory'],
    ['Notes?', 'LEXIQUE', 'DERNIERS']
  );
  data.history = histSection.join('\n').substring(0, 5000);

  data.notes = '';

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
    const isAssignedPlayer = character.assigned_user_id === req.user.id;
    if (role !== 'dm' && !isAssignedPlayer) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre personnage' });
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
      // Enforce 1 character per player per session
      const alreadyAssigned = db.prepare(
        'SELECT id, name FROM characters WHERE session_id = ? AND assigned_user_id = ? AND id != ?'
      ).get(character.session_id, assigned_user_id, req.params.id);
      if (alreadyAssigned) return res.status(409).json({
        error: `Ce joueur a déjà un personnage dans cette session : "${alreadyAssigned.name}"`
      });
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

    // Notify the assigned player in real-time so their character list updates immediately
    if (_io && assigned_user_id) {
      _io.to(`user:${assigned_user_id}`).emit('character-assigned', updated);
    }

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

    const pdfBuffer = fs.readFileSync(req.file.path);
    // Supprimer immédiatement le fichier uploadé — on n'a besoin que du buffer
    fs.unlinkSync(req.file.path);

    // pdf-parse peut échouer silencieusement au premier appel (initialisation paresseuse).
    // On retente une fois après un court délai si le premier appel lève une exception.
    let pdfData;
    try {
      pdfData = await PDFParse(pdfBuffer);
    } catch (firstErr) {
      await new Promise(r => setTimeout(r, 150));
      try {
        pdfData = await PDFParse(pdfBuffer);
      } catch (retryErr) {
        throw retryErr;
      }
    }
    const extractedText = pdfData.text;

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({
        error: 'Aucun texte extractible dans ce PDF. Le fichier est peut-être un scan/image.',
        rawText: ''
      });
    }

    const parsed = parsePdfText(extractedText);
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
    // Clean up file on error if it still exists
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
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
