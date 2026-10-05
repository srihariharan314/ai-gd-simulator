require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

let dbFilePath;
if (process.env.VERCEL) {
  dbFilePath = path.join('/tmp', 'gd_simulator.db');
  const localDb = path.resolve(__dirname, 'gd_simulator.db');
  if (fs.existsSync(localDb) && !fs.existsSync(dbFilePath)) {
    try {
      fs.copyFileSync(localDb, dbFilePath);
    } catch (e) {
      console.error('Could not copy initial DB to /tmp:', e);
    }
  }
} else {
  dbFilePath = path.resolve(__dirname, process.env.DB_PATH || './gd_simulator.db');
}

const db = new DatabaseSync(dbFilePath);

// Enable WAL mode & foreign keys
try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch (e) {}
db.exec('PRAGMA foreign_keys = ON;');

// Polyfill transaction method for compatibility with better-sqlite3 callers
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

// ============================================================
// SCHEMA CREATION
// ============================================================

const createTables = db.transaction(() => {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      avatar     TEXT DEFAULT 'default',
      bio        TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // GD Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS gd_sessions (
      session_id  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      mode        TEXT NOT NULL CHECK(mode IN ('ai', 'human')),
      topic       TEXT NOT NULL,
      category    TEXT DEFAULT 'General',
      room_id     TEXT,
      start_time  DATETIME,
      end_time    DATETIME,
      duration    INTEGER DEFAULT 0,
      status      TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'abandoned')),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // GD Transcripts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS gd_transcripts (
      transcript_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL REFERENCES gd_sessions(session_id) ON DELETE CASCADE,
      speaker       TEXT NOT NULL,
      speaker_type  TEXT DEFAULT 'user' CHECK(speaker_type IN ('user', 'ai', 'system')),
      message       TEXT NOT NULL,
      word_count    INTEGER DEFAULT 0,
      timestamp     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Performance table
  db.exec(`
    CREATE TABLE IF NOT EXISTS performance (
      performance_id       INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id           INTEGER UNIQUE NOT NULL REFERENCES gd_sessions(session_id) ON DELETE CASCADE,
      user_id              INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      communication_score  REAL DEFAULT 0,
      fluency_score        REAL DEFAULT 0,
      vocabulary_score     REAL DEFAULT 0,
      content_score        REAL DEFAULT 0,
      confidence_score     REAL DEFAULT 0,
      leadership_score     REAL DEFAULT 0,
      teamwork_score       REAL DEFAULT 0,
      critical_thinking    REAL DEFAULT 0,
      overall_score        REAL DEFAULT 0,
      strengths            TEXT DEFAULT '[]',
      improvements         TEXT DEFAULT '[]',
      recommendations      TEXT DEFAULT '[]',
      full_feedback        TEXT DEFAULT '',
      filler_word_count    INTEGER DEFAULT 0,
      total_words          INTEGER DEFAULT 0,
      speaking_turns       INTEGER DEFAULT 0,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Human Mode Room Participants
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_participants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id    TEXT NOT NULL,
      user_id    INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      name       TEXT NOT NULL,
      socket_id  TEXT,
      is_muted   INTEGER DEFAULT 0,
      joined_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Human Mode Rooms table
  db.exec(`
    CREATE TABLE IF NOT EXISTS human_rooms (
      room_id          TEXT PRIMARY KEY,
      room_code        TEXT UNIQUE NOT NULL,
      host_id          INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      topic            TEXT NOT NULL,
      category         TEXT DEFAULT 'General',
      topic_content    TEXT DEFAULT '',
      joining_duration INTEGER DEFAULT 120,
      join_deadline    DATETIME,
      gd_duration      INTEGER DEFAULT 300,
      max_participants INTEGER DEFAULT 6,
      status           TEXT DEFAULT 'WAITING_FOR_PARTICIPANTS',
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at       DATETIME,
      ended_at         DATETIME
    );
  `);

  // Indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON gd_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transcripts_session ON gd_transcripts(session_id);
    CREATE INDEX IF NOT EXISTS idx_performance_user ON performance(user_id);
    CREATE INDEX IF NOT EXISTS idx_room_participants_room ON room_participants(room_id);
    CREATE INDEX IF NOT EXISTS idx_human_rooms_code ON human_rooms(room_code);
    CREATE INDEX IF NOT EXISTS idx_human_rooms_status ON human_rooms(status);
  `);
});

createTables();

// ============================================================
// MIGRATIONS — safely add new columns if they don't exist yet
// (node:sqlite has no IF NOT EXISTS for ADD COLUMN, so we try/catch)
// ============================================================
const MIGRATIONS = [
  // ── New 10-metric scoring columns ──────────────────────────
  `ALTER TABLE performance ADD COLUMN participation_score  REAL DEFAULT 0`,
  `ALTER TABLE performance ADD COLUMN relevance_score      REAL DEFAULT 0`,
  `ALTER TABLE performance ADD COLUMN listening_score      REAL DEFAULT 0`,
  `ALTER TABLE performance ADD COLUMN conclusion_score     REAL DEFAULT 0`,
  // ── Behavioral metric columns ───────────────────────────────
  `ALTER TABLE performance ADD COLUMN speaking_time_seconds    INTEGER DEFAULT 0`,
  `ALTER TABLE performance ADD COLUMN meaningful_contributions INTEGER DEFAULT 0`,
  `ALTER TABLE performance ADD COLUMN interruptions            INTEGER DEFAULT 0`,
  `ALTER TABLE performance ADD COLUMN repeated_points         INTEGER DEFAULT 0`,
  `ALTER TABLE performance ADD COLUMN responses_to_others     INTEGER DEFAULT 0`,
  `ALTER TABLE performance ADD COLUMN questions_asked         INTEGER DEFAULT 0`,
  `ALTER TABLE performance ADD COLUMN topic_deviations        INTEGER DEFAULT 0`,
  // ── Extended feedback columns ───────────────────────────────
  `ALTER TABLE performance ADD COLUMN evidence               TEXT DEFAULT '[]'`,
  `ALTER TABLE performance ADD COLUMN practice_plan          TEXT DEFAULT '[]'`,
  `ALTER TABLE performance ADD COLUMN placement_readiness    TEXT DEFAULT ''`,
  `ALTER TABLE performance ADD COLUMN improvement_suggestions TEXT DEFAULT '[]'`,
  `ALTER TABLE performance ADD COLUMN score_projection       TEXT DEFAULT '{}'`,
  // ── Human Room Migrations ──────────────────────────────────
  `ALTER TABLE room_participants ADD COLUMN role              TEXT DEFAULT 'participant'`,
  `ALTER TABLE room_participants ADD COLUMN is_speaking       INTEGER DEFAULT 0`,
  `ALTER TABLE room_participants ADD COLUMN connection_status TEXT DEFAULT 'connected'`,
  `ALTER TABLE room_participants ADD COLUMN session_id        INTEGER`,
  `ALTER TABLE room_participants ADD COLUMN left_at           DATETIME`,
  `ALTER TABLE gd_transcripts ADD COLUMN room_id              TEXT`,
  `ALTER TABLE gd_transcripts ADD COLUMN user_id              INTEGER`,
  `ALTER TABLE performance ADD COLUMN room_id                 TEXT`,
  `ALTER TABLE performance ADD COLUMN user_name               TEXT`,
];

for (const sql of MIGRATIONS) {
  try {
    db.exec(sql);
  } catch (_) {
    // Column already exists — silently skip
  }
}

// Ensure default demo user exists (especially on fresh serverless /tmp databases)
try {
  const bcrypt = require('bcryptjs');
  const demoEmail = 'demo@gd.com';
  const existing = db.prepare('SELECT user_id FROM users WHERE email = ?').get(demoEmail);
  if (!existing) {
    const hash = bcrypt.hashSync('demo123', 10);
    db.prepare('INSERT INTO users (name, email, password, bio) VALUES (?, ?, ?, ?)').run(
      'Demo User',
      demoEmail,
      hash,
      'Aspirant preparing for placement & MBA group discussions.'
    );
    console.log('👤 Seeded demo user: demo@gd.com / demo123');
  }
} catch (e) {
  // Ignore if bcrypt not available or concurrent insert
}

console.log('✅ Database initialized successfully via node:sqlite:', dbFilePath);

module.exports = db;
