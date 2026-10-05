# 📡 REST API & Socket.IO Specifications

This document outlines the API endpoints and WebSocket event interfaces used by the **AI-Based Group Discussion Simulator**.

---

## 🔐 Base URL & Authentication

* **Base URL**: `http://localhost:3000/api`
* **Authentication Scheme**: Bearer Token in HTTP Authorization Header:
  ```
  Authorization: Bearer <jwt_token>
  ```

---

## 1. Authentication Endpoints (`/api/auth`)

### 1.1 Register User
* **Method**: `POST`
* **Endpoint**: `/api/auth/register`
* **Public**: Yes
* **Request Body**:
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "securepassword"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "name": "Jane Doe",
      "email": "jane@example.com"
    }
  }
  ```

### 1.2 Login User
* **Method**: `POST`
* **Endpoint**: `/api/auth/login`
* **Public**: Yes
* **Request Body**:
  ```json
  {
    "email": "jane@example.com",
    "password": "securepassword"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "name": "Jane Doe",
      "email": "jane@example.com"
    }
  }
  ```

### 1.3 Get Current User Profile
* **Method**: `GET`
* **Endpoint**: `/api/auth/me`
* **Protected**: Yes
* **Response (200 OK)**:
  ```json
  {
    "user": {
      "id": 1,
      "name": "Jane Doe",
      "email": "jane@example.com",
      "created_at": "2026-09-05T10:00:00.000Z"
    }
  }
  ```

---

## 2. GD Session Endpoints (`/api/sessions`)

### 2.1 Create Discussion Session
* **Method**: `POST`
* **Endpoint**: `/api/sessions`
* **Protected**: Yes
* **Request Body**:
  ```json
  {
    "mode": "ai",
    "topic": "Is AI replacing human creativity or augmenting it?",
    "category": "Technology",
    "roomId": null
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "sessionId": 12,
    "topic": "Is AI replacing human creativity or augmenting it?",
    "mode": "ai",
    "status": "active"
  }
  ```

### 2.2 Append Transcript Turn
* **Method**: `POST`
* **Endpoint**: `/api/sessions/:id/transcript`
* **Protected**: Yes
* **Request Body**:
  ```json
  {
    "speaker": "Jane Doe (You)",
    "speakerType": "user",
    "message": "I believe AI serves as a powerful collaborative tool rather than a replacement."
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "transcriptId": 45
  }
  ```

### 2.3 Conclude Session & Trigger Evaluation
* **Method**: `POST`
* **Endpoint**: `/api/sessions/:id/complete`
* **Protected**: Yes
* **Request Body**:
  ```json
  {
    "duration": 600,
    "fillerWordCount": 4,
    "apiKey": "optional_client_gemini_key"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "sessionId": 12,
    "performance": {
      "overall_score": 84,
      "communication_score": 85,
      "fluency_score": 82,
      "vocabulary_score": 86,
      "content_score": 88,
      "confidence_score": 80,
      "leadership_score": 78,
      "teamwork_score": 85,
      "critical_thinking": 88,
      "strengths": ["Clear articulation", "Respectful counterpoints"],
      "improvements": ["Synthesize earlier before concluding"],
      "recommendations": ["Practice time management transitions"],
      "full_feedback": "Great overall clarity..."
    }
  }
  ```

### 2.4 Retrieve Session History
* **Method**: `GET`
* **Endpoint**: `/api/sessions/history?limit=20`
* **Protected**: Yes
* **Response (200 OK)**: Array of user's past GD sessions with scores and metadata.

---

## 3. AI Generation Endpoints (`/api/ai`)

### 3.1 Generate Topics by Category
* **Method**: `POST`
* **Endpoint**: `/api/ai/generate-topics`
* **Request Body**:
  ```json
  {
    "category": "Technology",
    "apiKey": "optional_key"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "topics": [
      {
        "id": "ai-1",
        "title": "Should Autonomous AI Weapons Be Banned Under International Law?",
        "category": "Technology",
        "difficulty": "Advanced",
        "starter_prompt": "Consider ethics, deterrence, and autonomous decision limits."
      }
    ]
  }
  ```

### 3.2 Generate AI Participant Response
* **Method**: `POST`
* **Endpoint**: `/api/ai/agent-turn`
* **Request Body**:
  ```json
  {
    "topic": "Is AI replacing human creativity or augmenting it?",
    "persona": {
      "name": "Vikram",
      "stance": "critical",
      "description": "Critical Challenger"
    },
    "recentMessages": [
      { "speaker": "Jane Doe", "message": "I think AI amplifies creators." }
    ],
    "apiKey": "optional_key"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "speaker": "Vikram",
    "message": "While optimistic, Jane, what about the artists whose works were scraped without consent?",
    "suggestedNext": "user"
  }
  ```

---

## 4. Socket.IO Real-Time Events (Human Mode)

### Client to Server:
* `room:create`: `{ roomId, topic, userName, userId }` — Host creates a new room.
* `room:join`: `{ roomId, userName, userId }` — Participant joins existing room.
* `room:message`: `{ roomId, userName, message, timestamp }` — Broadcasts chat argument.
* `room:toggle_mute`: `{ roomId, isMuted }` — Synchronizes mute status.
* `room:start`: `{ roomId, duration }` — Host begins discussion timer.
* `room:end`: `{ roomId }` — Host ends discussion.

### Server to Client:
* `room:joined`: `{ roomId, topic, participants }` — Confirms room membership.
* `room:participant_joined`: `{ participant, participants }` — Peer joined notification.
* `room:participant_left`: `{ name, participants }` — Peer left notification.
* `room:message`: `{ userName, message, timestamp }` — Incoming real-time message.
* `room:timer`: `{ remaining }` — 1-second countdown broadcast.
* `room:ended`: `{ message }` — Final session end event.
