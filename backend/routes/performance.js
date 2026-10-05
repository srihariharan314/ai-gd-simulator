const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/performance/history ───────────────────────────────────────────
router.get('/history', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;

  const history = db.prepare(`
    SELECT 
      s.session_id, s.mode, s.topic, s.category, s.duration, s.created_at,
      p.overall_score, p.communication_score, p.fluency_score, p.content_score,
      p.confidence_score, p.leadership_score, p.teamwork_score, p.critical_thinking,
      p.participation_score, p.relevance_score, p.listening_score, p.conclusion_score,
      p.speaking_turns, p.total_words, p.placement_readiness
    FROM gd_sessions s
    JOIN performance p ON s.session_id = p.session_id
    WHERE s.user_id = ? AND s.status = 'completed'
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.user_id, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as count 
    FROM gd_sessions s 
    JOIN performance p ON s.session_id = p.session_id
    WHERE s.user_id = ? AND s.status = 'completed'
  `).get(req.user.user_id);

  res.json({ history, total: total.count });
});

// ─── GET /api/performance/stats ──────────────────────────────────────────────
router.get('/stats', authMiddleware, (req, res) => {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_gds,
      ROUND(AVG(p.overall_score), 1) as avg_score,
      ROUND(MAX(p.overall_score), 1) as best_score,
      ROUND(MIN(p.overall_score), 1) as min_score,
      ROUND(AVG(p.communication_score), 1) as avg_communication,
      ROUND(AVG(p.fluency_score), 1) as avg_fluency,
      ROUND(AVG(p.vocabulary_score), 1) as avg_vocabulary,
      ROUND(AVG(p.content_score), 1) as avg_content,
      ROUND(AVG(p.confidence_score), 1) as avg_confidence,
      ROUND(AVG(p.leadership_score), 1) as avg_leadership,
      ROUND(AVG(p.teamwork_score), 1) as avg_teamwork,
      ROUND(AVG(p.critical_thinking), 1) as avg_critical_thinking,
      ROUND(AVG(p.participation_score), 1) as avg_participation,
      ROUND(AVG(p.relevance_score), 1) as avg_relevance,
      ROUND(AVG(p.listening_score), 1) as avg_listening,
      ROUND(AVG(p.conclusion_score), 1) as avg_conclusion,
      SUM(s.duration) as total_practice_time,
      SUM(p.total_words) as total_words_spoken
    FROM performance p
    JOIN gd_sessions s ON p.session_id = s.session_id
    WHERE p.user_id = ?
  `).get(req.user.user_id);

  // Get score progression for chart
  const progression = db.prepare(`
    SELECT 
      p.overall_score, 
      p.communication_score,
      p.content_score,
      p.participation_score,
      p.leadership_score,
      s.created_at,
      s.topic
    FROM performance p
    JOIN gd_sessions s ON p.session_id = s.session_id
    WHERE p.user_id = ?
    ORDER BY s.created_at ASC
    LIMIT 20
  `).all(req.user.user_id);

  res.json({ stats, progression });
});

// ─── GET /api/performance/:sessionId ────────────────────────────────────────
router.get('/:sessionId', authMiddleware, (req, res) => {
  // Allow if user owns the session OR if user is host of the room
  const perf = db.prepare(`
    SELECT p.*, s.topic, s.mode, s.category, s.duration, s.created_at, s.room_id
    FROM performance p
    JOIN gd_sessions s ON p.session_id = s.session_id
    LEFT JOIN human_rooms hr ON s.room_id = hr.room_id
    WHERE p.session_id = ? AND (p.user_id = ? OR hr.host_id = ?)
  `).get(req.params.sessionId, req.user.user_id, req.user.user_id);

  if (!perf) {
    return res.status(404).json({ error: 'Performance record not found.' });
  }

  // Parse all JSON fields safely
  const jsonFields = ['strengths', 'improvements', 'recommendations', 'evidence', 'practice_plan', 'improvement_suggestions'];
  for (const field of jsonFields) {
    if (perf[field] && typeof perf[field] === 'string') {
      try { perf[field] = JSON.parse(perf[field]); } catch { perf[field] = []; }
    } else if (!perf[field]) {
      perf[field] = [];
    }
  }

  // Get transcript (by session_id or by room_id for human rooms)
  let transcript = db.prepare(
    'SELECT * FROM gd_transcripts WHERE session_id = ? ORDER BY timestamp ASC'
  ).all(req.params.sessionId);

  if ((!transcript || transcript.length === 0) && perf.room_id) {
    transcript = db.prepare(
      'SELECT * FROM gd_transcripts WHERE room_id = ? ORDER BY timestamp ASC'
    ).all(perf.room_id);
  }

  res.json({ performance: perf, transcript });
});

module.exports = router;

