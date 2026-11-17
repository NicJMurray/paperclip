import { mkdir, readFile, writeFile } from 'node:fs/promises';
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../web/style.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const videoFeed = await readFile(new URL('../web/video-feed.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../server/worker.js', import.meta.url), 'utf8');
const substack = await readFile(new URL('../server/substack.js', import.meta.url), 'utf8');
const hls = await readFile(new URL('../node_modules/hls.js/dist/hls.light.min.js', import.meta.url), 'utf8');
const assets = { '/video-feed.js': [videoFeed, 'text/javascript; charset=utf-8'], '/hls.js': [hls, 'text/javascript; charset=utf-8'], '/': [html, 'text/html; charset=utf-8'], '/style.css': [css, 'text/css; charset=utf-8'], '/app.js': [js, 'text/javascript; charset=utf-8'] };
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/_worker.js', import.meta.url), worker.replace("import { assets } from './assets.js';", `const assets = ${JSON.stringify(assets)};`)
  .replace("import { substackFeedURL, refreshSubstack, sharedSubstackLink, substackStreamSource } from './substack.js';", () => substack.replace(/^export /gm, '')));
await writeFile(new URL('../dist/index.html', import.meta.url), html);
await writeFile(new URL('../dist/_routes.json', import.meta.url), JSON.stringify({ version: 1, include: ['/*'], exclude: [] }));
console.log('Built Paperclip Worker and web assets.');
