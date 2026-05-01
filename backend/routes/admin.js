import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import Stripe from 'stripe';
import { pool } from '../db/schema.js';
import { requireAdmin } from '../middleware/auth.js';
import { buildDailyReport } from '../services/dailyReport.js';
import { sendDailySalesReport, sendRaw, invalidateMailerCache, sendFulfillmentUpdate } from '../services/mailer.js';
import { markOrderPaid } from './webhook.js';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const CLOUDINARY_ENABLED = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (CLOUDINARY_ENABLED) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

const upload = multer({
  storage: CLOUDINARY_ENABLED
    ? multer.memoryStorage()
    : multer.diskStorage({
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

function uploadBufferToCloudinary(buffer, originalName) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'waremarkt',
        resource_type: 'auto',
        use_filename: true,
        unique_filename: true,
        overwrite: false
      },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(buffer);
  });
}

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
  const sku = String(body.sku || '').trim().toUpperCase().slice(0, 80) || null;
  return {
    slug: body.slug ? slugify(body.slug) : slugify(name),
    name,
    sku,
    category,
    brand: String(body.brand || '').trim() || null,
    description: String(body.description || '').trim() || null,
    price_cents: Math.round(price),
    compare_at_cents: body.compare_at_cents ? Math.round(Number(body.compare_at_cents)) : null,
    cost_cents: body.cost_cents != null && body.cost_cents !== '' && Number.isFinite(Number(body.cost_cents))
      ? Math.max(0, Math.round(Number(body.cost_cents)))
      : null,
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
      `INSERT INTO products (slug, name, sku, category, brand, description, price_cents, compare_at_cents, cost_cents, stock, icon, image_url, media_json, badge, featured, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.slug, p.name, p.sku, p.category, p.brand, p.description, p.price_cents, p.compare_at_cents, p.cost_cents, p.stock, p.icon, p.image_url, p.media_json, p.badge, p.featured, p.active]
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
         slug=?, name=?, sku=?, category=?, brand=?, description=?,
         price_cents=?, compare_at_cents=?, cost_cents=?, stock=?,
         icon=?, image_url=?, media_json=?, badge=?, featured=?, active=?
       WHERE id=?`,
      [p.slug, p.name, p.sku, p.category, p.brand, p.description, p.price_cents, p.compare_at_cents, p.cost_cents, p.stock, p.icon, p.image_url, p.media_json, p.badge, p.featured, p.active, Number(req.params.id)]
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
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: 'Archivo requerido' });
    const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    try {
      if (CLOUDINARY_ENABLED) {
        const result = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname);
        return res.json({
          success: true,
          data: {
            url: result.secure_url,
            type: result.resource_type === 'video' ? 'video' : 'image',
            size: result.bytes,
            name: req.file.originalname,
            public_id: result.public_id
          }
        });
      }
      // Fallback local (solo útil en desarrollo; en Hostinger no persiste)
      res.json({
        success: true,
        data: { url: `/uploads/${req.file.filename}`, type, size: req.file.size, name: req.file.originalname }
      });
    } catch (e) {
      res.status(500).json({ success: false, error: `Upload falló: ${e.message}` });
    }
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

async function sanitizeCategory(body, selfId = null) {
  const name_es = String(body.name_es || '').trim();
  const name_en = String(body.name_en || '').trim();
  if (!name_es) throw Object.assign(new Error('Nombre (ES) requerido'), { statusCode: 400 });
  if (!name_en) throw Object.assign(new Error('Name (EN) required'), { statusCode: 400 });

  let parent_id = null;
  const rawParent = body.parent_id;
  if (rawParent !== '' && rawParent != null && Number(rawParent) > 0) {
    const pid = Math.round(Number(rawParent));
    if (selfId && pid === selfId) {
      throw Object.assign(new Error('Una categoría no puede ser padre de sí misma'), { statusCode: 400 });
    }
    const [parentRows] = await pool.execute(
      'SELECT id, parent_id FROM categories WHERE id = ? AND active = 1',
      [pid]
    );
    if (parentRows.length === 0) {
      throw Object.assign(new Error('Categoría padre inválida o inactiva'), { statusCode: 400 });
    }
    if (parentRows[0].parent_id != null) {
      throw Object.assign(new Error('Solo se permiten 2 niveles: el padre elegido ya es una subcategoría'), { statusCode: 400 });
    }
    // Si esta categoría ya tiene hijos, no puede volverse hija
    if (selfId) {
      const [[{ n }]] = await pool.execute(
        'SELECT COUNT(*) AS n FROM categories WHERE parent_id = ? AND active = 1',
        [selfId]
      );
      if (n > 0) {
        throw Object.assign(new Error('Esta categoría tiene subcategorías; no puede convertirse en subcategoría'), { statusCode: 400 });
      }
    }
    parent_id = pid;
  }

  return {
    slug: body.slug ? slugify(body.slug) : slugify(name_es),
    name_es,
    name_en,
    icon: String(body.icon || 'package').trim() || 'package',
    sort_order: Number.isFinite(Number(body.sort_order)) ? Math.round(Number(body.sort_order)) : 0,
    active: body.active === false || body.active === 0 ? 0 : 1,
    parent_id
  };
}

adminRouter.post('/categories', async (req, res, next) => {
  try {
    const c = await sanitizeCategory(req.body);
    const [result] = await pool.execute(
      `INSERT INTO categories (slug, name_es, name_en, icon, sort_order, active, parent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [c.slug, c.name_es, c.name_en, c.icon, c.sort_order, c.active, c.parent_id]
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
    const selfId = Number(req.params.id);
    const [existsRows] = await pool.execute('SELECT slug FROM categories WHERE id = ?', [selfId]);
    if (existsRows.length === 0) return res.status(404).json({ success: false, error: 'No encontrada' });
    const prevSlug = existsRows[0].slug;
    const c = await sanitizeCategory(req.body, selfId);
    await pool.execute(
      `UPDATE categories SET
         slug=?, name_es=?, name_en=?,
         icon=?, sort_order=?, active=?, parent_id=?
       WHERE id=?`,
      [c.slug, c.name_es, c.name_en, c.icon, c.sort_order, c.active, c.parent_id, selfId]
    );
    if (c.slug !== prevSlug) {
      await pool.execute('UPDATE products SET category = ? WHERE category = ?', [c.slug, prevSlug]);
    }
    const [rows] = await pool.execute('SELECT * FROM categories WHERE id = ?', [selfId]);
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
    const id = Number(req.params.id);
    const [rows] = await pool.execute('SELECT slug FROM categories WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'No encontrada' });
    const slug = rows[0].slug;
    const [[{ used }]] = await pool.execute(
      'SELECT COUNT(*) AS used FROM products WHERE category = ? AND active = 1',
      [slug]
    );
    if (used > 0) {
      return res.status(409).json({ success: false, error: `No se puede eliminar: ${used} producto(s) activo(s) usan esta categoría` });
    }
    const [[{ subs }]] = await pool.execute(
      'SELECT COUNT(*) AS subs FROM categories WHERE parent_id = ? AND active = 1',
      [id]
    );
    if (subs > 0) {
      return res.status(409).json({ success: false, error: `No se puede eliminar: ${subs} subcategoría(s) activa(s) dependen de esta` });
    }
    await pool.execute('UPDATE categories SET active = 0 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ==== SETTINGS ====

const ALLOWED_SETTING_KEYS = new Set([
  'store_name', 'store_email', 'store_phone',
  'currency', 'shipping_flat_cents',
  'tax_enabled', 'tax_behavior',
  'checkout_success_url', 'checkout_cancel_url',
  'whatsapp_number',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from',
  'admin_notify_email',
  // Transferencia / Zelle
  'zelle_email', 'zelle_phone', 'zelle_account_holder', 'transfer_instructions',
  // NowPayments (cripto)
  'nowpayments_api_key', 'nowpayments_ipn_secret', 'nowpayments_enabled', 'nowpayments_sandbox'
]);

const SMTP_KEYS = new Set(['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'admin_notify_email']);

adminRouter.get('/settings', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT `key`, value, updated_at FROM settings ORDER BY `key`');
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

adminRouter.put('/settings', async (req, res, next) => {
  try {
    const body = req.body || {};
    let touchedSmtp = false;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const [key, value] of Object.entries(body)) {
        if (!ALLOWED_SETTING_KEYS.has(key)) continue;
        if (SMTP_KEYS.has(key)) touchedSmtp = true;
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
    if (touchedSmtp) invalidateMailerCache();
    const [rows] = await pool.query('SELECT `key`, value FROM settings');
    res.json({ success: true, data: Object.fromEntries(rows.map(r => [r.key, r.value])) });
  } catch (err) { next(err); }
});

// Envía un correo de prueba con la config SMTP actual (lee desde DB, sin cache).
adminRouter.post('/settings/smtp-test', async (req, res, next) => {
  try {
    const to = String(req.body?.to || '').trim();
    let destination = to;
    if (!destination) {
      const [rows] = await pool.query(
        "SELECT value FROM settings WHERE `key` IN ('admin_notify_email','smtp_user') ORDER BY FIELD(`key`,'admin_notify_email','smtp_user') LIMIT 1"
      );
      destination = rows[0]?.value || process.env.ADMIN_NOTIFY_EMAIL || process.env.SMTP_USER || '';
    }
    if (!destination) return res.status(400).json({ success: false, error: 'No hay destinatario. Configurá admin_notify_email o pasá "to".' });
    const result = await sendRaw({
      to: destination,
      subject: '✅ Prueba SMTP — Waremarkt',
      text: 'Este es un correo de prueba enviado desde el panel de administración de Waremarkt. Si lo recibiste, la configuración SMTP es correcta.',
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;background:#f6f8fb;">
        <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 12px rgba(10,46,80,0.06);">
          <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#FFC107;font-weight:600;">Prueba SMTP</div>
          <h1 style="margin:6px 0 12px;color:#0A2E50;font-size:22px;">Configuración correcta ✅</h1>
          <p style="color:#6b7280;font-size:14px;line-height:1.6;">Este es un correo de prueba enviado desde el panel de administración de Waremarkt. Si lo recibiste, la configuración SMTP está funcionando.</p>
        </div>
      </div>`
    }, { forceRefresh: true });
    res.json({ success: result.sent, data: result });
  } catch (err) { next(err); }
});

// ==== ORDERS ====

// State machine de fulfillment (envío). Separado de `status` (pago).
const FULFILLMENT_TRANSITIONS = {
  unfulfilled: ['preparing', 'shipped', 'canceled'],
  preparing:   ['shipped', 'unfulfilled', 'canceled'],
  shipped:     ['delivered', 'returned'],
  delivered:   ['returned'],
  canceled:    [],
  returned:    []
};
const FULFILLMENT_STATUSES = Object.keys(FULFILLMENT_TRANSITIONS);

const TRACKING_URLS = {
  usps:  'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=',
  ups:   'https://www.ups.com/track?tracknum=',
  fedex: 'https://www.fedex.com/fedextrack/?trknbr=',
  dhl:   'https://www.dhl.com/us-en/home/tracking.html?tracking-id='
};
function buildTrackingUrl(carrier, trackingNumber) {
  if (!carrier || !trackingNumber) return null;
  const base = TRACKING_URLS[String(carrier).toLowerCase()];
  return base ? base + encodeURIComponent(trackingNumber) : null;
}

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

adminRouter.get('/orders/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    const o = rows[0];
    res.json({
      success: true,
      data: {
        ...o,
        items: safeJson(o.items_json),
        shipping: safeJson(o.shipping_json)
      }
    });
  } catch (err) { next(err); }
});

// PUT /orders/:id/mark-paid — marca un pedido (típicamente transfer/Zelle o
// pendiente) como pagado: descuenta stock y dispara emails. Idempotente.
adminRouter.put('/orders/:id/mark-paid', async (req, res, next) => {
  try {
    const result = await markOrderPaid(Number(req.params.id));
    res.json({ success: true, data: result });
  } catch (err) {
    if (/no encontrado/i.test(err.message)) return res.status(404).json({ success: false, error: err.message });
    next(err);
  }
});

// PUT /orders/:id/fulfillment — actualiza estado de envío + carrier/tracking + notas.
// Body: { fulfillment_status, shipping_carrier?, shipping_method?, tracking_number?, tracking_url?, fulfillment_notes?, notify_customer? }
adminRouter.put('/orders/:id/fulfillment', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const target = String(body.fulfillment_status || '').toLowerCase();
    if (!FULFILLMENT_STATUSES.includes(target)) {
      return res.status(400).json({ success: false, error: `fulfillment_status inválido. Válidos: ${FULFILLMENT_STATUSES.join(', ')}` });
    }

    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    const order = rows[0];

    const current = order.fulfillment_status || 'unfulfilled';
    if (target !== current && !FULFILLMENT_TRANSITIONS[current].includes(target)) {
      return res.status(400).json({
        success: false,
        error: `Transición no permitida: ${current} → ${target}. Permitidas: ${FULFILLMENT_TRANSITIONS[current].join(', ') || '(ninguna, estado terminal)'}`
      });
    }

    const carrier = body.shipping_carrier ? String(body.shipping_carrier).toLowerCase().trim() : (order.shipping_carrier || null);
    const method  = body.shipping_method  != null ? String(body.shipping_method).trim() || null : order.shipping_method;
    const tracking = body.tracking_number != null ? String(body.tracking_number).trim() || null : order.tracking_number;
    const notes    = body.fulfillment_notes != null ? String(body.fulfillment_notes) : order.fulfillment_notes;

    if (target === 'shipped' && !tracking) {
      return res.status(400).json({ success: false, error: 'Para marcar enviado, el N° de tracking es obligatorio.' });
    }

    const trackingUrl = body.tracking_url != null
      ? (String(body.tracking_url).trim() || null)
      : buildTrackingUrl(carrier, tracking);

    const now = new Date();
    const shippedAt = target === 'shipped' && current !== 'shipped'
      ? now
      : (current === 'shipped' || target === 'shipped' || target === 'delivered' || target === 'returned'
          ? order.shipped_at
          : null);
    const deliveredAt = target === 'delivered' && current !== 'delivered'
      ? now
      : (target === 'returned' ? order.delivered_at : (target === 'delivered' ? order.delivered_at : (current === 'delivered' ? order.delivered_at : null)));

    await pool.execute(
      `UPDATE orders SET
         fulfillment_status = ?,
         shipping_carrier = ?,
         shipping_method = ?,
         tracking_number = ?,
         tracking_url = ?,
         fulfillment_notes = ?,
         shipped_at = ?,
         delivered_at = ?
       WHERE id = ?`,
      [target, carrier, method, tracking, trackingUrl, notes, shippedAt, deliveredAt, id]
    );

    const [updatedRows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [id]);
    const updated = updatedRows[0];

    let emailResult = { sent: false, reason: 'no solicitado' };
    if (body.notify_customer && target !== current && target !== 'unfulfilled') {
      emailResult = await sendFulfillmentUpdate({
        order: { ...updated, items: safeJson(updated.items_json) },
        status: target,
        carrier,
        trackingNumber: tracking,
        trackingUrl,
        method
      });
    }

    res.json({
      success: true,
      data: {
        ...updated,
        items: safeJson(updated.items_json),
        shipping: safeJson(updated.shipping_json)
      },
      email: emailResult
    });
  } catch (err) { next(err); }
});

// Backfill: recupera sesiones complete/paid de Stripe que no estén en la tabla orders.
// Body opcional: { session_id?: string, limit?: number, dry_run?: boolean }
adminRouter.post('/orders/backfill-stripe', async (req, res, next) => {
  try {
    if (!stripe) return res.status(503).json({ success: false, error: 'Stripe no configurado' });
    const body = req.body || {};
    const limit = Math.max(1, Math.min(100, Number(body.limit) || 50));
    const dryRun = !!body.dry_run;
    const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';

    let sessions;
    if (sessionId) {
      sessions = [await stripe.checkout.sessions.retrieve(sessionId)];
    } else {
      const list = await stripe.checkout.sessions.list({ limit });
      sessions = list.data;
    }

    const recovered = [];
    const skipped = [];
    for (const s of sessions) {
      if (s.status !== 'complete' || s.payment_status !== 'paid') {
        skipped.push({ id: s.id, reason: `status=${s.status}/payment=${s.payment_status}` });
        continue;
      }
      const [exists] = await pool.execute('SELECT id FROM orders WHERE stripe_session_id = ?', [s.id]);
      if (exists.length) {
        skipped.push({ id: s.id, reason: 'ya existe en DB' });
        continue;
      }

      const items = [];
      try {
        const parsed = JSON.parse(s.metadata?.items || '[]');
        for (const i of parsed) {
          const [prows] = await pool.execute('SELECT name, price_cents FROM products WHERE slug = ?', [i.s]);
          items.push({
            slug: i.s,
            name: prows[0]?.name || i.s,
            price_cents: prows[0]?.price_cents || 0,
            quantity: i.q
          });
        }
      } catch {}

      const record = {
        stripe_session_id: s.id,
        stripe_payment_intent: s.payment_intent || null,
        amount_total_cents: s.amount_total || 0,
        currency: (s.currency || 'usd').toLowerCase(),
        customer_email: s.customer_details?.email || null,
        customer_name: s.customer_details?.name || null,
        items,
        shipping: s.shipping_details || null,
        created_at: new Date(s.created * 1000).toISOString().slice(0, 19).replace('T', ' ')
      };

      if (!dryRun) {
        await pool.execute(
          `INSERT INTO orders
            (stripe_session_id, stripe_payment_intent, amount_total_cents, currency, status, items_json, customer_email, customer_name, shipping_json, created_at)
           VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?)`,
          [
            record.stripe_session_id,
            record.stripe_payment_intent,
            record.amount_total_cents,
            record.currency,
            JSON.stringify(record.items),
            record.customer_email,
            record.customer_name,
            JSON.stringify(record.shipping || {}),
            record.created_at
          ]
        );
      }
      recovered.push(record);
    }

    res.json({ success: true, data: { dry_run: dryRun, recovered, skipped } });
  } catch (err) { next(err); }
});

// Dispara el reporte diario manualmente (test). Body opcional: { date: 'YYYY-MM-DD' }
adminRouter.post('/reports/daily/send', async (req, res, next) => {
  try {
    const d = req.body?.date ? new Date(req.body.date + 'T12:00:00Z') : new Date();
    const report = await buildDailyReport(d);
    const r = await sendDailySalesReport(report);
    res.json({ success: true, data: { ...r, summary: { count: report.orders.length, totalCents: report.totalCents, date: report.dateLabel } } });
  } catch (err) { next(err); }
});

function safeJson(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

// ==== SUPPLIERS ====

function sanitizeSupplier(body) {
  const name = String(body.name || '').trim();
  if (!name) throw Object.assign(new Error('Nombre del proveedor requerido'), { statusCode: 400 });
  const url = String(body.website || '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    throw Object.assign(new Error('Website debe empezar con http:// o https://'), { statusCode: 400 });
  }
  return {
    name,
    tax_id: String(body.tax_id || '').trim() || null,
    contact: String(body.contact || '').trim() || null,
    payment_terms: String(body.payment_terms || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
    website: url || null,
    email: String(body.email || '').trim() || null,
    phone: String(body.phone || '').trim() || null,
    country: String(body.country || '').trim() || null,
    currency: String(body.currency || 'usd').trim().toLowerCase().slice(0, 8) || 'usd',
    shipping_in_invoice: body.shipping_in_invoice === false || body.shipping_in_invoice === 0 ? 0 : 1
  };
}

adminRouter.get('/suppliers', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchase_count,
              (SELECT COALESCE(SUM(total_cents), 0) FROM purchases p WHERE p.supplier_id = s.id) AS total_spent_cents,
              (SELECT MAX(issue_date) FROM purchases p WHERE p.supplier_id = s.id) AS last_purchase_date,
              (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id AND p.payment_status IN ('pendiente','parcial','vencido')) AS open_invoices
         FROM suppliers s
        ORDER BY s.name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

adminRouter.get('/suppliers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [supRows] = await pool.execute('SELECT * FROM suppliers WHERE id = ?', [id]);
    if (supRows.length === 0) return res.status(404).json({ success: false, error: 'Proveedor no encontrado' });
    const supplier = supRows[0];

    const [purchases] = await pool.execute(
      `SELECT p.*, (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS items_count
         FROM purchases p
        WHERE p.supplier_id = ?
        ORDER BY p.issue_date DESC, p.id DESC`,
      [id]
    );

    const [products] = await pool.execute(
      `SELECT DISTINCT pr.id, pr.slug, pr.name, pr.sku, pr.price_cents, pr.cost_cents, pr.stock, pr.active,
              (SELECT MAX(p.issue_date) FROM purchases p
                 JOIN purchase_items pi ON pi.purchase_id = p.id
                WHERE p.supplier_id = ? AND pi.product_id = pr.id) AS last_purchase_date,
              (SELECT SUM(pi.quantity) FROM purchases p
                 JOIN purchase_items pi ON pi.purchase_id = p.id
                WHERE p.supplier_id = ? AND pi.product_id = pr.id) AS total_purchased_qty
         FROM products pr
         JOIN purchase_items pi ON pi.product_id = pr.id
         JOIN purchases p ON p.id = pi.purchase_id
        WHERE p.supplier_id = ?
        ORDER BY pr.name ASC`,
      [id, id, id]
    );

    res.json({ success: true, data: { supplier, purchases, products } });
  } catch (err) { next(err); }
});

adminRouter.post('/suppliers', async (req, res, next) => {
  try {
    const s = sanitizeSupplier(req.body);
    const [result] = await pool.execute(
      `INSERT INTO suppliers (name, tax_id, contact, payment_terms, notes, website, email, phone, country, currency, shipping_in_invoice)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.name, s.tax_id, s.contact, s.payment_terms, s.notes, s.website, s.email, s.phone, s.country, s.currency, s.shipping_in_invoice]
    );
    const [rows] = await pool.execute('SELECT * FROM suppliers WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, error: 'Ya existe un proveedor con ese nombre' });
    next(e);
  }
});

adminRouter.put('/suppliers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [exists] = await pool.execute('SELECT id FROM suppliers WHERE id = ?', [id]);
    if (exists.length === 0) return res.status(404).json({ success: false, error: 'No encontrado' });
    const s = sanitizeSupplier(req.body);
    await pool.execute(
      `UPDATE suppliers
          SET name=?, tax_id=?, contact=?, payment_terms=?, notes=?,
              website=?, email=?, phone=?, country=?, currency=?, shipping_in_invoice=?
        WHERE id=?`,
      [s.name, s.tax_id, s.contact, s.payment_terms, s.notes, s.website, s.email, s.phone, s.country, s.currency, s.shipping_in_invoice, id]
    );
    const [rows] = await pool.execute('SELECT * FROM suppliers WHERE id = ?', [id]);
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, error: 'Ya existe un proveedor con ese nombre' });
    next(e);
  }
});

adminRouter.delete('/suppliers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM purchases WHERE supplier_id = ?', [id]);
    if (n > 0) return res.status(409).json({ success: false, error: `No se puede eliminar: tiene ${n} factura(s) registrada(s)` });
    const [result] = await pool.execute('DELETE FROM suppliers WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'No encontrado' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ==== PURCHASES (facturas de compra) ====

const PAYMENT_STATUSES = new Set(['pendiente', 'parcial', 'pagado', 'vencido', 'en_disputa']);

adminRouter.get('/purchases', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, s.name AS supplier_name,
              (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS items_count,
              CASE
                WHEN p.payment_status = 'pagado' THEN NULL
                WHEN p.due_date IS NULL THEN NULL
                ELSE DATEDIFF(p.due_date, CURDATE())
              END AS days_to_due
         FROM purchases p
         JOIN suppliers s ON s.id = p.supplier_id
        ORDER BY p.issue_date DESC, p.id DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

adminRouter.get('/purchases/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [pRows] = await pool.execute(
      `SELECT p.*, s.name AS supplier_name, s.website AS supplier_website
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.id = ?`,
      [id]
    );
    if (pRows.length === 0) return res.status(404).json({ success: false, error: 'Factura no encontrada' });

    const [items] = await pool.execute(
      `SELECT pi.*, pr.slug AS product_slug, pr.name AS product_name, pr.sku AS product_sku, pr.active AS product_active
         FROM purchase_items pi
         LEFT JOIN products pr ON pr.id = pi.product_id
        WHERE pi.purchase_id = ?
        ORDER BY pi.id ASC`,
      [id]
    );

    res.json({ success: true, data: { purchase: pRows[0], items } });
  } catch (err) { next(err); }
});

adminRouter.put('/purchases/:id/payment', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.payment_status || '').toLowerCase().trim();
    if (!PAYMENT_STATUSES.has(status)) {
      return res.status(400).json({ success: false, error: `Estado inválido. Válidos: ${[...PAYMENT_STATUSES].join(', ')}` });
    }
    const payment_date = req.body?.payment_date ? String(req.body.payment_date).slice(0, 10) : null;
    const [result] = await pool.execute(
      'UPDATE purchases SET payment_status = ?, payment_date = ? WHERE id = ?',
      [status, payment_date, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'No encontrada' });
    const [rows] = await pool.execute('SELECT * FROM purchases WHERE id = ?', [id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});
