import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
await mkdir(dist, { recursive: true });

const ui = await build({
  entryPoints: [resolve(root, 'src/ui.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
});
const javascript = ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = await readFile(resolve(root, 'src/page.html'), 'utf8');
const marker = '<!--__APP_SCRIPT__-->';
if (template.split(marker).length !== 2) throw new Error('The UI template must contain exactly one script marker');
const html = template.replace(marker, () => `<script>${javascript}</script>`);
await writeFile(resolve(dist, 'index.html'), html);

await build({
  entryPoints: [resolve(root, 'src/worker.ts')],
  outfile: resolve(dist, 'worker.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  plugins: [{
    name: 'inline-home-page',
    setup(builder) {
      builder.onLoad({ filter: /\/src\/page\.html$/ }, () => ({ contents: html, loader: 'text' }));
    },
  }],
});
console.log('Built dist/worker.mjs and dist/index.html');
