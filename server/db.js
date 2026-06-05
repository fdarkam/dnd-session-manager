import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'dnd.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    invite_code TEXT UNIQUE NOT NULL,
    dm_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dm_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS session_members (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(session_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    assigned_user_id TEXT DEFAULT NULL,
    name TEXT NOT NULL DEFAULT 'Nouveau Personnage',
    race TEXT DEFAULT '',
    class TEXT DEFAULT '',
    level INTEGER DEFAULT 1,
    hp_current INTEGER DEFAULT 10,
    hp_max INTEGER DEFAULT 10,
    ac INTEGER DEFAULT 10,
    initiative TEXT DEFAULT '+0',
    ba TEXT DEFAULT '+0',
    str INTEGER DEFAULT 10,
    dex INTEGER DEFAULT 10,
    con INTEGER DEFAULT 10,
    intel INTEGER DEFAULT 10,
    wis INTEGER DEFAULT 10,
    cha INTEGER DEFAULT 10,
    abilities TEXT DEFAULT '[]',
    capacities TEXT DEFAULT '[]',
    equipment TEXT DEFAULT '[]',
    history TEXT DEFAULT '',
    inventory TEXT DEFAULT '[]',
    skills TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS dice_rolls (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    expression TEXT NOT NULL,
    results TEXT NOT NULL,
    total INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS maps (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    image_path TEXT NOT NULL,
    tokens TEXT DEFAULT '[]',
    drawings TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS combat_encounters (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT DEFAULT 'Combat',
    entities TEXT DEFAULT '[]',
    current_turn INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    round INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS quests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_private INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS wiki_pages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'Général',
    content TEXT DEFAULT '',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS action_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT,
    username TEXT,
    action_type TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`);

// ---- Indexes ----
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_session_members_session ON session_members(session_id);
  CREATE INDEX IF NOT EXISTS idx_session_members_user ON session_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_characters_session ON characters(session_id);
  CREATE INDEX IF NOT EXISTS idx_characters_assigned ON characters(assigned_user_id);
  CREATE INDEX IF NOT EXISTS idx_dice_rolls_session ON dice_rolls(session_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_maps_session ON maps(session_id);
  CREATE INDEX IF NOT EXISTS idx_combat_encounters_session ON combat_encounters(session_id);
  CREATE INDEX IF NOT EXISTS idx_action_logs_session ON action_logs(session_id);
  CREATE INDEX IF NOT EXISTS idx_quests_session ON quests(session_id);
  CREATE INDEX IF NOT EXISTS idx_wiki_pages_session ON wiki_pages(session_id);
`);

// ---- Migrations for existing databases ----
const newCols = [
  ['characters', 'assigned_user_id', 'TEXT DEFAULT NULL'],
  ['characters', 'ac', 'INTEGER DEFAULT 10'],
  ['characters', 'initiative', "TEXT DEFAULT '+0'"],
  ['characters', 'ba', "TEXT DEFAULT '+0'"],
  ['characters', 'abilities', "TEXT DEFAULT '[]'"],
  ['characters', 'capacities', "TEXT DEFAULT '[]'"],
  ['characters', 'equipment', "TEXT DEFAULT '[]'"],
  ['characters', 'history', "TEXT DEFAULT ''"],
  ['maps', 'fog_enabled', 'INTEGER DEFAULT 0'],
  ['maps', 'fog_data', "TEXT DEFAULT '[]'"],
  ['maps', 'img_x', 'INTEGER DEFAULT 0'],
  ['maps', 'img_y', 'INTEGER DEFAULT 0'],
  ['maps', 'img_scale', 'REAL DEFAULT 1.0'],
];
for (const [table, col, def] of newCols) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch (e) {
    if (!e.message.includes('duplicate column')) console.error('Migration error:', e.message);
  }
}

export default db;

