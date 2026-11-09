import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handle } from '../dist/worker.mjs';

const origin = 'https://docker.fengqi.dev';
const registry = 'registry-1.docker.io';
const r2 = 'docker-images-prod.6aa30f8b08e16409b46e0173d6de2f56.r2.cloudflarestorage.com';
const calls = [];
async function transport(raw, options) {
  const url = new URL(raw);
  const legacyCDN = ['production.cloudfront.docker.com', 'production.cloudflare.docker.com', r2];
  const kind = url.hostname === 'auth.docker.io' ? 'auth' : url.hostname === registry ? 'registry' : url.hostname === 'mirror.gcr.io' ? 'mirror' : legacyCDN.includes(url.hostname) ? 'cdn' : 'multisource';
  const headers = new Headers(options.headers);
  calls.push({ url: raw, headers: Object.fromEntries(headers) });
  headers.set('x-mock-slug', kind);
  headers.set('x-test-origin', kind);
  headers.set('x-test-host', url.hostname);
  return fetch('http://127.0.0.1:41743' + url.pathname + url.search, { ...options, headers });
}
const make = (path, options = {}) => new Request(origin + path, options);
const authorized = { authorization: 'Bearer anonymous-token', cookie: 'private=example', 'x-api-key': 'example-secret' };

test('Hub repository challenge retains service/scope and changes realm to local token route', async () => {
  const response = await handle(make('/v2/library/busybox/manifests/latest'), transport);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="https://docker.fengqi.dev/token",service="registry.docker.io",scope="repository:library/busybox:pull"');
  assert.equal(response.headers.get('docker-distribution-api-version'), 'registry/2.0');
  assert.equal(response.headers.get('x-docker-proxy-upstream'), registry);
  await response.text();
});

test('Anonymous token exchange strips Basic, cookies, account and offline token fields', async () => {
  const response = await handle(make('/token?service=registry.docker.io&scope=repository:library/busybox:pull&account=private&offline_token=true', {
    headers: { authorization: 'Basic ZHVtbXk6ZHVtbXk=', cookie: 'private=example', 'x-api-key': 'example' },
  }), transport);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).token, 'anonymous-token');
  assert.equal(response.headers.get('set-cookie'), null);
  const last = calls.at(-1);
  assert.equal(new URL(last.url).search, '?service=registry.docker.io&scope=repository%3Alibrary%2Fbusybox%3Apull');
  assert.equal(last.headers.authorization, undefined);
});

test('Rejects write scopes, foreign services, unsupported URLs and methods without upstream calls', async () => {
  for (const [path, options, status] of [
    ['/token?scope=repository:library/busybox:pull,push', {}, 400],
    ['/token?scope=registry:catalog:*', {}, 400],
    ['/token?service=example.com', {}, 400],
    ['/token?scope=repository:../private:pull', {}, 400],
    ['/token', { method: 'HEAD' }, 405],
    ['/v2/library/busybox/blobs/uploads/', { method: 'POST' }, 405],
    ['/proxy?url=https://example.com', {}, 404],
    ['/v2/_catalog', {}, 404],
  ]) {
    const count = calls.length;
    const response = await handle(make(path, options), transport);
    assert.equal(response.status, status, path);
    assert.equal(calls.length, count, path);
    await response.text();
  }
});

test('Manifest Accept, bearer, digest and ns mirror query survive the HTTP boundary', async () => {
  const response = await handle(make('/v2/library/busybox/manifests/latest?ns=docker.io&secret=omitted', {
    headers: { ...authorized, accept: 'application/vnd.oci.image.manifest.v1+json' },
  }), transport);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('docker-content-digest'), 'sha256:abcd');
  assert.equal(response.headers.get('x-docker-proxy-upstream'), registry);
  assert.equal((await response.json()).schemaVersion, 2);
  const last = calls.at(-1);
  assert.equal(new URL(last.url).search, '?ns=docker.io');
  assert.equal(last.headers.authorization, 'Bearer anonymous-token');
  assert.equal(last.headers.cookie, undefined);
});

test('CloudFront 307 is followed inside Worker, streams layer and strips all CDN credentials', async () => {
  const response = await handle(make('/v2/library/busybox/blobs/sha256:abcd', { headers: authorized }), transport);
  assert.equal(response.status, 200);
  const content = Buffer.from(await response.arrayBuffer());
  assert.equal(content.toString(), 'fixture-layer-data');
  assert.equal(response.headers.get('docker-content-digest'), 'sha256:' + createHash('sha256').update(content).digest('hex'));
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(new URL(calls.at(-1).url).hostname, 'production.cloudfront.docker.com');
  assert.equal(calls.at(-1).headers.authorization, undefined);
});

test('Exact Docker R2 host is allowed and range requests retain 206 and Content-Range', async () => {
  const response = await handle(make('/v2/library/busybox/blobs/sha256:beef', { headers: { ...authorized, range: 'bytes=0-3' } }), transport);
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'fixt');
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/18');
  assert.equal(new URL(calls.at(-1).url).hostname, r2);
  assert.equal(calls.at(-1).headers.authorization, undefined);
});

test('Foreign, non-HTTPS, arbitrary R2 and nonstandard-port redirects are blocked', async () => {
  for (const digest of ['deadbeef', 'bad', 'cafe', 'feed']) {
    const count = calls.length;
    const response = await handle(make('/v2/library/busybox/blobs/sha256:' + digest, { headers: authorized }), transport);
    assert.equal(response.status, 502, digest);
    assert.equal(calls.length, count + 2, digest);
    assert.equal((await response.json()).errors[0].code, 'UPSTREAM_REDIRECT');
  }
});

test('Redirect loops stop after six network calls', async () => {
  const count = calls.length;
  const response = await handle(make('/v2/library/busybox/blobs/sha256:face', { headers: authorized }), transport);
  assert.equal(response.status, 502);
  assert.equal(calls.length, count + 7);
  await response.text();
});

test('Upstream 403 and 429 are preserved with Retry-After', async () => {
  for (const [tag, expected] of [['forbidden', 403], ['rate-limit', 429]]) {
    const response = await handle(make('/v2/library/busybox/manifests/' + tag, { headers: authorized }), transport);
    assert.equal(response.status, expected);
    if (expected === 429) assert.equal(response.headers.get('retry-after'), '60');
    await response.text();
  }
});

test('HEAD follows blob redirects but returns an empty body with original length', async () => {
  const response = await handle(make('/v2/library/busybox/blobs/sha256:abcd', { method: 'HEAD', headers: authorized }), transport);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '18');
  assert.equal(await response.text(), '');
});

test('Transport failures return sanitized errors without upstream URL or credentials', async () => {
  const response = await handle(make('/v2/library/busybox/manifests/latest'), async () => { throw new Error('private.example/secret-token'); });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).errors[0].message, 'Docker Hub upstream request failed');
});

test('Cached manifests bypass Hub, preserve Accept/digest and strip Basic or Bearer at Google', async () => {
  for (const authorization of ['Basic ZHVtbXk6ZHVtbXk=', 'Bearer anonymous-token']) {
    const count = calls.length;
    const response = await handle(make('/v2/library/busybox/manifests/cache-hit?ns=docker.io&secret=omitted', {
      headers: { ...authorized, authorization, accept: 'application/vnd.oci.image.manifest.v1+json' },
    }), transport);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).schemaVersion, 2);
    assert.equal(response.headers.get('x-docker-proxy-upstream'), 'mirror.gcr.io');
    assert.equal(response.headers.get('docker-content-digest'), 'sha256:cached');
    assert.equal(calls.length, count + 1);
    const last = calls.at(-1);
    assert.equal(new URL(last.url).search, '');
    assert.equal(last.headers.accept, 'application/vnd.oci.image.manifest.v1+json');
    assert.equal(last.headers.authorization, undefined);
    assert.equal(last.headers.cookie, undefined);
  }
});

test('Cached blob same-origin redirect retains signed query, Range/HEAD and strips credentials at every hop', async () => {
  for (const method of ['GET', 'HEAD']) {
    const count = calls.length;
    const response = await handle(make('/v2/library/busybox/blobs/sha256:aaa1', {
      method, headers: { ...authorized, range: 'bytes=0-3' },
    }), transport);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('x-docker-proxy-upstream'), 'mirror.gcr.io');
    assert.equal(response.headers.get('content-range'), 'bytes 0-3/18');
    assert.equal(response.headers.get('content-length'), '4');
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(await response.text(), method === 'HEAD' ? '' : 'fixt');
    assert.equal(calls.length, count + 2);
    for (const call of calls.slice(count)) {
      assert.equal(new URL(call.url).hostname, 'mirror.gcr.io');
      assert.equal(call.headers.authorization, undefined);
      assert.equal(call.headers.cookie, undefined);
      assert.equal(call.headers.range, 'bytes=0-3');
    }
    assert.equal(new URL(calls.at(-1).url).search, '?signature=fixture-only');
  }
});

test('Cached conditional 304 is retained without a Hub request', async () => {
  const count = calls.length;
  const response = await handle(make('/v2/library/busybox/manifests/cache-not-modified', {
    headers: { 'if-none-match': 'fixture-etag' },
  }), transport);
  assert.equal(response.status, 304);
  assert.equal(response.headers.get('etag'), 'fixture-etag');
  assert.equal(response.headers.get('x-docker-proxy-upstream'), 'mirror.gcr.io');
  assert.equal(calls.length, count + 1);
});

test('Cache miss returns Hub challenge; cache 401/403/404/429/5xx preserve Hub 429', async () => {
  const challenge = await handle(make('/v2/library/busybox/manifests/latest'), transport);
  assert.equal(challenge.status, 401);
  assert.equal(challenge.headers.get('x-docker-proxy-upstream'), registry);
  assert.match(challenge.headers.get('www-authenticate'), /docker\.fengqi\.dev\/token/);
  await challenge.text();
  for (const status of [401, 403, 404, 429, 500, 503]) {
    const count = calls.length;
    const response = await handle(make('/v2/library/busybox/manifests/cache-failure-' + status, { headers: authorized }), transport);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(response.headers.get('x-docker-proxy-upstream'), registry);
    assert.equal(calls.length, count + 2);
    assert.equal(await response.text(), 'rate limited');
  }
});

test('Unsafe cache redirects and loops fall back without contacting untrusted hosts', async () => {
  for (const suffix of ['foreign', 'http', 'credentials', 'port', 'path', 'loop']) {
    const count = calls.length;
    const response = await handle(make('/v2/library/busybox/manifests/cache-unsafe-' + suffix, { headers: authorized }), transport);
    assert.equal(response.status, 429, suffix);
    assert.equal(response.headers.get('x-docker-proxy-upstream'), registry);
    assert.equal(calls.length, count + (suffix === 'loop' ? 7 : 2), suffix);
    assert.ok(calls.slice(count).every(call => ['mirror.gcr.io', registry].includes(new URL(call.url).hostname)));
    await response.text();
  }
});

test('Cache network and timeout failures fall back to Hub with original credentials policy', async () => {
  for (const timeout of [false, true]) {
    let cacheAttempts = 0;
    const response = await handle(make('/v2/library/busybox/manifests/latest', { headers: authorized }), async (url, options) => {
      if (new URL(url).hostname !== 'mirror.gcr.io') return transport(url, options);
      cacheAttempts++;
      if (!timeout) throw new Error('fixture network error');
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('fixture timeout')), { once: true }));
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-docker-proxy-upstream'), registry);
    assert.equal(cacheAttempts, 1);
    await response.text();
  }
});

test('Cached blob response is streamed before the source finishes', async () => {
  let finish;
  const source = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('first')); finish = () => controller.close(); } });
  const response = await handle(make('/v2/library/busybox/blobs/sha256:aaaa'), async () => new Response(source));
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
  finish();
  assert.equal((await reader.read()).done, true);
  assert.equal(response.headers.get('x-docker-proxy-upstream'), 'mirror.gcr.io');
});

const referrers = digit => '/v2/library/busybox/referrers/sha256:' + digit.repeat(64);

test('Referrers discovery comes from authoritative Hub without cache or fallback-tag requests', async () => {
  const count = calls.length;
  const response = await handle(make(referrers('1') + '?artifactType=application%2Fvnd.example.sbom%2Bjson', { headers: authorized }), transport);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [] });
  assert.equal(response.headers.get('oci-filters-applied'), 'artifactType');
  assert.equal(response.headers.get('x-docker-proxy-upstream'), registry);
  assert.equal(calls.length, count + 1);
  assert.equal(new URL(calls.at(-1).url).hostname, registry);
  assert.equal(new URL(calls.at(-1).url).searchParams.get('artifactType'), 'application/vnd.example.sbom+json');
  assert.equal(calls.at(-1).headers.authorization, 'Bearer anonymous-token');
  assert.equal(calls.at(-1).headers.cookie, undefined);
});

test('Referrers preserve real Hub 401/404/429 and strip Basic credentials', async () => {
  for (const [digit, headers, status] of [
    ['1', { authorization: 'Basic ZHVtbXk6ZHVtbXk=' }, 401],
    ['3', authorized, 404], ['4', authorized, 429],
  ]) {
    const response = await handle(make(referrers(digit), { headers }), transport);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('x-docker-proxy-upstream'), registry);
    if (status === 401) {
      assert.match(response.headers.get('www-authenticate'), /docker\.fengqi\.dev\/token/);
      assert.equal(calls.at(-1).headers.authorization, undefined);
    }
    if (status === 429) assert.equal(response.headers.get('retry-after'), '60');
    await response.text();
  }
});

test('Referrers reject invalid paths, write methods, duplicate or malformed artifact types and oversized queries', async () => {
  for (const [path, options, status] of [
    [referrers('a').replace('sha256:', 'sha512:'), {}, 404],
    [referrers('A'), {}, 404],
    [referrers('1').slice(0, -1), {}, 404],
    [referrers('1'), { method: 'HEAD' }, 405],
    [referrers('1'), { method: 'POST' }, 405],
    [referrers('1') + '?artifactType=application%2Fjson&artifactType=text%2Fplain', {}, 400],
    [referrers('1') + '?artifactType=application%2Fjson%0D%0Ax-test%3Atrue', {}, 400],
    [referrers('1') + '?artifactType=', {}, 400],
    [referrers('1') + '?cursor=' + 'x'.repeat(2048), {}, 400],
  ]) {
    const count = calls.length;
    const response = await handle(make(path, options), transport);
    assert.equal(response.status, status, path.slice(0, 100));
    assert.equal(calls.length, count);
    await response.text();
  }
});

test('Referrers pagination rewrites safe relative and canonical Hub links and preserves opaque cursors', async () => {
  for (const digit of ['5', '6']) {
    const response = await handle(make(referrers(digit), { headers: authorized }), transport);
    assert.equal(response.status, 200);
    const link = response.headers.get('link');
    assert.ok(link.startsWith('<' + referrers(digit) + '?cursor=fixture-next'));
    assert.ok(!link.includes('https://'));
    await response.text();
    const next = link.match(/^<([^>]+)>/)[1];
    const page = await handle(make(next, { headers: authorized }), transport);
    assert.equal(page.status, 200);
    assert.equal(new URL(calls.at(-1).url).searchParams.get('cursor'), 'fixture-next');
    await page.text();
  }
});

test('Referrers reject foreign, cross-repository and HTTP pagination without exposing partial discovery', async () => {
  for (const digit of ['7', '8', '9']) {
    const count = calls.length;
    const response = await handle(make(referrers(digit), { headers: authorized }), transport);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).errors[0].code, 'UPSTREAM_PAGINATION');
    assert.equal(response.headers.get('link'), null);
    assert.equal(calls.length, count + 1);
  }
});

test('Registry ping is local 200 without binding the client to a source auth realm', async () => {
  for (const method of ['GET', 'HEAD']) {
    const count = calls.length;
    const response = await handle(make('/v2/', { method }), transport);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('www-authenticate'), null);
    assert.equal(response.headers.get('docker-distribution-api-version'), 'registry/2.0');
    assert.equal(await response.text(), method === 'HEAD' ? '' : '{}');
    assert.equal(calls.length, count);
  }
});

test('Explicit Docker Hub prefix retains mirror behavior and rewrites auth scopes both directions', async () => {
  const challenge = await handle(make('/v2/docker.io/library/busybox/manifests/latest'), transport);
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get('www-authenticate'), /scope="repository:docker\.io\/library\/busybox:pull"/);
  await challenge.text();
  const token = await handle(make('/token?service=registry.docker.io&scope=repository:docker.io/library/busybox:pull'), transport);
  assert.equal(token.status, 200);
  assert.equal(new URL(calls.at(-1).url).searchParams.get('scope'), 'repository:library/busybox:pull');
  await token.text();
  const manifest = await handle(make('/v2/docker.io/library/busybox/manifests/latest', { headers: authorized }), transport);
  assert.equal(manifest.status, 200);
  assert.equal(new URL(calls.at(-1).url).pathname, '/v2/library/busybox/manifests/latest');
  await manifest.text();
});

const publicSources = ['ghcr.io', 'quay.io', 'gcr.io', 'registry.k8s.io', 'mcr.microsoft.com', 'docker.elastic.co', 'nvcr.io'];
test('Each verified registry prefix routes a public manifest with isolated internal anonymous auth', async () => {
  for (const source of publicSources) {
    const count = calls.length;
    const response = await handle(make('/v2/' + source + '/owner/image/manifests/latest', { headers: authorized }), transport);
    assert.equal(response.status, 200, source);
    assert.equal(response.headers.get('x-docker-proxy-upstream'), source);
    assert.equal(response.headers.get('www-authenticate'), null);
    assert.equal((await response.json()).schemaVersion, 2);
    const observed = calls.slice(count);
    assert.equal(new URL(observed[0].url).hostname, source);
    assert.equal(new URL(observed[0].url).pathname, '/v2/owner/image/manifests/latest');
    assert.equal(observed[0].headers.authorization, undefined);
    assert.ok(observed.every(call => !call.headers.cookie && !call.headers['x-api-key']));
    assert.ok(observed.every(call => call.headers.authorization !== 'Bearer anonymous-token'));
    if (['ghcr.io', 'docker.elastic.co', 'nvcr.io'].includes(source)) {
      assert.equal(observed.length, 3);
      assert.equal(new URL(observed[1].url).searchParams.get('scope'), 'repository:owner/image:pull');
      assert.equal(observed[1].headers.authorization, undefined);
      assert.equal(observed[2].headers.authorization, 'Bearer ' + ({ 'ghcr.io': 'ghcr-token', 'docker.elastic.co': 'elastic-token', 'nvcr.io': 'nvcr-token' }[source]));
    }
  }
});

test('Verified source blob redirects stream Range/HEAD and never send tokens or cookies to CDN', async () => {
  for (const source of publicSources) for (const method of ['GET', 'HEAD']) {
    const response = await handle(make('/v2/' + source + '/owner/image/blobs/sha256:abcd', {
      method, headers: { ...authorized, authorization: 'Basic ZHVtbXk6ZHVtbXk=', range: 'bytes=0-0' },
    }), transport);
    assert.equal(response.status, 206, source + ' ' + method);
    assert.equal(response.headers.get('content-range'), 'bytes 0-0/18');
    assert.equal(await response.text(), method === 'HEAD' ? '' : 'f');
    assert.equal(calls.at(-1).headers.authorization, undefined);
    assert.equal(calls.at(-1).headers.cookie, undefined);
    assert.equal(calls.at(-1).headers.range, 'bytes=0-0');
  }
});

test('Public referrers retain authoritative per-source outcomes and Kubernetes legacy alias', async () => {
  for (const source of publicSources) {
    const path = '/v2/' + source + '/owner/image/referrers/sha256:' + 'a'.repeat(64);
    const response = await handle(make(path, { headers: authorized }), transport);
    assert.equal(response.status, ['ghcr.io', 'docker.elastic.co'].includes(source) ? 404 : 200, source);
    assert.equal(response.headers.get('www-authenticate'), null);
    await response.text();
  }
  const legacy = await handle(make('/v2/k8s.gcr.io/owner/image/manifests/latest'), transport);
  assert.equal(legacy.status, 200);
  assert.equal(legacy.headers.get('x-docker-proxy-upstream'), 'registry.k8s.io');
  await legacy.text();
});

test('Unknown sources and unsupported source paths do not reach an upstream', async () => {
  for (const path of [
    '/v2/attacker.example/owner/image/manifests/latest',
    '/v2/registry.ollama.ai/library/model/manifests/latest',
    '/v2/dhi.io/image/manifests/latest',
    '/v2/ghcr.io/owner/image/blobs/uploads/',
    '/v2/ghcr.io/owner/image/../../proxy?url=https://example.com',
  ]) {
    const count = calls.length;
    const response = await handle(make(path), transport);
    assert.equal(response.status, 404);
    assert.equal(calls.length, count);
    await response.text();
  }
});

test('Source redirect policies reject cross-source CDN, foreign R2 and other Google projects', async () => {
  for (const [source, location] of [
    ['ghcr.io', 'https://cdn01.quay.io/quayio-production-s3/layer'],
    ['docker.elastic.co', 'https://attacker.r2.cloudflarestorage.com/docker/registry/v2/blobs/layer'],
    ['registry.k8s.io', 'https://us-west2-docker.pkg.dev/v2/attacker/images/pause/manifests/latest'],
    ['gcr.io', 'https://example.com/artifacts-downloads/layer'],
    ['quay.io', 'http://cdn01.quay.io/quayio-production-s3/layer'],
  ]) {
    let count = 0;
    const response = await handle(make('/v2/' + source + '/owner/image/blobs/sha256:abcd'), async () => {
      count++; return new Response('', { status: 307, headers: { location } });
    });
    assert.equal(response.status, 502, source);
    assert.equal(count, 1);
    await response.text();
  }
});

test('Unknown auth realms are not fetched and public sources do not solicit client credentials', async () => {
  let count = 0;
  const response = await handle(make('/v2/ghcr.io/owner/image/manifests/latest', { headers: authorized }), async () => {
    count++; return new Response('unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://attacker.example/token",service="ghcr.io"' } });
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), null);
  assert.equal(await response.text(), 'unauthorized');
  assert.equal(count, 1);
});

test('Anonymous auth refuses redirects, oversized token bodies and malformed tokens', async () => {
  for (const authResponse of [
    () => new Response('', { status: 302, headers: { location: 'https://example.com/token' } }),
    () => new Response('x'.repeat(65537)),
    () => Response.json({ token: 'bad token with spaces' }),
  ]) {
    let count = 0;
    const response = await handle(make('/v2/ghcr.io/owner/image/manifests/latest'), async (url, options) => {
      count++;
      if (new URL(url).pathname === '/token') {
        assert.equal(new URL(url).hostname, 'ghcr.io');
        assert.equal(new Headers(options.headers).get('authorization'), null);
        assert.equal(options.redirect, 'manual');
        return authResponse();
      }
      return new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' } });
    });
    assert.equal(response.status, 502);
    assert.equal(count, 2);
    await response.text();
  }
});

test('Anonymous auth retries only once and preserves authentication-service 429', async () => {
  for (const rateLimited of [false, true]) {
    let count = 0;
    const response = await handle(make('/v2/ghcr.io/owner/image/manifests/latest'), async url => {
      count++;
      if (new URL(url).pathname === '/token') return rateLimited
        ? new Response('rate limited', { status: 429, headers: { 'retry-after': '20' } })
        : Response.json({ access_token: 'anonymous-token' });
      return new Response('unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' } });
    });
    assert.equal(response.status, rateLimited ? 429 : 401);
    assert.equal(count, rateLimited ? 2 : 3);
    assert.equal(response.headers.get('www-authenticate'), null);
    if (rateLimited) assert.equal(response.headers.get('retry-after'), '20');
    await response.text();
  }
});

test('Prefixed referrer pagination stays on the client prefix', async () => {
  const path = '/v2/gcr.io/owner/image/referrers/sha256:' + 'a'.repeat(64);
  const response = await handle(make(path), async () => Response.json({ manifests: [] }, { headers: {
    link: '</v2/owner/image/referrers/sha256:' + 'a'.repeat(64) + '?cursor=fixture>; rel="next"',
  } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('link'), '<' + path + '?cursor=fixture>; rel="next"');
  await response.text();
});

test('Referrer discovery cannot redirect into a source blob CDN or another repository', async () => {
  for (const location of [
    'https://pkg-containers.githubusercontent.com/ghcrblobs09/layer',
    'https://ghcr.io/v2/other/image/referrers/sha256:' + 'a'.repeat(64),
  ]) {
    let count = 0;
    const response = await handle(make('/v2/ghcr.io/owner/image/referrers/sha256:' + 'a'.repeat(64)), async () => {
      count++; return new Response('', { status: 307, headers: { location } });
    });
    assert.equal(response.status, 502);
    assert.equal(count, 1);
    await response.text();
  }
});
