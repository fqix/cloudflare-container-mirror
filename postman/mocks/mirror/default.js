const http = require('node:http');
const blob = Buffer.from('fixture-layer-data');
http.createServer((req, res) => {
  const u = new URL(req.url, 'https://mirror.gcr.io');
  function send(status, body, headers = {}) {
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  if (req.headers.authorization || req.headers.cookie || req.headers['x-api-key']) return send(400, 'credentials leaked');
  if (u.pathname.endsWith('/manifests/cache-hit')) {
    return send(200, JSON.stringify({ schemaVersion: 2 }), {
      'content-type': 'application/vnd.oci.image.manifest.v1+json', 'docker-content-digest': 'sha256:cached',
    });
  }
  if (u.pathname.endsWith('/manifests/cache-not-modified')) {
    return send(304, undefined, { etag: req.headers['if-none-match'] });
  }
  const failure = u.pathname.match(/\/manifests\/cache-failure-(\d+)$/);
  if (failure) return send(Number(failure[1]), 'Google fixture failure');
  const unsafe = u.pathname.match(/\/manifests\/cache-unsafe-(\w+)$/);
  if (unsafe) {
    const locations = {
      foreign: 'https://example.com/artifacts-downloads/layer',
      http: 'http://mirror.gcr.io/artifacts-downloads/layer',
      credentials: 'https://dummy:dummy@mirror.gcr.io/artifacts-downloads/layer',
      port: 'https://mirror.gcr.io:444/artifacts-downloads/layer',
      path: 'https://mirror.gcr.io/arbitrary/layer',
      loop: u.pathname,
    };
    return send(302, '', { location: locations[unsafe[1]] });
  }
  if (u.pathname.endsWith('/blobs/sha256:aaa1')) {
    return send(302, '', { location: '/artifacts-downloads/layer?signature=fixture-only' });
  }
  if (u.pathname === '/artifacts-downloads/layer') {
    if (u.searchParams.get('signature') !== 'fixture-only') return send(403, 'signature missing');
    const partial = req.headers.range === 'bytes=0-3';
    return send(partial ? 206 : 200, partial ? blob.subarray(0, 4) : blob, {
      'content-type': 'application/octet-stream', 'content-length': String(partial ? 4 : blob.length),
      ...(partial ? { 'content-range': 'bytes 0-3/' + blob.length } : {}),
      'set-cookie': 'must-not-leave-mock=1',
    });
  }
  if (/^\/v2\/.+\/(?:manifests|blobs)\/[^/]+$/.test(u.pathname)) return send(404, 'cache miss');
  send(501, 'undefined Google cache endpoint');
}).listen(process.env.PORT);
