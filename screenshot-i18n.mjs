import puppeteer from 'puppeteer';

const base = 'http://localhost:5500';

async function capture(url, outFile, lang) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((l) => {
    try { localStorage.setItem('waremarkt_lang', l); } catch (_) {}
  }, lang);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: outFile, fullPage: false });
  await browser.close();
  console.log('ok', outFile);
}

const pages = [
  ['/index.html',    'index'],
  ['/tienda.html',   'tienda'],
  ['/carrito.html',  'carrito'],
  ['/success.html',  'success'],
  ['/cancel.html',   'cancel'],
];

import { mkdirSync } from 'node:fs';
mkdirSync('./screenshots', { recursive: true });

for (const [path, name] of pages) {
  for (const lang of ['es', 'en']) {
    await capture(`${base}${path}`, `./screenshots/${name}-${lang}.png`, lang);
  }
}
