import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [resolve(root, 'worker/index.ts')],
  outfile: resolve(dist, 'worker.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
});

const worker = await readFile(resolve(dist, 'worker.mjs'));
console.log(`Built dist/worker.mjs: ${worker.length} bytes; gzip ${gzipSync(worker).length} bytes`);
