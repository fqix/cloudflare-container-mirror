import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildImageCommands, parseImage } from '../src/lib/image-commands.ts';
import type { ClientId } from '../src/data/clients.ts';

const proxyHost = 'fengqi.dev';
const digest = 'sha256:' + 'a'.repeat(64);

function build(image: string, selectedHost = 'docker.io', manualTag = '', client: ClientId = 'docker') {
  const result = buildImageCommands(proxyHost, image, selectedHost, manualTag, client);
  if (!result.ok) assert.fail('Expected a valid image: ' + image + '; ' + result.error);
  return result;
}

function rejectsImage(image: string, selectedHost = 'docker.io', client: ClientId = 'docker') {
  const result = buildImageCommands(proxyHost, image, selectedHost, '', client);
  if (result.ok) assert.fail('Unsafe or unsupported image produced commands: ' + image);
  assert.ok(result.error, 'Invalid images should explain why they were rejected');
  assert.equal(Object.hasOwn(result, 'commands'), false);
  return result;
}

test('short Docker Hub names expand to library and restore the original local tag', () => {
  const result = build('nginx:alpine');
  assert.equal(result.commands, [
    'docker pull fengqi.dev/docker.io/library/nginx:alpine',
    'docker tag fengqi.dev/docker.io/library/nginx:alpine nginx:alpine',
  ].join('\n'));
  assert.equal(result.needsTargetTag, false);
  assert.equal(result.targetTagError, null);

  assert.equal(build('nginx').commands, [
    'docker pull fengqi.dev/docker.io/library/nginx:latest',
    'docker tag fengqi.dev/docker.io/library/nginx:latest nginx:latest',
  ].join('\n'));
});

test('Docker Hub namespaces and supported aliases retain the correct target repository', () => {
  assert.equal(build('myteam/tool:RC_1.2-3').commands, [
    'docker pull fengqi.dev/docker.io/myteam/tool:RC_1.2-3',
    'docker tag fengqi.dev/docker.io/myteam/tool:RC_1.2-3 myteam/tool:RC_1.2-3',
  ].join('\n'));

  for (const alias of ['docker.io', 'index.docker.io', 'registry-1.docker.io']) {
    assert.equal(build(alias + '/library/nginx:alpine').commands, build('nginx:alpine').commands);
  }

  const namespaced = parseImage('acme-team/image:v1', 'docker.io');
  if (!namespaced.ok) assert.fail(namespaced.error);
  assert.equal(namespaced.source.host, 'docker.io');
  assert.equal(namespaced.path, 'docker.io/acme-team/image:v1');
});

test('an explicit source takes precedence over the dropdown without duplicating its prefix', () => {
  const image = 'ghcr.io/mhsanaei/3x-ui:v3.7.0';
  const result = build(image, 'docker.io');
  assert.equal(result.commands, [
    'docker pull fengqi.dev/ghcr.io/mhsanaei/3x-ui:v3.7.0',
    'docker tag fengqi.dev/ghcr.io/mhsanaei/3x-ui:v3.7.0 ghcr.io/mhsanaei/3x-ui:v3.7.0',
  ].join('\n'));
  assert.equal(result.commands, build('mhsanaei/3x-ui:v3.7.0', 'ghcr.io').commands);
});

test('digest-only references remain digest-only and do not invent a latest tag', () => {
  const result = build('nginx@' + digest);
  assert.equal(result.commands, 'docker pull fengqi.dev/docker.io/library/nginx@' + digest);
  assert.equal(result.needsTargetTag, true);
  assert.equal(result.targetTagError, null);
  assert.equal(result.commands.includes(':latest'), false);
  assert.equal(result.commands.includes('docker tag '), false);
});

test('a valid manual tag restores a digest-only pull using its repository digest', () => {
  const result = build('ghcr.io/acme/app@' + digest, 'docker.io', 'release_2026.11-rc1');
  assert.equal(result.commands, [
    'docker pull fengqi.dev/ghcr.io/acme/app@' + digest,
    'docker tag fengqi.dev/ghcr.io/acme/app@' + digest + ' ghcr.io/acme/app:release_2026.11-rc1',
  ].join('\n'));
  assert.equal(result.targetTagError, null);
});

test('invalid manual tags preserve the safe pull but never generate a docker tag command', () => {
  for (const manualTag of ['-bad', '.bad', 'bad/tag', 'bad:tag', 'a'.repeat(129), 'v1;id', '$(id)', 'v1\nid']) {
    const result = build('nginx@' + digest, 'docker.io', manualTag);
    assert.equal(result.commands, 'docker pull fengqi.dev/docker.io/library/nginx@' + digest, manualTag);
    assert.equal(result.needsTargetTag, true);
    assert.ok(result.targetTagError, manualTag);
  }
});

test('tag@digest pulls restore from repo@digest, never from tag@digest', () => {
  for (const [image, proxyRepo, targetRepo] of [
    ['nginx:alpine@' + digest, 'docker.io/library/nginx', 'nginx'],
    ['quay.io/acme/app:alpine@' + digest, 'quay.io/acme/app', 'quay.io/acme/app'],
  ]) {
    const result = build(image);
    assert.equal(result.commands, [
      'docker pull ' + proxyHost + '/' + proxyRepo + ':alpine@' + digest,
      'docker tag ' + proxyHost + '/' + proxyRepo + '@' + digest + ' ' + targetRepo + ':alpine',
    ].join('\n'));
    assert.equal(result.needsTargetTag, false);

    const parsed = parseImage(image, 'docker.io');
    if (!parsed.ok) assert.fail(parsed.error);
    assert.equal(parsed.tagSourcePath, proxyRepo + '@' + digest);
  }
});

test('a hidden manual tag cannot override a reference that already has a tag', () => {
  const expected = build('nginx:alpine@' + digest).commands;
  assert.equal(build('nginx:alpine@' + digest, 'docker.io', 'different').commands, expected);
  assert.equal(build('nginx:alpine@' + digest, 'docker.io', 'bad;id').commands, expected);
});

test('malformed tags or digests reject the image instead of producing partial commands', () => {
  for (const image of [
    'nginx:',
    'nginx:-bad',
    'nginx:.bad',
    'nginx:v1:extra',
    'nginx:' + 'x'.repeat(129),
    'nginx@sha256:abc',
    'nginx@sha256:' + 'a'.repeat(65),
    'nginx@sha256:' + 'g'.repeat(64),
    'nginx@sha512:' + 'a'.repeat(128),
    'nginx@' + digest + '@' + digest,
    'nginx:-bad@' + digest,
  ]) {
    rejectsImage(image);
  }
});

test('shell metacharacters, whitespace, options and URL inputs never become shell commands', () => {
  for (const image of [
    'nginx;id',
    'nginx&&id',
    'nginx|id',
    'nginx$(id)',
    'nginx' + String.fromCharCode(96) + 'id' + String.fromCharCode(96),
    'nginx\nid',
    'nginx\rid',
    'nginx\tid',
    'nginx --platform linux/amd64',
    ' nginx',
    'nginx ',
    '"nginx"',
    "nginx'",
    '--help',
    'https://docker.io/library/nginx:latest',
    'nginx%3Bid',
  ]) {
    rejectsImage(image);
  }
});

test('unknown registries and invalid namespaces cannot silently become Docker Hub repositories', () => {
  for (const image of [
    'evil.example/library/nginx:latest',
    'localhost/library/nginx:latest',
    'localhost:5000/library/nginx:latest',
    'docker.io.evil.example/library/nginx:latest',
    'ghcr.io/nginx:latest',
    'quay.io/nginx:latest',
    'Nginx:latest',
    'team//nginx:latest',
    'team/../nginx:latest',
  ]) {
    rejectsImage(image);
  }
  rejectsImage('nginx:latest', 'unknown.example');
});

test('unknown explicit registries identify the rejected host for every client', () => {
  for (const host of ['registry.example.com', 'localhost:5000', 'docker.io.evil.example']) {
    for (const client of ['docker', 'podman', 'ctr', 'container'] as const) {
      const result = rejectsImage(host + '/team/image:v1', 'ghcr.io', client);
      assert.ok(result.error.includes(host), 'The error should identify the unsupported registry');
      assert.match(result.error, /尚未接入/);
    }
  }
});

test('pasted HTTP URLs explain the image-reference format without generating commands', () => {
  for (const image of [
    'https://ghcr.io/acme/image:v1',
    'http://registry.example.com/team/image:v1',
    'HTTPS://docker.io/library/nginx:latest',
    'https://registry.example.com/team/image?v=1#details',
  ]) {
    const result = rejectsImage(image);
    assert.match(result.error, /镜像名而非 URL/);
    assert.match(result.error, /移除.*协议头/);
    assert.equal(result.error.includes('尚未接入'), false);
  }
});

test('disabled DHI and Ollama sources cannot generate Docker commands through either input mode', () => {
  for (const [host, image, reason] of [
    ['dhi.io', 'node:24', '需要登录'],
    ['registry.ollama.ai', 'library/llama3.2:1b', 'Ollama 使用原生模型 API'],
  ]) {
    assert.ok(rejectsImage(host + '/' + image).error.includes(reason));
    assert.ok(rejectsImage(image, host).error.includes(reason));
  }
});

const otherClients = [
  ['podman', 'podman'],
  ['ctr', 'ctr images'],
  ['container', 'container image'],
] as const satisfies readonly (readonly [ClientId, string])[];

for (const [client, command] of otherClients) {
  test(client + ' pulls and tags with its own CLI syntax and fully qualified targets', () => {
    assert.equal(build('nginx:alpine', 'docker.io', '', client).commands, [
      command + ' pull fengqi.dev/docker.io/library/nginx:alpine',
      command + ' tag fengqi.dev/docker.io/library/nginx:alpine docker.io/library/nginx:alpine',
    ].join('\n'));
    assert.equal(build('myteam/tool', 'docker.io', '', client).commands, [
      command + ' pull fengqi.dev/docker.io/myteam/tool:latest',
      command + ' tag fengqi.dev/docker.io/myteam/tool:latest docker.io/myteam/tool:latest',
    ].join('\n'));
    assert.equal(build('ghcr.io/acme/app:v2', 'docker.io', '', client).commands, [
      command + ' pull fengqi.dev/ghcr.io/acme/app:v2',
      command + ' tag fengqi.dev/ghcr.io/acme/app:v2 ghcr.io/acme/app:v2',
    ].join('\n'));
  });

  test(client + ' uses the same canonical digest name for pull and tag source', () => {
    const pull = command + ' pull fengqi.dev/docker.io/library/nginx@' + digest;
    const untagged = build('nginx@' + digest, 'docker.io', '', client);
    assert.equal(untagged.commands, pull);
    assert.equal(untagged.needsTargetTag, true);
    assert.equal(untagged.targetTagError, null);

    assert.equal(build('nginx@' + digest, 'docker.io', 'release_1', client).commands, [
      pull,
      command + ' tag fengqi.dev/docker.io/library/nginx@' + digest + ' docker.io/library/nginx:release_1',
    ].join('\n'));

    // ctr stores the supplied pull name exactly. Canonicalizing both commands
    // also avoids Apple container/Podman tag-plus-digest normalization differences.
    const pinned = build('nginx:alpine@' + digest, 'docker.io', 'ignored', client);
    assert.equal(pinned.commands, [
      pull,
      command + ' tag fengqi.dev/docker.io/library/nginx@' + digest + ' docker.io/library/nginx:alpine',
    ].join('\n'));
    assert.equal(pinned.needsTargetTag, false);
    assert.equal(pinned.targetTagError, null);
  });
}

test('client switching preserves invalid-input and manual-tag safeguards', () => {
  for (const [client, command] of otherClients) {
    for (const manualTag of ['bad;id', 'bad\nid', '-bad', 'bad/tag']) {
      const result = build('nginx@' + digest, 'docker.io', manualTag, client);
      assert.equal(result.commands, command + ' pull fengqi.dev/docker.io/library/nginx@' + digest);
      assert.equal(result.needsTargetTag, true);
      assert.ok(result.targetTagError);
    }
    for (const image of [
      'nginx$(id)',
      'nginx:v1;id',
      'nginx:-invalid',
      'evil.example/library/nginx:latest',
      'dhi.io/node:24',
      'registry.ollama.ai/library/llama3.2:1b',
    ]) {
      rejectsImage(image, 'docker.io', client);
    }
    rejectsImage('node:24', 'dhi.io', client);
    rejectsImage('library/llama3.2:1b', 'registry.ollama.ai', client);
  }
});
