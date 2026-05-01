import { pool } from '../db/schema.js';

// =============================================================================
// Validación + cálculo de descuento para un carrito.
// Uso público: POST /api/coupons/validate; e interno desde checkout.
// =============================================================================

// Carga el cupón + sus items objetivo (productos / categorías).
export async function loadCoupon(code, conn = pool) {
  const [rows] = await conn.execute(
    'SELECT * FROM coupons WHERE code = ? LIMIT 1',
    [String(code).trim().toUpperCase()]
  );
  if (!rows.length) return null;
  const coupon = rows[0];
  const [items] = await conn.execute(
    'SELECT item_type, item_value FROM coupon_items WHERE coupon_id = ?',
    [coupon.id]
  );
  coupon.items = items;
  return coupon;
}

// Devuelve { ok: false, error } si no es aplicable, o { ok: true, ...detalle }.
// `cart` es un array de { slug, quantity, price_cents, category, name }.
// Si `cart` es null, valida solo metadatos (vigencia/usos) — útil para preview.
export function evaluateCoupon(coupon, cart) {
  if (!coupon) return { ok: false, error: 'Cupón no encontrado' };
  if (!coupon.active) return { ok: false, error: 'Cupón inactivo' };

  const now = Date.now();
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) {
    return { ok: false, error: 'Cupón aún no vigente' };
  }
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) {
    return { ok: false, error: 'Cupón vencido' };
  }
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
    return { ok: false, error: 'Cupón sin usos disponibles' };
  }

  if (!cart) return { ok: true, coupon };

  const subtotal = cart.reduce((s, i) => s + (i.price_cents || 0) * (i.quantity || 0), 0);
  if (coupon.min_order_cents && subtotal < coupon.min_order_cents) {
    return {
      ok: false,
      error: `Pedido mínimo de $${(coupon.min_order_cents / 100).toFixed(2)} para usar este cupón`
    };
  }

  // Determina qué líneas del carrito son elegibles para el descuento.
  const targets = coupon.items || [];
  let eligibleLines;
  if (coupon.applies_to === 'order' || targets.length === 0) {
    eligibleLines = cart;
  } else {
    const productSlugs = new Set(targets.filter(t => t.item_type === 'product').map(t => t.item_value));
    const categories  = new Set(targets.filter(t => t.item_type === 'category').map(t => t.item_value));
    eligibleLines = cart.filter(i => productSlugs.has(i.slug) || categories.has(i.category));
  }
  if (eligibleLines.length === 0) {
    return { ok: false, error: 'Ningún producto del carrito coincide con el cupón' };
  }

  const eligibleSubtotal = eligibleLines.reduce((s, i) => s + i.price_cents * i.quantity, 0);

  let discountCents = 0;
  if (coupon.discount_type === 'percent') {
    const pct = Number(coupon.discount_percent) || 0;
    discountCents = Math.round(eligibleSubtotal * pct / 100);
  } else if (coupon.discount_type === 'fixed') {
    discountCents = Math.min(Number(coupon.discount_cents) || 0, eligibleSubtotal);
  }
  discountCents = Math.max(0, Math.min(discountCents, eligibleSubtotal));

  return {
    ok: true,
    coupon,
    discount_cents: discountCents,
    eligible_subtotal_cents: eligibleSubtotal,
    eligible_slugs: eligibleLines.map(l => l.slug),
    subtotal_cents: subtotal,
    total_after_discount_cents: subtotal - discountCents
  };
}

// =============================================================================
// Preview de productos que se venderían en pérdida con el cupón propuesto.
// `coupon` es el objeto que se va a guardar (puede no existir aún en DB).
// Itera todos los productos activos elegibles según applies_to + items.
// =============================================================================
export async function previewLoss(coupon) {
  let where = 'p.active = 1';
  const args = [];

  if (coupon.applies_to !== 'order' && coupon.items?.length) {
    const productSlugs = coupon.items.filter(i => i.item_type === 'product').map(i => i.item_value);
    const categories   = coupon.items.filter(i => i.item_type === 'category').map(i => i.item_value);
    const conds = [];
    if (productSlugs.length) {
      conds.push(`p.slug IN (${productSlugs.map(() => '?').join(',')})`);
      args.push(...productSlugs);
    }
    if (categories.length) {
      conds.push(`p.category IN (${categories.map(() => '?').join(',')})`);
      args.push(...categories);
    }
    if (conds.length === 0) return { products: [], summary: { total: 0, in_loss: 0 } };
    where += ' AND (' + conds.join(' OR ') + ')';
  }

  const [products] = await pool.query(
    `SELECT id, slug, name, category, price_cents, cost_cents, stock
       FROM products p
      WHERE ${where}`,
    args
  );

  const out = [];
  for (const p of products) {
    if (p.cost_cents == null) continue; // sin costo registrado, no se puede evaluar
    let finalPrice = p.price_cents;
    if (coupon.discount_type === 'percent') {
      finalPrice = Math.round(p.price_cents * (1 - Number(coupon.discount_percent) / 100));
    } else if (coupon.discount_type === 'fixed') {
      // Worst case: el descuento fijo entero recae en este producto
      finalPrice = Math.max(0, p.price_cents - Number(coupon.discount_cents || 0));
    }
    if (finalPrice < p.cost_cents) {
      out.push({
        id: p.id,
        slug: p.slug,
        name: p.name,
        category: p.category,
        cost_cents: p.cost_cents,
        price_cents: p.price_cents,
        final_price_cents: finalPrice,
        loss_cents: p.cost_cents - finalPrice,
        stock: p.stock
      });
    }
  }

  return {
    products: out.sort((a, b) => b.loss_cents - a.loss_cents),
    summary: {
      total: products.length,
      in_loss: out.length
    }
  };
}

// Incrementa uses_count cuando un order con cupón se marca pagado.
export async function incrementCouponUse(couponId, conn = pool) {
  if (!couponId) return;
  await conn.execute('UPDATE coupons SET uses_count = uses_count + 1 WHERE id = ?', [couponId]);
}
