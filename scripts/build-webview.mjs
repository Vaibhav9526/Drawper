import { build, context } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: ['src/webview/index.tsx'],
  outdir: 'media/dist',
  bundle: true,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  platform: 'browser',
  conditions: [watch ? 'development' : 'production'],
  target: 'es2020',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"', 'process.env.IS_PREACT': '"false"' },
  loader: { '.woff2': 'file', '.woff': 'file', '.png': 'dataurl', '.svg': 'dataurl' },
  logLevel: 'info',
};

mkdirSync('media/dist', { recursive: true });
cpSync('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'media/dist/fonts', { recursive: true, filter: (src) => !src.includes('Xiaolai') });

if (watch) await (await context(options)).watch();
else await build(options);
