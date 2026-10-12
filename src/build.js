// Builds index.html (the game) and lab.html (Counter Lab) into the repo root.
// Run from the repo root:  node src/build.js
const fs = require('fs'), path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const shapes = src('shapes.js'), eng = src('engine.js');
// Counter Lab
const r = JSON.parse(src('r5.json'));
const sample = { goldCosts: true, settings: { ...r.settings, budget: r.settings.budget * 100 }, units: r.units.map(u => ({ ...u, cost: Math.round(u.cost * 100) })) };
const ex = JSON.parse(src('r9.json')).units.slice(7).map(u => ({ ...u, cost: Math.round(u.cost * 100) }));
ex.push({ name: 'Ogre Smasher', cost: 100, bodies: 1, hp: 1100, hit: 260, aps: 0.5, range: 3, speed: 7, splash: 2.5, defense: 'none', defVal: 0, windUp: 1.0, knockback: 4 });
const lab = src('template.html').replace('/*SHAPES*/', () => shapes).replace('/*ENGINE*/', () => eng)
  .replace('/*SAMPLE*/', () => JSON.stringify(sample)).replace('/*EXAMPLES*/', () => JSON.stringify(ex));
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
  .replace('<div class="eyebrow">Phone Bellum · balance sandbox</div>', '<div class="eyebrow"><a href="./" style="color:inherit">Phone Bellum</a> · balance sandbox</div>')
  .replace('Tap a cell to watch that fight.</p>', 'Tap a cell to watch that fight. Units you make here show up in the game under Load units on this device.</p>')}
</body>
</html>
`;
fs.writeFileSync('lab.html', labDoc);
// Game
const css = src('game-template.html').split('<style>')[1].split('</style>')[0];
const game = src('site-template.html').replace('/*BASECSS*/', () => css)
  .replace('/*SHAPES*/', () => shapes).replace('/*ENGINE*/', () => eng)
  .replace('/*GAME*/', () => src('game.js')).replace('/*DATA*/', () => src('demo-units.json'));
game.split('<script>').slice(1).map(s => s.split('</script>')[0]).forEach(s => new Function(s));
fs.writeFileSync('index.html', game);
console.log('built index.html and lab.html');
