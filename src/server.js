require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const { generalLimiter } = require('./middleware/rate-limit');

const authRoutes = require('./routes/auth');
const driveRoutes = require('./routes/drive');
const productRoutes = require('./routes/products');
const contentRoutes = require('./routes/content');
const toolsRoutes = require('./routes/tools');

const app = express();
app.set('trust proxy', 1);)
const PORT = process.env.PORT || 3000;

// Security & performance
app.use(helmet({
  contentSecurityPolicy: false, // relax for existing inline scripts in frontend
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(generalLimiter);

// Static frontend
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '1h',
  etag: true
}));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/products', productRoutes);
app.use('/api', contentRoutes);
app.use('/api/tools', toolsRoutes);

// Product pages (no hash URLs) — serve SPA-style or JSON already handled
app.get('/products/:name', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Auth page
app.get('/auth', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/auth.html'));
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/auth.html'));
});
app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/auth.html'));
});

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Fallback to index for client routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Webever Labs running on http://localhost:${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
});
