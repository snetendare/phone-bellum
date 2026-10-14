// Counter Lab "Send changes": edit the saved roster, reload, and check the change list.
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext()).newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await p.goto('http://127.0.0.1:8766/lab.html'); await sleep(800);
  await p.click('#send'); await sleep(200);
  console.log('unchanged:', await p.textContent('#io-msg'));
  await p.evaluate(() => {
    document.getElementById('copy').click(); const r = JSON.parse(document.getElementById('io').value);
    const a = r.units.find(u => u.name === 'Skeleton Archers'); a.range = 20; a.hit = 14; a.skills[1] = 'slow';
    r.skills.find(k => k.id === 'regen').cost = 80;
    r.skills.find(k => k.id === 'poison').params.duration = 5;
    r.settings.spacing = 4;
    r.units = r.units.filter(u => u.name !== 'Ent');
    r.units.push({ ...a, name: 'Test Unit', hp: 99 });
    localStorage.setItem('counterlab.v1', JSON.stringify(r));
  });
  await p.reload(); await sleep(800);
  await p.click('#send'); await sleep(300);
  console.log(await p.textContent('#io-msg'));
  console.log((await p.inputValue('#io')).slice(0, 1200));
  await b.close();
})();
