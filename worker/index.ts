// Public-cache-first Docker Hub pull mirror. No accounts, uploads, or arbitrary upstream URLs.

type SourceId = 'docker.io' | 'ghcr.io' | 'quay.io' | 'gcr.io' | 'registry.k8s.io'
  | 'mcr.microsoft.com' | 'docker.elastic.co' | 'nvcr.io';
interface SourceConfig { host: string; auth?: string; service?: string }
interface Route { source: SourceId; config: SourceConfig; path: string; repo: string; prefix: string }
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
type TokenResult = { ok: true; token: string } | { ok: false; response: Response };

const REGISTRY = 'registry-1.docker.io';
const AUTH = 'auth.docker.io';
const MIRROR = 'mirror.gcr.io';
const SERVICE = 'registry.docker.io';
const SOURCES: Record<SourceId, SourceConfig> = {
  'docker.io': { host: REGISTRY, auth: `https://${AUTH}/token`, service: SERVICE },
  'ghcr.io': { host: 'ghcr.io', auth: 'https://ghcr.io/token', service: 'ghcr.io' },
  'quay.io': { host: 'quay.io', auth: 'https://quay.io/v2/auth', service: 'quay.io' },
  'gcr.io': { host: 'gcr.io', auth: 'https://gcr.io/v2/token' },
  'registry.k8s.io': { host: 'registry.k8s.io' },
  'mcr.microsoft.com': { host: 'mcr.microsoft.com' },
  'docker.elastic.co': { host: 'docker.elastic.co', auth: 'https://docker-auth.elastic.co/auth', service: 'token-service' },
  'nvcr.io': { host: 'nvcr.io', auth: 'https://nvcr.io/token', service: 'registry' },
};
const ALIASES: Record<string, SourceId> = { 'registry-1.docker.io': 'docker.io', 'k8s.gcr.io': 'registry.k8s.io' };
const CDN_HOSTS = new Set([
  'production.cloudfront.docker.com',
  'production.cloudflare.docker.com',
  // Docker-maintainer confirmation: https://github.com/docker/docs/issues/21960
  'docker-images-prod.6aa30f8b08e16409b46e0173d6de2f56.r2.cloudflarestorage.com',
]);
const COMPONENT = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
const REPOSITORY = `${COMPONENT}(?:/${COMPONENT})*`;
const SCOPE = new RegExp(`^repository:${REPOSITORY}:pull$`);
const READ_PATH = new RegExp(
  `^/v2/${REPOSITORY}/(?:manifests/[A-Za-z0-9_][A-Za-z0-9_.:-]{0,255}|blobs/[A-Za-z0-9_+.-]+:[a-fA-F0-9]+|tags/list)$`,
);
const REFERRERS_PATH = new RegExp(`^/v2/${REPOSITORY}/referrers/sha256:[0-9a-f]{64}$`);
const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;
const REQUEST_HEADERS = ['accept', 'range', 'if-range', 'if-none-match', 'if-modified-since'];
const RESPONSE_HEADERS = [
  'content-type', 'content-length', 'content-encoding', 'content-range',
  'accept-ranges', 'etag', 'last-modified', 'docker-content-digest',
  'docker-distribution-api-version', 'oci-filters-applied', 'retry-after',
  'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset',
];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function error(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ errors: [{ code, message }] }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function requestHeaders(request: Request, withBearer: boolean, token: string | null): Headers {
  const headers = new Headers({ 'accept-encoding': 'identity' });
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const authorization = request.headers.get('authorization') || '';
  if (withBearer && /^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(authorization)) {
    headers.set('authorization', authorization);
  }
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

function isSource(value: string): value is SourceId { return Object.hasOwn(SOURCES, value); }

function parseRoute(pathname: string): Route | null {
  const first = pathname.slice(4).split('/')[0];
  const candidate = ALIASES[first] || first;
  const prefixed = isSource(candidate);
  if (!prefixed && first.includes('.')) return null;
  const source: SourceId = isSource(candidate) ? candidate : 'docker.io';
  const path = prefixed ? '/v2/' + pathname.slice(5 + first.length) : pathname;
  if (path.length > 600 || !(READ_PATH.test(path) || REFERRERS_PATH.test(path))) return null;
  const repo = path.match(/^\/v2\/(.+)\/(?:manifests|blobs|tags|referrers)\//)?.[1];
  return repo ? { source, config: SOURCES[source], path, repo, prefix: prefixed ? first + '/' : '' } : null;
}

function trustedSourceRedirect(target: URL, route: Route): boolean {
  if (target.protocol !== 'https:' || target.port || target.username || target.password || target.hash) return false;
  if (target.hostname === route.config.host) {
    return READ_PATH.test(target.pathname) || REFERRERS_PATH.test(target.pathname)
      || (route.source === 'gcr.io' && target.pathname.startsWith('/artifacts-downloads/'));
  }
  if (route.source === 'docker.io') return trustedRedirect(target, new URL(`https://${REGISTRY}`));
  if (route.source === 'ghcr.io') return target.hostname === 'pkg-containers.githubusercontent.com' && target.pathname.startsWith('/ghcrblobs');
  if (route.source === 'quay.io') return /^(?:cdn|cdn0[1-6])\.quay\.io$/.test(target.hostname) && target.pathname.startsWith('/quayio-production-s3/');
  if (route.source === 'mcr.microsoft.com') return /^[a-z0-9-]+\.data\.mcr\.microsoft\.com$/.test(target.hostname);
  if (route.source === 'docker.elastic.co') return target.hostname === 'docker-registry-production.d24a988e385e0074d717b6bdaea58f0d.r2.cloudflarestorage.com'
    && target.pathname.startsWith('/docker/registry/v2/blobs/');
  if (route.source === 'nvcr.io') return target.hostname === 'layers.nvcr.io'
    && target.pathname.startsWith('/registry/docker/registry/v2/blobs/');
  if (route.source === 'registry.k8s.io') return (target.hostname === 'cdn.registry.k8s.io' && target.pathname.startsWith('/containers/images/'))
    || (/^[a-z]+(?:-[a-z]+)*[0-9]-docker\.pkg\.dev$/.test(target.hostname) && target.pathname.startsWith('/v2/k8s-artifacts-prod/images/'));
  return false;
}

function trustedRedirect(target: URL, source: URL): boolean {
  if (target.protocol !== 'https:' || target.port || target.username || target.password) return false;
  if (source.hostname === AUTH) return target.hostname === AUTH && target.pathname === '/token';
  if (target.hostname === REGISTRY) return READ_PATH.test(target.pathname) || target.pathname === '/v2/';
  return CDN_HOSTS.has(target.hostname);
}

async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* failed cache bodies must not block fallback */ }
}

function validReferrersQuery(url: URL): boolean {
  const types = url.searchParams.getAll('artifactType');
  return url.search.length <= 2048 && types.length <= 1 && types.every(type => MEDIA_TYPE.test(type));
}

function trustedReferrersTarget(target: URL, upstream: URL): boolean {
  return target.origin === upstream.origin && !target.username && !target.password && !target.hash
    && target.pathname === upstream.pathname && validReferrersQuery(target);
}

function trustedReferrersRedirect(target: URL, upstream: URL, route: Route | null): boolean {
  if (trustedReferrersTarget(target, upstream)) return true;
  return route?.source === 'registry.k8s.io' && trustedSourceRedirect(target, route)
    && target.pathname === '/v2/k8s-artifacts-prod/images/' + route.path.slice(4)
    && validReferrersQuery(target);
}

async function forward(request: Request, upstream: URL, fetchUpstream: Fetcher, authRequest = false,
  route: Route | null = null, token: string | null = null): Promise<Response | null> {
  const cacheRequest = upstream.hostname === MIRROR;
  const referrersRequest = REFERRERS_PATH.test(upstream.pathname);
  const source = route?.source || 'docker.io';
  const registryHost = route?.config.host || REGISTRY;
  let current = upstream;
  for (let hop = 0; hop <= 5; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cacheRequest ? 10000 : 20000);
    let response: Response;
    try {
      response = await fetchUpstream(current.toString(), {
        method: request.method,
        headers: requestHeaders(request, source === 'docker.io' && !authRequest && !cacheRequest && current.hostname === REGISTRY,
          !authRequest && !cacheRequest && current.hostname === registryHost
            && (READ_PATH.test(current.pathname) || REFERRERS_PATH.test(current.pathname)) ? token : null),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      if (cacheRequest) return null;
      return error(controller.signal.aborted ? 504 : 502, 'UPSTREAM_ERROR', 'Docker Hub upstream request failed');
    } finally {
      clearTimeout(timer);
    }
    if (REDIRECTS.has(response.status)) {
      const location = response.headers.get('location');
      let next: URL | undefined;
      try { if (location) next = new URL(location, current); } catch { /* handled below */ }
      await discard(response);
      const trusted = next && (cacheRequest
        ? next.protocol === 'https:' && next.hostname === MIRROR && !next.port && !next.username && !next.password
          && (READ_PATH.test(next.pathname) || next.pathname.startsWith('/artifacts-downloads/'))
        : referrersRequest ? trustedReferrersRedirect(next, upstream, route)
          : route ? trustedSourceRedirect(next, route) : trustedRedirect(next, current));
      if (!location || !next || !trusted || hop === 5) {
        if (cacheRequest) return null;
        return error(502, 'UPSTREAM_REDIRECT', 'Unsupported Docker Hub redirect');
      }
      current = next;
      continue;
    }
    if (cacheRequest && !(response.ok || response.status === 304)) {
      await discard(response);
      return null;
    }
    const headers = new Headers({ 'cache-control': 'no-store' });
    for (const name of RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    if (referrersRequest && response.ok && response.headers.has('link')) {
      const match = response.headers.get('link')?.match(/^\s*<([^<>]+)>\s*;\s*rel="?next"?\s*$/i);
      let next: URL | undefined;
      try { if (match) next = new URL(match[1], current); } catch { /* rejected below */ }
      if (!next || !trustedReferrersTarget(next, current)) {
        await discard(response);
        return error(502, 'UPSTREAM_PAGINATION', 'Unsupported Docker Hub pagination link');
      }
      const clientPath = route ? '/v2/' + route.prefix + route.path.slice(4) : next.pathname;
      headers.set('link', `<${clientPath}${next.search}>; rel="next"`);
    }
    const challenge = response.headers.get('www-authenticate');
    if (!authRequest && !cacheRequest && challenge) {
      headers.set('www-authenticate', source === 'docker.io' ? challenge.replace(
        /realm="[^"]*"/i, `realm="${new URL(request.url).origin}/token"`,
      ).replace(/scope="repository:([^"]+):pull"/i, `scope="repository:${route?.prefix || ''}$1:pull"`) : challenge);
    }
    if (!authRequest) {
      headers.set('docker-distribution-api-version', 'registry/2.0');
      headers.set('x-docker-proxy-upstream', cacheRequest ? MIRROR : registryHost);
    }
    // Preserve the stream; image layers are never buffered in Worker memory.
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status, statusText: response.statusText, headers,
    });
  }
  return error(502, 'UPSTREAM_REDIRECT', 'Registry redirect limit reached');
}

async function readBounded(response: Response, limit = 65536): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error('response too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

function knownChallenge(challenge: string | null, config: SourceConfig): boolean {
  if (!challenge || !config.auth || !/^Bearer /i.test(challenge)) return false;
  const fields: Record<string, string> = Object.fromEntries([...challenge.matchAll(/(realm|service)="([^"]*)"/gi)]
    .map((match): [string, string] => [match[1].toLowerCase(), match[2]]));
  return fields.realm === config.auth && (fields.service || '') === (config.service || '');
}

async function anonymousToken(route: Route, fetchUpstream: Fetcher): Promise<TokenResult> {
  if (!route.config.auth) return { ok: false, response: error(401, 'UNAUTHORIZED', 'Anonymous authentication is unsupported') };
  const url = new URL(route.config.auth);
  if (route.config.service) url.searchParams.set('service', route.config.service);
  url.searchParams.set('scope', `repository:${route.repo}:pull`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchUpstream(url.toString(), {
      method: 'GET', headers: { accept: 'application/json', 'accept-encoding': 'identity' },
      redirect: 'manual', signal: controller.signal,
    });
    if (REDIRECTS.has(response.status)) { await discard(response); return { ok: false, response: error(502, 'UPSTREAM_REDIRECT', 'Unsupported registry auth redirect') }; }
    const body = await readBounded(response);
    if (!response.ok) return { ok: false, response: new Response(body, { status: response.status, headers: {
      'content-type': response.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store', 'x-docker-proxy-upstream': route.config.host,
      ...(response.headers.get('retry-after') ? { 'retry-after': response.headers.get('retry-after') || '' } : {}),
    } }) };
    const data: unknown = JSON.parse(new TextDecoder().decode(body));
    if (typeof data !== 'object' || data === null) throw new Error('invalid token response');
    const record = data as Record<string, unknown>;
    const token = record.token || record.access_token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/-]+=*$/.test(token) || token.length > 32768) throw new Error('invalid token');
    return { ok: true, token };
  } catch {
    return { ok: false, response: error(controller.signal.aborted ? 504 : 502, 'UPSTREAM_AUTH', 'Registry anonymous authentication failed') };
  } finally { clearTimeout(timer); }
}

async function publicRegistry(request: Request, upstream: URL, route: Route, fetchUpstream: Fetcher): Promise<Response> {
  let response = await forward(request, upstream, fetchUpstream, false, route);
  if (!response) return error(502, 'UPSTREAM_ERROR', 'Registry request failed');
  if (response.status === 401 && knownChallenge(response.headers.get('www-authenticate'), route.config)) {
    await discard(response);
    const result = await anonymousToken(route, fetchUpstream);
    if (!result.ok) return result.response;
    response = await forward(request, upstream, fetchUpstream, false, route, result.token);
  }
  if (!response) return error(502, 'UPSTREAM_ERROR', 'Registry request failed');
  const headers = new Headers(response.headers);
  headers.delete('www-authenticate'); // Public-only sources never request user credentials.
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handle(request: Request, fetchUpstream: Fetcher = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return error(405, 'UNSUPPORTED', 'Only GET and HEAD are supported', { allow: 'GET, HEAD' });
  }
  if (url.pathname === '/v2' || url.pathname === '/v2/') {
    return new Response(request.method === 'HEAD' ? null : '{}', { headers: {
      'content-type': 'application/json', 'docker-distribution-api-version': 'registry/2.0', 'cache-control': 'no-store',
    } });
  }
  if (url.pathname === '/token') {
    if (request.method !== 'GET') return error(405, 'UNSUPPORTED', 'Token requests require GET', { allow: 'GET' });
    const service = url.searchParams.get('service');
    if (service && service !== SERVICE) return error(400, 'INVALID_SERVICE', 'Only Docker Hub is supported');
    const scopes = url.searchParams.getAll('scope').map(scope => scope.replace(/^repository:(?:docker\.io|registry-1\.docker\.io)\//, 'repository:'));
    if (scopes.length > 8 || scopes.some(scope => scope && (!SCOPE.test(scope) || scope.length > 280))) {
      return error(400, 'INVALID_SCOPE', 'Only repository pull scopes are supported');
    }
    const upstream = new URL(`https://${AUTH}/token`);
    upstream.searchParams.set('service', SERVICE);
    for (const scope of scopes) if (scope) upstream.searchParams.append('scope', scope);
    return await forward(request, upstream, fetchUpstream, true) || error(502, 'UPSTREAM_ERROR', 'Docker Hub token request failed');
  }
  const route = url.pathname.startsWith('/v2/') ? parseRoute(url.pathname) : null;
  if (!route) return error(404, 'NAME_UNKNOWN', 'Unsupported public registry pull endpoint');
  const pathname = route.path;
  const upstream = new URL(`https://${route.config.host}${pathname}`);
  if (REFERRERS_PATH.test(pathname)) {
    if (request.method !== 'GET') return error(405, 'UNSUPPORTED', 'Referrers requests require GET', { allow: 'GET' });
    if (!validReferrersQuery(url)) return error(400, 'INVALID_QUERY', 'Invalid referrers query');
    // Discovery is authoritative at Hub; image-cache coverage does not establish referrer completeness.
    upstream.search = url.search;
  } else for (const name of ['n', 'last', 'ns']) {
    const value = url.searchParams.get(name);
    if (value !== null) upstream.searchParams.set(name, value);
  }
  if (route.source !== 'docker.io') return publicRegistry(request, upstream, route, fetchUpstream);
  if (/\/(?:manifests|blobs)\/[^/]+$/.test(pathname)) {
    const cached = await forward(request, new URL(`https://${MIRROR}${pathname}`), fetchUpstream);
    if (cached) return cached;
  }
  return await forward(request, upstream, fetchUpstream, false, route) || error(502, 'UPSTREAM_ERROR', 'Docker Hub request failed');
}

export default {
  async fetch(request: Request): Promise<Response> {
    try { return await handle(request); }
    catch { return error(502, 'UPSTREAM_ERROR', 'Docker Hub proxy request failed'); }
  },
};
