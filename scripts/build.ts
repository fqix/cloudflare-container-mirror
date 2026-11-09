import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
await mkdir(dist, { recursive: true });

const stylesheet = resolve(root, 'src/styles.css');
const [cssInput, notices] = await Promise.all([
  readFile(stylesheet, 'utf8'),
  readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
]);
const [ui, styles] = await Promise.all([
  build({
    entryPoints: [resolve(root, 'src/ui.tsx')],
    outfile: resolve(dist, 'ui.js'),
    tsconfig: resolve(root, 'tsconfig.ui.json'),
    bundle: true,
    write: false,
    metafile: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    legalComments: 'inline',
    banner: { js: `/*!\n${notices.replace(/\*\//g, '* /')}\n*/` },
  }),
  postcss([tailwindcss({ base: resolve(root, 'src'), optimize: { minify: true } })])
    .process(cssInput, { from: stylesheet, map: false }),
]);
if (ui.outputFiles.length !== 1 || !ui.outputFiles[0]) {
  throw new Error('The UI must bundle to one JavaScript file; styles are built separately');
}
if (Object.values(ui.metafile.outputs).some(output => output.imports.some(dependency => dependency.external))) {
  throw new Error('The UI bundle must not depend on external runtime imports');
}
if (/@import\b/i.test(styles.css) || /url\(\s*['"]?(?:https?:)?\/\//i.test(styles.css)) {
  throw new Error('The stylesheet must not depend on external imports or remote assets');
}
const javascript = ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = styles.css.replace(/<\/style/gi, '<\\/style');
const template = await readFile(resolve(root, 'src/page.html'), 'utf8');
const scriptMarker = '<!--__APP_SCRIPT__-->';
const styleMarker = '<!--__APP_STYLE__-->';
if (template.split(scriptMarker).length !== 2 || template.split(styleMarker).length !== 2) {
  throw new Error('The UI template must contain exactly one script marker and one style marker');
}
const html = template.replace(scriptMarker, () => `<script>${javascript}</script>`)
  .replace(styleMarker, () => `<style>${css}</style>`);
if (/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel\s*=\s*['"]stylesheet/i.test(html)) {
  throw new Error('The page must contain only bundled inline scripts and styles');
}
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
const worker = await readFile(resolve(dist, 'worker.mjs'));
console.log(`Built inline production UI: JavaScript ${Buffer.byteLength(javascript)} bytes; CSS ${Buffer.byteLength(css)} bytes`);
console.log(`Built dist/worker.mjs: ${worker.length} bytes; gzip ${gzipSync(worker).length} bytes`);
