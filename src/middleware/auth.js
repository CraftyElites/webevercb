const jwt = require('jsonwebtoken');
const { getDb } = require('../utils/init-db');

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requirePlan(minPlan = 'pro') {
  const order = { free: 0, pro: 1, business: 2 };
  return (req, res, next) => {
    const db = getDb();
    const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(req.user.id);
    db.close();
    if (!user || (order[user.plan] || 0) < (order[minPlan] || 0)) {
      return res.status(403).json({ error: 'Subscription upgrade required' });
    }
    next();
  };
}

module.exports = { auth, requirePlan };
