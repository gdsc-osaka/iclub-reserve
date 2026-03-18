import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
mkdirSync('dist/public', { recursive: true });

// Copy static files
if (existsSync('public/styles.css')) {
  copyFileSync('public/styles.css', 'dist/public/styles.css');
}

// Build the worker
await esbuild.build({
  entryPoints: ['_worker.ts'],
  bundle: true,
  outfile: 'dist/_worker.js',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'remix/component',
  platform: 'browser',
  conditions: ['worker', 'browser'],
  external: ['node:*'],
  loader: { '.css': 'text' },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

console.log('Build complete: dist/_worker.js');
