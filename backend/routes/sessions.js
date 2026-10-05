const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ─── POST /api/sessions ──────────────────────────────────────────────────────
// Create a new GD session
router.post('/', authMiddleware, (req, res) => {
  const { mode, topic, category, room_id } = req.body;

  if (!mode || !topic) {
    return res.status(400).json({ error: 'Mode and topic are required.' });
  }

  const generatedRoomId = room_id || (mode === 'human' ? uuidv4().slice(0, 8).toUpperCase() : null);

  try {
    const result = db.prepare(`
      INSERT INTO gd_sessions (user_id, mode, topic, category, room_id, start_time, status)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'active')
    `).run(req.user.user_id, mode, topic, category || 'General', generatedRoomId);

    const session = db.prepare('SELECT * FROM gd_sessions WHERE session_id = ?')
      .get(result.lastInsertRowid);

    return res.status(201).json({ session });
  } catch (err) {
    // If UNIQUE constraint on room_id fails, find and return an existing active session for this room
    if (err.message && err.message.includes('UNIQUE') && generatedRoomId) {
      const existing = db.prepare(
        "SELECT * FROM gd_sessions WHERE room_id = ? AND status = 'active' ORDER BY session_id DESC LIMIT 1"
      ).get(generatedRoomId);
      if (existing) {
        return res.status(200).json({ session: existing });
      }
    }
    console.error('Session create error:', err.message);
    return res.status(500).json({ error: 'Failed to create session: ' + err.message });
  }
});


// ─── GET /api/sessions/:id ───────────────────────────────────────────────────
router.get('/:id', authMiddleware, (req, res) => {
  const session = db.prepare('SELECT * FROM gd_sessions WHERE session_id = ? AND user_id = ?')
    .get(req.params.id, req.user.user_id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const transcript = db.prepare(
    'SELECT * FROM gd_transcripts WHERE session_id = ? ORDER BY timestamp ASC'
  ).all(session.session_id);

  const performance = db.prepare(
    'SELECT * FROM performance WHERE session_id = ?'
  ).get(session.session_id);

  res.json({ session, transcript, performance });
});

// ─── GET /api/sessions ───────────────────────────────────────────────────────
// List user's sessions
router.get('/', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;

  const sessions = db.prepare(`
    SELECT s.*, p.overall_score, p.communication_score, p.content_score
    FROM gd_sessions s
    LEFT JOIN performance p ON s.session_id = p.session_id
    WHERE s.user_id = ? AND s.status = 'completed'
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.user_id, limit, offset);

  const total = db.prepare(
    "SELECT COUNT(*) as count FROM gd_sessions WHERE user_id = ? AND status = 'completed'"
  ).get(req.user.user_id);

  res.json({ sessions, total: total.count });
});

// ─── POST /api/sessions/:id/transcript ──────────────────────────────────────
// Add a transcript entry
router.post('/:id/transcript', authMiddleware, (req, res) => {
  const { speaker, speaker_type, message } = req.body;

  if (!speaker || !message) {
    return res.status(400).json({ error: 'Speaker and message are required.' });
  }

  const session = db.prepare('SELECT * FROM gd_sessions WHERE session_id = ?')
    .get(req.params.id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;

  db.prepare(`
    INSERT INTO gd_transcripts (session_id, speaker, speaker_type, message, word_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, speaker, speaker_type || 'user', message, wordCount);

  res.status(201).json({ message: 'Transcript saved.' });
});

// ─── PUT /api/sessions/:id/end ───────────────────────────────────────────────
// End a GD session
router.put('/:id/end', authMiddleware, (req, res) => {
  const session = db.prepare('SELECT * FROM gd_sessions WHERE session_id = ? AND user_id = ?')
    .get(req.params.id, req.user.user_id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  db.prepare(`
    UPDATE gd_sessions 
    SET end_time = CURRENT_TIMESTAMP, 
        status = 'completed',
        duration = CAST((julianday('now') - julianday(start_time)) * 86400 AS INTEGER)
    WHERE session_id = ?
  `).run(req.params.id);

  const updated = db.prepare('SELECT * FROM gd_sessions WHERE session_id = ?').get(req.params.id);
  res.json({ session: updated });
});

module.exports = router;
