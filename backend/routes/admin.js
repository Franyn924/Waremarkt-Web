import { Router } from 'express';
import { db } from '../db/schema.js';
import { requireAdmin } from '../middleware/auth.js';

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
  if (!['computacion', 'accesorios'].includes(category)) {
    throw Object.assign(new Error('Categoría inválida'), { statusCode: 400 });
  }
  const price = Number(body.price_cents);
  if (!Number.isFinite(price) || price < 0) {
    throw Object.assign(new Error('Precio inválido'), { statusCode: 400 });
  }
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
    image_url: String(body.image_url || '').trim() || null,
    badge: String(body.badge || '').trim() || null,
    featured: body.featured ? 1 : 0,
    active: body.active === false || body.active === 0 ? 0 : 1
  };
}

adminRouter.post('/products', (req, res, next) => {
  try {
    const p = sanitize(req.body);
    const info = db.prepare(`
      INSERT INTO products (slug, name, category, brand, description, price_cents, compare_at_cents, stock, icon, image_url, badge, featured, active)
      VALUES (@slug, @name, @category, @brand, @description, @price_cents, @compare_at_cents, @stock, @icon, @image_url, @badge, @featured, @active)
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
        icon=@icon, image_url=@image_url, badge=@badge, featured=@featured, active=@active
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
