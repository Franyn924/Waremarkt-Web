import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/schema.js';
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
adminRouter.get('/stats', async (req, res, next) => {
  try {
    const [[{ products }]] = await pool.query('SELECT COUNT(*) AS products FROM products WHERE active = 1');
    const [[{ lowStock }]] = await pool.query('SELECT COUNT(*) AS lowStock FROM products WHERE active = 1 AND stock <= 5');
    const [[paidAgg]] = await pool.query(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount_total_cents), 0) AS total FROM orders WHERE status = 'paid'`
    );
    const [[{ pending }]] = await pool.query(`SELECT COUNT(*) AS pending FROM orders WHERE status = 'pending'`);
    res.json({
      success: true,
      data: {
        products,
        lowStock,
        paidOrders: paidAgg.c,
        revenueCents: Number(paidAgg.total),
        pendingOrders: pending
      }
    });
  } catch (err) { next(err); }
});

// ==== PRODUCTS CRUD ====

adminRouter.get('/products', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

adminRouter.get('/products/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'No encontrado' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}

async function sanitize(body) {
  const name = String(body.name || '').trim();
  const category = String(body.category || '').trim();
  if (!name) throw Object.assign(new Error('Nombre requerido'), { statusCode: 400 });
  const [catRows] = await pool.execute('SELECT slug FROM categories WHERE slug = ? AND active = 1', [category]);
  if (catRows.length === 0) {
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

adminRouter.post('/products', async (req, res, next) => {
  try {
    const p = await sanitize(req.body);
    const [result] = await pool.execute(
      `INSERT INTO products (slug, name, category, brand, description, price_cents, compare_at_cents, stock, icon, image_url, media_json, badge, featured, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.slug, p.name, p.category, p.brand, p.description, p.price_cents, p.compare_at_cents, p.stock, p.icon, p.image_url, p.media_json, p.badge, p.featured, p.active]
    );
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Ya existe un producto con ese slug' });
    }
    next(e);
  }
});

adminRouter.put('/products/:id', async (req, res, next) => {
  try {
    const [exists] = await pool.execute('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if (exists.length === 0) return res.status(404).json({ success: false, error: 'No encontrado' });
    const p = await sanitize(req.body);
    await pool.execute(
      `UPDATE products SET
         slug=?, name=?, category=?, brand=?, description=?,
         price_cents=?, compare_at_cents=?, stock=?,
         icon=?, image_url=?, media_json=?, badge=?, featured=?, active=?
       WHERE id=?`,
      [p.slug, p.name, p.category, p.brand, p.description, p.price_cents, p.compare_at_cents, p.stock, p.icon, p.image_url, p.media_json, p.badge, p.featured, p.active, Number(req.params.id)]
    );
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Ya existe un producto con ese slug' });
    }
    next(e);
  }
});

adminRouter.delete('/products/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute('UPDATE products SET active = 0 WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'No encontrado' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ==== MEDIA UPLOAD ====

adminRouter.post('/upload', (req, res) => {
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

adminRouter.get('/categories', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC, name_es ASC');
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
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

adminRouter.post('/categories', async (req, res, next) => {
  try {
    const c = sanitizeCategory(req.body);
    const [result] = await pool.execute(
      `INSERT INTO categories (slug, name_es, name_en, icon, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [c.slug, c.name_es, c.name_en, c.icon, c.sort_order, c.active]
    );
    const [rows] = await pool.execute('SELECT * FROM categories WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Ya existe una categoría con ese slug' });
    }
    next(e);
  }
});

adminRouter.put('/categories/:id', async (req, res, next) => {
  try {
    const [existsRows] = await pool.execute('SELECT slug FROM categories WHERE id = ?', [req.params.id]);
    if (existsRows.length === 0) return res.status(404).json({ success: false, error: 'No encontrada' });
    const prevSlug = existsRows[0].slug;
    const c = sanitizeCategory(req.body);
    await pool.execute(
      `UPDATE categories SET
         slug=?, name_es=?, name_en=?,
         icon=?, sort_order=?, active=?
       WHERE id=?`,
      [c.slug, c.name_es, c.name_en, c.icon, c.sort_order, c.active, Number(req.params.id)]
    );
    if (c.slug !== prevSlug) {
      await pool.execute('UPDATE products SET category = ? WHERE category = ?', [c.slug, prevSlug]);
    }
    const [rows] = await pool.execute('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Ya existe una categoría con ese slug' });
    }
    next(e);
  }
});

adminRouter.delete('/categories/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT slug FROM categories WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'No encontrada' });
    const slug = rows[0].slug;
    const [[{ used }]] = await pool.execute(
      'SELECT COUNT(*) AS used FROM products WHERE category = ? AND active = 1',
      [slug]
    );
    if (used > 0) {
      return res.status(409).json({ success: false, error: `No se puede eliminar: ${used} producto(s) activo(s) usan esta categoría` });
    }
    await pool.execute('UPDATE categories SET active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ==== SETTINGS ====

const ALLOWED_SETTING_KEYS = new Set([
  'store_name', 'store_email', 'store_phone',
  'currency', 'shipping_flat_cents',
  'tax_enabled', 'tax_behavior',
  'checkout_success_url', 'checkout_cancel_url',
  'whatsapp_number'
]);

adminRouter.get('/settings', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT `key`, value, updated_at FROM settings ORDER BY `key`');
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

adminRouter.put('/settings', async (req, res, next) => {
  try {
    const body = req.body || {};
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const [key, value] of Object.entries(body)) {
        if (!ALLOWED_SETTING_KEYS.has(key)) continue;
        await conn.execute(
          `INSERT INTO settings (\`key\`, value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [key, value == null ? '' : String(value)]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    const [rows] = await pool.query('SELECT `key`, value FROM settings');
    res.json({ success: true, data: Object.fromEntries(rows.map(r => [r.key, r.value])) });
  } catch (err) { next(err); }
});

// ==== ORDERS ====

adminRouter.get('/orders', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100');
    const parsed = rows.map(o => ({
      ...o,
      items: safeJson(o.items_json),
      shipping: safeJson(o.shipping_json)
    }));
    res.json({ success: true, data: parsed });
  } catch (err) { next(err); }
});

function safeJson(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}
