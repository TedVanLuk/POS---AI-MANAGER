// Turns dist-demo/ into one HTML fragment for publishing as a Claude artifact.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('dist-demo');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dir, href.replace(/^\//, '')), 'utf8');
const js = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/)[1];
const css = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/)[1];
const script = read(js).replace(/<\/script/gi, '<\\/script');
const out = `<title>AI Manager HR</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Manrope:wght@400;500;600;700;800&display=swap">
<style>${read(css)}</style>
<div id="root"></div>
<script type="module">${script}</script>
`;
fs.writeFileSync(path.resolve(process.argv[2] ?? 'dist-demo/ai-manager-hr.html'), out);
console.log(`wrote ${(out.length / 1024).toFixed(0)} KB`);
