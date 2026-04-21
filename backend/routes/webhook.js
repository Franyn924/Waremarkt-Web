import { Router, raw } from 'express';
import Stripe from 'stripe';
import { pool } from '../db/schema.js';
import { sendOrderConfirmation } from '../services/mailer.js';

export const webhookRouter = Router();

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

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
         SET status = 'paid',
             stripe_payment_intent = ?,
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

      const items = JSON.parse(s.metadata?.items || '[]');
      for (const i of items) {
        await pool.execute(
          'UPDATE products SET stock = GREATEST(0, stock - ?) WHERE slug = ?',
          [i.q, i.s]
        );
      }

      // Email de confirmación al cliente
      const [orderRows] = await pool.execute(
        'SELECT id, amount_total_cents, currency, items_json, customer_email, customer_name, shipping_json FROM orders WHERE stripe_session_id = ?',
        [s.id]
      );
      if (orderRows[0]) {
        const o = orderRows[0];
        let itemsParsed = [];
        try { itemsParsed = JSON.parse(o.items_json || '[]'); } catch {}
        // Enriquecer con SKU desde productos
        for (const it of itemsParsed) {
          if (it.slug) {
            const [pr] = await pool.execute('SELECT sku FROM products WHERE slug = ?', [it.slug]);
            if (pr[0]?.sku) it.sku = pr[0].sku;
          }
        }
        let shippingParsed = null;
        try { shippingParsed = JSON.parse(o.shipping_json || 'null'); } catch {}
        sendOrderConfirmation({
          order: {
            id: o.id,
            amount_total_cents: o.amount_total_cents,
            currency: o.currency,
            items: itemsParsed,
            customer_email: o.customer_email,
            customer_name: o.customer_name,
            shipping: shippingParsed
          },
          stripeSession: s
        }).catch(err => console.error('[webhook] mail error:', err.message));
      }
    } catch (e) {
      console.error('[webhook] DB error:', e.message);
    }
  }

  res.json({ received: true });
});
