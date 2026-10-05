const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'gd_simulator_secret';

/**
 * Middleware: Verify JWT token from Authorization header.
 * Attaches decoded user to req.user.
 * Automatically guarantees the user exists in the local database to avoid foreign key failures.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Please log in.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // Self-healing: Ensure user exists in SQLite DB (vital for Vercel/ephemeral DB and session continuity)
    if (decoded && decoded.user_id) {
      let dbUser = db.prepare('SELECT user_id, email, name FROM users WHERE user_id = ?').get(decoded.user_id);
      if (!dbUser && decoded.email) {
        dbUser = db.prepare('SELECT user_id, email, name FROM users WHERE email = ?').get(decoded.email);
        if (dbUser) {
          req.user.user_id = dbUser.user_id;
        } else {
          try {
            db.prepare('INSERT INTO users (user_id, name, email, password) VALUES (?, ?, ?, ?)').run(
              decoded.user_id,
              decoded.name || 'User',
              decoded.email,
              'session_ephemeral_token'
            );
          } catch (e) {
            const fallback = db.prepare('SELECT user_id FROM users WHERE email = ?').get(decoded.email);
            if (fallback) req.user.user_id = fallback.user_id;
          }
        }
      }
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token. Please log in.' });
  }
}

module.exports = authMiddleware;
