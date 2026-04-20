import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/schema.js';
import { requireAdmin } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10) || '.bin';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^(image|video)\//.test(file.mimetype)) return cb(new Error('Solo se permiten imágenes o videos'));
    cb(null, true);
  }
});

export const adminRouter = Router();

adminRouter.use(requireAdmin);

// Verifica el token (ping de login)
adminRouter.get('/me', (req, res) => {
  res.json({ success: true, data: { authenticated: true } });
});

// Stats para dashboard
adminRouter.get('/stats', (req, res) => {
  const products = db.prepare('SELECT COUNT(*) as c FROM products WHERE active = 1').get().c;
  const lowStock = db.prepare('SELECT COUNT(*) as c FROM products WHERE active = 1 AND stock <= 5').get().c;
  const orders = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount_total_cents),0) as total FROM orders WHERE status = ?').get('paid');
  const pending = db.prepare('SELECT COUNT(*) as c FROM orders WHERE status = ?').get('pending').c;
  res.json({
    success: true,
    data: {
      products,
      lowStock,
      paidOrders: orders.c,
      revenueCents: orders.total,
      pendingOrders: pending
    }
  });
});

// ==== PRODUCTS CRUD ====

adminRouter.get('/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json({ success: true, data: rows });
});

adminRouter.get('/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'No encontrado' });
  res.json({ success: true, data: row });
});

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}

function sanitize(body) {
  const name = String(body.name || '').trim();
  const category = String(body.category || '').trim();
  if (!name) throw Object.assign(new Error('Nombre requerido'), { statusCode: 400 });
  const catRow = db.prepare('SELECT slug FROM categories WHERE slug = ? AND active = 1').get(category);
  if (!catRow) {
    throw Object.assign(new Error('Categoría inválida o inactiva'), { statusCode: 400 });
  }
  const price = Number(body.price_cents);
  if (!Number.isFinite(price) || price < 0) {
    throw Object.assign(new Error('Precio inválido'), { statusCode: 400 });
  }
  const media = Array.isArray(body.media) ? body.media
    .filter(m => m && typeof m.url === 'string' && m.url.trim())
    .slice(0, 10)
    .map(m => ({
      url: String(m.url).trim(),
      type: m.type === 'video' ? 'video' : 'image'
    })) : [];
  const firstImage = media.find(m => m.type === 'image');
  const legacyImage = String(body.image_url || '').trim();
  // Si hay media, la portada = primera imagen. Si no, usa image_url legacy (para migrar sin perder datos).
  const image_url = firstImage ? firstImage.url : (legacyImage || null);
  return {
    slug: body.slug ? slugify(body.slug) : slugify(name),
    name,
    category,
    brand: String(body.brand || '').trim() || null,
    description: String(body.description || '').trim() || null,
    price_cents: Math.round(price),
    compare_at_cents: body.compare_at_cents ? Math.round(Number(body.compare_at_cents)) : null,
    stock: Number.isFinite(Number(body.stock)) ? Math.max(0, Math.round(Number(body.stock))) : 0,
    icon: String(body.icon || '').trim() || 'package',
    image_url,
    media_json: media.length ? JSON.stringify(media) : null,
    badge: String(body.badge || '').trim() || null,
    featured: body.featured ? 1 : 0,
    active: body.active === false || body.active === 0 ? 0 : 1
  };
}

adminRouter.post('/products', (req, res, next) => {
  try {
    const p = sanitize(req.body);
    const info = db.prepare(`
      INSERT INTO products (slug, name, category, brand, description, price_cents, compare_at_cents, stock, icon, image_url, media_json, badge, featured, active)
      VALUES (@slug, @name, @category, @brand, @description, @price_cents, @compare_at_cents, @stock, @icon, @image_url, @media_json, @badge, @featured, @active)
    `).run(p);
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ success: false, error: 'Ya existe un producto con ese slug' });
    }
    next(e);
  }
});

adminRouter.put('/products/:id', (req, res, next) => {
  try {
    const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
    if (!exists) return res.status(404).json({ success: false, error: 'No encontrado' });
    const p = sanitize(req.body);
    db.prepare(`
      UPDATE products SET
        slug=@slug, name=@name, category=@category, brand=@brand, description=@description,
        price_cents=@price_cents, compare_at_cents=@compare_at_cents, stock=@stock,
        icon=@icon, image_url=@image_url, media_json=@media_json, badge=@badge, featured=@featured, active=@active
      WHERE id=@id
    `).run({ ...p, id: Number(req.params.id) });
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: row });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ success: false, error: 'Ya existe un producto con ese slug' });
    }
    next(e);
  }
});

// Soft-delete: active = 0
adminRouter.delete('/products/:id', (req, res) => {
  const info = db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ success: false, error: 'No encontrado' });
  res.json({ success: true });
});

// ==== MEDIA UPLOAD ====

adminRouter.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: 'Archivo requerido' });
    const url = `/uploads/${req.file.filename}`;
    const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    res.json({ success: true, data: { url, type, size: req.file.size, name: req.file.originalname } });
  });
});

// ==== UPC LOOKUP (upcitemdb trial) ====

adminRouter.get('/upc/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code).replace(/\D/g, '');
    if (code.length < 8 || code.length > 14) {
      return res.status(400).json({ success: false, error: 'Código UPC/EAN inválido' });
    }
    const r = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(r.status).json({ success: false, error: `upcitemdb: ${r.status} ${txt.slice(0, 120)}` });
    }
    const json = await r.json();
    if (!json.items || json.items.length === 0) {
      return res.status(404).json({ success: false, error: 'No se encontraron productos con ese UPC' });
    }
    const it = json.items[0];
    const normalized = {
      code,
      title: it.title || '',
      brand: it.brand || '',
      description: it.description || [it.title, it.model, it.color, it.size].filter(Boolean).join(' · '),
      category: guessCategory(it),
      images: Array.isArray(it.images) ? it.images.filter(u => /^https?:\/\//.test(u)) : [],
      price_cents: it.lowest_recorded_price ? Math.round(Number(it.lowest_recorded_price) * 100) : null,
      raw: {
        ean: it.ean, upc: it.upc, model: it.model, color: it.color,
        size: it.size, dimension: it.dimension, weight: it.weight,
        category_raw: it.category
      }
    };
    res.json({ success: true, data: normalized });
  } catch (e) {
    next(e);
  }
});

function guessCategory(it) {
  const hay = `${it.title || ''} ${it.category || ''} ${it.description || ''}`.toLowerCase();
  const computacion = /laptop|notebook|desktop|monitor|ssd|hdd|ram|cpu|gpu|tarjeta|processor|computer|pc |motherboard|gaming pc/;
  const accesorios = /mouse|keyboard|teclado|headphone|audifono|earbud|auricular|speaker|webcam|cable|adapter|hub|charger|cargador|case|funda|pad|stand|soporte/;
  if (computacion.test(hay)) return 'computacion';
  if (accesorios.test(hay)) return 'accesorios';
  return '';
}

// ==== CATEGORIES CRUD ====

adminRouter.get('/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, name_es ASC').all();
  res.json({ success: true, data: rows });
});

function sanitizeCategory(body) {
  const name_es = String(body.name_es || '').trim();
  const name_en = String(body.name_en || '').trim();
  if (!name_es) throw Object.assign(new Error('Nombre (ES) requerido'), { statusCode: 400 });
  if (!name_en) throw Object.assign(new Error('Name (EN) required'), { statusCode: 400 });
  return {
    slug: body.slug ? slugify(body.slug) : slugify(name_es),
    name_es,
    name_en,
    icon: String(body.icon || 'package').trim() || 'package',
    sort_order: Number.isFinite(Number(body.sort_order)) ? Math.round(Number(body.sort_order)) : 0,
    active: body.active === false || body.active === 0 ? 0 : 1
  };
}

adminRouter.post('/categories', (req, res, next) => {
  try {
    const c = sanitizeCategory(req.body);
    const info = db.prepare(`
      INSERT INTO categories (slug, name_es, name_en, icon, sort_order, active)
      VALUES (@slug, @name_es, @name_en, @icon, @sort_order, @active)
    `).run(c);
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ success: false, error: 'Ya existe una categoría con ese slug' });
    }
    next(e);
  }
});

adminRouter.put('/categories/:id', (req, res, next) => {
  try {
    const exists = db.prepare('SELECT slug FROM categories WHERE id = ?').get(req.params.id);
    if (!exists) return res.status(404).json({ success: false, error: 'No encontrada' });
    const c = sanitizeCategory(req.body);
    db.prepare(`
      UPDATE categories SET
        slug=@slug, name_es=@name_es, name_en=@name_en,
        icon=@icon, sort_order=@sort_order, active=@active
      WHERE id=@id
    `).run({ ...c, id: Number(req.params.id) });
    // Si cambió el slug, actualiza productos existentes
    if (c.slug !== exists.slug) {
      db.prepare('UPDATE products SET category = ? WHERE category = ?').run(c.slug, exists.slug);
    }
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: row });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ success: false, error: 'Ya existe una categoría con ese slug' });
    }
    next(e);
  }
});

adminRouter.delete('/categories/:id', (req, res) => {
  const row = db.prepare('SELECT slug FROM categories WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'No encontrada' });
  const used = db.prepare('SELECT COUNT(*) as n FROM products WHERE category = ? AND active = 1').get(row.slug).n;
  if (used > 0) {
    return res.status(409).json({ success: false, error: `No se puede eliminar: ${used} producto(s) activo(s) usan esta categoría` });
  }
  db.prepare('UPDATE categories SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==== SETTINGS ====

const ALLOWED_SETTING_KEYS = new Set([
  'store_name', 'store_email', 'store_phone',
  'currency', 'shipping_flat_cents',
  'tax_enabled', 'tax_behavior',
  'checkout_success_url', 'checkout_cancel_url',
  'whatsapp_number'
]);

adminRouter.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all();
  res.json({ success: true, data: rows });
});

adminRouter.put('/settings', (req, res) => {
  const body = req.body || {};
  const update = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) {
      if (!ALLOWED_SETTING_KEYS.has(key)) continue;
      update.run({ key, value: value == null ? '' : String(value) });
    }
  });
  tx(Object.entries(body));
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json({ success: true, data: Object.fromEntries(rows.map(r => [r.key, r.value])) });
});

// ==== ORDERS ====

adminRouter.get('/orders', (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all();
  const parsed = rows.map(o => ({
    ...o,
    items: safeJson(o.items_json),
    shipping: safeJson(o.shipping_json)
  }));
  res.json({ success: true, data: parsed });
});

function safeJson(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}
