import puppeteer from 'puppeteer';

const base = 'http://localhost:5500';
const pages = [
  { name: 'index-desktop', url: '/', width: 1440, height: 900 },
  { name: 'index-mobile', url: '/', width: 375, height: 812 },
  { name: 'tienda-desktop', url: '/tienda.html', width: 1440, height: 900 },
  { name: 'tienda-mobile', url: '/tienda.html', width: 375, height: 812 },
  { name: 'producto-desktop', url: '/producto?slug=laptop-gaming-rtx-4060', width: 1440, height: 900 },
  { name: 'carrito-desktop', url: '/carrito.html', width: 1440, height: 900 },
  { name: 'carrito-mobile', url: '/carrito.html', width: 375, height: 812 }
];

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

// Pre-seed cart for the cart screenshots
async function seedCart() {
  await page.evaluate(() => {
    localStorage.setItem('waremarkt_cart_v1', JSON.stringify([
      { slug: 'laptop-gaming-rtx-4060', name: 'Laptop Gaming RTX 4060', price_cents: 129900, icon: 'laptop', brand: 'ASUS', quantity: 1 },
      { slug: 'audifonos-pro-wireless', name: 'Audífonos Pro Wireless', price_cents: 18900, icon: 'headphones', brand: 'Sony', quantity: 2 }
    ]));
  });
}

for (const p of pages) {
  await page.setViewport({ width: p.width, height: p.height, deviceScaleFactor: 1 });
  if (p.name.startsWith('carrito')) {
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await seedCart();
  }
  await page.goto(base + p.url, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: `screenshots/${p.name}.png`, fullPage: true });
  console.log(`✓ ${p.name}`);
}

await browser.close();
