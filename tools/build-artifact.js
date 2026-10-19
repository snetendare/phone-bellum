// Builds the claude.ai artifact versions (phone-bellum.html, game3d-artifact.html, counter-lab.html, lab3d-artifact.html)
// from the built pages.
// Run from the repo root after `node src/build.js`:  node tools/build-artifact.js
const fs = require('fs');
const game = fs.readFileSync('index.html', 'utf8');
const head = game.slice(game.indexOf('<title>'), game.indexOf('</head>'));
const body = game.slice(game.indexOf('<body>') + 6, game.lastIndexOf('</body>'));
let art = head + '\n' + body;
art = art.replace('<script src="peerjs.min.js"></script>', '<script src="https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js"></script>')
  .replace(/<a class="btn small" id="lab-link"[^>]*>Counter Lab<\/a>/, '');
if (art.includes('id="lab-link"') || !art.includes('jsdelivr')) throw new Error('artifact build failed');
// The 3D board (the Board setting): its code inlined (about 75 KB; it only defines functions, so the 2D game opens
// as before), three.js imported from jsDelivr only when 3D starts.
const code3d = ['camera3d', 'models3d', 'render3d'].map(f => fs.readFileSync(`src/${f}.js`, 'utf8')).join('\n');
const with3d = (page, threeUrl) => {
  const out = page.replace('</style>', () => '</style>\n<script>\n' + code3d + '\n</script>')
    .replace("const THREE_URL = './vendor/three.module.min.js';", () => `const THREE_URL = '${threeUrl}';`);
  if (out === page || !out.includes('const Render3D') || !out.includes(`const THREE_URL = '${threeUrl}';`)) throw new Error('3D build failed');
  return out;
};
const ga = with3d(art, 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js');
fs.writeFileSync('phone-bellum.html', ga);
console.log('wrote phone-bellum.html', ga.length);

// The game on the 3D board, for testing 3D on phones (game3d-artifact.html): forced onto the 3D board with the speed
// meter (PB_FORCE3D). three.js stays at ./vendor/, published next to the page.
const g3 = with3d(art, './vendor/three.module.min.js').replace('<title>No Mans Land</title>', '<title>No Mans Land 3D Game</title>')
  .replace('</style>', () => '</style>\n<script>window.PB_FORCE3D = true;</script>');
if (!g3.includes('No Mans Land 3D Game') || !g3.includes('PB_FORCE3D = true')) throw new Error('3D game artifact build failed');
fs.writeFileSync('game3d-artifact.html', g3);
console.log('wrote game3d-artifact.html', g3.length);

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

