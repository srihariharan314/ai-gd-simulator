/**
 * human-room.js — Complete Human Group Discussion Room Lifecycle
 * Handles: Waiting Lobby, Joining Countdown, Realtime Participant Sync,
 * Server Authoritative Host Controls, Web Speech STT, Live Transcript,
 * WhatsApp Invitation, and Post-GD Multi-Participant AI Evaluation.
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
  let topicContent = null;
  let timerInterval = null;
  let timerRemainingSeconds = 120;

  // ─── CLIENT-SIDE SMOOTH COUNTDOWN TIMER ───────────────────────────────────
  function startClientTimer(initialSeconds, timerType) {
    if (timerInterval) clearInterval(timerInterval);
    timerRemainingSeconds = Math.max(0, parseInt(initialSeconds, 10) || (timerType === 'joining' ? 120 : 300));
    updateTimerDisplay(timerRemainingSeconds, timerType);

    timerInterval = setInterval(() => {
      timerRemainingSeconds--;
      updateTimerDisplay(timerRemainingSeconds, timerType);

      if (timerRemainingSeconds <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        if (timerType === 'joining') {
          console.log('⏰ Joining countdown expired. Starting GD automatically...');
          startDiscussion('Joining countdown ended. Discussion started automatically!');
        } else if (timerType === 'gd') {
          console.log('⏰ Discussion timer expired. Concluding GD...');
          endDiscussion('Discussion time limit reached.');
        }
      }
    }, 1000);
  }

  // ─── START & END DISCUSSION CONTROLS (SERVERLESS AUTHORITATIVE) ───────────
  async function startDiscussion(reason = 'Discussion started by host') {
    if (roomStatus === 'ACTIVE') return;
    roomStatus = 'ACTIVE';

    // 1. Emit to Socket if connected
    try {
      if (socket && socket.connected) {
        socket.emit('room:start', { roomId, userId });
      }
    } catch (e) {
      console.warn('Socket start error:', e.message);
    }

    // 2. Call backend REST endpoint POST /api/rooms/:roomId/start
    try {
      if (API.Rooms && API.Rooms.start) {
        await API.Rooms.start(roomId);
      }
    } catch (e) {
      console.warn('REST start error:', e.message);
    }

    // 3. Update UI immediately
    AppUtils.showToast('🚀 Group Discussion has started! Good luck!', 'success', 3500);
    switchViewToActive();
    appendSystemMessage('🚀 Group Discussion is now ACTIVE. Participants may speak.');

    // 4. Start active discussion countdown timer
    startClientTimer(gdDuration || 300, 'gd');
  }

  async function endDiscussion(reason = 'Discussion ended.') {
    if (roomStatus === 'COMPLETED') return;
    roomStatus = 'COMPLETED';

    Speech.stopListening();
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    try {
      if (socket && socket.connected) {
        socket.emit('room:end', { roomId, userId });
      }
    } catch (e) {}

    try {
      if (API.Rooms && API.Rooms.end) {
        await API.Rooms.end(roomId);
      }
    } catch (e) {}

    switchViewToCompleted(reason);
  }

  // ─── INITIALIZATION ────────────────────────────────────────────────────────
  async function init() {
    if (!AppUtils.requireAuth()) return;

    const user = AppUtils.getUser();
    userName = user?.name || 'Participant';
    userId = user?.user_id;
    userAvatar = (userName.charAt(0) || 'P').toUpperCase();

    // 1. Parse URL parameters and cached room
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action'); // 'create', 'lobby', 'join'
    const queryRoomId = params.get('roomId');
    const queryRoomCode = params.get('roomCode') || params.get('room');
    const queryTopic = params.get('topic');
    sessionId = params.get('session');

    let cachedRoom = null;
    try {
      cachedRoom = JSON.parse(localStorage.getItem('gd_last_room') || 'null');
    } catch (e) {}

    // Synchronously set initial values so UI renders immediately
    roomCode = queryRoomCode || (cachedRoom && cachedRoom.room_code) || queryRoomId || 'GD-LIVE';
    roomId = queryRoomId || (cachedRoom && cachedRoom.room_id) || ('room_' + roomCode);
    topic = queryTopic || (cachedRoom && cachedRoom.topic) || 'AI: Boon or Bane?';
    category = (cachedRoom && cachedRoom.category) || 'General';

    // Authoritative initial role derivation:
    // Only action === 'create' or isHost === '1' can be true initially; joining users are strictly false
    if (action === 'create' || params.get('isHost') === '1') {
      isHost = true;
      roomHostId = userId;
    } else if (action === 'join' || params.get('isHost') === '0') {
      isHost = false;
    } else if (cachedRoom && cachedRoom.host_id) {
      roomHostId = cachedRoom.host_id;
      isHost = (userId !== null && userId !== undefined && userId === roomHostId);
    } else {
      isHost = false;
    }

    // Initial participant entry for current user
    participants = [{
      userId,
      name: userName,
      role: isHost ? 'host' : 'participant',
      isConnected: true,
      isMuted: false,
      isSpeaking: false
    }];

    // IMMEDIATELY render room code, header, lobby, and countdown timer
    updateHeaderInfo();
    setupUIEventListeners();
    switchViewToLobby();
    startClientTimer(120, 'joining');
    renderParticipants();

    const identifier = queryRoomCode || queryRoomId;

    if (!identifier && action !== 'create') {
      openJoinDialog();
      return;
    }

    try {
      // 2. Fetch authoritative room details from backend
      let roomData = null;
      if (identifier) {
        try {
          const res = await API.Rooms.get(identifier, topic);
          if (res && res.room) {
            roomData = res.room;
            topicContent = res.topicContent;
            roomHostId = res.room.host_id || res.hostId || roomHostId;
            if (roomHostId) {
              isHost = (userId !== null && userId !== undefined && userId === roomHostId);
            } else if (res.isHost !== undefined) {
              isHost = !!res.isHost;
            }
            if (res.participants && res.participants.length > 0) {
              participants = res.participants;
            }
          }
        } catch (fetchErr) {
          console.warn('API.Rooms.get fallback to local state:', fetchErr.message);
        }
      }

      if (roomData) {
        roomId = roomData.room_id || roomId;
        roomCode = roomData.room_code || roomCode;
        topic = roomData.topic || topic;
        category = roomData.category || category;
        roomStatus = roomData.status || roomStatus;
        gdDuration = roomData.gd_duration || 300;
        joiningDuration = roomData.joining_duration || 120;
      } else if (action === 'create') {
        try {
          const createRes = await API.Rooms.create(
            topic || 'AI: Boon or Bane?',
            category || 'General',
            joiningDuration || 120,
            gdDuration || 300,
            6
          );
          if (createRes && createRes.room) {
            roomId = createRes.room.room_id;
            roomCode = createRes.room.room_code;
            topic = createRes.room.topic;
            sessionId = createRes.session?.session_id;
            roomHostId = createRes.room.host_id || userId;
            isHost = (userId !== null && userId !== undefined && userId === roomHostId);
          }
        } catch (createErr) {
          console.warn('API.Rooms.create fallback:', createErr.message);
        }
      }

      // 3. Join the room on the backend (registers participant & session)
      try {
        const joinRes = await API.Rooms.join(roomId, topic);
        if (joinRes && joinRes.session) {
          sessionId = joinRes.session.session_id;
          localStorage.setItem('gd_current_session', JSON.stringify(joinRes.session));
        }
        if (joinRes && joinRes.room) {
          roomHostId = joinRes.room.host_id || joinRes.hostId || roomHostId;
          isHost = (userId !== null && userId !== undefined && userId === roomHostId);
        } else if (joinRes && joinRes.isHost !== undefined) {
          isHost = !!joinRes.isHost;
        }
        if (joinRes && joinRes.participants && joinRes.participants.length > 0) {
          participants = joinRes.participants;
        }
      } catch (joinErr) {
        console.warn('API.Rooms.join fallback:', joinErr.message);
      }

      // 4. Ensure a valid session exists for AI evaluation tracking
      if (!sessionId) {
        try {
          const sessRes = await API.Sessions.create('human', topic, category, roomId);
          if (sessRes && sessRes.session) {
            sessionId = sessRes.session.session_id;
            localStorage.setItem('gd_current_session', JSON.stringify(sessRes.session));
          }
        } catch (sessErr) {
          console.warn('Session create fallback:', sessErr.message);
        }
      }

      // Update Header & DOM with final room info
      updateHeaderInfo();
      renderParticipants();
      renderTopicBriefing();
      switchViewToLobby();

      // Connect Socket.IO
      connectSocket();

    } catch (err) {
      console.error('Human room initialization error:', err);
      updateHeaderInfo();
      renderParticipants();
      switchViewToLobby();
      connectSocket();
    }
  }

  // ─── SOCKET.IO CONNECTION & REAL-TIME EVENTS ──────────────────────────────
  function connectSocket() {
    socket = io(window.location.origin);

    socket.on('connect', () => {
      console.log('🔌 Connected to Human GD Socket server with ID:', socket.id);

      if (isHost) {
        socket.emit('room:create', {
          roomId,
          roomCode,
          topic,
          userName,
          userId
        });
      } else {
        socket.emit('room:join', {
          roomId,
          roomCode,
          userName,
          userId
        });
      }
    });

    socket.on('room:joined', (data) => {
      roomId = data.roomId;
      roomCode = data.roomCode || roomCode;
      topic = data.topic || topic;
      if (data.hostId) {
        roomHostId = data.hostId;
        isHost = (userId !== null && userId !== undefined && userId === roomHostId);
      } else if (data.isHost !== undefined) {
        isHost = !!data.isHost;
      }
      roomStatus = data.status || roomStatus;

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
        if (data.joiningTimerRemaining !== undefined) {
          updateTimerDisplay(data.joiningTimerRemaining, 'joining');
        }
      }
    });

    socket.on('room:error', (data) => {
      AppUtils.showToast(data.message || 'Room error', 'error');
    });

    socket.on('room:joining_timer', (data) => {
      if (data && data.remaining !== undefined) {
        timerRemainingSeconds = data.remaining;
        updateTimerDisplay(timerRemainingSeconds, 'joining');
      }
    });

    socket.on('room:started', (data) => {
      startDiscussion(data?.message || 'Group Discussion started!');
    });

    socket.on('room:timer', (data) => {
      if (data && data.remaining !== undefined) {
        timerRemainingSeconds = data.remaining;
        updateTimerDisplay(timerRemainingSeconds, 'gd');
      }
    });

    socket.on('room:participant_joined', (data) => {
      if (data.participants) {
        participants = data.participants;
        renderParticipants();
        if (roomStatus === 'WAITING_FOR_PARTICIPANTS') {
          switchViewToLobby();
        }
      }
      if (data.participant && data.participant.name !== userName) {
        AppUtils.showToast(`👋 ${data.participant.name} joined the room`, 'info', 2500);
      }
    });

    socket.on('room:participant_status', (data) => {
      const p = participants.find(part => part.userId === data.userId || part.name === data.name);
      if (p) {
        p.isConnected = data.isConnected;
        renderParticipants();
      }
    });

    socket.on('room:participants_update', (updatedList) => {
      if (Array.isArray(updatedList)) {
        participants = updatedList;
        renderParticipants();
        if (roomStatus === 'WAITING_FOR_PARTICIPANTS') {
          switchViewToLobby();
        }
      }
    });

    socket.on('room:speaking_status', (data) => {
      updateSpeakerVisuals(data.userId, data.userName, data.isSpeaking);
    });

    socket.on('room:message', (data) => {
      appendChatMessage(data.userName, data.message, data.userId === userId || data.userName === userName, data.timestamp);
    });

    socket.on('room:host_status', (data) => {
      const banner = document.getElementById('host-reconnecting-banner');
      if (banner) {
        banner.style.display = data.status === 'reconnecting' ? 'flex' : 'none';
        banner.textContent = `⚠️ ${data.message}`;
      }
    });

    socket.on('room:ended', (data) => {
      endDiscussion(data?.message || 'Discussion ended.');
    });

    socket.on('room:evaluations_ready', (data) => {
      console.log('✅ Post-GD evaluations are ready for room:', data.roomId);
      setTimeout(() => {
        navigateToResults();
      }, 1500);
    });

    socket.on('disconnect', () => {
      console.warn('Socket disconnected');
      const badge = document.getElementById('connection-status-badge');
      if (badge) {
        badge.textContent = '🟡 Reconnecting...';
        badge.className = 'badge badge-warning';
      }
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

    // Host controls in active GD
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

    // Auto navigate after grace time if socket event hasn't already redirected
    setTimeout(() => {
      navigateToResults();
    }, 4000);
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

    // Join Link
    const directJoinUrl = `${window.location.origin}/gd/join/${encodeURIComponent(roomCode || roomId || '')}`;
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

    if (timerType === 'joining') {
      const lobbyTimer = document.getElementById('lobby-countdown-timer');
      if (lobbyTimer) lobbyTimer.textContent = timeStr;

      const headerTimer = document.getElementById('timer-display');
      if (headerTimer) {
        headerTimer.textContent = timeStr;
        headerTimer.className = 'timer-display' + (sec <= 30 ? ' danger' : sec <= 60 ? ' warning' : '');
      }

      const timerLabel = document.getElementById('timer-label');
      if (timerLabel) timerLabel.textContent = 'Joining closes in';

    } else {
      // Discussion Timer
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
      if (timerLabel) timerLabel.textContent = 'Discussion ends in';
    }
  }

  function renderParticipants() {
    // Deduplicate participants by unique key (userId or socketId or name)
    const uniqueParticipants = [];
    const seen = new Set();
    (participants || []).forEach(p => {
      const key = p.userId || p.socketId || p.name;
      if (key && !seen.has(key)) {
        seen.add(key);
        // Authoritative role check: user is host ONLY if matches roomHostId or role === 'host'
        const isParticipantHost = (roomHostId && p.userId === roomHostId) || p.role === 'host';
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
          const isMe = hostUser.userId === userId || hostUser.name === userName;
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
            const isMe = p.userId === userId || p.name === userName;
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
        const isMe = p.userId === userId || p.name === userName;
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
    // 1. Current Speaker Spotlight Banner
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

    // 2. Individual tile animation
    participants.forEach(p => {
      const match = (speakerUserId && p.userId === speakerUserId) || p.name === speakerName;
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

    // Remove empty placeholder
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
      socket.emit('room:speaking_status', { roomId, isSpeaking: false });
      return;
    }

    // Start existing Speech Recognition pipeline
    const started = Speech.startListening(
      // On interim/final result
      (finalText, interimText) => {
        socket.emit('room:speaking_status', { roomId, isSpeaking: true });
        if (inputStatus) inputStatus.textContent = `🎙️ "${interimText || finalText}"`;

        // Reset silence timer
        clearTimeout(speechSilenceTimer);
        speechSilenceTimer = setTimeout(() => {
          socket.emit('room:speaking_status', { roomId, isSpeaking: false });
        }, 1500);
      },
      // On speech end
      (finalTranscript, isSuccess, errorMsg) => {
        if (voiceBtn) {
          voiceBtn.classList.remove('recording');
          voiceBtn.innerHTML = '🎤 <span>Click to Speak</span>';
        }
        if (inputStatus) inputStatus.textContent = 'Microphone ready';
        socket.emit('room:speaking_status', { roomId, isSpeaking: false });

        if (finalTranscript && finalTranscript.trim()) {
          socket.emit('room:message', {
            roomId,
            userName,
            userId,
            message: finalTranscript.trim(),
            timestamp: new Date().toISOString()
          });
        }
      },
      true // continuous listening
    );

    if (started) {
      if (voiceBtn) {
        voiceBtn.classList.add('recording');
        voiceBtn.innerHTML = '⏹️ <span>Speaking... (Click to Stop)</span>';
      }
      if (inputStatus) inputStatus.textContent = 'Listening... Speak now!';
      socket.emit('room:speaking_status', { roomId, isSpeaking: true });
    } else {
      AppUtils.showToast('Microphone not available or permission denied.', 'error');
    }
  }

  function toggleMute() {
    isMuted = !isMuted;
    socket.emit('room:toggle_mute', { roomId, isMuted });
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
    if (!msg || !socket) return;

    socket.emit('room:message', {
      roomId,
      userName,
      userId,
      message: msg,
      timestamp: new Date().toISOString()
    });

    input.value = '';
  }

  // ─── SHARE & INVITATION MECHANISMS ─────────────────────────────────────────
  function copyRoomCode() {
    const code = roomCode || roomId;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      AppUtils.showToast(`✓ Room Code "${code}" copied to clipboard!`, 'success');
    }).catch(() => {
      AppUtils.showToast(`Room Code: ${code}`, 'info');
    });
  }

  function copyJoinLink() {
    const url = `${window.location.origin}/gd/join/${encodeURIComponent(roomCode || roomId)}`;
    navigator.clipboard.writeText(url).then(() => {
      AppUtils.showToast('✓ Join link copied to clipboard! 🔗', 'success');
    }).catch(() => {
      AppUtils.showToast(`Join URL: ${url}`, 'info');
    });
  }

  function shareViaWhatsApp() {
    const code = roomCode || roomId;
    const url = `${window.location.origin}/gd/join/${encodeURIComponent(code)}`;

    const message =
`You're invited to join a Group Discussion!

Topic:
${topic || 'Group Discussion'}

GD Code:
${code}

Join the discussion:
${url}

Please join before the joining time expires.`;

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
