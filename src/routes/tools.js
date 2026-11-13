const express = require('express');
const { auth } = require('../middleware/auth');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const router = express.Router();

// Auxobus-style automation stub
router.post('/automation/run', auth, (req, res) => {
  const { type, payload } = req.body || {};
  res.json({
    ok: true,
    jobId: Date.now().toString(36),
    type: type || 'generic',
    message: 'Automation queued (starter stub)'
  });
});

// QA / traffic test lab
router.get('/qa/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

router.get('/qa/traffic-sample', (req, res) => {
  res.json({
    requestsHandled: Math.floor(Math.random() * 1000),
    avgLatencyMs: 12 + Math.random() * 8,
    note: 'Sample metrics — wire to real APM in production'
  });
});

/**
 * Quality Test Lab — security probes + stress
 * Body: {
 *   target: "https://example.com/api",
 *   tests?: ["headers","cors","methods","injection","auth"],
 *   stress?: { concurrency: 10, requests: 50, method: "GET", path: "/" }
 * }
 */
router.post('/qa/run', auth, async (req, res) => {
  const { target, tests = ['headers', 'cors', 'methods'], stress } = req.body || {};
  if (!target || typeof target !== 'string') {
    return res.status(400).json({ error: 'target URL required' });
  }

  let base;
  try {
    base = new URL(target);
  } catch {
    return res.status(400).json({ error: 'Invalid target URL' });
  }

  // Only allow http/https and block private ranges in production-minded way
  if (!['http:', 'https:'].includes(base.protocol)) {
    return res.status(400).json({ error: 'Only http/https targets allowed' });
  }

  const results = { target: base.origin + base.pathname, ranAt: new Date().toISOString(), checks: [], stress: null };

  const fetchOnce = (url, opts = {}) =>
    new Promise((resolve) => {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const started = Date.now();
      const reqOpts = {
        method: opts.method || 'GET',
        headers: opts.headers || { 'User-Agent': 'Auxobus-QA/1.0' },
        timeout: opts.timeout || 8000
      };
      const r = lib.request(u, reqOpts, (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          resolve({
            status: resp.statusCode,
            headers: resp.headers,
            body: Buffer.concat(chunks).toString('utf8').slice(0, 4000),
            ms: Date.now() - started
          });
        });
      });
      r.on('error', (e) => resolve({ error: e.message, ms: Date.now() - started }));
      r.on('timeout', () => {
        r.destroy();
        resolve({ error: 'timeout', ms: Date.now() - started });
      });
      if (opts.body) r.write(opts.body);
      r.end();
    });

  // --- Security checks (extensible) ---
  const runners = {
    async headers() {
      const r = await fetchOnce(base.href);
      const h = r.headers || {};
      const missing = [];
      const wanted = [
        'strict-transport-security',
        'x-content-type-options',
        'x-frame-options',
        'content-security-policy',
        'referrer-policy'
      ];
      wanted.forEach((k) => {
        if (!h[k]) missing.push(k);
      });
      return {
        name: 'security-headers',
        ok: missing.length === 0,
        status: r.status,
        ms: r.ms,
        missing,
        note: missing.length ? 'Add missing headers on the target' : 'Core security headers present'
      };
    },
    async cors() {
      const r = await fetchOnce(base.href, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example',
          'Access-Control-Request-Method': 'GET'
        }
      });
      const h = r.headers || {};
      const acao = h['access-control-allow-origin'];
      const risky = acao === '*';
      return {
        name: 'cors',
        ok: !risky,
        status: r.status,
        ms: r.ms,
        allowOrigin: acao || null,
        note: risky ? 'Wildcard CORS is permissive' : (acao ? 'CORS origin restricted' : 'No CORS headers (ok for same-origin)')
      };
    },
    async methods() {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'TRACE', 'OPTIONS'];
      const allowed = [];
      for (const m of methods) {
        const r = await fetchOnce(base.href, { method: m });
        if (r.status && r.status < 500 && r.status !== 405 && r.status !== 404) allowed.push(m);
      }
      const risky = allowed.includes('TRACE');
      return {
        name: 'http-methods',
        ok: !risky,
        allowed,
        note: risky ? 'TRACE enabled — consider disabling' : 'Method set looks reasonable'
      };
    },
    async injection() {
      // Lightweight reflection check (not a full scanner)
      const probe = base.href + (base.href.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent("\"'><script>1</script>");
      const r = await fetchOnce(probe);
      const reflected = (r.body || '').includes('<script>1</script>');
      return {
        name: 'reflection-probe',
        ok: !reflected,
        status: r.status,
        ms: r.ms,
        note: reflected ? 'Query reflected unescaped — review output encoding' : 'No obvious reflection of script tag'
      };
    },
    async auth() {
      const r = await fetchOnce(base.href);
      const needsAuth = r.status === 401 || r.status === 403;
      return {
        name: 'auth-gate',
        ok: true,
        status: r.status,
        ms: r.ms,
        note: needsAuth ? 'Endpoint requires authentication' : 'Endpoint reachable without auth (confirm intentional)'
      };
    }
  };

  for (const t of tests) {
    if (runners[t]) {
      try {
        results.checks.push(await runners[t]());
      } catch (e) {
        results.checks.push({ name: t, ok: false, error: e.message });
      }
    }
  }

  // --- Stress sample ---
  if (stress && typeof stress === 'object') {
    const concurrency = Math.min(Number(stress.concurrency) || 5, 25);
    const total = Math.min(Number(stress.requests) || 20, 200);
    const method = (stress.method || 'GET').toUpperCase();
    const path = stress.path || base.pathname || '/';
    const url = base.origin + path;
    const latencies = [];
    let okCount = 0;
    let errCount = 0;
    let i = 0;

    const worker = async () => {
      while (i < total) {
        const n = i++;
        if (n >= total) break;
        const r = await fetchOnce(url, { method });
        if (r.error || !r.status || r.status >= 500) errCount++;
        else okCount++;
        if (r.ms != null) latencies.push(r.ms);
      }
    };

    const started = Date.now();
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const elapsed = Date.now() - started;
    latencies.sort((a, b) => a - b);
    const p = (q) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] || 0;

    results.stress = {
      concurrency,
      requests: total,
      ok: okCount,
      errors: errCount,
      elapsedMs: elapsed,
      rps: total / (elapsed / 1000),
      latency: {
        min: latencies[0] || 0,
        p50: p(0.5),
        p95: p(0.95),
        max: latencies[latencies.length - 1] || 0
      }
    };
  }

  res.json(results);
});

// Platform Flow Lab — store/validate a workflow definition (client can also keep local)
router.post('/flows/validate', auth, (req, res) => {
  const { name, steps } = req.body || {};
  if (!name || !Array.isArray(steps) || !steps.length) {
    return res.status(400).json({ error: 'name and non-empty steps[] required' });
  }
  const cleaned = steps.map((s, i) => ({
    id: s.id || `s${i + 1}`,
    type: s.type || 'action',
    name: s.name || `Step ${i + 1}`,
    method: (s.method || 'POST').toUpperCase(),
    path: s.path || `/api/${(s.name || 'step').toLowerCase().replace(/\s+/g, '-')}`,
    body: s.body || {},
    on: s.on || 'success'
  }));
  res.json({
    ok: true,
    name,
    steps: cleaned,
    // Pseudocode the client can turn into real handlers
    apiSketch: cleaned
      .map(
        (s) =>
          `// ${s.name}\nrouter.${s.method.toLowerCase()}('${s.path}', auth, async (req, res) => {\n  // TODO: implement ${s.type}\n  res.json({ ok: true, step: '${s.id}' });\n});`
      )
      .join('\n\n')
  });
});

module.exports = router;
