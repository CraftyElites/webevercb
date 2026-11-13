const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../utils/init-db');
const { authLimiter } = require('../middleware/rate-limit');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, plan: user.plan },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function logActivity(db, { userId, email, success, ip, userAgent }) {
  db.prepare(
    'INSERT INTO login_activity (user_id, email, success, ip, user_agent) VALUES (?, ?, ?, ?, ?)'
  ).run(userId || null, email, success ? 1 : 0, ip || '', userAgent || '');
}

router.post('/signup', authLimiter, (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Valid email and password (min 8 chars) required' });
  }

  const db = getDb();
  try {
    const hash = bcrypt.hashSync(password, 12);
    const info = db.prepare(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
    ).run(email.toLowerCase().trim(), hash, name || '');

    const user = { id: info.lastInsertRowid, email, plan: 'free' };
    logActivity(db, { userId: user.id, email, success: true, ip: req.ip, userAgent: req.get('user-agent') });

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email, name, plan: 'free' } });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Signup failed' });
  } finally {
    db.close();
  }
});

router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const db = getDb();
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    const success = user && bcrypt.compareSync(password, user.password_hash);

    logActivity(db, {
      userId: user ? user.id : null,
      email,
      success,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    if (!success) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan }
    });
  } finally {
    db.close();
  }
});

router.get('/me', require('../middleware/auth').auth, (req, res) => {
  const db = getDb();
  try {
    const user = db.prepare(
      'SELECT id, email, name, plan, quota_bytes, used_bytes FROM users WHERE id = ?'
    ).get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.percent_used = Math.round((user.used_bytes / user.quota_bytes) * 1000) / 10;
    res.json(user);
  } finally {
    db.close();
  }
});

router.get('/activity', require('../middleware/auth').auth, (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare(
      'SELECT success, ip, user_agent, created_at FROM login_activity WHERE user_id = ? ORDER BY id DESC LIMIT 50'
    ).all(req.user.id);
    res.json(rows);
  } finally {
    db.close();
  }
});

module.exports = router;
