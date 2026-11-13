const express = require('express');
const { cache } = require('../utils/helpers');

const router = express.Router();

// Static product data (extend with DB later)
const PRODUCTS = {
  auxa: {
    name: 'Auxa Cloud',
    tagline: '1 GB Drive + compute for your builds',
    description: 'Secure storage with smart deduplication, connectors, and free tier to start.'
  },
  build: {
    name: 'Hybrid Build',
    tagline: 'One codebase. Web, Android and iOS.',
    description: 'Describe your app and Webever turns it into a hybrid build.'
  },
  research: {
    name: 'Research',
    tagline: 'Market, competitor and idea briefs',
    description: 'Ask once. Leave with a clear plan and sources you can check.'
  }
};

router.get('/:name', (req, res) => {
  const name = (req.params.name || '').toLowerCase();
  const key = `product:${name}`;
  let product = cache.get(key);
  if (!product) {
    product = PRODUCTS[name];
    if (product) cache.set(key, product, 3600);
  }
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

router.get('/', (req, res) => {
  res.json(Object.keys(PRODUCTS).map(k => ({ slug: k, ...PRODUCTS[k] })));
});

module.exports = router;
