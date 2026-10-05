# 🛠️ Setup & Installation Instructions

This guide provides step-by-step instructions to configure, run, and test the **AI-Based Group Discussion Simulator** on your local machine.

---

## 📋 Prerequisites

Before starting, ensure you have the following installed on your system:
* **Node.js**: v18.x or higher (LTS recommended)
* **npm**: v9.x or higher (comes bundled with Node.js)
* **Modern Web Browser**: Google Chrome or Microsoft Edge (recommended for native **Web Speech API** support for speech-to-text voice recognition)

---

## 📦 Step 1: Install Dependencies

Open your terminal, navigate to the backend directory, and install the required npm packages:

```bash
cd backend
npm install
```

This installs:
* `express` — Fast web framework for API routing and static frontend serving
* `socket.io` — Real-time bidirectional event engine for Human GD mode
* `better-sqlite3` — High-performance synchronous SQLite driver
* `bcryptjs` — Secure password hashing
* `jsonwebtoken` — Secure JWT-based authentication
* `dotenv` — Environment configuration management
* `cors` — Cross-Origin Resource Sharing middleware
* `node-fetch` — HTTP client for Google Gemini AI endpoints

---

## ⚙️ Step 2: Configure Environment Variables

1. In the `backend` folder, duplicate `.env.example` to create `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and configure your settings:
   ```env
   # Server Port
   PORT=3000

   # JWT Secret Key for token signing
   JWT_SECRET=super_secret_gd_simulator_jwt_token_2026_dev_mode

   # SQLite Database file location
   DB_PATH=./gd_simulator.db

   # Google Gemini API Key (Optional: fallbacks active if omitted)
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

> [!TIP]
> **Gemini API Key is Optional**: If no key is set, the application automatically uses smart offline AI fallback engines with pre-structured persona responses and natural language analysis algorithms.

---

## 🗄️ Step 3: Seed the Database

Pre-populate the database with demo users, past GD sessions, sample transcripts, and comprehensive scoring evaluations:

```bash
node sample_data/seed.js
```

Upon completion, you will have:
* **Demo User**: `demo@gd.com`
* **Demo Password**: `demo123`
* **4 Completed GD Sessions** with radar competency data, strengths, action items, and transcripts.

---

## 🚀 Step 4: Run the Application

Start the Express and Socket.IO server:

```bash
npm start
```

Or for development with automatic restart on file changes:

```bash
npm run dev
```

Output:
```
🚀 ========================================
🎯  GD Simulator Server Running!
🌐  http://localhost:3000
📊  API: http://localhost:3000/api/health
🚀 ========================================
```

---

## 🌐 Step 5: Access the Web App

Open your browser and navigate to:
**[http://localhost:3000](http://localhost:3000)**

### Quick Verification Checklist:
1. **Login**: Use `demo@gd.com` / `demo123` or create a new account.
2. **Dashboard**: Check recent sessions, stat summary cards, and score chart.
3. **Start AI GD**:
   * Click **Start GD** -> select **AI Group Discussion**.
   * Pick a topic from Technology, Economy, or Social Issues, or generate one.
   * Review rules and start the session in **AI GD Room**.
   * Speak using your microphone (Web Speech API) or type your argument.
   * Watch AI participants respond naturally according to their designated persona.
   * Click **End Discussion & View Report** to view detailed radar chart evaluations.
4. **Start Human GD**:
   * Select **Human GD Mode**.
   * Create a Room or join using a Room ID.
   * Open an incognito window, join the same Room ID, and chat / discuss in real-time.
