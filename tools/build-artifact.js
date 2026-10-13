// Builds the claude.ai artifact version (phone-bellum.html) from index.html.
// Run from the repo root after `node src/build.js`:  node tools/build-artifact.js
const fs = require('fs');
const game = fs.readFileSync('index.html', 'utf8');
const head = game.slice(game.indexOf('<title>'), game.indexOf('</head>'));
const body = game.slice(game.indexOf('<body>') + 6, game.lastIndexOf('</body>'));
let art = head + '\n' + body;
art = art.replace('<script src="peerjs.min.js"></script>', '<script src="https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js"></script>')
  .replace(/<a class="btn small" id="lab-link"[^>]*>Counter Lab<\/a>/, '');
if (art.includes('id="lab-link"') || !art.includes('jsdelivr')) throw new Error('artifact build failed');
fs.writeFileSync('phone-bellum.html', art);
console.log('wrote phone-bellum.html', art.length);
