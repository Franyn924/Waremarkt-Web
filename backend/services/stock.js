import cron from 'node-cron';
import { pool } from '../db/schema.js';

const TIMEZONE = process.env.STOCK_TIMEZONE || process.env.REPORT_TIMEZONE || 'America/New_York';
// Fin del día (23:55) — desactiva productos cuyo sold_out_at tiene >24h
const SOLDOUT_CRON = process.env.SOLDOUT_DEACTIVATE_CRON || '55 23 * * *';

const SOLDOUT_BADGE = 'Vendido';

// Aplicar efectos de transición de stock para un producto:
// - 0  → Si sold_out_at es null y producto activo → setea badge='Vendido' + sold_out_at=NOW()
// - >0 → Si sold_out_at no es null → limpia sold_out_at; si badge='Vendido' lo limpia también
// Idempotente: si ya está en el estado correcto, no hace nada.
export async function applyStockTransitionEffects(productIdOrSlug, conn = pool) {
  const isId = typeof productIdOrSlug === 'number';
  const where = isId ? 'id = ?' : 'slug = ?';
  const [rows] = await conn.execute(
    `SELECT id, stock, badge, sold_out_at, active FROM products WHERE ${where}`,
    [productIdOrSlug]
  );
  if (!rows.length) return null;
  const p = rows[0];

  if (p.stock <= 0 && p.sold_out_at == null && p.active === 1) {
    await conn.execute(
      "UPDATE products SET badge = ?, sold_out_at = NOW() WHERE id = ?",
      [SOLDOUT_BADGE, p.id]
    );
    return { id: p.id, transition: 'sold_out' };
  }

  if (p.stock > 0 && p.sold_out_at != null) {
    await conn.execute(
      `UPDATE products SET sold_out_at = NULL,
         badge = CASE WHEN badge = ? THEN NULL ELSE badge END
       WHERE id = ?`,
      [SOLDOUT_BADGE, p.id]
    );
    return { id: p.id, transition: 'restocked' };
  }

  return { id: p.id, transition: 'noop' };
}

// Desactiva productos vendidos que llevan >24h con sold_out_at.
// Idempotente y seguro de llamar varias veces.
export async function deactivateAgedSoldOuts() {
  const [result] = await pool.query(
    `UPDATE products
        SET active = 0
      WHERE active = 1
        AND sold_out_at IS NOT NULL
        AND sold_out_at < NOW() - INTERVAL 24 HOUR`
  );
  return { deactivated: result.affectedRows };
}

export function startSoldOutCron() {
  if (!cron.validate(SOLDOUT_CRON)) {
    console.error(`[soldOut] cron inválido: ${SOLDOUT_CRON}`);
    return;
  }
  cron.schedule(SOLDOUT_CRON, async () => {
    try {
      const r = await deactivateAgedSoldOuts();
      console.log(`[soldOut] ${SOLDOUT_CRON} (${TIMEZONE}) · desactivados=${r.deactivated}`);
    } catch (err) {
      console.error('[soldOut] error:', err.message);
    }
  }, { timezone: TIMEZONE });
  console.log(`  Sold-out      · cron "${SOLDOUT_CRON}" (${TIMEZONE})`);
}
