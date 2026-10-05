const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'gd_simulator_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ─── POST /api/auth/register ────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  // Check if email already exists
  const existing = db.prepare('SELECT user_id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  // Hash password
  const hashedPassword = bcrypt.hashSync(password, 10);

  // Insert user
  const result = db.prepare(
    'INSERT INTO users (name, email, password) VALUES (?, ?, ?)'
  ).run(name.trim(), email.toLowerCase().trim(), hashedPassword);

  const user = db.prepare('SELECT user_id, name, email, avatar, created_at FROM users WHERE user_id = ?')
    .get(result.lastInsertRowid);

  const token = jwt.sign(
    { user_id: user.user_id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.status(201).json({
    message: 'Account created successfully!',
    token,
    user: { user_id: user.user_id, name: user.name, email: user.email, avatar: user.avatar }
  });
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const validPassword = bcrypt.compareSync(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = jwt.sign(
    { user_id: user.user_id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({
    message: 'Login successful!',
    token,
    user: { user_id: user.user_id, name: user.name, email: user.email, avatar: user.avatar }
  });
});

// ─── GET /api/auth/profile ───────────────────────────────────────────────────
router.get('/profile', authMiddleware, (req, res) => {
  const user = db.prepare(
    'SELECT user_id, name, email, avatar, bio, created_at FROM users WHERE user_id = ?'
  ).get(req.user.user_id);

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  // Get stats
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_gds,
      AVG(p.overall_score) as avg_score,
      MAX(p.overall_score) as best_score
    FROM performance p
    WHERE p.user_id = ?
  `).get(req.user.user_id);

  res.json({ user, stats });
});

// ─── PUT /api/auth/profile ───────────────────────────────────────────────────
router.put('/profile', authMiddleware, (req, res) => {
  const { name, bio, avatar } = req.body;

  db.prepare(
    'UPDATE users SET name = COALESCE(?, name), bio = COALESCE(?, bio), avatar = COALESCE(?, avatar), updated_at = CURRENT_TIMESTAMP WHERE user_id = ?'
  ).run(name, bio, avatar, req.user.user_id);

  const user = db.prepare(
    'SELECT user_id, name, email, avatar, bio FROM users WHERE user_id = ?'
  ).get(req.user.user_id);

  res.json({ message: 'Profile updated!', user });
});

// ─── PUT /api/auth/password ──────────────────────────────────────────────────
router.put('/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current and new password are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.user.user_id);
  const valid = bcrypt.compareSync(currentPassword, user.password);

  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const hashed = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
    .run(hashed, req.user.user_id);

  res.json({ message: 'Password changed successfully!' });
});

module.exports = router;
