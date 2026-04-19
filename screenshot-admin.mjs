import puppeteer from 'puppeteer';

const base = 'http://localhost:5500';
const TOKEN = 'waremarkt_admin_2026';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

async function shot(name, w, h) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log(`✓ ${name}`);
}

// 1. Login screen (no token)
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.removeItem('waremarkt_admin_token'));
await page.goto(base + '/admin', { waitUntil: 'networkidle0' });
await shot('admin-login', 1440, 900);

// 2. Dashboard (authed)
await page.evaluate((t) => localStorage.setItem('waremarkt_admin_token', t), TOKEN);
await page.goto(base + '/admin', { waitUntil: 'networkidle0' });
await shot('admin-dashboard', 1440, 900);

// 3. Products tab
await page.click('button:nth-of-type(2)'); // products nav button
await new Promise(r => setTimeout(r, 800));
await shot('admin-products', 1440, 900);

// 4. Orders tab
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('nav button')];
  const orders = buttons.find(b => b.textContent.trim() === 'Pedidos');
  if (orders) orders.click();
});
await new Promise(r => setTimeout(r, 800));
await shot('admin-orders', 1440, 900);

// 5. New product modal
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('nav button')];
  const prods = buttons.find(b => b.textContent.trim() === 'Productos');
  if (prods) prods.click();
});
await new Promise(r => setTimeout(r, 500));
await page.evaluate(() => {
  const nuevoBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().includes('Nuevo'));
  if (nuevoBtn) nuevoBtn.click();
});
await new Promise(r => setTimeout(r, 500));
await shot('admin-new-modal', 1440, 900);

await browser.close();
