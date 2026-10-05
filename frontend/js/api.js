/**
 * api.js — Centralized API client for GD Simulator backend
 */

const API_BASE = window.location.origin + '/api';

/**
 * Get stored JWT token
 */
function getToken() {
  return localStorage.getItem('gd_token');
}

/**
 * Get stored user object
 */
function getUser() {
  try {
    return JSON.parse(localStorage.getItem('gd_user') || 'null');
  } catch { return null; }
}

/**
 * Get stored Gemini API key (user-provided)
 */
function getGeminiKey() {
  return localStorage.getItem('gd_gemini_key') || localStorage.getItem('gemini_api_key') || '';
}

/**
 * Core fetch wrapper with auth + error handling
 */
async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Auto-redirect on auth failure
    if (response.status === 401 && !endpoint.includes('/auth/')) {
      localStorage.removeItem('gd_token');
      localStorage.removeItem('gd_user');
      window.location.href = '/index.html';
      return;
    }
    throw new Error(data.error || `API error: ${response.status}`);
  }

  return data;
}

// ─── AUTH ───────────────────────────────────────────────────
const Auth = {
  async register(name, email, password) {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
    if (data.token) {
      localStorage.setItem('gd_token', data.token);
      localStorage.setItem('gd_user', JSON.stringify(data.user));
    }
    return data;
  },

  async login(email, password) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (data.token) {
      localStorage.setItem('gd_token', data.token);
      localStorage.setItem('gd_user', JSON.stringify(data.user));
    }
    return data;
  },

  async getProfile() {
    return apiFetch('/auth/profile');
  },

  async updateProfile(updates) {
    return apiFetch('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  async changePassword(currentPassword, newPassword) {
    return apiFetch('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },

  logout() {
    localStorage.removeItem('gd_token');
    localStorage.removeItem('gd_user');
    localStorage.removeItem('gd_current_session');
    window.location.href = '/index.html';
  },

  isLoggedIn() {
    return !!getToken();
  },

  getUser() {
    return getUser();
  },

  getToken() {
    return getToken();
  },

  getGeminiKey() {
    return getGeminiKey();
  }
};

// ─── SESSIONS ───────────────────────────────────────────────
const Sessions = {
  async create(mode, topic, category, roomId) {
    return apiFetch('/sessions', {
      method: 'POST',
      body: JSON.stringify({ mode, topic, category, room_id: roomId })
    });
  },

  async get(sessionId) {
    return apiFetch(`/sessions/${sessionId}`);
  },

  async getById(sessionId) {
    return apiFetch(`/sessions/${sessionId}`);
  },

  async getAnalysis(sessionId) {
    return apiFetch(`/performance/${sessionId}`);
  },

  async list(limit = 20, offset = 0) {
    return apiFetch(`/sessions?limit=${limit}&offset=${offset}`);
  },

  async getHistory(limit = 20, offset = 0) {
    return apiFetch(`/sessions?limit=${limit}&offset=${offset}`);
  },

  async addTranscript(sessionId, speaker, speakerType, message) {
    return apiFetch(`/sessions/${sessionId}/transcript`, {
      method: 'POST',
      body: JSON.stringify({ speaker, speaker_type: speakerType, message })
    });
  },

  async end(sessionId) {
    return apiFetch(`/sessions/${sessionId}/end`, { method: 'PUT' });
  }
};

// ─── AI ─────────────────────────────────────────────────────
const AI = {
  async getAgentResponse(agentId, topic, conversationHistory, userMessage) {
    return apiFetch('/ai/respond', {
      method: 'POST',
      body: JSON.stringify({
        agentId,
        topic,
        conversationHistory,
        userMessage,
        apiKey: getGeminiKey()
      })
    });
  },

  async generateTopics(category) {
    return apiFetch('/ai/topics', {
      method: 'POST',
      body: JSON.stringify({ category, apiKey: getGeminiKey() })
    });
  },

  async evaluate(sessionId) {
    return apiFetch('/ai/evaluate', {
      method: 'POST',
      body: JSON.stringify({ sessionId, apiKey: getGeminiKey() })
    });
  },

  async getAgents() {
    return apiFetch('/ai/agents');
  }
};

// ─── PERFORMANCE ────────────────────────────────────────────
const Performance = {
  async getHistory(limit = 20, offset = 0) {
    return apiFetch(`/performance/history?limit=${limit}&offset=${offset}`);
  },

  async getStats() {
    return apiFetch('/performance/stats');
  },

  async getSession(sessionId, userId) {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    return apiFetch(`/performance/${encodeURIComponent(sessionId)}${q}`);
  }
};

// ─── UTILITIES ──────────────────────────────────────────────
function requireAuth() {
  if (!Auth.isLoggedIn()) {
    const currentLoc = window.location.pathname + window.location.search;
    const returnUrl = encodeURIComponent(currentLoc);
    window.location.href = `/index.html?returnUrl=${returnUrl}`;
    return false;
  }
  return true;
}

function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || '📢'}</span><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, duration + 300);
}

function formatDuration(seconds) {
  if (!seconds) return '0m 0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function getScoreColor(score) {
  if (score >= 80) return '#10b981';
  if (score >= 65) return '#3b82f6';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function getScoreGrade(score) {
  if (score >= 85) return { grade: 'Excellent', cls: 'grade-excellent' };
  if (score >= 70) return { grade: 'Good', cls: 'grade-good' };
  if (score >= 55) return { grade: 'Average', cls: 'grade-average' };
  return { grade: 'Needs Work', cls: 'grade-poor' };
}

// ─── ROOMS (HUMAN GD) ───────────────────────────────────────
const Rooms = {
  async create(topic, category, joiningDuration, gdDuration, maxParticipants) {
    return apiFetch('/rooms', {
      method: 'POST',
      body: JSON.stringify({ topic, category, joiningDuration, gdDuration, maxParticipants })
    });
  },

  async validate(code, topic = '') {
    const q = topic ? `?topic=${encodeURIComponent(topic)}` : '';
    return apiFetch(`/rooms/validate/${encodeURIComponent(code)}${q}`);
  },

  async get(roomId, topic = '') {
    const q = topic ? `?topic=${encodeURIComponent(topic)}` : '';
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}${q}`);
  },

  async join(roomId, topic = '') {
    const q = topic ? `?topic=${encodeURIComponent(topic)}` : '';
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/join${q}`, {
      method: 'POST'
    });
  },

  async start(roomId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/start`, {
      method: 'POST'
    });
  },

  async end(roomId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/end`, {
      method: 'POST'
    });
  },

  async cancel(roomId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/cancel`, {
      method: 'POST'
    });
  },

  async getResults(roomId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/results`);
  },

  async sync(roomId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/sync`);
  }
};

// Export everything to window for global access
window.API = { Auth, Sessions, AI, Performance, Rooms };
window.AppUtils = { requireAuth, showToast, formatDuration, formatDate, getScoreColor, getScoreGrade, getUser, getToken, getGeminiKey };

