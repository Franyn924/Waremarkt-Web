import { Router } from 'express';
import Stripe from 'stripe';
import { db } from '../db/schema.js';

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

    const getProduct = db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1');
    const line_items = [];
    const orderItems = [];

    for (const { slug, quantity } of items) {
      const p = getProduct.get(slug);
      if (!p) return res.status(400).json({ success: false, error: `Producto no encontrado: ${slug}` });
      if (p.stock < quantity) return res.status(400).json({ success: false, error: `Stock insuficiente: ${p.name}` });

      line_items.push({
        price_data: {
          currency: 'usd',
          product_data: { name: p.name, description: p.brand ? `${p.brand} · ${p.category}` : p.category },
          unit_amount: p.price_cents
        },
        quantity: Math.max(1, Number(quantity) || 1)
      });
      orderItems.push({ slug: p.slug, name: p.name, price_cents: p.price_cents, quantity });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      payment_method_types: ['card'],
      shipping_address_collection: { allowed_countries: ['US', 'MX', 'CO', 'AR', 'PE', 'CL', 'EC', 'VE', 'UY', 'PY', 'BO', 'CR', 'PA', 'DO', 'GT', 'HN', 'SV', 'NI', 'PR'] },
      success_url: `${frontendUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/cancel.html`,
      metadata: { items: JSON.stringify(orderItems.map(i => ({ s: i.slug, q: i.quantity }))) }
    });

    const total = orderItems.reduce((s, i) => s + i.price_cents * i.quantity, 0);
    db.prepare(`
      INSERT INTO orders (stripe_session_id, amount_total_cents, status, items_json)
      VALUES (?, ?, 'pending', ?)
    `).run(session.id, total, JSON.stringify(orderItems));

    res.json({ success: true, data: { id: session.id, url: session.url } });
  } catch (err) { next(err); }
});

checkoutRouter.get('/session/:id', async (req, res, next) => {
  try {
    if (!stripe) return res.status(503).json({ success: false, error: 'Stripe no configurado' });
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    res.json({ success: true, data: { status: session.status, payment_status: session.payment_status, customer_email: session.customer_details?.email } });
  } catch (err) { next(err); }
});
