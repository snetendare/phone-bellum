// Builds the claude.ai artifact versions (phone-bellum.html, counter-lab.html, lab3d-artifact.html) from the built pages.
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

// 3D test artifact (lab3d-artifact.html) from lab3d.html. three.js stays at ./vendor/, published next to the page.
const l3 = fs.readFileSync('lab3d.html', 'utf8');
const l3a = l3.slice(l3.indexOf('<meta charset'), l3.indexOf('</head>')).replace(/<meta name="theme-color"[^>]*>\n|<link rel="icon"[^>]*>\n/g, '')
  + '\n' + l3.slice(l3.indexOf('<body>') + 6, l3.lastIndexOf('</body>'));
if (!l3a.includes("from './vendor/three.module.min.js'")) throw new Error('3D artifact build failed');
fs.writeFileSync('lab3d-artifact.html', l3a);
console.log('wrote lab3d-artifact.html', l3a.length);

// Counter Lab artifact (counter-lab.html) from lab.html: no link back to the game, no note about Load units
// (artifacts don't share browser storage with the game).
const lab = fs.readFileSync('lab.html', 'utf8');
let la = lab.slice(lab.indexOf('<title>'), lab.indexOf('</head>')) + '\n' + lab.slice(lab.indexOf('<body>') + 6, lab.lastIndexOf('</body>'));
la = la.replace('<a href="./" style="color:inherit">No Mans Land</a>', 'No Mans Land')
  .replace(' Units you make here show up in the game under Load units on this device.', '');
if (la.includes('href="./"') || la.includes('Load units')) throw new Error('lab artifact build failed');
fs.writeFileSync('counter-lab.html', la);
console.log('wrote counter-lab.html', la.length);

