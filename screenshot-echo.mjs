import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

await page.goto('http://localhost:5500/producto.html?slug=840080521602', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: 'screenshots/echo-detail.png', fullPage: true });
console.log('✓ echo-detail');

await page.goto('http://localhost:5500/index.html', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: 'screenshots/home-featured.png', fullPage: false });
console.log('✓ home-featured');

await browser.close();
