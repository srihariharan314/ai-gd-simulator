const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { generateTopicContext } = require('../utils/gemini');

const router = express.Router();

/**
 * Generate a unique room code like GD-X7K92
 */
function generateRoomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let randomPart = '';
  for (let i = 0; i < 5; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `GD-${randomPart}`;
}

function ensureUserExists(userId, name, email) {
  if (!userId) return null;
  const existing = db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(userId);
  if (existing) return existing.user_id;

  const mail = email || `user_${userId}@gd.com`;
  const byEmail = db.prepare('SELECT user_id FROM users WHERE email = ?').get(mail);
  if (byEmail) return byEmail.user_id;

  try {
    db.prepare('INSERT OR IGNORE INTO users (user_id, name, email, password) VALUES (?, ?, ?, ?)').run(
      userId,
      name || 'User',
      mail,
      'ephemeral_token'
    );
    const checked = db.prepare('SELECT user_id FROM users WHERE user_id = ? OR email = ?').get(userId, mail);
    return checked ? checked.user_id : userId;
  } catch (e) {
    console.warn('ensureUserExists error in rooms.js:', e.message);
    return userId;
  }
}

/**
 * Self-healing room lookup for serverless environments (e.g. Vercel)
 * where each lambda instance may have an isolated ephemeral /tmp SQLite database.
 */
function findOrSelfHealRoom(identifier, fallbackTopic, hostUser) {
  if (!identifier) return null;
  const raw = String(identifier).trim();
  const upper = raw.toUpperCase();
  const alphanumericOnly = upper.replace(/[^A-Z0-9]/g, '');

  // 1. Look up existing room in SQLite
  let room = db.prepare(`
    SELECT * FROM human_rooms
    WHERE room_id = ? OR room_code = ? OR room_code = ? OR room_id = ?
  `).get(raw, upper, alphanumericOnly, upper);

  if (room) return room;

  // 2. Check if identifier is plausibly a room code or room UUID
  const isLikelyCode = upper.startsWith('GD') || (alphanumericOnly.length >= 4 && alphanumericOnly.length <= 12);
  const isLikelyUuid = raw.length >= 30 && raw.includes('-');

  if (!isLikelyCode && !isLikelyUuid) {
    return null;
  }

  let roomCode = '';
  let roomId = '';

  if (isLikelyUuid) {
    roomId = raw;
    roomCode = 'GD-' + (alphanumericOnly.slice(0, 5) || 'ROOM1');
  } else {
    roomCode = upper.startsWith('GD-')
      ? upper
      : (upper.startsWith('GD') ? 'GD-' + upper.slice(2) : 'GD-' + upper);
    roomId = raw.startsWith('room_') ? raw : ('room_' + roomCode);
  }

  // Ensure host exists in users table (guarantees foreign key constraints never fail)
  let hostId = 1;
  if (hostUser && hostUser.user_id) {
    hostId = ensureUserExists(hostUser.user_id, hostUser.name, hostUser.email);
  } else {
    hostId = ensureUserExists(1, 'Host', 'host@gd.com');
  }

  const topic = (fallbackTopic && fallbackTopic.trim()) || 'AI: Boon or Bane?';
  const joinSec = 180;
  const joinDeadline = new Date(Date.now() + joinSec * 1000).toISOString();

  try {
    db.prepare(`
      INSERT OR IGNORE INTO human_rooms
      (room_id, room_code, host_id, topic, category, joining_duration, join_deadline, gd_duration, max_participants, status, created_at)
      VALUES (?, ?, ?, ?, 'General', ?, ?, 300, 6, 'WAITING_FOR_PARTICIPANTS', CURRENT_TIMESTAMP)
    `).run(roomId, roomCode, hostId, topic, joinSec, joinDeadline);

    return db.prepare('SELECT * FROM human_rooms WHERE room_id = ? OR room_code = ?').get(roomId, roomCode);
  } catch (err) {
    console.error('Failed to self-heal room in SQLite:', err);
    return null;
  }
}

router.findOrSelfHealRoom = findOrSelfHealRoom;

// ─── POST /api/rooms ─────────────────────────────────────────────────────────
// Host creates a new human GD room
router.post('/', authMiddleware, async (req, res) => {
  const {
    topic,
    category = 'General',
    joiningDuration = 120, // default 2 minutes (in seconds)
    gdDuration = 300,      // default 5 minutes (in seconds)
    maxParticipants = 6    // default 6 participants
  } = req.body;

  if (!topic || !topic.trim()) {
    return res.status(400).json({ error: 'Discussion topic is required.' });
  }

  const cleanTopic = topic.trim();
  const joinSec = Math.max(60, Math.min(600, parseInt(joiningDuration, 10) || 120));
  const gdSec = Math.max(120, Math.min(1200, parseInt(gdDuration, 10) || 300));
  const maxPart = Math.max(2, Math.min(10, parseInt(maxParticipants, 10) || 6));

  const roomId = uuidv4();
  let roomCode = generateRoomCode();

  // Ensure unique room code
  let attempts = 0;
  while (attempts < 10) {
    const existing = db.prepare('SELECT room_code FROM human_rooms WHERE room_code = ? AND status NOT IN (\'COMPLETED\', \'CANCELLED\', \'EXPIRED\')').get(roomCode);
    if (!existing) break;
    roomCode = generateRoomCode();
    attempts++;
  }

  const joinDeadline = new Date(Date.now() + joinSec * 1000).toISOString();

  // Fetch or generate rich topic content asynchronously
  let topicContent = '';
  try {
    const contextData = await generateTopicContext(cleanTopic);
    topicContent = JSON.stringify(contextData);
  } catch (err) {
    console.warn('Could not generate topic context:', err.message);
  }

  try {
    const hostUserId = ensureUserExists(req.user.user_id, req.user.name, req.user.email);

    // 1. Insert room record
    db.prepare(`
      INSERT INTO human_rooms
      (room_id, room_code, host_id, topic, category, topic_content, joining_duration, join_deadline, gd_duration, max_participants, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAITING_FOR_PARTICIPANTS', CURRENT_TIMESTAMP)
    `).run(roomId, roomCode, hostUserId, cleanTopic, category, topicContent, joinSec, joinDeadline, gdSec, maxPart);

    // 2. Create host's personal session in gd_sessions
    const sessionRes = db.prepare(`
      INSERT INTO gd_sessions (user_id, mode, topic, category, room_id, start_time, status)
      VALUES (?, 'human', ?, ?, ?, CURRENT_TIMESTAMP, 'active')
    `).run(hostUserId, cleanTopic, category, roomId);
    const hostSessionId = sessionRes.lastInsertRowid;

    // 3. Register host as first participant
    const hostName = req.user.name || 'Host';
    db.prepare(`
      INSERT INTO room_participants
      (room_id, user_id, name, role, socket_id, is_muted, connection_status, session_id, joined_at)
      VALUES (?, ?, ?, 'host', NULL, 0, 'connected', ?, CURRENT_TIMESTAMP)
    `).run(roomId, hostUserId, hostName, hostSessionId);

    const room = db.prepare('SELECT * FROM human_rooms WHERE room_id = ?').get(roomId);
    const session = db.prepare('SELECT * FROM gd_sessions WHERE session_id = ?').get(hostSessionId);

    return res.status(201).json({
      room,
      session,
      host: {
        userId: hostUserId,
        name: hostName,
        role: 'host'
      }
    });
  } catch (err) {
    console.error('Failed to create human room:', err);
    return res.status(500).json({ error: 'Failed to create GD room: ' + err.message });
  }
});

// ─── GET /api/rooms/validate/:code ──────────────────────────────────────────
// Validate a room code or room ID before entering
router.get('/validate/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!code) {
    return res.status(400).json({ valid: false, error: 'Invalid GD room code.', reason: 'invalid_code' });
  }

  // Look up by room_code or room_id with serverless self-healing fallback
  const room = findOrSelfHealRoom(code, req.query.topic, req.user);

  if (!room) {
    return res.status(404).json({ valid: false, error: 'Invalid GD room code.', reason: 'not_found' });
  }

  if (room.status === 'CANCELLED') {
    return res.status(400).json({ valid: false, error: 'This GD has been cancelled.', reason: 'cancelled' });
  }

  if (room.status === 'COMPLETED') {
    return res.status(400).json({ valid: false, error: 'This GD has already ended.', reason: 'completed' });
  }

  if (room.status === 'ACTIVE') {
    return res.status(400).json({ valid: false, error: 'This GD has already started. New participants cannot join.', reason: 'already_started' });
  }

  if (room.status === 'EXPIRED') {
    return res.status(400).json({ valid: false, error: 'This GD is no longer accepting participants.', reason: 'expired' });
  }

  // Check deadline
  if (room.join_deadline && new Date(room.join_deadline).getTime() < Date.now() && room.status === 'WAITING_FOR_PARTICIPANTS') {
    // Check if anyone joined
    const participantCount = db.prepare(`
      SELECT COUNT(*) as count FROM room_participants WHERE room_id = ? AND connection_status != 'left'
    `).get(room.room_id).count;

    if (participantCount < 2) {
      db.prepare("UPDATE human_rooms SET status = 'EXPIRED' WHERE room_id = ?").run(room.room_id);
      return res.status(400).json({ valid: false, error: 'This GD is no longer accepting participants.', reason: 'expired' });
    }
  }

  // Check capacity
  const countRes = db.prepare(`
    SELECT COUNT(*) as count FROM room_participants WHERE room_id = ? AND connection_status != 'left'
  `).get(room.room_id);

  if (countRes.count >= room.max_participants) {
    return res.status(400).json({ valid: false, error: 'This GD is full.', reason: 'full' });
  }

  return res.json({
    valid: true,
    room: {
      room_id: room.room_id,
      room_code: room.room_code,
      topic: room.topic,
      category: room.category,
      host_id: room.host_id,
      max_participants: room.max_participants,
      current_participants: countRes.count,
      status: room.status,
      joining_duration: room.joining_duration,
      gd_duration: room.gd_duration,
      join_deadline: room.join_deadline
    }
  });
});

// ─── GET /api/rooms/:roomId ──────────────────────────────────────────────────
// Get complete room details, participants, and status
router.get('/:roomId', authMiddleware, (req, res) => {
  const roomId = req.params.roomId;
  const room = findOrSelfHealRoom(roomId, req.query.topic, req.user);

  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  const participants = db.prepare(`
    SELECT p.*, u.avatar
    FROM room_participants p
    LEFT JOIN users u ON p.user_id = u.user_id
    WHERE p.room_id = ?
    ORDER BY p.id ASC
  `).all(room.room_id);

  let parsedContent = null;
  if (room.topic_content) {
    try { parsedContent = JSON.parse(room.topic_content); } catch { parsedContent = null; }
  }

  const isHost = req.user.user_id === room.host_id;

  res.json({
    room,
    topicContent: parsedContent,
    participants,
    isHost,
    currentUser: {
      userId: req.user.user_id,
      name: req.user.name,
      isHost
    }
  });
});

// ─── POST /api/rooms/:roomId/join ───────────────────────────────────────────
// Authenticated participant joins room and receives session
router.post('/:roomId/join', authMiddleware, (req, res) => {
  const roomIdParam = req.params.roomId;
  const room = findOrSelfHealRoom(roomIdParam, req.query.topic, req.user);

  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  const userId = req.user.user_id;
  const userName = req.user.name || 'Participant';

  // Check if user is already a registered participant in this room
  let participant = db.prepare(`
    SELECT * FROM room_participants WHERE room_id = ? AND user_id = ?
  `).get(room.room_id, userId);

  let session = null;

  if (participant) {
    // Reconnecting user
    db.prepare(`
      UPDATE room_participants
      SET connection_status = 'connected'
      WHERE id = ?
    `).run(participant.id);

    if (participant.session_id) {
      session = db.prepare('SELECT * FROM gd_sessions WHERE session_id = ?').get(participant.session_id);
    }
  } else {
    // New participant joining
    if (room.status === 'COMPLETED') {
      return res.status(400).json({ error: 'This GD has already ended.' });
    }
    if (room.status === 'ACTIVE') {
      return res.status(400).json({ error: 'This GD has already started. New participants cannot join.' });
    }
    if (room.status === 'CANCELLED') {
      return res.status(400).json({ error: 'This GD has been cancelled.' });
    }
    if (room.status === 'EXPIRED') {
      return res.status(400).json({ error: 'This GD is no longer accepting participants.' });
    }

    // Check capacity
    const countRes = db.prepare(`
      SELECT COUNT(*) as count FROM room_participants WHERE room_id = ? AND connection_status != 'left'
    `).get(room.room_id);

    if (countRes.count >= room.max_participants) {
      return res.status(400).json({ error: 'This GD is full.' });
    }

    const validUserId = ensureUserExists(userId, userName, req.user?.email);

    // Create a personal session for this participant
    const role = (validUserId === room.host_id) ? 'host' : 'participant';
    const sessionRes = db.prepare(`
      INSERT INTO gd_sessions (user_id, mode, topic, category, room_id, start_time, status)
      VALUES (?, 'human', ?, ?, ?, CURRENT_TIMESTAMP, 'active')
    `).run(validUserId, room.topic, room.category || 'General', room.room_id);

    const sessionId = sessionRes.lastInsertRowid;
    session = db.prepare('SELECT * FROM gd_sessions WHERE session_id = ?').get(sessionId);

    // Register participant
    const partRes = db.prepare(`
      INSERT INTO room_participants
      (room_id, user_id, name, role, is_muted, connection_status, session_id, joined_at)
      VALUES (?, ?, ?, ?, 0, 'connected', ?, CURRENT_TIMESTAMP)
    `).run(room.room_id, validUserId, userName, role, sessionId);

    participant = db.prepare('SELECT * FROM room_participants WHERE id = ?').get(partRes.lastInsertRowid);
  }

  const participants = db.prepare(`
    SELECT * FROM room_participants WHERE room_id = ?
  `).all(room.room_id);

  res.json({
    room,
    session,
    participant,
    participants,
    isHost: userId === room.host_id
  });
});

// ─── POST /api/rooms/:roomId/start ──────────────────────────────────────────
// Host starts discussion via HTTP REST (critical for serverless / Vercel)
router.post('/:roomId/start', authMiddleware, (req, res) => {
  const room = findOrSelfHealRoom(req.params.roomId, req.query.topic, req.user);
  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  try {
    db.prepare("UPDATE human_rooms SET status = 'ACTIVE', started_at = CURRENT_TIMESTAMP WHERE room_id = ?")
      .run(room.room_id);
  } catch (err) {
    console.warn('Error starting room in DB:', err.message);
  }

  res.json({
    success: true,
    status: 'ACTIVE',
    roomId: room.room_id,
    roomCode: room.room_code,
    gd_duration: room.gd_duration || 300
  });
});

// ─── POST /api/rooms/:roomId/end ────────────────────────────────────────────
// Host ends discussion via HTTP REST
router.post('/:roomId/end', authMiddleware, (req, res) => {
  const room = findOrSelfHealRoom(req.params.roomId, req.query.topic, req.user);
  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  try {
    db.prepare("UPDATE human_rooms SET status = 'COMPLETED', ended_at = CURRENT_TIMESTAMP WHERE room_id = ?")
      .run(room.room_id);

    db.prepare(`
      UPDATE gd_sessions
      SET end_time = CURRENT_TIMESTAMP,
          status = 'completed',
          duration = CAST((julianday('now') - julianday(start_time)) * 86400 AS INTEGER)
      WHERE room_id = ? AND status = 'active'
    `).run(room.room_id);
  } catch (err) {
    console.warn('Error ending room in DB:', err.message);
  }

  res.json({
    success: true,
    status: 'COMPLETED',
    roomId: room.room_id
  });
});

// ─── POST /api/rooms/:roomId/cancel ─────────────────────────────────────────
// Host cancels room before start
router.post('/:roomId/cancel', authMiddleware, (req, res) => {
  const room = db.prepare('SELECT * FROM human_rooms WHERE room_id = ?').get(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  if (room.host_id !== req.user.user_id) {
    return res.status(403).json({ error: 'Only the host can cancel this room.' });
  }

  if (room.status === 'ACTIVE' || room.status === 'COMPLETED') {
    return res.status(400).json({ error: 'Cannot cancel a discussion that is already active or ended.' });
  }

  db.prepare("UPDATE human_rooms SET status = 'CANCELLED', ended_at = CURRENT_TIMESTAMP WHERE room_id = ?")
    .run(room.room_id);

  res.json({ success: true, message: 'Room cancelled.' });
});

// ─── GET /api/rooms/:roomId/results ─────────────────────────────────────────
// Get post-GD results summary for all participants (host overview)
router.get('/:roomId/results', authMiddleware, (req, res) => {
  const room = findOrSelfHealRoom(req.params.roomId, req.query.topic, req.user);
  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  const participants = db.prepare(`
    SELECT p.user_id, p.name, p.role, p.session_id,
           perf.overall_score, perf.communication_score, perf.content_score,
           perf.leadership_score, perf.teamwork_score, perf.critical_thinking,
           perf.speaking_turns, perf.total_words, perf.placement_readiness
    FROM room_participants p
    LEFT JOIN performance perf ON p.session_id = perf.session_id
    WHERE p.room_id = ?
    ORDER BY p.id ASC
  `).all(room.room_id);

  const transcripts = db.prepare(`
    SELECT speaker, speaker_type, message, timestamp
    FROM gd_transcripts
    WHERE room_id = ?
    ORDER BY timestamp ASC
  `).all(room.room_id);

  const isHost = req.user.user_id === room.host_id;

  res.json({
    room: {
      room_id: room.room_id,
      room_code: room.room_code,
      topic: room.topic,
      duration: room.gd_duration,
      status: room.status,
      created_at: room.created_at,
      started_at: room.started_at,
      ended_at: room.ended_at
    },
    isHost,
    participants,
    transcriptsCount: transcripts.length
  });
});

module.exports = router;
