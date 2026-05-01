import { Router } from 'express';
import { pool } from '../db/schema.js';
import { loadCoupon, evaluateCoupon } from '../services/coupons.js';

export const couponsRouter = Router();

// POST /api/coupons/validate { code, items: [{slug, quantity}] }
// Devuelve descuento aplicable al carrito, o error si no aplica.
couponsRouter.post('/validate', async (req, res, next) => {
  try {
    const code = String(req.body?.code || '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!code) return res.status(400).json({ success: false, error: 'Falta el código' });
    if (items.length === 0) return res.status(400).json({ success: false, error: 'Carrito vacío' });

    const coupon = await loadCoupon(code);
    if (!coupon) return res.status(404).json({ success: false, error: 'Cupón inválido' });

    // Enriquece items con price_cents y category desde la BD
    const enriched = [];
    for (const { slug, quantity } of items) {
      const [rows] = await pool.execute(
        'SELECT slug, name, price_cents, category FROM products WHERE slug = ? AND active = 1',
        [slug]
      );
      if (!rows.length) continue;
      enriched.push({ ...rows[0], quantity: Math.max(1, Number(quantity) || 1) });
    }
    if (enriched.length === 0) return res.status(400).json({ success: false, error: 'Productos no encontrados' });

    const result = evaluateCoupon(coupon, enriched);
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });

    res.json({
      success: true,
      data: {
        code: coupon.code,
        coupon_id: coupon.id,
        description: coupon.description,
        discount_cents: result.discount_cents,
        eligible_subtotal_cents: result.eligible_subtotal_cents,
        eligible_slugs: result.eligible_slugs,
        subtotal_cents: result.subtotal_cents,
        total_after_discount_cents: result.total_after_discount_cents,
        applies_to: coupon.applies_to,
        discount_type: coupon.discount_type,
        discount_percent: coupon.discount_percent,
        discount_fixed_cents: coupon.discount_cents
      }
    });
  } catch (err) { next(err); }
});
