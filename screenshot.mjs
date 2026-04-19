import puppeteer from 'puppeteer';
import { pathToFileURL } from 'url';
import path from 'path';

const file = pathToFileURL(path.resolve('index.html')).href;

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 }
];

for (const v of viewports) {
  await page.setViewport({ width: v.width, height: v.height, deviceScaleFactor: 1 });
  await page.goto(file, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: `screenshots/${v.name}.png`, fullPage: true });
  console.log(`✓ ${v.name} ${v.width}x${v.height}`);
}

await browser.close();
