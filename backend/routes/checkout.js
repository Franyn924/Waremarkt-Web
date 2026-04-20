import { Router } from 'express';
import Stripe from 'stripe';
import { pool, getSetting } from '../db/schema.js';

export const checkoutRouter = Router();

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

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
      `INSERT INTO orders (stripe_session_id, amount_total_cents, currency, status, items_json)
       VALUES (?, ?, ?, 'pending', ?)`,
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
