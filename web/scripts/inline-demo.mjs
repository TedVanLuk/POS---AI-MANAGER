// Turns dist-demo/ into one HTML fragment for publishing as a Claude artifact.
import fs from 'node:fs';
import path from 'node:path';

// usage: node scripts/inline-demo.mjs [out.html] [dist dir] [title]
const dir = path.resolve(process.argv[3] ?? 'dist-demo');
const title = process.argv[4] ?? 'AI Manager HR';
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dir, href.replace(/^\//, '')), 'utf8');
const js = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/)[1];
const css = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/)[1];
const script = read(js).replace(/<\/script/gi, '<\\/script');
const out = `<!DOCTYPE html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Caveat:wght@600&family=Manrope:wght@400;500;600;700;800&display=swap">
<style>${read(css)}</style>
<div id="root"></div>
<script type="module">${script}</script>
`;
fs.writeFileSync(path.resolve(process.argv[2] ?? 'dist-demo/ai-manager-hr.html'), out);
console.log(`wrote ${(out.length / 1024).toFixed(0)} KB`);
