import puppeteer from 'puppeteer';
const TOKEN = 'waremarkt_admin_2026';
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

await page.goto('http://localhost:5500/admin.html', { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('waremarkt_admin_token', t), TOKEN);
await page.goto('http://localhost:5500/admin.html', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 600));

// Go to Productos
await page.evaluate(() => {
  const b = [...document.querySelectorAll('nav button')].find(x => x.textContent.trim() === 'Productos');
  b && b.click();
});
await new Promise(r => setTimeout(r, 500));

// Click Nuevo
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes('Nuevo'));
  b && b.click();
});
await new Promise(r => setTimeout(r, 600));

// Type UPC and click Buscar
await page.type('input[placeholder*="885909"]', '885909950805');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes('Buscar') && !x.textContent.includes('Buscando'));
  b && b.click();
});
await new Promise(r => setTimeout(r, 3500));

await page.screenshot({ path: 'screenshots/admin-upc-results.png', fullPage: true });
console.log('✓ admin-upc-results');

await browser.close();
