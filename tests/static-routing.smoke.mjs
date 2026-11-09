import assert from 'node:assert/strict';
import test from 'node:test';

// Run against a separately started Wrangler server after building:
// SMOKE_BASE_URL=http://127.0.0.1:8787 node --test tests/static-routing.smoke.mjs
test('built UI assets and Registry API requests retain their own responses', async () => {
  assert.ok(process.env.SMOKE_BASE_URL, 'Set SMOKE_BASE_URL to the running Wrangler origin');
  const origin = new URL(process.env.SMOKE_BASE_URL);
  assert.ok(['http:', 'https:'].includes(origin.protocol));
  const get = path => fetch(new URL(path, origin), {
    headers: { accept: 'text/html,*/*', 'user-agent': 'docker/29.9.3' },
    signal: AbortSignal.timeout(10000),
  });

  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /^text\/html(?:;|$)/i);
  const html = await page.text();

  const scriptPath = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map(match => match[1]).find(path => path.startsWith('/assets/'));
  assert.ok(scriptPath, 'The Vite HTML must reference its emitted JavaScript asset');
  const script = await get(scriptPath);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') || '', /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i);
  const javascript = await script.text();
  assert.ok(javascript.length > 0);
  assert.doesNotMatch(javascript, /^\s*(?:<!doctype html|<html)/i);

  const stylePath = [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["']/gi)]
    .map(match => match[1]).find(path => path.startsWith('/assets/'));
  assert.ok(stylePath, 'The Vite HTML must reference its emitted stylesheet');
  const style = await get(stylePath);
  assert.equal(style.status, 200);
  assert.match(style.headers.get('content-type') || '', /^text\/css(?:;|$)/i);
  assert.ok((await style.text()).length > 0);

  const ping = await get('/v2/');
  assert.equal(ping.status, 200);
  assert.match(ping.headers.get('content-type') || '', /^application\/json(?:;|$)/i);
  assert.equal(ping.headers.get('docker-distribution-api-version'), 'registry/2.0');
  assert.deepEqual(await ping.json(), {});

  // A browser-like Accept header must not turn unknown API or asset paths into HTML.
  for (const path of ['/v2/__routing_smoke_missing__', '/assets/__routing_smoke_missing__.js']) {
    const missing = await get(path);
    assert.equal(missing.status, 404, path);
    assert.match(missing.headers.get('content-type') || '', /^application\/json(?:;|$)/i, path);
    const body = await missing.json();
    assert.ok(Array.isArray(body.errors) && body.errors.length > 0, path);
    assert.equal(typeof body.errors[0].code, 'string', path);
  }
});
