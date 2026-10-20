// Builds index.html (the game) and lab.html (Counter Lab) into the repo root.
// Run from the repo root:  node src/build.js
const fs = require('fs'), path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const shapes = src('shapes.js'), eng = src('engine.js');
// Counter Lab
const SK = JSON.parse(src('skills-default.json'));
const withSkills = (u) => ({ ...u, skills: SK.assign[u.name] || [null, null, null], skillsOn: [false, false, false] });
const sample = JSON.parse(src('default-roster.json')); // the default roster for Counter Lab
const ex = JSON.parse(src('r9.json')).units.slice(7).map(u => ({ ...u, cost: Math.round(u.cost * 100) }));
ex.push({ name: 'Ogre Smasher', cost: 100, bodies: 1, hp: 1100, hit: 260, aps: 0.5, range: 3, speed: 7, splash: 2.5, defense: 'none', defVal: 0, windUp: 1.0, knockback: 4 });
ex.forEach((u, i) => { ex[i] = withSkills(u); });
const lab = src('template.html').replace('/*SHAPES*/', () => shapes).replace('/*ENGINE*/', () => eng)
  .replace('/*SAMPLE*/', () => JSON.stringify(sample)).replace('/*EXAMPLES*/', () => JSON.stringify(ex))
  .replace('/*FACTIONS*/', () => src('factions.json'));
const cut = lab.indexOf('</style>') + '</style>'.length;
const labDoc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0D1315">
<link rel="icon" href="icon.png">
<link rel="apple-touch-icon" href="icon.png">
${lab.slice(0, cut)}
</head>
<body>
${lab.slice(cut)
  .replace('<div class="eyebrow">No Mans Land · balance sandbox</div>', '<div class="eyebrow"><a href="./" style="color:inherit">No Mans Land</a> · balance sandbox</div>')
  .replace('Tap a cell to watch that fight.</p>', 'Tap a cell to watch that fight. Units you make here show up in the game under Load units on this device.</p>')}
</body>
</html>
`;
fs.writeFileSync('lab.html', labDoc);
// Game
const game = src('site-template.html').replace('/*BASECSS*/', () => src('game.css'))
  .replace('/*SHAPES*/', () => shapes).replace('/*ENGINE*/', () => eng)
  .replace('/*GAME*/', () => src('game.js'))
  .replace('/*ART*/', () => src('art.js')).replace('/*RENDER2D*/', () => src('render2d.js')).replace('/*DATA*/', () => src('demo-units.json'))
  .replace('/*FACTIONS*/', () => src('faction-units.json'));
game.split('<script>').slice(1).map(s => s.split('</script>')[0]).forEach(s => new Function(s));
// the 3D board's code is loaded on its own when 3D starts: make sure it parses too
for (const f of ['camera3d.js', 'models3d.js', 'render3d.js']) new Function(src(f));
fs.writeFileSync('index.html', game);
// 3D test page
const lab3d = src('lab3d-template.html').replace('/*BASECSS*/', () => src('game.css'))
  .replace('/*SHAPES*/', () => shapes).replace('/*ENGINE*/', () => eng).replace('/*GAME*/', () => src('game.js'))
  .replace('/*ART*/', () => src('art.js')).replace('/*RENDER2D*/', () => src('render2d.js')).replace('/*CAMERA3D*/', () => src('camera3d.js'))
  .replace('/*MODELS3D*/', () => src('models3d.js')).replace('/*RENDER3D*/', () => src('render3d.js'))
  .replace('/*DATA*/', () => src('demo-units.json')).replace('/*LAB3D*/', () => src('lab3d.js'));
fs.writeFileSync('lab3d.html', lab3d);
console.log('built index.html, lab.html and lab3d.html');
