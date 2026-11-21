const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 520, height: 860 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'chat-simulator', 'index.html'));

  const send = async (t) => {
    await page.fill('#msg', t);
    await page.press('#msg', 'Enter');
    await page.waitForFunction(() => !document.querySelector('.typing'), null, { timeout: 8000 });
  };
  await send('Hi, do you have the burr grinder in stock?');
  await send('Where is my order ORD-1002?');
  await send('I want to speak to a human');

  const bots = await page.$$eval('.row.bot .bub', (n) => n.map((x) => x.textContent));
  const chips = await page.$$eval('.meta .chip', (n) => n.map((x) => x.textContent));
  const banner = await page.$$eval('.banner', (n) => n.length);
  console.log('bot bubbles:', bots.length, '| banner count:', banner);
  console.log('chips:', chips.join(' | '));
  await page.screenshot({ path: path.join(__dirname, 'ui.png') });

  // export
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exp')]);
  const f = path.join(__dirname, 'exported.json');
  await dl.saveAs(f);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log('export turns:', j.turns.length, 'first agent intent:', j.turns[0].agent.intent);

  // error path: wrong URL
  await page.click('#gear');
  await page.fill('#url', 'http://localhost:5678/webhook-test/nope');
  await page.dispatchEvent('#url', 'change');
  await page.fill('#msg', 'hello'); await page.press('#msg', 'Enter');
  await page.waitForSelector('#err', { state: 'visible', timeout: 5000 });
  console.log('error shown:', await page.textContent('#err'));
  console.log('page errors:', errors.length ? errors.join('; ') : 'none');
  await browser.close();
})();
