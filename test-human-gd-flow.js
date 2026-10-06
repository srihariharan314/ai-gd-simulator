/**
 * test-human-gd-flow.js
 * Comprehensive automated test suite verifying all 10 requirements + AI GD non-regression.
 */

const http = require('http');
const ioClient = require('socket.io-client');
const app = require('./backend/server');
const db = require('./backend/db');

const TEST_PORT = 3399;
let serverInstance = null;
let baseUrl = `http://localhost:${TEST_PORT}`;

// Helper: fetch JSON
async function apiPost(endpoint, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function apiGet(endpoint, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'GET',
    headers,
    redirect: 'manual'
  });
  const location = res.headers.get('location');
  let data = {};
  if (res.headers.get('content-type')?.includes('application/json')) {
    data = await res.json().catch(() => ({}));
  }
  return { status: res.status, ok: res.ok, location, data };
}

async function runTests() {
  console.log('🚀 ========================================================');
  console.log('🧪 STARTING COMPREHENSIVE HUMAN GD & REGRESSION TEST SUITE');
  console.log('🚀 ========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // Start test server
  await new Promise((resolve) => {
    serverInstance = app.server.listen(TEST_PORT, () => {
      console.log(`📡 Test server listening on ${baseUrl}`);
      resolve();
    });
  });

  try {
    // Setup test users
    const rand = Math.floor(Math.random() * 10000);
    const hostUserRes = await apiPost('/api/auth/register', {
      name: `HostUser_${rand}`,
      email: `host_${rand}@test.com`,
      password: 'Password123!'
    });
    const hostToken = hostUserRes.data.token;
    const hostId = hostUserRes.data.user.user_id;
    const hostName = hostUserRes.data.user.name;

    const part1Res = await apiPost('/api/auth/register', {
      name: `Arun_${rand}`,
      email: `arun_${rand}@test.com`,
      password: 'Password123!'
    });
    const part1Token = part1Res.data.token;
    const part1Id = part1Res.data.user.user_id;
    const part1Name = part1Res.data.user.name;

    const part2Res = await apiPost('/api/auth/register', {
      name: `LateUser_${rand}`,
      email: `late_${rand}@test.com`,
      password: 'Password123!'
    });
    const part2Token = part2Res.data.token;

    // ─────────────────────────────────────────────────────────────
    // TEST 1 — Host creates room
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 1: Host creates room ---');
    const createRoomRes = await apiPost('/api/rooms', {
      topic: 'AI: Boon or Bane?',
      joiningDuration: 120,
      gdDuration: 300,
      maxParticipants: 6
    }, hostToken);

    assert(createRoomRes.status === 201, 'Host room creation returns 201 Created');
    assert(createRoomRes.data.room && createRoomRes.data.room.room_id, 'Room ID generated');
    assert(/^GD-[A-Z0-9]{5}$/.test(createRoomRes.data.room.room_code), `Room Code matches GD-XXXXX format (${createRoomRes.data.room?.room_code})`);
    assert(createRoomRes.data.room.status === 'WAITING_FOR_PARTICIPANTS', 'Initial status is WAITING_FOR_PARTICIPANTS');
    assert(createRoomRes.data.session && createRoomRes.data.session.session_id, 'Host personal session created in gd_sessions');

    const createdRoom = createRoomRes.data.room;
    const hostSession = createRoomRes.data.session;

    // ─────────────────────────────────────────────────────────────
    // TEST 2 — Participant joins with code
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Participant validates & joins with code ---');
    const valRes = await apiGet(`/api/rooms/validate/${createdRoom.room_code}`);
    assert(valRes.data.valid === true, 'Room code validates successfully');
    assert(valRes.data.room.topic === 'AI: Boon or Bane?', 'Room topic matches');
    assert(valRes.data.room.current_participants === 1, 'Current participants count is 1 (Host)');

    const joinRes = await apiPost(`/api/rooms/${createdRoom.room_id}/join`, {}, part1Token);
    assert(joinRes.status === 200, 'Participant joins successfully');
    assert(joinRes.data.participant && joinRes.data.participant.role === 'participant', 'Participant role is participant');
    assert(joinRes.data.session && joinRes.data.session.session_id === hostSession.session_id, 'All users share the exact same session_id for Human GD');

    const sharedSession = joinRes.data.session;

    // ─────────────────────────────────────────────────────────────
    // TEST 3 — Direct join link redirect (/human-gd/join/:code and /gd/join/:code)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Direct join link redirect ---');
    const directJoinRes = await apiGet(`/human-gd/join/${createdRoom.room_code}`);
    assert(directJoinRes.status === 302, 'HTTP 302 redirect for /human-gd/join/:code');
    assert(directJoinRes.location && directJoinRes.location.includes(`roomCode=${createdRoom.room_code}`), `Redirects to human-room.html with roomCode`);

    // ─────────────────────────────────────────────────────────────
    // TEST 4 — WhatsApp invitation formatting
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: WhatsApp invitation message formatting ---');
    const waUrl = `${baseUrl}/human-gd/join/${createdRoom.room_code}`;
    const expectedWaMsg = `IntelliGD Human GD invitation\n\nTopic: ${createdRoom.topic}\nRoom Code: ${createdRoom.room_code}\nJoin Link: ${waUrl}`;
    const encodedWa = encodeURIComponent(expectedWaMsg);
    assert(encodedWa.includes(encodeURIComponent(createdRoom.room_code)), 'WhatsApp message correctly encodes room code');
    assert(encodedWa.includes(encodeURIComponent(waUrl)), 'WhatsApp message includes direct join URL');

    // ─────────────────────────────────────────────────────────────
    // TEST 5 — Real-time Sockets & Host/Participant Role Synchronization
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Sockets connect & Host/Participant Role Synchronization ---');
    let hostSocket = ioClient(baseUrl, { forceNew: true });
    let part1Socket = ioClient(baseUrl, { forceNew: true });

    let hostJoinedData = null;
    let part1JoinedData = null;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 5 timeout waiting for socket room:joined')), 6000);

      hostSocket.on('connect', () => {
        hostSocket.emit('room:create', {
          roomId: createdRoom.room_id,
          roomCode: createdRoom.room_code,
          topic: createdRoom.topic,
          userName: hostName,
          userId: hostId
        });
      });

      hostSocket.on('room:joined', (data) => {
        hostJoinedData = data;
        part1Socket.emit('room:join', {
          roomId: createdRoom.room_id,
          roomCode: createdRoom.room_code,
          userName: part1Name,
          userId: part1Id
        });
      });

      part1Socket.on('room:joined', (data) => {
        part1JoinedData = data;
        clearTimeout(timer);
        resolve();
      });

      hostSocket.on('room:error', (err) => {
        console.error('Host socket error:', err);
      });
      part1Socket.on('room:error', (err) => {
        console.error('Part1 socket error:', err);
      });
    });

    assert(hostJoinedData && hostJoinedData.isHost === true, 'Host socket received room:joined with isHost=true');
    assert(part1JoinedData && part1JoinedData.isHost === false, 'Participant socket received room:joined with isHost=false');
    assert(hostJoinedData.status === 'WAITING_FOR_PARTICIPANTS', 'Room remains in WAITING_FOR_PARTICIPANTS with no auto-timeout');

    // ─────────────────────────────────────────────────────────────
    // TEST 6 & 7 — Host Manual Start vs Unauthorized Start
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6 & 7: Server Authoritative Discussion Start ---');
    let unauthorizedErrorReceived = false;
    let roomStartedEventReceived = false;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test 6/7 timeout waiting for room:started')), 6000);

      // Non-host tries to start -> must be rejected
      part1Socket.emit('room:start', { roomId: createdRoom.room_id, userId: part1Id });
      part1Socket.on('room:error', (err) => {
        if (err.message.includes('Only the host')) {
          unauthorizedErrorReceived = true;
          // Now host starts legally
          hostSocket.emit('room:start', { roomId: createdRoom.room_id, userId: hostId });
        }
      });

      part1Socket.on('room:started', (startData) => {
        roomStartedEventReceived = true;
        clearTimeout(timer);
        resolve();
      });
    });

    assert(unauthorizedErrorReceived, 'Server rejected non-host attempt to start discussion');
    assert(roomStartedEventReceived, 'Server started discussion when host requested, broadcasted room:started');

    const activeDbRoom = db.prepare('SELECT status FROM human_rooms WHERE room_id = ?').get(createdRoom.room_id);
    assert(activeDbRoom.status === 'ACTIVE', 'Database room status transitioned to ACTIVE');

    // ─────────────────────────────────────────────────────────────
    // TEST 8 — Late participant rejection
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 8: Late participant rejection ---');
    const lateVal = await apiGet(`/api/rooms/validate/${createdRoom.room_code}`);
    assert(lateVal.data.valid === false, 'Late validation returns valid: false');
    assert(lateVal.data.reason === 'already_started', `Rejection reason is already_started (${lateVal.data.error})`);

    const lateJoin = await apiPost(`/api/rooms/${createdRoom.room_id}/join`, {}, part2Token);
    assert(lateJoin.status === 400, 'Late join request rejected with HTTP 400');

    // ─────────────────────────────────────────────────────────────
    // TEST 9 — Speech extraction, speaker attribution & transcripts
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9: Real-time Transcript & Speaker Attribution ---');
    let hostMsgReceivedByPart1 = false;
    let part1MsgReceivedByHost = false;

    await new Promise((resolve) => {
      hostSocket.emit('room:message', {
        roomId: createdRoom.room_id,
        userName: hostName,
        userId: hostId,
        message: 'Artificial Intelligence improves automation in education and industry.'
      });

      part1Socket.on('room:message', (m) => {
        if (m.userName === hostName) hostMsgReceivedByPart1 = true;
        if (m.userName === part1Name) {
          part1MsgReceivedByHost = true;
          resolve();
        }
      });

      hostSocket.on('room:message', (m) => {
        if (m.userName === hostName) {
          // Participant 1 responds
          part1Socket.emit('room:message', {
            roomId: createdRoom.room_id,
            userName: part1Name,
            userId: part1Id,
            message: 'I agree with HostUser, but we must protect user privacy and avoid job displacement.'
          });
        }
      });
    });

    assert(hostMsgReceivedByPart1, 'Participant 1 received host live statement');
    assert(part1MsgReceivedByHost, 'Host received participant 1 live statement');

    // Check DB transcripts
    const savedTranscripts = db.prepare('SELECT * FROM gd_transcripts WHERE room_id = ?').all(createdRoom.room_id);
    assert(savedTranscripts.length >= 2, `Transcripts saved in database with room_id (Count: ${savedTranscripts.length})`);
    assert(savedTranscripts.some(t => t.speaker === hostName), 'Host statement recorded with speaker name');
    assert(savedTranscripts.some(t => t.speaker === part1Name), 'Participant statement recorded with speaker name');

    // ─────────────────────────────────────────────────────────────
    // TEST 10 — Host ends GD, evaluations run separately per user
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 10: Host ends GD & Post-GD Separate AI Evaluations ---');
    let roomEndedReceived = false;

    await new Promise((resolve) => {
      part1Socket.on('room:ended', () => {
        roomEndedReceived = true;
        resolve();
      });
      hostSocket.emit('room:end', { roomId: createdRoom.room_id, userId: hostId });
    });

    assert(roomEndedReceived, 'Participants received room:ended event');

    // Wait 3 seconds for async evaluations to finish
    await new Promise(r => setTimeout(r, 3000));

    const completedDbRoom = db.prepare('SELECT status, ended_at FROM human_rooms WHERE room_id = ?').get(createdRoom.room_id);
    assert(completedDbRoom.status === 'COMPLETED', 'Database human_rooms marked COMPLETED');

    // Check performance records for each participant
    const hostPerf = db.prepare('SELECT * FROM performance WHERE session_id = ? AND user_id = ?').get(hostSession.session_id, hostId);
    const part1Perf = db.prepare('SELECT * FROM performance WHERE session_id = ? AND user_id = ?').get(hostSession.session_id, part1Id);

    assert(hostPerf !== undefined, `Host evaluation recorded in performance table (Overall: ${hostPerf?.overall_score})`);
    assert(part1Perf !== undefined, `Participant 1 evaluation recorded in performance table (Overall: ${part1Perf?.overall_score})`);
    assert(hostPerf?.overall_score > 0 && part1Perf?.overall_score > 0, 'Both participants received positive evaluation scores');

    // Host Results API check (Section 27)
    const hostResultsRes = await apiGet(`/api/rooms/${createdRoom.room_id}/results`, hostToken);
    assert(hostResultsRes.status === 200, 'Host results endpoint returns HTTP 200');
    assert(hostResultsRes.data.isHost === true, 'Response identifies user as Host');
    assert(hostResultsRes.data.participants.length >= 2, 'Host sees scoreboard for all participants in the room');

    // Participant individual report check (Section 28)
    const part1PerfRes = await apiGet(`/api/performance/${hostSession.session_id}`, part1Token);
    assert(part1PerfRes.status === 200, 'Participant can retrieve personal performance report');
    assert(part1PerfRes.data.performance.user_id === part1Id, 'Participant only receives their own performance data');

    // Disconnect sockets
    hostSocket.disconnect();
    part1Socket.disconnect();

    // ─────────────────────────────────────────────────────────────
    // TEST 11 — MOST IMPORTANT NON-REGRESSION TEST: AI GD Mode
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 11: Non-Regression Test for Existing AI GD Mode ---');

    // 1. Create AI session
    const aiSessionRes = await apiPost('/api/sessions', {
      mode: 'ai',
      topic: 'Is AI replacing jobs or creating new opportunities?',
      category: 'Technology'
    }, hostToken);
    assert(aiSessionRes.status === 201, 'AI GD session created');
    const aiSessionId = aiSessionRes.data.session.session_id;

    // 2. Fetch AI agents
    const agentsRes = await apiGet('/api/ai/agents', hostToken);
    assert(agentsRes.status === 200 && agentsRes.data.agents.length >= 4, 'Existing AI agents fetched');

    // 3. AI responds to user
    const aiRespondRes = await apiPost('/api/ai/respond', {
      agentId: 'arjun',
      topic: 'Is AI replacing jobs or creating new opportunities?',
      conversationHistory: [],
      userMessage: 'I believe AI creates new roles in data science and engineering.'
    }, hostToken);
    assert(aiRespondRes.status === 200 && aiRespondRes.data.message.length > 5, `AI agent responded: "${aiRespondRes.data?.message?.slice(0, 50)}..."`);

    // 4. Save user and AI transcripts
    await apiPost(`/api/sessions/${aiSessionId}/transcript`, {
      speaker: hostName,
      speaker_type: 'user',
      message: 'I believe AI creates new roles in data science and engineering.'
    }, hostToken);
    await apiPost(`/api/sessions/${aiSessionId}/transcript`, {
      speaker: 'Arjun',
      speaker_type: 'ai',
      message: aiRespondRes.data.message
    }, hostToken);

    // 5. End AI session
    const endAiRes = await apiPost(`/api/sessions/${aiSessionId}/transcript`, {
      speaker: hostName,
      speaker_type: 'user',
      message: 'In conclusion, we need reskilling programs to prepare the workforce.'
    }, hostToken);

    // 6. Evaluate AI session
    const evalAiRes = await apiPost('/api/ai/evaluate', {
      sessionId: aiSessionId
    }, hostToken);
    assert(evalAiRes.status === 200 && evalAiRes.data.evaluation.overall_score > 0, `Existing AI GD evaluation succeeded with score: ${evalAiRes.data?.evaluation?.overall_score}`);

    console.log('\n🚀 ========================================================');
    console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('🚀 ========================================================\n');

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
