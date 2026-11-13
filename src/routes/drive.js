const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../utils/init-db');
const { hashFileStream, getUploadDir, cache } = require('../utils/helpers');
const { auth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  dest: path.join(getUploadDir(), 'tmp'),
  limits: { fileSize: (Number(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024 }
});

router.post('/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const db = getDb();
  try {
    const hash = await hashFileStream(req.file.path);
    const size = req.file.size;
    const mime = req.file.mimetype;

    const user = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(req.user.id);
    if (user.used_bytes + size > user.quota_bytes) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Quota exceeded' });
    }

    let file = db.prepare('SELECT id, ref_count FROM files WHERE hash = ?').get(hash);
    const uploadDir = getUploadDir();
    const finalPath = path.join(uploadDir, hash);

    if (!file) {
      fs.renameSync(req.file.path, finalPath);
      const info = db.prepare('INSERT INTO files (hash, size, mime) VALUES (?, ?, ?)').run(hash, size, mime);
      file = { id: info.lastInsertRowid, ref_count: 1 };
    } else {
      fs.unlinkSync(req.file.path); // already have it
      db.prepare('UPDATE files SET ref_count = ref_count + 1 WHERE id = ?').run(file.id);
    }

    db.prepare('INSERT INTO user_files (user_id, file_id, original_name) VALUES (?, ?, ?)').run(
      req.user.id, file.id, req.file.originalname
    );
    db.prepare('UPDATE users SET used_bytes = used_bytes + ? WHERE id = ?').run(size, req.user.id);

    cache.del(`drive:${req.user.id}`);
    res.json({ hash, size, name: req.file.originalname, deduplicated: !!file.ref_count && file.ref_count > 1 });
  } catch (err) {
    console.error(err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Upload failed' });
  } finally {
    db.close();
  }
});

router.get('/list', auth, (req, res) => {
  const key = `drive:${req.user.id}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT uf.original_name, f.hash, f.size, f.mime, uf.created_at
      FROM user_files uf
      JOIN files f ON f.id = uf.file_id
      WHERE uf.user_id = ?
      ORDER BY uf.id DESC
    `).all(req.user.id);
    cache.set(key, rows);
    res.json(rows);
  } finally {
    db.close();
  }
});

router.get('/usage', auth, (req, res) => {
  const db = getDb();
  try {
    const u = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(req.user.id);
    res.json({
      used: u.used_bytes,
      quota: u.quota_bytes,
      percent: Math.round((u.used_bytes / u.quota_bytes) * 1000) / 10
    });
  } finally {
    db.close();
  }
});

module.exports = router;
