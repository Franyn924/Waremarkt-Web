import { Router } from 'express';
import Stripe from 'stripe';
import { pool, getSetting, getAllSettings } from '../db/schema.js';

export const checkoutRouter = Router();

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// =============================================================================
// Helpers compartidos: valida items contra DB, valida customer, calcula total.
// Usado por checkout/transfer y checkout/nowpayments (Stripe va por su API).
// =============================================================================

function sanitizeCustomer(c) {
  if (!c || typeof c !== 'object') throw new Error('Datos del cliente requeridos');
  const name  = String(c.name  || '').trim();
  const email = String(c.email || '').trim().toLowerCase();
  const phone = String(c.phone || '').trim();
  const a = c.address || {};
  const line1 = String(a.line1 || '').trim();
  const city  = String(a.city  || '').trim();
  const postal_code = String(a.postal_code || '').trim();
  const country = String(a.country || '').trim().toUpperCase();
  if (!name)  throw new Error('Nombre requerido');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email inválido');
  if (!phone) throw new Error('Teléfono requerido');
  if (!line1) throw new Error('Dirección (línea 1) requerida');
  if (!city)  throw new Error('Ciudad requerida');
  if (!postal_code) throw new Error('Código postal requerido');
  if (!country) throw new Error('País requerido');
  return {
    name, email, phone,
    address: {
      line1,
      line2: String(a.line2 || '').trim() || null,
      city,
      state: String(a.state || '').trim() || null,
      postal_code,
      country
    }
  };
}

async function resolveCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Carrito vacío');
  const orderItems = [];
  for (const { slug, quantity } of items) {
    const qty = Math.max(1, Number(quantity) || 1);
    const [rows] = await pool.execute('SELECT * FROM products WHERE slug = ? AND active = 1', [slug]);
    const p = rows[0];
    if (!p) throw new Error(`Producto no encontrado: ${slug}`);
    if (p.stock < qty) throw new Error(`Stock insuficiente: ${p.name}`);
    orderItems.push({ slug: p.slug, name: p.name, price_cents: p.price_cents, quantity: qty, sku: p.sku || null });
  }
  const subtotal = orderItems.reduce((s, i) => s + i.price_cents * i.quantity, 0);
  return { orderItems, subtotal };
}

function shippingDetailsFromCustomer(c) {
  return {
    name: c.name,
    phone: c.phone,
    address: c.address
  };
}

function orderNumber(id) {
  return `WM-${String(id).padStart(6, '0')}`;
}

// =============================================================================
// STRIPE — flujo existente (sin cambios funcionales)
// =============================================================================

checkoutRouter.post('/session', async (req, res, next) => {
  try {
    if (!stripe) {
      return res.status(503).json({
        success: false,
        error: 'Stripe no configurado. Falta STRIPE_SECRET_KEY en .env'
      });
    }

    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Carrito vacío' });
    }

    const currency = ((await getSetting('currency', 'usd')) || 'usd').toLowerCase();
    const taxEnabled = (await getSetting('tax_enabled', '0')) === '1';
    const taxBehavior = (await getSetting('tax_behavior', 'exclusive')) === 'inclusive' ? 'inclusive' : 'exclusive';
    const shippingFlat = Math.max(0, Number(await getSetting('shipping_flat_cents', '0')) || 0);
    const successPath = (await getSetting('checkout_success_url', '/success.html')) || '/success.html';
    const cancelPath = (await getSetting('checkout_cancel_url', '/cancel.html')) || '/cancel.html';

    const line_items = [];
    const orderItems = [];

    for (const { slug, quantity } of items) {
      const [rows] = await pool.execute('SELECT * FROM products WHERE slug = ? AND active = 1', [slug]);
      const p = rows[0];
      if (!p) return res.status(400).json({ success: false, error: `Producto no encontrado: ${slug}` });
      if (p.stock < quantity) return res.status(400).json({ success: false, error: `Stock insuficiente: ${p.name}` });

      const product_data = { name: p.name, description: p.brand ? `${p.brand} · ${p.category}` : p.category };
      if (taxEnabled) product_data.tax_code = 'txcd_99999999';
      const price_data = { currency, product_data, unit_amount: p.price_cents };
      if (taxEnabled) price_data.tax_behavior = taxBehavior;

      line_items.push({
        price_data,
        quantity: Math.max(1, Number(quantity) || 1)
      });
      orderItems.push({ slug: p.slug, name: p.name, price_cents: p.price_cents, quantity });
    }

    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;

    const sessionPayload = {
      mode: 'payment',
      line_items,
      payment_method_types: ['card'],
      shipping_address_collection: { allowed_countries: ['US', 'MX', 'CO', 'AR', 'PE', 'CL', 'EC', 'VE', 'UY', 'PY', 'BO', 'CR', 'PA', 'DO', 'GT', 'HN', 'SV', 'NI', 'PR'] },
      success_url: `${frontendUrl}${successPath}${successPath.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}${cancelPath}`,
      metadata: { items: JSON.stringify(orderItems.map(i => ({ s: i.slug, q: i.quantity }))) }
    };

    if (taxEnabled) sessionPayload.automatic_tax = { enabled: true };

    if (shippingFlat > 0) {
      sessionPayload.shipping_options = [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: shippingFlat, currency },
          display_name: 'Envío estándar',
          tax_behavior: taxEnabled ? taxBehavior : undefined,
          tax_code: taxEnabled ? 'txcd_92010001' : undefined
        }
      }];
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);

    const total = orderItems.reduce((s, i) => s + i.price_cents * i.quantity, 0);
    await pool.execute(
      `INSERT INTO orders (stripe_session_id, payment_provider, amount_total_cents, currency, status, items_json)
       VALUES (?, 'stripe', ?, ?, 'pending', ?)`,
      [session.id, total, currency, JSON.stringify(orderItems)]
    );

    res.json({ success: true, data: { id: session.id, url: session.url } });
  } catch (err) { next(err); }
});

checkoutRouter.get('/session/:id', async (req, res, next) => {
  try {
    if (!stripe) return res.status(503).json({ success: false, error: 'Stripe no configurado' });
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    res.json({
      success: true,
      data: {
        status: session.status,
        payment_status: session.payment_status,
        customer_email: session.customer_details?.email
      }
    });
  } catch (err) { next(err); }
});

// =============================================================================
// TRANSFERENCIA / Zelle — crea order pending_transfer y devuelve instrucciones
// =============================================================================

checkoutRouter.post('/transfer', async (req, res, next) => {
  try {
    const { items, customer } = req.body || {};
    const cust = sanitizeCustomer(customer);
    const { orderItems, subtotal } = await resolveCart(items);
    const settings = await getAllSettings();
    const currency = (settings.currency || 'usd').toLowerCase();

    const [result] = await pool.execute(
      `INSERT INTO orders
         (payment_provider, amount_total_cents, currency, status, items_json,
          customer_email, customer_name, customer_phone, shipping_json)
       VALUES ('transfer', ?, ?, 'pending_transfer', ?, ?, ?, ?, ?)`,
      [
        subtotal,
        currency,
        JSON.stringify(orderItems),
        cust.email,
        cust.name,
        cust.phone,
        JSON.stringify(shippingDetailsFromCustomer(cust))
      ]
    );

    res.json({
      success: true,
      data: {
        order_id: result.insertId,
        order_number: orderNumber(result.insertId),
        total_cents: subtotal,
        currency,
        instructions: {
          zelle_email: settings.zelle_email || '',
          zelle_phone: settings.zelle_phone || '',
          zelle_account_holder: settings.zelle_account_holder || '',
          transfer_instructions: settings.transfer_instructions || '',
          whatsapp_number: settings.whatsapp_number || ''
        }
      }
    });
  } catch (err) {
    if (err.message && err.statusCode == null) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

// =============================================================================
// NOWPAYMENTS (cripto) — crea order pending y devuelve invoice_url
// =============================================================================

const NOWPAYMENTS_BASE_LIVE = 'https://api.nowpayments.io/v1';
const NOWPAYMENTS_BASE_SANDBOX = 'https://api-sandbox.nowpayments.io/v1';

checkoutRouter.post('/nowpayments', async (req, res, next) => {
  try {
    const settings = await getAllSettings();
    if (settings.nowpayments_enabled !== '1') {
      return res.status(503).json({ success: false, error: 'NowPayments deshabilitado en Ajustes' });
    }
    if (!settings.nowpayments_api_key) {
      return res.status(503).json({ success: false, error: 'Falta NowPayments API key en Ajustes' });
    }

    const { items, customer } = req.body || {};
    const cust = sanitizeCustomer(customer);
    const { orderItems, subtotal } = await resolveCart(items);
    const currency = (settings.currency || 'usd').toLowerCase();

    const [result] = await pool.execute(
      `INSERT INTO orders
         (payment_provider, amount_total_cents, currency, status, items_json,
          customer_email, customer_name, customer_phone, shipping_json)
       VALUES ('nowpayments', ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [
        subtotal,
        currency,
        JSON.stringify(orderItems),
        cust.email,
        cust.name,
        cust.phone,
        JSON.stringify(shippingDetailsFromCustomer(cust))
      ]
    );
    const orderId = result.insertId;

    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const successPath = settings.checkout_success_url || '/success.html';
    const cancelPath = settings.checkout_cancel_url || '/cancel.html';
    const sandbox = settings.nowpayments_sandbox === '1';
    const base = sandbox ? NOWPAYMENTS_BASE_SANDBOX : NOWPAYMENTS_BASE_LIVE;

    const invoicePayload = {
      price_amount: Number((subtotal / 100).toFixed(2)),
      price_currency: currency,
      order_id: String(orderId),
      order_description: `Waremarkt ${orderNumber(orderId)} — ${orderItems.length} producto(s)`,
      ipn_callback_url: `${frontendUrl}/api/webhook/nowpayments`,
      success_url: `${frontendUrl}${successPath}${successPath.includes('?') ? '&' : '?'}order_id=${orderId}&provider=nowpayments`,
      cancel_url: `${frontendUrl}${cancelPath}?order_id=${orderId}`
    };

    let invoice;
    try {
      const r = await fetch(`${base}/invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.nowpayments_api_key
        },
        body: JSON.stringify(invoicePayload)
      });
      const text = await r.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
      if (!r.ok) {
        // Marcar el order como cancelado para no dejar zombi
        await pool.execute("UPDATE orders SET status='canceled', fulfillment_notes=? WHERE id=?",
          [`NowPayments invoice falló: ${text.slice(0, 200)}`, orderId]);
        return res.status(502).json({ success: false, error: `NowPayments rechazó la factura: ${json?.message || text.slice(0, 200)}` });
      }
      invoice = json;
    } catch (e) {
      await pool.execute("UPDATE orders SET status='canceled', fulfillment_notes=? WHERE id=?",
        [`NowPayments inalcanzable: ${e.message}`, orderId]);
      return res.status(502).json({ success: false, error: `No se pudo contactar NowPayments: ${e.message}` });
    }

    if (invoice?.id) {
      await pool.execute(
        'UPDATE orders SET nowpayments_invoice_id = ? WHERE id = ?',
        [String(invoice.id), orderId]
      );
    }

    res.json({
      success: true,
      data: {
        order_id: orderId,
        order_number: orderNumber(orderId),
        invoice_url: invoice?.invoice_url || null,
        invoice_id: invoice?.id || null,
        sandbox
      }
    });
  } catch (err) {
    if (err.message && err.statusCode == null) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});
