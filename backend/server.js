import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initDb, pool } from './db/schema.js';
import { productsRouter } from './routes/products.js';
import { categoriesRouter } from './routes/categories.js';
import { settingsRouter } from './routes/settings.js';
import { checkoutRouter } from './routes/checkout.js';
import { webhookRouter } from './routes/webhook.js';
import { adminRouter } from './routes/admin.js';
import { startDailyReportCron } from './services/dailyReport.js';
import { startSoldOutCron } from './services/stock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors({ origin: true, credentials: true }));

// Webhook necesita body raw — va ANTES de express.json()
app.use('/api/webhook', webhookRouter);

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', ts: new Date().toISOString() } });
});

app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/checkout', checkoutRouter);
app.use('/api/admin', adminRouter);

// Archivos subidos (fotos/videos de productos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '7d'
}));

// producto.html con Open Graph dinámico según ?slug= (va antes del static)
const FRONTEND_ROOT = path.join(__dirname, '..');
const PRODUCTO_HTML_PATH = path.join(FRONTEND_ROOT, 'producto.html');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function absolutizeUrl(u, req) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  const base = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
  return base.replace(/\/$/, '') + (u.startsWith('/') ? u : '/' + u);
}

// Inserta f_auto,q_auto y resize en URLs /image/upload/ de Cloudinary.
function cldUrl(url, opts = {}) {
  if (!url || typeof url !== 'string') return url;
  const m = url.match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/);
  if (!m) return url;
  const first = m[2].split('/')[0];
  if (/(^|,)(f_auto|q_auto|w_\d+|c_[a-z]+)(,|$)/.test(first)) return url;
  const parts = [];
  if (opts.w) parts.push(`w_${opts.w}`);
  if (opts.h) parts.push(`h_${opts.h}`);
  if (opts.crop) parts.push(`c_${opts.crop}`);
  parts.push(`q_${opts.q || 'auto'}`);
  parts.push(`f_${opts.f || 'auto'}`);
  return m[1] + parts.join(',') + '/' + m[2];
}

async function productoHandler(req, res, next) {
  try {
    let html = await fs.readFile(PRODUCTO_HTML_PATH, 'utf8');
    const slug = String(req.query.slug || '').trim();

    let title = 'Producto — Waremarkt';
    let description = 'Computación y accesorios con envío US + LatAm.';
    let image = '';
    const pageUrl = absolutizeUrl(req.originalUrl, req);

    if (slug) {
      const [rows] = await pool.execute(
        'SELECT name, description, image_url, media_json, price_cents FROM products WHERE slug = ? AND active = 1',
        [slug]
      );
      if (rows.length) {
        const p = rows[0];
        title = `${p.name} — Waremarkt`;
        const desc = String(p.description || '').replace(/\s+/g, ' ').trim();
        if (desc) description = desc.slice(0, 200);

        let img = p.image_url || '';
        if (!img && p.media_json) {
          try {
            const arr = JSON.parse(p.media_json);
            const first = Array.isArray(arr) ? arr.find(m => m && m.type === 'image' && m.url) : null;
            if (first) img = first.url;
          } catch {}
        }
        if (img) image = absolutizeUrl(cldUrl(img, { w: 1200, crop: 'fill' }), req);
      }
    }

    const cardType = image ? 'summary_large_image' : 'summary';
    const og = [
      `<title>${escapeHtml(title)}</title>`,
      `<meta name="description" content="${escapeHtml(description)}">`,
      `<meta property="og:site_name" content="Waremarkt">`,
      `<meta property="og:type" content="${slug ? 'product' : 'website'}">`,
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:description" content="${escapeHtml(description)}">`,
      `<meta property="og:url" content="${escapeHtml(pageUrl)}">`,
      image ? `<meta property="og:image" content="${escapeHtml(image)}">` : '',
      `<meta name="twitter:card" content="${cardType}">`,
      `<meta name="twitter:title" content="${escapeHtml(title)}">`,
      `<meta name="twitter:description" content="${escapeHtml(description)}">`,
      image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''
    ].filter(Boolean).join('\n  ');

    html = html.replace(
      /<!-- OG:START -->[\s\S]*?<!-- OG:END -->/,
      `<!-- OG:START -->\n  ${og}\n  <!-- OG:END -->`
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(html);
  } catch (err) { next(err); }
}

app.get(['/producto', '/producto.html'], productoHandler);

// Frontend estático (HTML/CSS/JS/imgs del proyecto)
app.use(express.static(path.join(__dirname, '..'), {
  index: 'index.html',
  extensions: ['html']
}));

// 404 solo para rutas /api no encontradas
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// Error handler central
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  const code = err.statusCode || 500;
  res.status(code).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Error interno' : err.message
  });
});

(async () => {
  try {
    await initDb();
    console.log('  DB             · MySQL conectado y esquema listo');
  } catch (e) {
    console.error('[fatal] initDb falló:', e.message);
    process.exit(1);
  }

  startDailyReportCron();
  startSoldOutCron();

  app.listen(PORT, () => {
    console.log(`\n  Waremarkt API · http://localhost:${PORT}`);
    console.log(`  Health         · http://localhost:${PORT}/api/health`);
    console.log(`  Products       · http://localhost:${PORT}/api/products\n`);
  });
})();
