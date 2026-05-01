import { Router, raw } from 'express';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import { pool, getAllSettings } from '../db/schema.js';
import { sendOrderConfirmation, sendAdminOrderNotification } from '../services/mailer.js';

export const webhookRouter = Router();

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// =============================================================================
// Helper compartido — marca order como paid, descuenta stock y dispara emails.
// Idempotente: si el order ya estaba en 'paid', no descuenta stock dos veces.
// =============================================================================
export async function markOrderPaid(orderId, { providerSession = null } = {}) {
  const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!rows.length) throw new Error(`Order ${orderId} no encontrado`);
  const o = rows[0];
  if (o.status === 'paid') return { alreadyPaid: true, order: o };

  let items = [];
  try { items = JSON.parse(o.items_json || '[]'); } catch {}

  await pool.execute("UPDATE orders SET status='paid' WHERE id = ?", [orderId]);
  for (const i of items) {
    if (i.slug && i.quantity) {
      await pool.execute(
        'UPDATE products SET stock = GREATEST(0, stock - ?) WHERE slug = ?',
        [i.quantity, i.slug]
      );
    }
  }

  // Enriquecer items con SKU para emails
  for (const it of items) {
    if (it.slug && !it.sku) {
      const [pr] = await pool.execute('SELECT sku FROM products WHERE slug = ?', [it.slug]);
      if (pr[0]?.sku) it.sku = pr[0].sku;
    }
  }
  let shippingParsed = null;
  try { shippingParsed = JSON.parse(o.shipping_json || 'null'); } catch {}

  const orderPayload = {
    order: {
      id: o.id,
      amount_total_cents: o.amount_total_cents,
      currency: o.currency,
      items,
      customer_email: o.customer_email,
      customer_name: o.customer_name,
      shipping: shippingParsed
    },
    stripeSession: providerSession || {
      customer_details: { email: o.customer_email, name: o.customer_name },
      shipping_details: shippingParsed,
      currency: o.currency,
      amount_total: o.amount_total_cents
    }
  };
  sendOrderConfirmation(orderPayload).catch(err => console.error('[webhook] customer mail error:', err.message));
  sendAdminOrderNotification(orderPayload).catch(err => console.error('[webhook] admin mail error:', err.message));

  return { alreadyPaid: false, order: { ...o, status: 'paid' } };
}

// =============================================================================
// STRIPE webhook
// =============================================================================
webhookRouter.post('/', raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    try {
      await pool.execute(
        `UPDATE orders
           SET stripe_payment_intent = ?,
               customer_email = ?,
               customer_name = ?,
               shipping_json = ?
         WHERE stripe_session_id = ?`,
        [
          s.payment_intent || null,
          s.customer_details?.email || null,
          s.customer_details?.name || null,
          JSON.stringify(s.shipping_details || {}),
          s.id
        ]
      );
      const [rows] = await pool.execute('SELECT id FROM orders WHERE stripe_session_id = ?', [s.id]);
      if (rows[0]) await markOrderPaid(rows[0].id, { providerSession: s });
    } catch (e) {
      console.error('[webhook] Stripe DB error:', e.message);
    }
  }

  res.json({ received: true });
});

// =============================================================================
// NOWPAYMENTS webhook (IPN) — verifica HMAC SHA-512 con `nowpayments_ipn_secret`
// El body crudo se ordena por keys (recursivamente) y se firma. Header: x-nowpayments-sig
// =============================================================================

function sortObjectKeys(obj) {
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortObjectKeys(obj[k]);
    return out;
  }
  return obj;
}

const NOWPAYMENTS_FINAL_PAID = new Set(['finished', 'confirmed']);
const NOWPAYMENTS_FINAL_FAILED = new Set(['failed', 'expired', 'refunded']);

webhookRouter.post('/nowpayments', raw({ type: 'application/json' }), async (req, res) => {
  try {
    const settings = await getAllSettings();
    const secret = settings.nowpayments_ipn_secret;
    if (!secret) {
      console.warn('[webhook nowpayments] sin ipn_secret configurado');
      return res.status(503).json({ error: 'NowPayments IPN no configurado' });
    }

    const sig = req.headers['x-nowpayments-sig'];
    if (!sig) return res.status(400).json({ error: 'Falta x-nowpayments-sig' });

    const raw = req.body; // Buffer (raw)
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); }
    catch { return res.status(400).json({ error: 'JSON inválido' }); }

    const sortedString = JSON.stringify(sortObjectKeys(payload));
    const expected = crypto.createHmac('sha512', secret).update(sortedString).digest('hex');
    if (expected !== String(sig)) {
      console.warn('[webhook nowpayments] HMAC inválido');
      return res.status(401).json({ error: 'Firma inválida' });
    }

    const orderId = Number(payload.order_id);
    const status = String(payload.payment_status || '').toLowerCase();
    if (!orderId) return res.status(400).json({ error: 'Falta order_id' });

    const updates = ['nowpayments_payment_id = ?'];
    const args = [String(payload.payment_id || '')];
    if (payload.pay_currency) { updates.push('pay_currency = ?'); args.push(String(payload.pay_currency)); }

    if (NOWPAYMENTS_FINAL_FAILED.has(status)) {
      updates.push("status = 'canceled'");
    }

    args.push(orderId);
    await pool.execute(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, args);

    if (NOWPAYMENTS_FINAL_PAID.has(status)) {
      await markOrderPaid(orderId);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[webhook nowpayments] error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});
