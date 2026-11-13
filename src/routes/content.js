const express = require('express');
const { getDb } = require('../utils/init-db');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/contact', (req, res) => {
  const { name, email, message } = req.body || {};
  if (!email || !message) return res.status(400).json({ error: 'Email and message required' });
  // In production: store in DB or send email. For starter we just acknowledge.
  console.log('[contact]', { name, email, message: message.slice(0, 200) });
  res.json({ ok: true, message: 'Thanks — we will get back to you.' });
});

router.get('/posts', (req, res) => {
  const db = getDb();
  try {
    const posts = db.prepare('SELECT slug, title, created_at FROM posts WHERE published = 1 ORDER BY id DESC LIMIT 20').all();
    res.json(posts);
  } finally {
    db.close();
  }
});

router.get('/posts/:slug', (req, res) => {
  const db = getDb();
  try {
    const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND published = 1').get(req.params.slug);
    if (!post) return res.status(404).json({ error: 'Not found' });
    res.json(post);
  } finally {
    db.close();
  }
});

// Simple admin-style create (protect in production)
router.post('/posts', auth, (req, res) => {
  const { slug, title, content } = req.body || {};
  if (!slug || !title) return res.status(400).json({ error: 'slug and title required' });
  const db = getDb();
  try {
    db.prepare('INSERT INTO posts (slug, title, content, published) VALUES (?, ?, ?, 1)').run(slug, title, content || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: 'Slug already exists' });
  } finally {
    db.close();
  }
});

module.exports = router;
