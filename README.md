# 🎤 AI-Based Group Discussion Simulator

An end-to-end web platform designed to empower students and job aspirants to practice **Group Discussions (GD)** in a realistic simulated environment and receive deep **AI-powered performance analytics** and diagnostic feedback.

![Architecture Overview](https://img.shields.io/badge/Mode-AI%20Multi--Agent-6c63ff)
![Real-time](https://img.shields.io/badge/Real--Time-Socket.IO-10b981)
![AI Engine](https://img.shields.io/badge/AI-Google%20Gemini-f59e0b)
![Database](https://img.shields.io/badge/Database-SQLite3%20WAL-3b82f6)

---

## 🌟 Key Features

### 1. Dual Practice Modes
* **🤖 AI Group Discussion Mode**:
  * Practice with 2 to 6 autonomous AI participants with distinct personas (Constructive Supporter, Critical Challenger, Analytical/Data-Driven, Mediator/Synthesizer).
  * System moderator dynamically facilitates turns, enforces time limits, and ensures natural conversational flow.
  * Live voice-to-text via Web Speech API and text-to-speech AI voice playback.
  * Real-time conversational insights and keyword extraction.
* **👥 Human Group Discussion Mode**:
  * Real-time peer-to-peer discussions powered by WebSockets (`Socket.IO`).
  * Instant room creation with 6-character room codes and one-click invite links.
  * Participant roster with mute/unmute status, live speaking indicator, and host controls.

### 2. Comprehensive AI Performance Evaluation
Evaluates your performance across **8 core competencies**:
1. **Communication Skills**: Articulation, clarity, structure, and expression.
2. **English Fluency**: Flow of speech, cadence, and grammatical correctness.
3. **Vocabulary**: Contextual phrasing, professional lexicon, filler word minimization.
4. **Content Quality**: Relevance of arguments, factual backing, depth of thought.
5. **Confidence**: Assertive delivery, conviction, and emotional stability.
6. **Leadership**: Guiding discussions, steering conversations, and building consensus.
7. **Teamwork & Collaboration**: Active listening, acknowledging peers, turn-taking.
8. **Critical Thinking**: Multi-perspective reasoning and handling counter-arguments.

### 3. Analytics & Feedback Reports
* Animated score ring and performance grading (A+, A, B, C, Needs Work).
* Interactive **Chart.js** Radar competency charts and bar score distributions.
* Categorized feedback (Key Strengths, Areas for Improvement, Actionable Recommendations).
* Full searchable and exportable transcript viewer.

---

## 📂 Project Structure

```
Final_demo_GD/
├── backend/
│   ├── db.js                     # SQLite DB initialization & schema creation
│   ├── server.js                 # Express + Socket.IO server entry point
│   ├── package.json              # Backend dependencies
│   ├── .env.example              # Environment variables template
│   ├── middleware/
│   │   └── auth.js               # JWT verification middleware
│   ├── routes/
│   │   ├── auth.js               # Register, login, profile routes
│   │   ├── sessions.js           # Session creation, transcript & evaluation
│   │   ├── ai.js                 # Gemini topic generation & agent responses
│   │   └── performance.js        # User metrics, stats & skill aggregates
│   └── utils/
│       └── gemini.js             # Google Gemini API helper with resilient offline fallbacks
├── frontend/
│   ├── index.html                # Modern Login / Registration page
│   ├── dashboard.html            # Main User Dashboard & Progress Overview
│   ├── select-mode.html          # Mode selection (AI GD vs Human GD)
│   ├── select-topic.html         # Topic library + AI topic generator
│   ├── gd-instructions.html      # Prep timer, GD rules & persona preview
│   ├── ai-room.html              # 3-Panel interactive AI GD Room
│   ├── human-room.html           # Real-time WebSockets Human GD Room
│   ├── results.html              # Detailed session evaluation & charts
│   ├── performance.html          # Performance analytics & radar charts
│   ├── history.html              # Session history, search & transcript logs
│   ├── profile.html              # User profile & Gemini API configuration
│   ├── css/
│   │   ├── main.css              # Core design tokens, dark glassmorphic styling
│   │   ├── ai-room.css           # AI Room 3-panel layout styling
│   │   └── results.css           # Evaluation visual styling & score gauges
│   └── js/
│       ├── api.js                # Frontend API client & authentication store
│       ├── speech.js             # Web Speech recognition & synthesis engine
│       ├── ai-room.js            # AI discussion state machine & agent turns
│       └── human-room.js         # Socket.IO client room management
├── sample_data/
│   └── seed.js                   # Pre-populates demo data & past sessions
└── docs/
    ├── README.md                 # Project Overview
    ├── SETUP_INSTRUCTIONS.md     # Installation & execution guide
    ├── API_DOCUMENTATION.md      # REST API & Socket.IO specifications
    ├── DATABASE_SCHEMA.md        # Relational schema documentation
    └── ARCHITECTURE.md           # Architecture design & system workflows
```

---

## 🚀 Quick Start

1. **Install backend dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   Add your `GEMINI_API_KEY` (optional; system includes smart offline response engines for AI participants, topic briefings, and evaluations).

3. **Run Comprehensive Test Suite**:
   ```bash
   npm test
   ```
   *Runs 43 automated integration tests validating all Human GD states, validations, socket events, evaluations, and AI GD non-regression.*

4. **Start the application**:
   ```bash
   npm start
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.
   * **Demo Account**: `demo@gd.com` / `demo123`

---

## 👥 Mode 2: Human Group Discussion System

The platform includes a real-time multiplayer Human Group Discussion system:

### 1. Room Creation (Host)
* Configure **Topic** (or pick from curated AI/industry presets).
* Select **Joining Time**: 1, 2, 3, 5, or 10 minutes.
* Select **GD Duration**: 2, 3, 5, 10, 15, or 20 minutes.
* Set **Max Participants**: 2 to 10 participants.
* System generates a unique 5-character room code (`GD-XXXXX`) and creates an authoritative database record in `human_rooms`.

### 2. WhatsApp & Direct Link Invitations
* **1-Click WhatsApp Invite**: Generates pre-formatted WhatsApp invitation message with direct deep link.
* **Direct URL Redirect**: `/gd/join/:code` and `/join/:code` automatically redirect to the room lobby with code pre-filled.
* **Shareable Join Link**: Automatically adapts to current host origin (`window.location.origin`).

### 3. Server-Authoritative Join Validation
* Rejects expired join deadlines with clear message.
* Rejects full rooms (exceeding configured `max_participants`).
* Rejects late joiners once the discussion has already started or ended.
* Ensures each participant gets a distinct `gd_sessions` record and `room_participants` entry.

### 4. Real-time Waiting Lobby
* Live countdown clock for remaining joining time.
* Live participant roster synced via Socket.IO with avatar initials and host badges.
* Topic briefing drawer providing structured overview, arguments, pros/cons, and key facts.
* Host manual start control (`room:start`) with server-side validation against `host_id`.
* Automatic discussion start when joining timer reaches 0.

### 5. Live Discussion Room
* **Current Speaker Spotlight**: Displays who is speaking with glowing halo and animated audio bars.
* **Web Speech Recognition STT**: Integrated via `frontend/js/speech.js` with microphone toggle and real-time transcripts broadcasted to all peers.
* **Live Transcript Feed**: Color-coded chat log with speaker names, timestamps, and role badges.
* **Live GD Timer**: Server-synchronized duration clock.
* **Host End Control**: Host can end discussion early with confirmation modal, or GD automatically completes when duration expires.

### 6. Post-GD AI Evaluations & Scoreboard
* Separate AI evaluations executed for every participant who spoke using multi-metric scoring (Communication, Fluency, Vocabulary, Content, Confidence, Leadership, Teamwork, Critical Thinking, Listening).
* **Host Scoreboard**: Summary table of all participants with their overall scores, rankings, speaking turns, and drill-down modal to inspect detailed reports.
* **Participant Results**: Individual performance report with strengths, improvement areas, evidence snippets, and personalized practice plan.



