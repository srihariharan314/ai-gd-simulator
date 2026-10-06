/**
 * human-room.js — Complete Human Group Discussion Room Lifecycle
 * Handles: Waiting Lobby, Server-Authoritative Shared Countdowns,
 * Realtime Synchronization, Single Host Security, Web Speech STT,
 * WhatsApp Invitation, and Multi-Participant AI Evaluation.
 */

const HumanRoom = (() => {
  let socket = null;
  let roomId = null;
  let roomCode = null;
  let topic = '';
  let category = 'General';
  let userName = '';
  let userId = null;
  let userAvatar = '?';
  let sessionId = null;
  let isHost = false;
  let roomHostId = null;
  let roomStatus = 'WAITING_FOR_PARTICIPANTS'; // 'WAITING_FOR_PARTICIPANTS' | 'ACTIVE' | 'COMPLETED'
  let participants = [];
  let isMuted = false;
  let isSpeaking = false;
  let speechSilenceTimer = null;
  let gdDuration = 300;
  let joiningDuration = 120;
  let joinDeadline = null;
  let gdDeadline = null;
  let topicContent = null;
  let timerInterval = null;
  let syncInterval = null;
  const renderedMessageIds = new Set();

  function getProductionBaseUrl() {
    if (typeof window !== 'undefined' && window.location) {
      const origin = window.location.origin;
      if (origin && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
        return origin;
      }
    }
    return 'https://ai-gd-simulator.vercel.app';
  }

  // ─── ACTIVE GD COUNTDOWN TIMER (FOR ACTIVE DISCUSSION ONLY) ───────────────────────────────
  function syncDeadlineTimer(deadlineIso, fallbackDuration = 300) {
    if (timerInterval) clearInterval(timerInterval);

    function tick() {
      let remaining = fallbackDuration;
      if (deadlineIso) {
        const msLeft = new Date(deadlineIso).getTime() - Date.now();
        remaining = Math.max(0, Math.floor(msLeft / 1000));
      } else {
        remaining = Math.max(0, fallbackDuration);
      }

      updateTimerDisplay(remaining, 'gd');

      if (remaining <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  // ─── START & END CONTROLS (SERVER-AUTHORITATIVE) ──────────────────────────
  async function startDiscussion(reason = 'Discussion started by host') {
    // Only the host can start discussion
    if (!isHost) {
      console.warn('Unauthorized attempt: only host can start discussion');
      return;
    }
    if (roomStatus === 'ACTIVE' || roomStatus === 'COMPLETED') return;
    roomStatus = 'ACTIVE';

    // 1. Socket emit if connected
    try {
      if (socket && socket.connected) {
        socket.emit('room:start', { roomId, userId });
      }
    } catch (e) {}

    // 2. HTTP REST endpoint
    try {
      if (API.Rooms && API.Rooms.start) {
        const res = await API.Rooms.start(roomId);
        if (res && res.gd_deadline) {
          gdDeadline = res.gd_deadline;
        }
      }
    } catch (e) {
      console.warn('REST start notice:', e.message);
    }

    // 3. Update UI & timers
    AppUtils.showToast('🚀 Group Discussion has started! Good luck!', 'success', 3500);
    switchViewToActive();
    appendSystemMessage('🚀 Group Discussion is now ACTIVE. Participants may speak.');

    if (!gdDeadline) {
      gdDeadline = new Date(Date.now() + (gdDuration || 300) * 1000).toISOString();
    }
    syncDeadlineTimer(gdDeadline, gdDuration || 300);
  }

  async function endDiscussion(reason = 'Discussion ended.') {
    // Only the host can end discussion (or system on room:ended event)
    if (roomStatus === 'COMPLETED') return;
    roomStatus = 'COMPLETED';

    Speech.stopListening();
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }

    try {
      if (socket && socket.connected) {
        socket.emit('room:end', { roomId, userId });
      }
    } catch (e) {}

    try {
      if (isHost && API.Rooms && API.Rooms.end) {
        await API.Rooms.end(roomId);
      }
    } catch (e) {}

    switchViewToCompleted(reason);
  }

  // ─── INITIALIZATION ────────────────────────────────────────────────────────
  function getProductionJoinUrl(code) {
    const c = code || roomCode || roomId;
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'https://ai-gd-simulator.vercel.app';
    return `${origin}/human-gd/join/${encodeURIComponent(c)}`;
  }

  function showRoomError(title, message, errorType = 'not_found') {
    const lobbySection = document.getElementById('lobby-section');
    const activeSection = document.getElementById('active-discussion-section');
    const completedSection = document.getElementById('completed-section');
    if (activeSection) activeSection.style.display = 'none';
    if (completedSection) completedSection.style.display = 'none';
    if (lobbySection) {
      lobbySection.style.display = 'block';
      lobbySection.innerHTML = `
        <div class="lobby-wrapper" style="text-align:center; padding:48px 32px; border-color:rgba(239,68,68,0.4); box-shadow:0 0 40px rgba(239,68,68,0.1)">
          <div style="font-size:3.2rem; margin-bottom:12px">⚠️</div>
          <h1 style="font-size:1.75rem; font-weight:900; color:#f87171; margin-bottom:8px">${title}</h1>
          <p style="font-size:0.95rem; color:var(--text-secondary); max-width:480px; margin:0 auto 24px; line-height:1.6">${message}</p>
          <div style="display:flex; justify-content:center; gap:12px; flex-wrap:wrap">
            <a href="/select-mode.html" class="btn btn-primary" style="padding:12px 24px">Join Another GD</a>
            <a href="/dashboard.html" class="btn btn-secondary" style="padding:12px 24px">Dashboard</a>
          </div>
        </div>
      `;
    }
  }

  // ─── INITIALIZATION ────────────────────────────────────────────────────────
  async function init() {
    if (!AppUtils.requireAuth()) return;

    const user = AppUtils.getUser();
    userName = user?.name || 'Participant';
    userId = user?.user_id;
    userAvatar = (userName.charAt(0) || 'P').toUpperCase();

    // 1. Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action'); // 'create', 'lobby', 'join'
    const queryRoomId = params.get('roomId');
    const queryRoomCode = params.get('roomCode') || params.get('room');
    const queryTopic = params.get('topic');
    sessionId = params.get('session');

    // Initial placeholder values before server response
    roomCode = queryRoomCode || queryRoomId || '';
    roomId = queryRoomId || (roomCode ? 'room_' + roomCode : '');
    topic = queryTopic || '';

    const identifier = queryRoomCode || queryRoomId;

    if (!identifier && action !== 'create') {
      openJoinDialog();
      return;
    }

    try {
      // 2. Room lookup, creation, or validation
      let roomData = null;

      if (action === 'create' && !queryRoomId) {
        try {
          const createRes = await API.Rooms.create(
            topic || 'AI: Boon or Bane?',
            category || 'General',
            joiningDuration || 120,
            gdDuration || 300,
            6
          );
          if (createRes && createRes.room) {
            roomData = createRes.room;
            roomId = roomData.room_id;
            roomCode = roomData.room_code;
            topic = roomData.topic;
            sessionId = createRes.session?.session_id || roomData.session_id;
            roomHostId = roomData.host_id;
          } else {
            throw new Error(createRes.error || 'Failed to create room');
          }
        } catch (createErr) {
          console.error('Room creation error:', createErr);
          showRoomError('Could Not Create Room', createErr.message || 'Server was unable to create the GD room.');
          return;
        }
      } else if (identifier) {
        // Validate room first before attempting to join or display
        try {
          const validation = await API.Rooms.validate(identifier, topic);
          if (!validation || !validation.valid) {
            const reason = validation?.reason || 'not_found';
            if (reason === 'not_found') {
              showRoomError('Room not found', `The room code "<strong>${escapeHtml(identifier)}</strong>" does not exist. Please check your room code and try again.`);
            } else if (reason === 'expired') {
              showRoomError('Joining has ended', 'Joining has ended for this Group Discussion. No new participants are being accepted.');
            } else if (reason === 'already_started') {
              showRoomError('Discussion In Progress', 'This Group Discussion has already started. New participants cannot join.');
            } else if (reason === 'completed') {
              showRoomError('Discussion Ended', 'This Group Discussion has already completed.');
            } else if (reason === 'full') {
              showRoomError('Room Full', 'This Group Discussion has reached its maximum participant limit.');
            } else {
              showRoomError('Cannot Join Room', validation?.error || 'Unable to join this Group Discussion.');
            }
            return;
          }

          if (validation.room) {
            roomData = validation.room;
          }
        } catch (valErr) {
          console.warn('Validate check notice:', valErr.message);
        }

        // Fetch complete room details
        try {
          const getRes = await API.Rooms.get(identifier, topic);
          if (getRes && getRes.room) {
            roomData = getRes.room;
            topicContent = getRes.topicContent;
          }
        } catch (getErr) {
          console.warn('Room get fallback:', getErr.message);
        }
      }

      // 3. Register join in room
      try {
        const joinTarget = roomData ? roomData.room_id : (roomId || identifier);
        const joinRes = await API.Rooms.join(joinTarget, topic);
        if (joinRes) {
          if (joinRes.room) roomData = joinRes.room;
          if (joinRes.session) sessionId = joinRes.session.session_id;
          if (joinRes.participants && joinRes.participants.length > 0) {
            participants = joinRes.participants;
          }
        }
      } catch (joinErr) {
        console.warn('Join registration notice:', joinErr.message);
        if (joinErr.message && (joinErr.message.includes('ended') || joinErr.message.includes('started') || joinErr.message.includes('not found') || joinErr.message.includes('full'))) {
          showRoomError('Unable to Join', joinErr.message);
          return;
        }
      }

      // 4. Update authoritative state strictly from server roomData
      if (roomData) {
        roomId = roomData.room_id || roomId;
        roomCode = roomData.room_code || roomCode;
        topic = roomData.topic || topic;
        category = roomData.category || category;
        roomStatus = roomData.status || roomStatus;
        gdDuration = roomData.gd_duration || gdDuration;
        joiningDuration = roomData.joining_duration || joiningDuration;
        joinDeadline = roomData.join_deadline;
        gdDeadline = roomData.gd_deadline;
        roomHostId = roomData.host_id;
        sessionId = roomData.session_id || sessionId;

        // Authoritative Host Check: strictly database user_id === room.host_id
        isHost = (userId !== null && userId !== undefined && roomHostId !== null && Number(userId) === Number(roomHostId));
      } else {
        showRoomError('Room not found', 'Could not load the requested Group Discussion room.');
        return;
      }

      // 5. Render view and start synchronized timer
      updateHeaderInfo();
      setupUIEventListeners();
      renderParticipants();
      renderTopicBriefing();

      if (roomStatus === 'ACTIVE') {
        switchViewToActive();
        if (!gdDeadline && roomData?.started_at) {
          gdDeadline = new Date(new Date(roomData.started_at).getTime() + (gdDuration * 1000)).toISOString();
        }
        syncDeadlineTimer(gdDeadline, gdDuration || 300);
      } else if (roomStatus === 'COMPLETED') {
        switchViewToCompleted();
      } else {
        switchViewToLobby();
      }

      // Connect Socket & Start Sync Loop
      connectSocket();
      startPeriodicSync();

    } catch (err) {
      console.error('Human room initialization error:', err);
      showRoomError('Room Error', err.message || 'An error occurred while loading the room.');
    }
  }

  // ─── PERIODIC SYNC LOOP (REAL-TIME POLLING FALLBACK) ───────────────────────
  function startPeriodicSync() {
    if (syncInterval) clearInterval(syncInterval);

    syncInterval = setInterval(async () => {
      if (!roomId || roomStatus === 'COMPLETED') return;

      try {
        const syncData = await API.Rooms.sync(roomId);
        if (!syncData || !syncData.room) return;

        const serverRoom = syncData.room;
        roomHostId = serverRoom.host_id;
        isHost = (userId !== null && userId !== undefined && roomHostId !== null && Number(userId) === Number(roomHostId));

        if (serverRoom.status && serverRoom.status !== roomStatus) {
          roomStatus = serverRoom.status;
          if (roomStatus === 'ACTIVE') {
            switchViewToActive();
            gdDeadline = serverRoom.gd_deadline;
            syncDeadlineTimer(gdDeadline, serverRoom.gd_duration || 300);
          } else if (roomStatus === 'COMPLETED') {
            switchViewToCompleted();
          }
        }

        // Sync participants
        if (Array.isArray(syncData.participants)) {
          participants = syncData.participants;
          renderParticipants();
        }

        // Sync transcripts
        if (Array.isArray(syncData.transcripts)) {
          syncData.transcripts.forEach(t => {
            const key = `${t.transcript_id || ''}_${t.speaker}_${t.message}`;
            if (!renderedMessageIds.has(key)) {
              renderedMessageIds.add(key);
              appendChatMessage(t.speaker, t.message, Number(t.user_id) === Number(userId), t.timestamp);
            }
          });
        }
      } catch (syncErr) {
        // Silently skip transient sync errors
      }
    }, 1500);
  }

  // ─── SOCKET.IO CONNECTION & EVENTS ─────────────────────────────────────────
  function connectSocket() {
    try {
      socket = io(window.location.origin);
    } catch (e) {
      console.warn('Socket connection failed, relying on HTTP sync loop:', e.message);
      return;
    }

    socket.on('connect', () => {
      console.log('🔌 Connected to Socket server with ID:', socket.id);
      if (isHost) {
        socket.emit('room:create', { roomId, roomCode, topic, userName, userId });
      } else {
        socket.emit('room:join', { roomId, roomCode, userName, userId });
      }
    });

    socket.on('room:joined', (data) => {
      if (data.hostId) {
        roomHostId = data.hostId;
        isHost = (userId !== null && userId !== undefined && Number(userId) === Number(roomHostId));
      }
      if (data.status) roomStatus = data.status;

      updateHeaderInfo();

      if (data.participants) {
        participants = data.participants;
        renderParticipants();
      }

      if (roomStatus === 'ACTIVE') {
        switchViewToActive();
        if (data.gdTimerRemaining !== undefined) {
          updateTimerDisplay(data.gdTimerRemaining, 'gd');
        }
      } else if (roomStatus === 'COMPLETED') {
        switchViewToCompleted();
      } else {
        switchViewToLobby();
      }
    });

    socket.on('room:error', (data) => {
      AppUtils.showToast(data.message || 'Room notification', 'info');
    });

    socket.on('room:started', (data) => {
      if (data && data.deadline) gdDeadline = data.deadline;
      switchViewToActive();
      appendSystemMessage('🚀 Group Discussion is now ACTIVE. Participants may speak.');
      syncDeadlineTimer(gdDeadline, data?.duration || 300);
      AppUtils.showToast('🚀 Group Discussion has started! Good luck!', 'success', 3500);
    });

    socket.on('room:timer', (data) => {
      if (data && data.remaining !== undefined) {
        updateTimerDisplay(data.remaining, 'gd');
      }
    });

    socket.on('room:participant_joined', (data) => {
      if (data.participants) {
        participants = data.participants;
        renderParticipants();
      }
      if (data.participant && data.participant.name !== userName) {
        AppUtils.showToast(`👋 ${data.participant.name} joined the room`, 'info', 2500);
      }
    });

    socket.on('room:participants_update', (updatedList) => {
      if (Array.isArray(updatedList)) {
        participants = updatedList;
        renderParticipants();
      }
    });

    socket.on('room:speaking_status', (data) => {
      updateSpeakerVisuals(data.userId, data.userName, data.isSpeaking);
    });

    socket.on('room:message', (data) => {
      const key = `${data.timestamp || ''}_${data.userName}_${data.message}`;
      if (!renderedMessageIds.has(key)) {
        renderedMessageIds.add(key);
        appendChatMessage(data.userName, data.message, Number(data.userId) === Number(userId) || data.userName === userName, data.timestamp);
      }
    });

    socket.on('room:ended', (data) => {
      endDiscussion(data?.message || 'Discussion ended.');
    });

    socket.on('room:evaluations_ready', (data) => {
      console.log('✅ AI evaluations completed for room:', data.roomId);
      setTimeout(() => navigateToResults(), 1500);
    });
  }

  // ─── UI VIEW SWITCHING ────────────────────────────────────────────────────
  function switchViewToLobby() {
    const lobbySection = document.getElementById('lobby-section');
    const activeSection = document.getElementById('active-discussion-section');
    const completedSection = document.getElementById('completed-section');
    const statusBadge = document.getElementById('status-badge');

    if (lobbySection) lobbySection.style.display = 'block';
    if (activeSection) activeSection.style.display = 'none';
    if (completedSection) completedSection.style.display = 'none';

    if (statusBadge) {
      statusBadge.textContent = '🟡 WAITING LOBBY';
      statusBadge.className = 'badge badge-warning';
    }

    const headerTimer = document.getElementById('timer-display');
    if (headerTimer) {
      headerTimer.textContent = 'READY';
      headerTimer.className = 'timer-display';
    }
    const timerLabel = document.getElementById('timer-label');
    if (timerLabel) timerLabel.textContent = 'Lobby Status';

    // Toggle Host vs Participant Lobby view strictly based on authoritative isHost
    const hostControls = document.getElementById('lobby-host-controls');
    const participantNotice = document.getElementById('lobby-participant-notice');

    if (hostControls) hostControls.style.display = isHost ? 'flex' : 'none';
    if (participantNotice) participantNotice.style.display = isHost ? 'none' : 'block';
  }

  function switchViewToActive() {
    const lobbySection = document.getElementById('lobby-section');
    const activeSection = document.getElementById('active-discussion-section');
    const completedSection = document.getElementById('completed-section');
    const statusBadge = document.getElementById('status-badge');

    if (lobbySection) lobbySection.style.display = 'none';
    if (activeSection) activeSection.style.display = 'grid';
    if (completedSection) completedSection.style.display = 'none';

    if (statusBadge) {
      statusBadge.textContent = '🔴 LIVE GD';
      statusBadge.className = 'badge badge-danger';
    }

    const timerLabel = document.getElementById('timer-label');
    if (timerLabel) timerLabel.textContent = 'Discussion Timer';

    const hostEndBtn = document.getElementById('btn-host-end-gd');
    if (hostEndBtn) hostEndBtn.style.display = isHost ? 'inline-flex' : 'none';
  }

  function switchViewToCompleted(customMessage) {
    const lobbySection = document.getElementById('lobby-section');
    const activeSection = document.getElementById('active-discussion-section');
    const completedSection = document.getElementById('completed-section');
    const statusBadge = document.getElementById('status-badge');

    if (lobbySection) lobbySection.style.display = 'none';
    if (activeSection) activeSection.style.display = 'none';
    if (completedSection) completedSection.style.display = 'flex';

    if (statusBadge) {
      statusBadge.textContent = '🏁 COMPLETED';
      statusBadge.className = 'badge badge-success';
    }

    const msgEl = document.getElementById('completed-message');
    if (msgEl && customMessage) msgEl.textContent = customMessage;

    setTimeout(() => navigateToResults(), 4000);
  }

  function navigateToResults() {
    if (sessionId) {
      window.location.href = `/results.html?session=${sessionId}&roomId=${encodeURIComponent(roomId || '')}&isHost=${isHost ? '1' : '0'}`;
    } else if (roomId) {
      window.location.href = `/results.html?roomId=${encodeURIComponent(roomId)}&isHost=${isHost ? '1' : '0'}`;
    } else {
      window.location.href = `/history.html`;
    }
  }

  // ─── DOM RENDERING HELPERS ─────────────────────────────────────────────────
  function updateHeaderInfo() {
    // Topic
    const topicEl = document.getElementById('room-topic-text');
    if (topicEl) topicEl.textContent = topic ? `"${topic}"` : 'Group Discussion';

    // Room Code
    const codeElements = ['room-id-display', 'lobby-code-display', 'modal-share-code'];
    codeElements.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = roomCode || roomId || '——';
    });

    // Joining Link using production join URL
    const directJoinUrl = getProductionJoinUrl(roomCode || roomId);
    const linkInputs = ['lobby-join-link-input', 'modal-share-link'];
    linkInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = directJoinUrl;
    });
  }

  function updateTimerDisplay(remainingSeconds, timerType) {
    const sec = Math.max(0, parseInt(remainingSeconds, 10) || 0);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    const headerTimer = document.getElementById('timer-display');
    if (headerTimer) {
      headerTimer.textContent = timeStr;
      headerTimer.className = 'timer-display' + (sec <= 60 ? ' danger' : sec <= 120 ? ' warning' : '');
    }

    const activeTimer = document.getElementById('active-gd-timer');
    if (activeTimer) {
      activeTimer.textContent = timeStr;
      activeTimer.className = 'active-gd-timer-badge' + (sec <= 60 ? ' danger' : sec <= 120 ? ' warning' : '');
    }

    const timerLabel = document.getElementById('timer-label');
    if (timerLabel) timerLabel.textContent = 'Discussion Timer';
  }

  function renderParticipants() {
    // Deduplicate participants and enforce single authoritative host
    const uniqueParticipants = [];
    const seen = new Set();

    (participants || []).forEach(p => {
      const key = p.userId || p.socketId || p.name;
      if (key && !seen.has(key)) {
        seen.add(key);
        const isParticipantHost = (roomHostId && Number(p.userId) === Number(roomHostId)) || (p.role === 'host' && Number(p.userId) === Number(roomHostId));
        uniqueParticipants.push({
          ...p,
          role: isParticipantHost ? 'host' : 'participant'
        });
      }
    });

    // 1. Counter badge
    const count = uniqueParticipants.length;
    const countBadge = document.getElementById('participant-count');
    if (countBadge) countBadge.textContent = count;

    const lobbyCount = document.getElementById('lobby-participant-counter');
    if (lobbyCount) lobbyCount.textContent = `${count} Joined`;

    // 2. Waiting Lobby list - partitioned into 👑 HOST and 👥 PARTICIPANTS
    const lobbyList = document.getElementById('lobby-participants-list');
    if (lobbyList) {
      if (uniqueParticipants.length === 0) {
        lobbyList.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px; font-size:0.85rem">Waiting for participants to join...</div>`;
      } else {
        const hostUser = uniqueParticipants.find(p => p.role === 'host');
        const regularParticipants = uniqueParticipants.filter(p => p.role !== 'host');

        let html = '';

        // HOST SECTION
        if (hostUser) {
          const isMe = Number(hostUser.userId) === Number(userId) || hostUser.name === userName;
          const isOnline = hostUser.isConnected !== false;
          html += `
            <div style="font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.1em; color:#fbbf24; margin:8px 0 6px; display:flex; align-items:center; gap:6px">
              👑 Room Host
            </div>
            <div class="lobby-participant-card ${isMe ? 'is-self' : ''}" style="border-color:rgba(245,158,11,0.35); background:rgba(245,158,11,0.05)">
              <div class="avatar-ring ${isOnline ? 'online' : 'offline'}" style="border-color:#fbbf24; color:#fbbf24; background:rgba(245,158,11,0.15)">
                ${(hostUser.name || 'H').charAt(0).toUpperCase()}
              </div>
              <div style="flex:1; min-width:0">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
                  <span style="font-weight:700; font-size:0.92rem; color:var(--text-primary)">👑 ${hostUser.name}</span>
                  <span class="role-badge host">Host</span>
                  ${isMe ? '<span style="font-size:0.75rem; color:#34d399; font-weight:700">(You)</span>' : ''}
                </div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px">
                  ${isOnline ? '🟢 Connected' : '⏳ Reconnecting...'} · ${hostUser.isMuted ? '🔇 Muted' : '🎤 Microphone Ready'}
                </div>
              </div>
            </div>
          `;
        }

        // PARTICIPANTS SECTION
        html += `
          <div style="font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.1em; color:#60a5fa; margin:16px 0 6px; display:flex; align-items:center; gap:6px">
            👥 Participants (${regularParticipants.length})
          </div>
        `;

        if (regularParticipants.length === 0) {
          html += `
            <div style="text-align:center; color:var(--text-muted); padding:16px; font-size:0.85rem; background:rgba(255,255,255,0.02); border-radius:10px; border:1px dashed rgba(255,255,255,0.08)">
              Waiting for participants to join via code or invite link...
            </div>
          `;
        } else {
          html += regularParticipants.map(p => {
            const isMe = Number(p.userId) === Number(userId) || p.name === userName;
            const isOnline = p.isConnected !== false;

            return `
              <div class="lobby-participant-card ${isMe ? 'is-self' : ''}">
                <div class="avatar-ring ${isOnline ? 'online' : 'offline'}">
                  ${(p.name || 'P').charAt(0).toUpperCase()}
                </div>
                <div style="flex:1; min-width:0">
                  <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
                    <span style="font-weight:700; font-size:0.92rem; color:var(--text-primary)">${p.name}</span>
                    <span class="role-badge participant">Participant</span>
                    ${isMe ? '<span style="font-size:0.75rem; color:#34d399; font-weight:700">(You)</span>' : ''}
                  </div>
                  <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px">
                    ${isOnline ? '🟢 Connected' : '⏳ Reconnecting...'} · ${p.isMuted ? '🔇 Muted' : '🎤 Microphone Ready'}
                  </div>
                </div>
              </div>
            `;
          }).join('');
        }

        lobbyList.innerHTML = html;
      }
    }

    // 3. Active GD Participant Grid
    const activeGrid = document.getElementById('active-participants-grid');
    if (activeGrid) {
      activeGrid.innerHTML = uniqueParticipants.map(p => {
        const isMe = Number(p.userId) === Number(userId) || p.name === userName;
        const isParticipantHost = p.role === 'host';
        const isOnline = p.isConnected !== false;

        return `
          <div class="participant-tile ${p.isSpeaking ? 'speaking-pulse' : ''} ${isMe ? 'self-tile' : ''}" id="tile-user-${p.userId || p.name}">
            <div class="tile-avatar-container">
              <div class="tile-avatar" style="background: ${getAvatarColor(p.name)}25; color:${getAvatarColor(p.name)}">
                ${(p.name || 'P').charAt(0).toUpperCase()}
              </div>
              <div class="speaker-wave-indicator ${p.isSpeaking ? 'visible' : ''}">
                <span></span><span></span><span></span>
              </div>
            </div>
            <div class="tile-name">
              ${isParticipantHost ? '👑 ' : ''}${p.name} ${isMe ? '<span style="color:#34d399">(You)</span>' : ''}
            </div>
            <div class="tile-status-bar">
              ${isParticipantHost ? '<span class="role-badge host" style="font-size:0.65rem">👑 Host</span>' : '<span class="role-badge participant" style="font-size:0.65rem">Participant</span>'}
              <span class="mic-status-icon ${p.isMuted ? 'muted' : 'active'}" title="${p.isMuted ? 'Muted' : 'Microphone Ready'}">
                ${p.isMuted ? '🔇' : '🎤'}
              </span>
              <span style="font-size:0.72rem; color:${p.isSpeaking ? '#34d399' : 'var(--text-muted)'}">
                ${p.isSpeaking ? 'Speaking...' : isOnline ? 'Listening' : 'Offline'}
              </span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  function updateSpeakerVisuals(speakerUserId, speakerName, isSpeaking) {
    const speakerBanner = document.getElementById('current-speaker-spotlight');
    if (speakerBanner) {
      if (isSpeaking) {
        speakerBanner.classList.add('active');
        speakerBanner.innerHTML = `
          <span class="pulse-mic">🎙️</span>
          <span>CURRENT SPEAKER: <strong>${speakerName}</strong></span>
          <div class="sound-wave"><span></span><span></span><span></span><span></span></div>
        `;
      } else {
        speakerBanner.classList.remove('active');
        speakerBanner.innerHTML = `
          <span style="opacity:0.6">🎙️</span>
          <span style="color:var(--text-muted)">Discussion in progress — click Speak or type to participate</span>
        `;
      }
    }

    participants.forEach(p => {
      const match = (speakerUserId && Number(p.userId) === Number(speakerUserId)) || p.name === speakerName;
      if (match) p.isSpeaking = !!isSpeaking;
    });

    document.querySelectorAll('.participant-tile').forEach(tile => {
      tile.classList.remove('speaking-pulse');
    });

    if (isSpeaking) {
      const targetTile = document.getElementById(`tile-user-${speakerUserId || speakerName}`);
      if (targetTile) targetTile.classList.add('speaking-pulse');
    }
  }

  function appendChatMessage(speaker, message, isOwn, timestamp) {
    const container = document.getElementById('live-transcript-container');
    if (!container) return;

    const emptyNotice = container.querySelector('.empty-transcript-notice');
    if (emptyNotice) emptyNotice.remove();

    const timeStr = timestamp
      ? new Date(timestamp).toLocaleTimeString('en-IN', { minute: '2-digit', second: '2-digit' })
      : new Date().toLocaleTimeString('en-IN', { minute: '2-digit', second: '2-digit' });

    const color = getAvatarColor(speaker);

    const row = document.createElement('div');
    row.className = `transcript-bubble ${isOwn ? 'is-self' : ''}`;
    row.innerHTML = `
      <div class="transcript-meta">
        <span class="transcript-speaker" style="color:${color}">${speaker}</span>
        <span class="transcript-time">[${timeStr}]</span>
      </div>
      <div class="transcript-body">${escapeHtml(message)}</div>
    `;

    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  function appendSystemMessage(text) {
    const container = document.getElementById('live-transcript-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'transcript-system-message';
    row.textContent = text;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  function renderTopicBriefing() {
    if (!topicContent) return;
    const briefingContainer = document.getElementById('topic-briefing-content');
    if (!briefingContainer) return;

    briefingContainer.innerHTML = `
      <div style="margin-bottom:14px">
        <div style="font-size:0.75rem; font-weight:700; color:#a78bfa; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px">Overview</div>
        <p style="font-size:0.85rem; line-height:1.6; color:var(--text-secondary); margin:0">${topicContent.overview || ''}</p>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px">
        <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:10px; padding:12px">
          <div style="font-size:0.75rem; font-weight:700; color:#34d399; margin-bottom:6px">✓ Key Arguments (Pros)</div>
          <ul style="margin:0; padding-left:16px; font-size:0.8rem; color:var(--text-secondary); line-height:1.5">
            ${(topicContent.pros || []).map(p => `<li>${p}</li>`).join('')}
          </ul>
        </div>
        <div style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:10px; padding:12px">
          <div style="font-size:0.75rem; font-weight:700; color:#f87171; margin-bottom:6px">⚠️ Challenges / Counterarguments</div>
          <ul style="margin:0; padding-left:16px; font-size:0.8rem; color:var(--text-secondary); line-height:1.5">
            ${(topicContent.cons || []).map(c => `<li>${c}</li>`).join('')}
          </ul>
        </div>
      </div>

      <div style="background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25); border-radius:10px; padding:12px">
        <div style="font-size:0.75rem; font-weight:700; color:#60a5fa; margin-bottom:6px">📊 Facts &amp; Statistics</div>
        <ul style="margin:0; padding-left:16px; font-size:0.8rem; color:var(--text-secondary); line-height:1.5">
          ${(topicContent.facts || []).map(f => `<li>${f}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // ─── USER CONTROLS & SPEECH INTEGRATION ────────────────────────────────────
  function setupUIEventListeners() {
    // Host Start Button (in Lobby)
    const btnLobbyStart = document.getElementById('btn-lobby-start-now');
    if (btnLobbyStart) {
      btnLobbyStart.addEventListener('click', () => {
        startDiscussion('Discussion started by host!');
      });
    }

    // Host Cancel Button (in Lobby)
    const btnLobbyCancel = document.getElementById('btn-lobby-cancel');
    if (btnLobbyCancel) {
      btnLobbyCancel.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to cancel this Group Discussion room?')) return;
        try {
          await API.Rooms.cancel(roomId);
          AppUtils.showToast('Room cancelled', 'info');
          window.location.href = '/select-mode.html';
        } catch (e) {
          AppUtils.showToast(e.message || 'Could not cancel room', 'error');
        }
      });
    }

    // Host End Discussion Button (in Active GD)
    const btnHostEnd = document.getElementById('btn-host-end-gd');
    if (btnHostEnd) {
      btnHostEnd.addEventListener('click', () => {
        const confirmModal = document.getElementById('end-confirm-modal');
        if (confirmModal) confirmModal.style.display = 'flex';
      });
    }

    // Confirm End Modal Buttons
    const btnConfirmEndYes = document.getElementById('btn-confirm-end-yes');
    if (btnConfirmEndYes) {
      btnConfirmEndYes.addEventListener('click', () => {
        document.getElementById('end-confirm-modal').style.display = 'none';
        endDiscussion('Discussion ended by host.');
      });
    }
    const btnConfirmEndNo = document.getElementById('btn-confirm-end-no');
    if (btnConfirmEndNo) {
      btnConfirmEndNo.addEventListener('click', () => {
        document.getElementById('end-confirm-modal').style.display = 'none';
      });
    }

    // Microphone Speak Toggle Button (Web Speech STT)
    const btnVoice = document.getElementById('voice-input-btn');
    if (btnVoice) {
      btnVoice.addEventListener('click', toggleVoiceSpeaking);
    }

    // Mute/Unmute Toggle
    const btnMute = document.getElementById('btn-toggle-mute');
    if (btnMute) {
      btnMute.addEventListener('click', toggleMute);
    }

    // Send text message (Fallback)
    const btnSend = document.getElementById('chat-send-btn');
    const inputMsg = document.getElementById('chat-text-input');
    if (btnSend && inputMsg) {
      btnSend.addEventListener('click', sendTextMessage);
      inputMsg.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendTextMessage();
        }
      });
    }

    // Topic Briefing Toggle Drawer
    const btnBriefing = document.getElementById('btn-toggle-briefing');
    const drawer = document.getElementById('topic-briefing-drawer');
    if (btnBriefing && drawer) {
      btnBriefing.addEventListener('click', () => {
        const isShown = drawer.style.display === 'block';
        drawer.style.display = isShown ? 'none' : 'block';
      });
    }
  }

  function toggleVoiceSpeaking() {
    const voiceBtn = document.getElementById('voice-input-btn');
    const inputStatus = document.getElementById('voice-status-text');

    if (Speech.isListening()) {
      Speech.stopListening();
      if (voiceBtn) {
        voiceBtn.classList.remove('recording');
        voiceBtn.innerHTML = '🎤 <span>Click to Speak</span>';
      }
      if (inputStatus) inputStatus.textContent = 'Microphone ready';
      if (socket && socket.connected) {
        socket.emit('room:speaking_status', { roomId, isSpeaking: false });
      }
      return;
    }

    const started = Speech.startListening(
      (finalText, interimText) => {
        if (socket && socket.connected) {
          socket.emit('room:speaking_status', { roomId, isSpeaking: true });
        }
        if (inputStatus) inputStatus.textContent = `🎙️ "${interimText || finalText}"`;

        clearTimeout(speechSilenceTimer);
        speechSilenceTimer = setTimeout(() => {
          if (socket && socket.connected) {
            socket.emit('room:speaking_status', { roomId, isSpeaking: false });
          }
        }, 1500);
      },
      (finalTranscript, isSuccess, errorMsg) => {
        if (voiceBtn) {
          voiceBtn.classList.remove('recording');
          voiceBtn.innerHTML = '🎤 <span>Click to Speak</span>';
        }
        if (inputStatus) inputStatus.textContent = 'Microphone ready';
        if (socket && socket.connected) {
          socket.emit('room:speaking_status', { roomId, isSpeaking: false });
        }

        if (finalTranscript && finalTranscript.trim()) {
          const msg = finalTranscript.trim();
          if (socket && socket.connected) {
            socket.emit('room:message', {
              roomId,
              userName,
              userId,
              message: msg,
              timestamp: new Date().toISOString()
            });
          }
        }
      },
      true
    );

    if (started) {
      if (voiceBtn) {
        voiceBtn.classList.add('recording');
        voiceBtn.innerHTML = '⏹️ <span>Speaking... (Click to Stop)</span>';
      }
      if (inputStatus) inputStatus.textContent = 'Listening... Speak now!';
      if (socket && socket.connected) {
        socket.emit('room:speaking_status', { roomId, isSpeaking: true });
      }
    } else {
      AppUtils.showToast('Microphone not available or permission denied.', 'error');
    }
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (socket && socket.connected) {
      socket.emit('room:toggle_mute', { roomId, isMuted });
    }
    const btn = document.getElementById('btn-toggle-mute');
    if (btn) {
      btn.innerHTML = isMuted ? '🔇 Unmute' : '🎤 Mute';
      btn.className = isMuted ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm';
    }
    if (isMuted && Speech.isListening()) {
      Speech.stopListening();
    }
  }

  function sendTextMessage() {
    const input = document.getElementById('chat-text-input');
    const msg = input?.value.trim();
    if (!msg) return;

    if (socket && socket.connected) {
      socket.emit('room:message', {
        roomId,
        userName,
        userId,
        message: msg,
        timestamp: new Date().toISOString()
      });
    }

    input.value = '';
  }

  // ─── SHARE & INVITATION MECHANISMS ─────────────────────────────────────────
  function copyRoomCode() {
    const code = roomCode || roomId;
    if (!code) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        AppUtils.showToast(`✓ Room Code "${code}" copied to clipboard!`, 'success');
      }).catch(() => {
        AppUtils.showToast(`Room Code: ${code}`, 'info');
      });
    } else {
      AppUtils.showToast(`Room Code: ${code}`, 'info');
    }
  }

  function copyJoinLink() {
    const url = getProductionJoinUrl(roomCode || roomId);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        AppUtils.showToast('✓ Production join link copied to clipboard! 🔗', 'success');
      }).catch(() => {
        AppUtils.showToast(`Join URL: ${url}`, 'info');
      });
    } else {
      AppUtils.showToast(`Join URL: ${url}`, 'info');
    }
  }

  function shareViaWhatsApp() {
    const code = roomCode || roomId;
    const url = getProductionJoinUrl(code);

    const message =
`IntelliGD Human GD invitation

Topic: ${topic || 'Group Discussion'}
Room Code: ${code}
Join Link: ${url}`;

    const encoded = encodeURIComponent(message);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
  }

  // ─── UTILITIES ─────────────────────────────────────────────────────────────
  function getAvatarColor(name) {
    const colors = ['#6c63ff', '#10b981', '#3b82f6', '#ec4899', '#f59e0b', '#0ea5e9', '#8b5cf6', '#14b8a6'];
    const idx = Math.abs((name || 'User').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % colors.length;
    return colors[idx];
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text || ''));
    return div.innerHTML;
  }

  function openJoinDialog() {
    window.location.href = '/select-mode.html';
  }

  return {
    init,
    startDiscussion,
    endDiscussion,
    cancelRoom: () => {
      const btn = document.getElementById('btn-lobby-cancel');
      if (btn) btn.click();
    },
    copyRoomCode,
    copyJoinLink,
    shareViaWhatsApp,
    toggleVoiceSpeaking,
    toggleMute,
    sendTextMessage
  };
})();

window.HumanRoom = HumanRoom;

document.addEventListener('DOMContentLoaded', () => {
  HumanRoom.init();
});
