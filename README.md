# Webever Labs — Starting Node.js Platform

Clean, scalable, and secure starting backend for the Webever Labs site.

## Features included

- Secure authentication (JWT + bcrypt) with **login activity logging** (IP, user-agent, success/fail, timestamp)
- Subscription plans (basic model + middleware to enforce)
- Drive storage with **content-addressable deduplication** (SHA-256). Identical files across users share one physical copy → less disk and less memory traffic
- Quota tracking + percent-used
- In-memory caching (node-cache) for hot reads
- Product routes: `/products/:name` (e.g. `/products/auxa`) — no hash URLs
- Contact form endpoint
- Simple blog / content post endpoints
- Auxobus-style automation stubs + QA / traffic test endpoints
- Helmet, rate limiting, compression, CORS
- Optimized for shared hosting: SQLite, low memory, efficient file handling

## Quick start

```bash
cd webever-app
cp .env.example .env
# Edit .env — set a strong JWT_SECRET

npm install
npm run init-db
npm start
```

Then open http://localhost:3000

## Project layout

```
webever-app/
├── public/           # Frontend (index.html, designs.css, auth.html)
├── src/
│   ├── server.js     # Main Express app
│   ├── routes/       # Auth, drive, products, contact, blog, tools
│   ├── middleware/   # Auth, rate-limit, subscription
│   ├── models/       # SQLite schema helpers
│   └── utils/        # DB init, hashing, cache
├── uploads/          # Deduplicated file store (hash-named)
├── data/             # SQLite database
└── package.json
```

## Security notes

- Passwords hashed with bcrypt
- JWT with short expiry recommended in production
- Rate limiting on auth and public endpoints
- Helmet security headers
- File uploads validated by size + type (extend as needed)
- Login activity recorded for audit
- Deduplication uses streaming hash to keep memory low

## Shared-host optimizations

- SQLite (no external DB required)
- Streaming file hashing and storage
- Response compression
- Caching of frequently read data
- Minimal dependencies
- Single process friendly

## Next steps

1. Point the frontend auth form (`auth.html`) at `/api/auth/signup` and `/api/auth/login`
2. Add Stripe (or your payment provider) webhooks for real subscriptions
3. Replace in-memory cache with Redis if you outgrow shared hosting
4. Add proper email verification and password reset
5. Expand the QA lab and automation tools as needed

Generated as a clean starting point. Review and harden before production use.
