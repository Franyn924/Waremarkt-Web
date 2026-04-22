import cron from 'node-cron';
import { pool } from '../db/schema.js';
import { sendDailySalesReport } from './mailer.js';

const TIMEZONE = process.env.REPORT_TIMEZONE || 'America/New_York';
const CRON_EXPR = process.env.REPORT_CRON || '0 18 * * *';

export async function buildDailyReport(date = new Date()) {
  const tz = TIMEZONE;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(date);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  const dayStart = `${y}-${m}-${d} 00:00:00`;
  const dayEnd = `${y}-${m}-${d} 23:59:59`;

  const [orders] = await pool.query(
    `SELECT id, amount_total_cents, currency, items_json, customer_email, customer_name, created_at
     FROM orders
     WHERE status = 'paid' AND created_at BETWEEN ? AND ?
     ORDER BY created_at ASC`,
    [dayStart, dayEnd]
  );

  const totalCents = orders.reduce((s, o) => s + (o.amount_total_cents || 0), 0);
  const currency = orders[0]?.currency || 'usd';

  const qtyBySlug = {};
  for (const o of orders) {
    let items = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch {}
    for (const it of items) {
      const key = it.slug || it.name;
      if (!qtyBySlug[key]) qtyBySlug[key] = { name: it.name || key, qty: 0 };
      qtyBySlug[key].qty += Number(it.quantity) || 0;
    }
  }
  const topItems = Object.values(qtyBySlug).sort((a, b) => b.qty - a.qty);

  const dateLabel = new Intl.DateTimeFormat('es-US', {
    timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }).format(date);

  return { dateLabel, orders, totalCents, currency, topItems };
}

export function startDailyReportCron() {
  if (!cron.validate(CRON_EXPR)) {
    console.error(`[dailyReport] cron inválido: ${CRON_EXPR}`);
    return;
  }
  cron.schedule(CRON_EXPR, async () => {
    try {
      const report = await buildDailyReport();
      const res = await sendDailySalesReport(report);
      console.log(`[dailyReport] ${CRON_EXPR} (${TIMEZONE}) · ${report.orders.length} ventas · enviado=${res.sent}`);
      if (!res.sent) console.warn(`[dailyReport] motivo: ${res.reason}`);
    } catch (err) {
      console.error('[dailyReport] error:', err.message);
    }
  }, { timezone: TIMEZONE });
  console.log(`  Daily report  · cron "${CRON_EXPR}" (${TIMEZONE})`);
}
