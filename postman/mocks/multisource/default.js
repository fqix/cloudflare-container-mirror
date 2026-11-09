const http = require('node:http');
http.createServer((req, res) => {
  const host = req.headers['x-test-host'];
  const u = new URL(req.url, 'https://' + host);
  function send(status, body, headers = {}) { res.writeHead(status, headers); res.end(req.method === 'HEAD' ? undefined : body); }
  const auth = {
    'ghcr.io': ['/token', 'ghcr.io', 'ghcr-token'],
    'quay.io': ['/v2/auth', 'quay.io', 'quay-token'],
    'gcr.io': ['/v2/token', null, 'gcr-token'],
    'docker-auth.elastic.co': ['/auth', 'token-service', 'elastic-token'],
    'nvcr.io': ['/token', 'registry', 'nvcr-token'],
  };
  if (auth[host] && u.pathname === auth[host][0]) {
    if (req.headers.authorization || req.headers.cookie) return send(400, 'credentials leaked to auth');
    if (u.searchParams.get('service') !== auth[host][1]) return send(400, 'wrong auth service');
    if (!/^repository:[a-z0-9/_-]+:pull$/.test(u.searchParams.get('scope') || '')) return send(400, 'wrong auth scope');
    if ([...u.searchParams.keys()].some(k => !['scope', 'service'].includes(k))) return send(400, 'extra auth query');
    return send(200, JSON.stringify({ token: auth[host][2], expires_in: 300 }), { 'content-type': 'application/json' });
  }
  if (req.headers.cookie || req.headers['x-api-key']) return send(400, 'private header leaked');
  const cdn = ['pkg-containers.githubusercontent.com', 'cdn01.quay.io', 'cdn.registry.k8s.io', 'westus.data.mcr.microsoft.com', 'docker-registry-production.d24a988e385e0074d717b6bdaea58f0d.r2.cloudflarestorage.com', 'layers.nvcr.io'];
  if (cdn.includes(host) || (host === 'gcr.io' && u.pathname.startsWith('/artifacts-downloads/'))) {
    if (req.headers.authorization) return send(400, 'CDN credentials leaked');
    return send(206, 'f', { 'content-type': 'application/octet-stream', 'content-length': '1', 'content-range': 'bytes 0-0/18' });
  }
  if (host.endsWith('-docker.pkg.dev')) {
    if (req.headers.authorization) return send(400, 'Google backend credentials leaked');
    return send(200, JSON.stringify({ schemaVersion: 2, manifests: [] }), { 'content-type': 'application/vnd.oci.image.index.v1+json' });
  }
  if (host === 'ghcr.io' || host === 'docker.elastic.co' || host === 'nvcr.io') {
    const elastic = host === 'docker.elastic.co';
    const nvcr = host === 'nvcr.io';
    if (req.headers.authorization !== 'Bearer ' + (elastic ? 'elastic-token' : nvcr ? 'nvcr-token' : 'ghcr-token')) {
      return send(401, 'needs anonymous token', { 'www-authenticate': 'Bearer realm="' + (elastic ? 'https://docker-auth.elastic.co/auth' : nvcr ? 'https://nvcr.io/token' : 'https://ghcr.io/token') + '",service="' + (elastic ? 'token-service' : nvcr ? 'registry' : 'ghcr.io') + '",scope="repository:owner/image:pull"' });
    }
  } else if (req.headers.authorization) return send(400, 'client authorization leaked');
  if (u.pathname.includes('/blobs/')) {
    const locations = {
      'ghcr.io': 'https://pkg-containers.githubusercontent.com/ghcrblobs09/layer?signature=fixture-only',
      'quay.io': 'https://cdn01.quay.io/quayio-production-s3/layer?signature=fixture-only',
      'gcr.io': '/artifacts-downloads/layer?signature=fixture-only',
      'registry.k8s.io': 'https://cdn.registry.k8s.io/containers/images/sha256:abcd',
      'mcr.microsoft.com': 'https://westus.data.mcr.microsoft.com/fixture/docker/registry/v2/blobs/sha256/ab/abcd/data',
      'docker.elastic.co': 'https://docker-registry-production.d24a988e385e0074d717b6bdaea58f0d.r2.cloudflarestorage.com/docker/registry/v2/blobs/sha256/ab/abcd/data',
      'nvcr.io': 'https://layers.nvcr.io/registry/docker/registry/v2/blobs/sha256/ab/abcd/data',
    };
    if (locations[host]) return send(307, '', { location: locations[host] });
  }
  if (host === 'registry.k8s.io') return send(307, '', { location: 'https://us-west2-docker.pkg.dev/v2/k8s-artifacts-prod/images/' + u.pathname.slice(4) });
  if (u.pathname.includes('/manifests/')) return send(200, JSON.stringify({ schemaVersion: 2 }), { 'content-type': 'application/vnd.oci.image.manifest.v1+json', 'docker-content-digest': 'sha256:abcd' });
  if (u.pathname.includes('/referrers/')) return send(host === 'ghcr.io' || host === 'docker.elastic.co' ? 404 : 200, JSON.stringify({ schemaVersion: 2, manifests: [] }), { 'content-type': 'application/vnd.oci.image.index.v1+json' });
  send(501, 'undefined public registry fixture');
}).listen(process.env.PORT);
