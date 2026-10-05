require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

// Initialize DB (runs schema creation)
require('./db');

// Routes
const authRoutes = require('./routes/auth');
const sessionsRoutes = require('./routes/sessions');
const aiRoutes = require('./routes/ai');
const performanceRoutes = require('./routes/performance');
const roomsRoutes = require('./routes/rooms');
const db = require('./db');
const { evaluatePerformance } = require('./utils/gemini');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── JOIN LINK REDIRECT ───────────────────────────────────────────────────────
// Support friendly WhatsApp & invite links: /gd/join/:code and /join/:code
app.get(['/gd/join/:code', '/join/:code'], (req, res) => {
  const code = encodeURIComponent(req.params.code || '');
  res.redirect(`/human-room.html?action=join&roomCode=${code}`);
});

// ─── API ROUTES ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/rooms', roomsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'GD Simulator API'
  });
});

// ─── HUMAN MODE - SOCKET.IO ROOMS STATE MACHINE ─────────────────────────────
const rooms = {};

/**
 * Helper to fetch or initialize active room state from DB or memory
 */
function getOrInitRoom(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();

  // Check in-memory first
  if (rooms[raw]) return rooms[raw];
  if (rooms[upper]) return rooms[upper];

  // Try DB lookup by room_code or room_id (raw or uppercase)
  let dbRoom = null;
  try {
    dbRoom = db.prepare(`
      SELECT * FROM human_rooms WHERE room_code = ? OR room_id = ? OR room_id = ?
    `).get(upper, raw, upper);

    if (!dbRoom && roomsRoutes && roomsRoutes.findOrSelfHealRoom) {
      dbRoom = roomsRoutes.findOrSelfHealRoom(raw);
    }
  } catch (e) {
    console.error('getOrInitRoom DB lookup error:', e.message);
  }

  if (dbRoom) {
    const rId = dbRoom.room_id;
    if (!rooms[rId]) {
      // Calculate remaining joining time
      let joinRemaining = dbRoom.joining_duration || 120;
      if (dbRoom.join_deadline) {
        const msLeft = new Date(dbRoom.join_deadline).getTime() - Date.now();
        joinRemaining = Math.max(0, Math.round(msLeft / 1000));
      }

      rooms[rId] = {
        roomId: dbRoom.room_id,
        roomCode: dbRoom.room_code,
        hostId: dbRoom.host_id,
        topic: dbRoom.topic,
        category: dbRoom.category,
        maxParticipants: dbRoom.max_participants || 6,
        status: dbRoom.status || 'WAITING_FOR_PARTICIPANTS',
        joiningDuration: dbRoom.joining_duration || 120,
        joiningTimerRemaining: joinRemaining,
        joiningInterval: null,
        gdDuration: dbRoom.gd_duration || 300,
        gdTimerRemaining: dbRoom.gd_duration || 300,
        gdInterval: null,
        participants: [],
        hostDisconnectTimeout: null
      };
      // Map aliases
      rooms[dbRoom.room_code] = rooms[rId];
      rooms[dbRoom.room_code.toUpperCase()] = rooms[rId];
      rooms[rId.toUpperCase()] = rooms[rId];
    }
    return rooms[rId];
  }

  return null;
}

/**
 * Start the discussion (transition from lobby to ACTIVE)
 */
function startRoomDiscussion(roomId, reason = 'Discussion started!') {
  const room = rooms[roomId];
  if (!room || room.status === 'ACTIVE' || room.status === 'COMPLETED') return;

  // Clear joining countdown
  if (room.joiningInterval) {
    clearInterval(room.joiningInterval);
    room.joiningInterval = null;
  }

  room.status = 'ACTIVE';
  room.gdTimerRemaining = room.gdDuration;

  // Update Database
  try {
    db.prepare("UPDATE human_rooms SET status = 'ACTIVE', started_at = CURRENT_TIMESTAMP WHERE room_id = ?")
      .run(room.roomId);
  } catch (e) {
    console.error('Error updating human_rooms to ACTIVE:', e.message);
  }

  // Broadcast to all sockets in room
  io.to(room.roomId).emit('room:started', {
    topic: room.topic,
    duration: room.gdDuration,
    message: reason
  });
  console.log(`🚀 Room ${room.roomCode} (${room.roomId}) is now ACTIVE!`);

  // Start GD Duration countdown
  if (room.gdInterval) clearInterval(room.gdInterval);
  room.gdInterval = setInterval(() => {
    if (!rooms[room.roomId]) return;
    room.gdTimerRemaining--;
    io.to(room.roomId).emit('room:timer', { remaining: room.gdTimerRemaining });

    if (room.gdTimerRemaining <= 0) {
      clearInterval(room.gdInterval);
      room.gdInterval = null;
      endRoomDiscussion(room.roomId, 'Discussion duration ended automatically!');
    }
  }, 1000);
}

/**
 * End the discussion (transition to COMPLETED and evaluate participants)
 */
async function endRoomDiscussion(roomId, reason = 'Discussion ended.') {
  const room = rooms[roomId];
  if (!room || room.status === 'COMPLETED') return;

  if (room.joiningInterval) clearInterval(room.joiningInterval);
  if (room.gdInterval) clearInterval(room.gdInterval);
  room.status = 'COMPLETED';

  // Update human_rooms in DB
  try {
    db.prepare("UPDATE human_rooms SET status = 'COMPLETED', ended_at = CURRENT_TIMESTAMP WHERE room_id = ?")
      .run(room.roomId);

    // End all active sessions for this room in gd_sessions
    db.prepare(`
      UPDATE gd_sessions
      SET end_time = CURRENT_TIMESTAMP,
          status = 'completed',
          duration = CAST((julianday('now') - julianday(start_time)) * 86400 AS INTEGER)
      WHERE room_id = ? AND status = 'active'
    `).run(room.roomId);
  } catch (e) {
    console.error('Error updating room/sessions to COMPLETED:', e.message);
  }

  io.to(room.roomId).emit('room:ended', { message: reason, roomId: room.roomId });
  console.log(`⏹️ Room ${room.roomCode} completed. Beginning AI post-GD evaluation...`);

  // Asynchronously evaluate each participant
  evaluateAllParticipants(room.roomId).catch(err => {
    console.error('Error in participant evaluation:', err);
  });
}

/**
 * Run separate AI evaluation for each participant who spoke in the room
 */
async function evaluateAllParticipants(roomId) {
  try {
    const room = db.prepare('SELECT * FROM human_rooms WHERE room_id = ?').get(roomId);
    if (!room) return;

    const transcripts = db.prepare(`
      SELECT * FROM gd_transcripts WHERE room_id = ? ORDER BY timestamp ASC
    `).all(roomId);

    const participants = db.prepare(`
      SELECT * FROM room_participants WHERE room_id = ?
    `).all(roomId);

    for (const p of participants) {
      if (!p.user_id) continue;

      // Check if session exists
      let sessionId = p.session_id;
      if (!sessionId) {
        const sess = db.prepare(`
          SELECT session_id FROM gd_sessions WHERE room_id = ? AND user_id = ? ORDER BY session_id DESC LIMIT 1
        `).get(roomId, p.user_id);
        if (sess) sessionId = sess.session_id;
      }
      if (!sessionId) continue;

      // Skip if already evaluated
      const existingPerf = db.prepare('SELECT performance_id FROM performance WHERE session_id = ?').get(sessionId);
      if (existingPerf) continue;

      try {
        const evaluation = await evaluatePerformance(transcripts, p.name, room.topic);
        const userMessages = transcripts.filter(t => t.user_id === p.user_id || (t.speaker && t.speaker.toLowerCase() === p.name.toLowerCase()));
        const totalWords = userMessages.reduce((sum, t) => sum + (t.word_count || (t.message ? t.message.split(/\s+/).length : 0)), 0);
        const speakingTurns = userMessages.length;
        const speakingTimeSec = evaluation.speaking_time_seconds || Math.round((totalWords / 130) * 60);

        db.prepare(`
          INSERT OR REPLACE INTO performance
          (session_id, user_id, room_id, user_name,
           communication_score, fluency_score, vocabulary_score,
           content_score, confidence_score, leadership_score, teamwork_score, critical_thinking,
           participation_score, relevance_score, listening_score, conclusion_score,
           overall_score,
           strengths, improvements, recommendations,
           evidence, practice_plan, placement_readiness, improvement_suggestions,
           full_feedback, score_projection,
           total_words, speaking_turns,
           speaking_time_seconds, meaningful_contributions, interruptions,
           repeated_points, responses_to_others, questions_asked, topic_deviations)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sessionId,
          p.user_id,
          roomId,
          p.name,
          evaluation.communication_score || 0,
          evaluation.fluency_score || 0,
          evaluation.vocabulary_score || 0,
          evaluation.content_score || 0,
          evaluation.confidence_score || 0,
          evaluation.leadership_score || 0,
          evaluation.teamwork_score || 0,
          evaluation.critical_thinking || 0,
          evaluation.participation_score || 0,
          evaluation.relevance_score || 0,
          evaluation.listening_score || 0,
          evaluation.conclusion_score || 0,
          evaluation.overall_score || 0,
          JSON.stringify(evaluation.strengths || []),
          JSON.stringify(evaluation.improvements || []),
          JSON.stringify(evaluation.recommendations || []),
          JSON.stringify(evaluation.evidence || []),
          JSON.stringify(evaluation.practice_plan || []),
          evaluation.placement_readiness || '',
          JSON.stringify(evaluation.improvement_suggestions || []),
          evaluation.full_feedback || '',
          JSON.stringify(evaluation.score_projection || {}),
          totalWords,
          speakingTurns,
          speakingTimeSec,
          evaluation.meaningful_contributions || Math.max(1, speakingTurns - 1),
          evaluation.interruptions || 0,
          evaluation.repeated_points || 0,
          evaluation.responses_to_others || 0,
          evaluation.questions_asked || 0,
          evaluation.topic_deviations || 0
        );
        console.log(`✅ Evaluation stored for participant: ${p.name} (Overall Score: ${evaluation.overall_score})`);
      } catch (evalErr) {
        console.error(`Evaluation failed for participant ${p.name}:`, evalErr.message);
      }
    }

    io.to(roomId).emit('room:evaluations_ready', { roomId });
  } catch (err) {
    console.error('Error running group evaluations:', err);
  }
}

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Create or register host in room
  socket.on('room:create', ({ roomId, roomCode, topic, userName, userId }) => {
    const room = getOrInitRoom(roomId || roomCode);
    if (!room) {
      socket.emit('room:error', { message: 'Room could not be found or initialized.' });
      return;
    }

    socket.userId = userId;
    socket.userName = userName;
    socket.roomId = room.roomId;
    socket.join(room.roomId);

    // Cancel any host disconnect timeout
    if (room.hostDisconnectTimeout) {
      clearTimeout(room.hostDisconnectTimeout);
      room.hostDisconnectTimeout = null;
    }

    // Add or update participant
    const participant = {
      socketId: socket.id,
      userId,
      name: userName,
      role: 'host',
      isMuted: false,
      isSpeaking: false,
      isConnected: true
    };

    const existingIdx = room.participants.findIndex(p => (userId && p.userId === userId) || p.name === userName);
    if (existingIdx >= 0) {
      room.participants[existingIdx] = { ...room.participants[existingIdx], ...participant };
    } else {
      room.participants.push(participant);
    }

    // Start joining countdown if not already running and room is in lobby
    if (room.status === 'WAITING_FOR_PARTICIPANTS' && !room.joiningInterval && room.joiningTimerRemaining > 0) {
      room.joiningInterval = setInterval(() => {
        if (!rooms[room.roomId]) return;
        room.joiningTimerRemaining--;
        io.to(room.roomId).emit('room:joining_timer', { remaining: room.joiningTimerRemaining });

        if (room.joiningTimerRemaining <= 0) {
          clearInterval(room.joiningInterval);
          room.joiningInterval = null;
          // Auto-start discussion
          startRoomDiscussion(room.roomId, 'Joining time ended. Discussion automatically started!');
        }
      }, 1000);
    }

    socket.emit('room:joined', {
      roomId: room.roomId,
      roomCode: room.roomCode,
      topic: room.topic,
      isHost: true,
      status: room.status,
      participants: room.participants,
      joiningTimerRemaining: room.joiningTimerRemaining,
      gdTimerRemaining: room.gdTimerRemaining
    });

    socket.to(room.roomId).emit('room:participant_joined', {
      participant,
      participants: room.participants
    });

    console.log(`🏠 Host ${userName} connected to room ${room.roomCode} (${room.participants.length} participants)`);
  });

  // Participant joins an existing room
  socket.on('room:join', ({ roomId, roomCode, userName, userId }) => {
    const room = getOrInitRoom(roomId || roomCode);
    if (!room) {
      socket.emit('room:error', { message: 'Invalid GD room code.' });
      return;
    }

    if (room.status === 'COMPLETED') {
      socket.emit('room:error', { message: 'This GD has already ended.' });
      return;
    }

    if (room.status === 'CANCELLED') {
      socket.emit('room:error', { message: 'This GD has been cancelled.' });
      return;
    }

    // Check if new participant trying to join after active
    const existingIdx = room.participants.findIndex(p => (userId && p.userId === userId) || p.name === userName);
    if (room.status === 'ACTIVE' && existingIdx === -1) {
      socket.emit('room:error', { message: 'This GD has already started. New participants cannot join.' });
      return;
    }

    // Check capacity
    if (existingIdx === -1 && room.participants.filter(p => p.isConnected).length >= room.maxParticipants) {
      socket.emit('room:error', { message: 'This GD is full.' });
      return;
    }

    socket.userId = userId;
    socket.userName = userName;
    socket.roomId = room.roomId;
    socket.join(room.roomId);

    const isHost = (userId && userId === room.hostId) || (existingIdx >= 0 && room.participants[existingIdx].role === 'host');

    const participant = {
      socketId: socket.id,
      userId,
      name: userName,
      role: isHost ? 'host' : 'participant',
      isMuted: false,
      isSpeaking: false,
      isConnected: true
    };

    if (existingIdx >= 0) {
      room.participants[existingIdx] = { ...room.participants[existingIdx], ...participant };
    } else {
      room.participants.push(participant);
    }

    // Notify joiner
    socket.emit('room:joined', {
      roomId: room.roomId,
      roomCode: room.roomCode,
      topic: room.topic,
      isHost,
      status: room.status,
      participants: room.participants,
      joiningTimerRemaining: room.joiningTimerRemaining,
      gdTimerRemaining: room.gdTimerRemaining
    });

    // Notify room peers
    socket.to(room.roomId).emit('room:participant_joined', {
      participant,
      participants: room.participants
    });

    console.log(`👤 Participant ${userName} joined room ${room.roomCode} (Total: ${room.participants.length})`);
  });

  // Host manually starts the discussion
  socket.on('room:start', ({ roomId, userId }) => {
    const room = getOrInitRoom(roomId);
    if (!room) return;

    // Security check: Only host can start
    const callerId = userId || socket.userId;
    if (room.hostId && callerId && callerId !== room.hostId) {
      socket.emit('room:error', { message: 'Only the host can start this Group Discussion.' });
      return;
    }

    startRoomDiscussion(room.roomId, 'Discussion started by host.');
  });

  // Host manually ends the discussion
  socket.on('room:end', ({ roomId, userId }) => {
    const room = getOrInitRoom(roomId);
    if (!room) return;

    // Security check: Only host can end
    const callerId = userId || socket.userId;
    if (room.hostId && callerId && callerId !== room.hostId) {
      socket.emit('room:error', { message: 'Only the host can end this Group Discussion.' });
      return;
    }

    endRoomDiscussion(room.roomId, 'Discussion ended by host.');
  });

  // Participant speaking status update (for live speaker visual indicator)
  socket.on('room:speaking_status', ({ roomId, isSpeaking }) => {
    const room = rooms[roomId];
    if (!room) return;

    const p = room.participants.find(part => part.socketId === socket.id || (socket.userId && part.userId === socket.userId));
    if (p) {
      p.isSpeaking = !!isSpeaking;
      io.to(room.roomId).emit('room:speaking_status', {
        userId: p.userId,
        userName: p.name,
        socketId: socket.id,
        isSpeaking: !!isSpeaking
      });
    }
  });

  // Live Speech / Message pipeline — preserving speech-to-text integration
  socket.on('room:message', ({ roomId, userName, userId, message, timestamp }) => {
    const room = getOrInitRoom(roomId);
    if (!room || !message || !message.trim()) return;

    const cleanMsg = message.trim();
    const cleanUser = userName || socket.userName || 'Participant';
    const cleanUserId = userId || socket.userId;
    const timeStr = timestamp || new Date().toISOString();

    const msgData = {
      userName: cleanUser,
      userId: cleanUserId,
      message: cleanMsg,
      timestamp: timeStr
    };

    // Broadcast live transcript entry to all in room
    io.to(room.roomId).emit('room:message', msgData);

    // Save into gd_transcripts associated with room_id
    try {
      const wordCount = cleanMsg.split(/\s+/).filter(Boolean).length;
      // Find session ID for this user if available
      let sessionId = null;
      if (cleanUserId) {
        const sess = db.prepare('SELECT session_id FROM gd_sessions WHERE room_id = ? AND user_id = ? ORDER BY session_id DESC LIMIT 1').get(room.roomId, cleanUserId);
        if (sess) sessionId = sess.session_id;
      }
      if (!sessionId) {
        // Fallback to any session in this room
        const anySess = db.prepare('SELECT session_id FROM gd_sessions WHERE room_id = ? ORDER BY session_id ASC LIMIT 1').get(room.roomId);
        if (anySess) sessionId = anySess.session_id;
      }

      if (sessionId) {
        db.prepare(`
          INSERT INTO gd_transcripts (session_id, room_id, user_id, speaker, speaker_type, message, word_count, timestamp)
          VALUES (?, ?, ?, ?, 'user', ?, ?, ?)
        `).run(sessionId, room.roomId, cleanUserId || null, cleanUser, cleanMsg, wordCount, timeStr);
      }
    } catch (dbErr) {
      console.error('Error saving human room transcript:', dbErr.message);
    }
  });

  // Mute / Unmute toggle
  socket.on('room:toggle_mute', ({ roomId, isMuted }) => {
    const room = rooms[roomId];
    if (!room) return;

    const p = room.participants.find(part => part.socketId === socket.id || (socket.userId && part.userId === socket.userId));
    if (p) {
      p.isMuted = !!isMuted;
      io.to(room.roomId).emit('room:participants_update', room.participants);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);

    for (const rId in rooms) {
      const room = rooms[rId];
      if (!room || !room.participants) continue;

      const pIdx = room.participants.findIndex(p => p.socketId === socket.id);
      if (pIdx !== -1) {
        const p = room.participants[pIdx];
        p.isConnected = false;
        p.isSpeaking = false;

        const isHost = p.role === 'host' || p.userId === room.hostId;

        if (isHost) {
          socket.to(room.roomId).emit('room:host_status', {
            status: 'reconnecting',
            message: 'Host temporarily disconnected. Waiting for reconnection...'
          });

          // 60-second host reconnection grace timer
          if (room.hostDisconnectTimeout) clearTimeout(room.hostDisconnectTimeout);
          room.hostDisconnectTimeout = setTimeout(() => {
            if (room.participants.filter(pt => pt.isConnected).length === 0) {
              if (room.joiningInterval) clearInterval(room.joiningInterval);
              if (room.gdInterval) clearInterval(room.gdInterval);
              delete rooms[room.roomId];
              delete rooms[room.roomCode];
              console.log(`🗑️ Room ${room.roomCode} cleaned up after host timeout.`);
            }
          }, 60000);
        } else {
          socket.to(room.roomId).emit('room:participant_status', {
            userId: p.userId,
            name: p.name,
            isConnected: false
          });
        }

        socket.to(room.roomId).emit('room:participants_update', room.participants);
        break;
      }
    }
  });
});

// ─── CATCH-ALL: Serve frontend for SPA-style routing ─────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── START SERVER (Only when run directly, not in Vercel Serverless or required as module) ───
if (!process.env.VERCEL && require.main === module) {
  server.listen(PORT, () => {
    console.log('');
    console.log('🚀 ========================================');
    console.log(`🎯  GD Simulator Server Running!`);
    console.log(`🌐  http://localhost:${PORT}`);
    console.log(`📊  API: http://localhost:${PORT}/api/health`);
    console.log('🚀 ========================================');
    console.log('');
  });
}

app.app = app;
app.server = server;
app.io = io;

module.exports = app;
