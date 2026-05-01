import nodemailer from 'nodemailer';
import { getAllSettings } from '../db/schema.js';

const { FRONTEND_URL, WHATSAPP_NUMBER } = process.env;

// Lee config SMTP desde la tabla settings (prioritaria) con fallback a env vars.
async function loadMailConfig() {
  let s = {};
  try { s = await getAllSettings(); } catch {}
  const host = s.smtp_host || process.env.SMTP_HOST || '';
  const port = Number(s.smtp_port || process.env.SMTP_PORT || 465);
  const user = s.smtp_user || process.env.SMTP_USER || '';
  const pass = s.smtp_pass || process.env.SMTP_PASS || '';
  const from = s.smtp_from || process.env.SMTP_FROM || user;
  const adminTo = s.admin_notify_email || process.env.ADMIN_NOTIFY_EMAIL || user;
  return {
    host, port, user, pass, from,
    adminTo,
    enabled: !!(host && user && pass)
  };
}

let cache = null;
let cacheAt = 0;
const CACHE_MS = 30_000;
async function getMailConfig(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cache && (now - cacheAt) < CACHE_MS) return cache;
  cache = await loadMailConfig();
  cacheAt = now;
  return cache;
}

export function invalidateMailerCache() { cache = null; cacheAt = 0; }

function buildTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });
}

export async function sendRaw(mailOptions, { forceRefresh = false } = {}) {
  const cfg = await getMailConfig(forceRefresh);
  if (!cfg.enabled) return { sent: false, reason: 'SMTP no configurado' };
  try {
    const info = await buildTransporter(cfg).sendMail({
      from: cfg.from,
      ...mailOptions
    });
    return { sent: true, messageId: info.messageId, config: { host: cfg.host, user: cfg.user } };
  } catch (err) {
    console.error('[mailer] sendRaw error:', err.message);
    return { sent: false, reason: err.message };
  }
}

export async function getAdminNotifyEmail() {
  return (await getMailConfig()).adminTo;
}

function money(cents, currency = 'usd') {
  const amount = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${amount} ${String(currency).toUpperCase()}`;
}

function escape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatShipping(ship) {
  if (!ship || !ship.address) return '';
  const a = ship.address;
  const parts = [
    ship.name,
    [a.line1, a.line2].filter(Boolean).join(', '),
    [a.city, a.state, a.postal_code].filter(Boolean).join(', '),
    a.country
  ].filter(Boolean);
  return parts.join('<br>');
}

function renderHtml({ orderNumber, items, subtotalCents, shippingCents, totalCents, currency, customerName, shippingHtml, discountCents, couponCode }) {
  const rows = items.map(i => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #eef2f6;">
        <div style="font-weight:600;color:#0A2E50;font-size:14px;">${escape(i.name)}</div>
        <div style="color:#6b7280;font-size:12px;margin-top:2px;">SKU: ${escape(i.sku || '—')}</div>
      </td>
      <td align="center" style="padding:12px 0;border-bottom:1px solid #eef2f6;color:#343A40;font-size:14px;">${i.quantity}</td>
      <td align="right" style="padding:12px 0;border-bottom:1px solid #eef2f6;color:#0A2E50;font-weight:600;font-size:14px;">${money(i.price_cents * i.quantity, currency)}</td>
    </tr>
  `).join('');

  const wa = WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hola! Consulta sobre mi pedido ' + orderNumber)}` : null;
  const site = FRONTEND_URL || 'https://waremarkt.com';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#343A40;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(10,46,80,0.08);">
        <tr><td style="background:linear-gradient(135deg,#0A2E50 0%,#173F69 100%);padding:32px 32px 28px;color:#ffffff;">
          <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:22px;letter-spacing:-0.5px;">WARE<span style="color:#3E9BFF;">MARKT</span></div>
          <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-top:4px;">Confirmación de pedido</div>
        </td></tr>

        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 8px;font-size:24px;color:#0A2E50;font-weight:700;">¡Gracias por tu compra${customerName ? ', ' + escape(customerName.split(' ')[0]) : ''}!</h1>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">Recibimos tu pedido y ya está en preparación. Te avisaremos en cuanto salga a envío.</p>

          <div style="background:#f6f8fb;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
            <div style="display:inline-block;width:49%;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:600;">N° de pedido</div>
              <div style="font-family:monospace;font-size:14px;color:#0A2E50;font-weight:600;margin-top:2px;">${escape(orderNumber)}</div>
            </div>
            <div style="display:inline-block;width:49%;vertical-align:top;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:600;">Estado</div>
              <div style="margin-top:4px;"><span style="display:inline-block;background:#FFF4D1;color:#8a6400;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;">En preparación</span></div>
            </div>
          </div>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <thead>
              <tr>
                <th align="left" style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding-bottom:8px;border-bottom:2px solid #0A2E50;">Producto</th>
                <th align="center" style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding-bottom:8px;border-bottom:2px solid #0A2E50;width:60px;">Cant.</th>
                <th align="right" style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding-bottom:8px;border-bottom:2px solid #0A2E50;width:100px;">Importe</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="right" style="padding:4px 0;color:#6b7280;font-size:13px;">Subtotal</td>
                <td align="right" width="100" style="padding:4px 0;color:#343A40;font-size:13px;">${money(subtotalCents, currency)}</td></tr>
            ${discountCents > 0 ? `<tr><td align="right" style="padding:4px 0;color:#0F6B2D;font-size:13px;font-weight:600;">Descuento${couponCode ? ' · <span style="font-family:monospace;background:#D6F5DB;padding:1px 6px;border-radius:4px;">' + escape(couponCode) + '</span>' : ''}</td>
                <td align="right" style="padding:4px 0;color:#0F6B2D;font-size:13px;font-weight:600;">−${money(discountCents, currency)}</td></tr>` : ''}
            ${shippingCents > 0 ? `<tr><td align="right" style="padding:4px 0;color:#6b7280;font-size:13px;">Envío</td>
                <td align="right" style="padding:4px 0;color:#343A40;font-size:13px;">${money(shippingCents, currency)}</td></tr>` : ''}
            <tr><td align="right" style="padding:12px 0 0;border-top:1px solid #eef2f6;color:#0A2E50;font-size:16px;font-weight:700;">Total pagado</td>
                <td align="right" style="padding:12px 0 0;border-top:1px solid #eef2f6;color:#0A2E50;font-size:18px;font-weight:700;">${money(totalCents, currency)}</td></tr>
          </table>

          ${shippingHtml ? `
          <div style="margin-top:28px;padding:20px;background:#f6f8fb;border-radius:12px;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:600;margin-bottom:8px;">Dirección de envío</div>
            <div style="color:#343A40;font-size:14px;line-height:1.6;">${shippingHtml}</div>
          </div>` : ''}

          <div style="margin-top:28px;padding:20px;background:linear-gradient(135deg,#FFC107 0%,#FB8F1A 100%);border-radius:12px;text-align:center;">
            <div style="font-size:13px;color:#07213A;font-weight:600;margin-bottom:8px;">¿Preguntas sobre tu pedido?</div>
            ${wa ? `<a href="${wa}" style="display:inline-block;background:#0A2E50;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 24px;border-radius:999px;">Escribínos por WhatsApp</a>` : ''}
          </div>
        </td></tr>

        <tr><td style="padding:24px 32px;background:#f6f8fb;text-align:center;color:#6b7280;font-size:12px;line-height:1.6;">
          <a href="${site}" style="color:#0A2E50;text-decoration:none;font-weight:600;">waremarkt.com</a><br>
          Soluciones logísticas inteligentes · US + LatAm<br>
          Este correo fue enviado porque realizaste una compra en Waremarkt.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function renderText({ orderNumber, items, subtotalCents, totalCents, currency, shippingText, discountCents, couponCode }) {
  const lines = items.map(i => `  • ${i.name} ${i.sku ? '(' + i.sku + ')' : ''} — ${i.quantity} × ${money(i.price_cents, currency)} = ${money(i.price_cents * i.quantity, currency)}`).join('\n');
  return [
    `¡Gracias por tu compra en Waremarkt!`,
    ``,
    `Pedido: ${orderNumber}`,
    `Estado: En preparación`,
    ``,
    `Productos:`,
    lines,
    ``,
    discountCents > 0 ? `Subtotal: ${money(subtotalCents, currency)}` : '',
    discountCents > 0 ? `Descuento${couponCode ? ' (' + couponCode + ')' : ''}: -${money(discountCents, currency)}` : '',
    `Total pagado: ${money(totalCents, currency)}`,
    shippingText ? `\nEnvío a:\n${shippingText}` : '',
    ``,
    `Te avisaremos en cuanto tu pedido salga a despacho.`,
    WHATSAPP_NUMBER ? `Consultas: WhatsApp +${WHATSAPP_NUMBER}` : '',
    ``,
    `— Waremarkt · ${FRONTEND_URL || 'waremarkt.com'}`
  ].filter(Boolean).join('\n');
}

export async function sendAdminOrderNotification({ order, stripeSession }) {
  const cfg = await getMailConfig();
  if (!cfg.enabled) return { sent: false, reason: 'SMTP no configurado' };
  if (!cfg.adminTo) return { sent: false, reason: 'sin admin_notify_email' };

  const items = Array.isArray(order.items) ? order.items : [];
  const currency = order.currency || stripeSession.currency || 'usd';
  const totalCents = order.amount_total_cents || stripeSession.amount_total || 0;
  const discountCents = Number(order.discount_cents) || 0;
  const couponCode = order.coupon_code || null;
  const orderNumber = `WM-${String(order.id || '').padStart(6, '0')}`;
  const email = stripeSession.customer_details?.email || order.customer_email || '—';
  const name = stripeSession.customer_details?.name || order.customer_name || '—';
  const ship = stripeSession.shipping_details || order.shipping;
  const shippingHtml = formatShipping(ship);
  const adminUrl = `${FRONTEND_URL || 'https://waremarkt.com'}/admin.html`;

  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eef2f6;color:#0A2E50;font-size:13px;">
        ${escape(i.name)} ${i.sku ? `<span style="color:#6b7280;font-size:11px;">(${escape(i.sku)})</span>` : ''}
      </td>
      <td align="center" style="padding:8px 0;border-bottom:1px solid #eef2f6;color:#343A40;font-size:13px;">${i.quantity}</td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid #eef2f6;color:#0A2E50;font-weight:600;font-size:13px;">${money(i.price_cents * i.quantity, currency)}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="560" cellpadding="0" cellspacing="0" align="center" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(10,46,80,0.06);">
    <tr><td style="background:#0A2E50;padding:20px 24px;color:#fff;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#FFC107;margin-bottom:4px;">Nueva venta</div>
      <div style="font-size:22px;font-weight:700;">${money(totalCents, currency)} · ${items.length} producto${items.length !== 1 ? 's' : ''}</div>
    </td></tr>
    <tr><td style="padding:24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        <tr><td style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding-bottom:4px;">Pedido</td>
            <td align="right" style="font-family:monospace;font-size:13px;color:#0A2E50;font-weight:600;">${escape(orderNumber)}</td></tr>
        <tr><td style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding:6px 0 4px;">Cliente</td>
            <td align="right" style="font-size:13px;color:#0A2E50;">${escape(name)}</td></tr>
        <tr><td colspan="2" align="right" style="font-size:12px;color:#6b7280;">${escape(email)}</td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0">
        <thead><tr>
          <th align="left" style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding-bottom:6px;border-bottom:2px solid #0A2E50;">Producto</th>
          <th align="center" style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding-bottom:6px;border-bottom:2px solid #0A2E50;width:50px;">Cant.</th>
          <th align="right" style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding-bottom:6px;border-bottom:2px solid #0A2E50;width:90px;">Importe</th>
        </tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      ${discountCents > 0 ? `
      <div style="margin-top:14px;padding:10px 14px;background:#D6F5DB;border-left:3px solid #0F6B2D;border-radius:6px;font-size:12px;color:#0F6B2D;">
        <strong>Cupón aplicado:</strong>
        ${couponCode ? `<span style="font-family:monospace;background:#fff;padding:1px 6px;border-radius:4px;margin-left:4px;">${escape(couponCode)}</span>` : ''}
        · Descuento: <strong>-${money(discountCents, currency)}</strong>
      </div>` : ''}
      ${shippingHtml ? `
      <div style="margin-top:20px;padding:14px 16px;background:#f6f8fb;border-radius:8px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:6px;">Envío</div>
        <div style="color:#343A40;font-size:13px;line-height:1.5;">${shippingHtml}</div>
      </div>` : ''}
      <div style="margin-top:20px;text-align:center;">
        <a href="${adminUrl}" style="display:inline-block;background:linear-gradient(135deg,#FFC107 0%,#FB8F1A 100%);color:#07213A;text-decoration:none;font-weight:700;font-size:13px;padding:10px 22px;border-radius:999px;">Ver en el panel</a>
      </div>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Nueva venta en Waremarkt`,
    ``,
    `Pedido: ${orderNumber}`,
    `Total: ${money(totalCents, currency)}`,
    `Cliente: ${name} <${email}>`,
    ``,
    `Items:`,
    ...items.map(i => `  • ${i.quantity}× ${i.name} ${i.sku ? '(' + i.sku + ')' : ''} = ${money(i.price_cents * i.quantity, currency)}`),
    ``,
    discountCents > 0 ? `Cupón: ${couponCode || '—'} (-${money(discountCents, currency)})` : '',
    `Panel: ${adminUrl}`
  ].filter(Boolean).join('\n');

  return sendRaw({
    to: cfg.adminTo,
    subject: `🔔 Nueva venta ${orderNumber} · ${money(totalCents, currency)}`,
    text,
    html
  });
}

export async function sendDailySalesReport({ dateLabel, orders, totalCents, currency, topItems }) {
  const cfg = await getMailConfig();
  if (!cfg.enabled) return { sent: false, reason: 'SMTP no configurado' };
  if (!cfg.adminTo) return { sent: false, reason: 'sin admin_notify_email' };

  const count = orders.length;
  const adminUrl = `${FRONTEND_URL || 'https://waremarkt.com'}/admin.html`;

  const ordersHtml = orders.map(o => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eef2f6;font-family:monospace;font-size:12px;color:#0A2E50;">WM-${String(o.id).padStart(6, '0')}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eef2f6;font-size:12px;color:#343A40;">${escape(o.customer_name || o.customer_email || '—')}</td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid #eef2f6;font-size:12px;color:#0A2E50;font-weight:600;">${money(o.amount_total_cents, o.currency)}</td>
    </tr>
  `).join('');

  const topHtml = (topItems || []).slice(0, 5).map((t, idx) => `
    <tr>
      <td style="padding:6px 0;color:#6b7280;font-size:12px;width:24px;">${idx + 1}.</td>
      <td style="padding:6px 0;color:#0A2E50;font-size:13px;">${escape(t.name)}</td>
      <td align="right" style="padding:6px 0;color:#343A40;font-size:12px;">${t.qty} ud.</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="600" cellpadding="0" cellspacing="0" align="center" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(10,46,80,0.06);">
    <tr><td style="background:linear-gradient(135deg,#0A2E50 0%,#173F69 100%);padding:24px;color:#fff;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.6);">Resumen diario</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">${escape(dateLabel)}</div>
    </td></tr>
    <tr><td style="padding:28px 24px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="50%" style="padding-right:8px;">
            <div style="background:#f6f8fb;border-radius:10px;padding:16px;">
              <div style="font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:1px;">Ventas</div>
              <div style="font-size:28px;font-weight:700;color:#0A2E50;margin-top:4px;">${count}</div>
            </div>
          </td>
          <td width="50%" style="padding-left:8px;">
            <div style="background:linear-gradient(135deg,#FFC107 0%,#FB8F1A 100%);border-radius:10px;padding:16px;">
              <div style="font-size:11px;text-transform:uppercase;color:#07213A;letter-spacing:1px;opacity:0.8;">Ingresos</div>
              <div style="font-size:24px;font-weight:700;color:#07213A;margin-top:4px;">${money(totalCents, currency)}</div>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>

    ${count > 0 ? `
    <tr><td style="padding:24px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:10px;font-weight:600;">Pedidos del día</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <thead><tr>
          <th align="left" style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding-bottom:6px;border-bottom:2px solid #0A2E50;">N°</th>
          <th align="left" style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding-bottom:6px;border-bottom:2px solid #0A2E50;">Cliente</th>
          <th align="right" style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding-bottom:6px;border-bottom:2px solid #0A2E50;">Total</th>
        </tr></thead>
        <tbody>${ordersHtml}</tbody>
      </table>
    </td></tr>` : `
    <tr><td style="padding:32px 24px;text-align:center;color:#6b7280;font-size:14px;">Sin ventas hoy. 💤</td></tr>`}

    ${topHtml ? `
    <tr><td style="padding:0 24px 24px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:10px;font-weight:600;">Productos más vendidos</div>
      <table width="100%" cellpadding="0" cellspacing="0">${topHtml}</table>
    </td></tr>` : ''}

    <tr><td style="padding:16px 24px;background:#f6f8fb;text-align:center;">
      <a href="${adminUrl}" style="color:#0A2E50;text-decoration:none;font-weight:600;font-size:13px;">Abrir panel →</a>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Resumen diario Waremarkt — ${dateLabel}`,
    ``,
    `Ventas: ${count}`,
    `Ingresos: ${money(totalCents, currency)}`,
    ``,
    count > 0 ? 'Pedidos:' : 'Sin ventas hoy.',
    ...orders.map(o => `  • WM-${String(o.id).padStart(6, '0')} — ${o.customer_name || o.customer_email || '—'} — ${money(o.amount_total_cents, o.currency)}`),
    ``,
    topItems && topItems.length ? 'Top productos:' : '',
    ...(topItems || []).slice(0, 5).map((t, i) => `  ${i + 1}. ${t.name} — ${t.qty} ud.`)
  ].filter(Boolean).join('\n');

  return sendRaw({
    to: cfg.adminTo,
    subject: `📊 Resumen Waremarkt — ${dateLabel} · ${count} venta${count !== 1 ? 's' : ''} · ${money(totalCents, currency)}`,
    text,
    html
  });
}

// Configuración por evento de fulfillment para el email al cliente
const FULFILLMENT_EMAIL = {
  preparing: {
    subject: orderNumber => `Tu pedido ${orderNumber} está en preparación`,
    headline: 'Tu pedido está en preparación',
    body: 'Estamos alistando tu pedido. Te avisaremos en cuanto salga a envío.',
    badge: { label: 'En preparación', bg: '#FFF4D1', color: '#8a6400' }
  },
  shipped: {
    subject: orderNumber => `Tu pedido ${orderNumber} está en camino`,
    headline: '¡Tu pedido salió a envío!',
    body: 'Tu pedido fue despachado y está en camino.',
    badge: { label: 'Enviado', bg: '#D4ECFF', color: '#0A2E50' }
  },
  delivered: {
    subject: orderNumber => `Tu pedido ${orderNumber} fue entregado`,
    headline: '¡Tu pedido fue entregado!',
    body: 'Tu pedido fue entregado. Esperamos que lo disfrutes.',
    badge: { label: 'Entregado', bg: '#D6F5DB', color: '#0F6B2D' }
  },
  canceled: {
    subject: orderNumber => `Tu pedido ${orderNumber} fue cancelado`,
    headline: 'Tu pedido fue cancelado',
    body: 'Tu pedido fue cancelado. Si tienes dudas, escribínos.',
    badge: { label: 'Cancelado', bg: '#FBD9D9', color: '#7A1F1F' }
  },
  returned: {
    subject: orderNumber => `Tu pedido ${orderNumber} fue marcado como devuelto`,
    headline: 'Tu pedido fue devuelto',
    body: 'Registramos la devolución de tu pedido.',
    badge: { label: 'Devuelto', bg: '#E5E7EB', color: '#374151' }
  }
};

const CARRIER_LABELS = {
  usps: 'USPS',
  ups: 'UPS',
  fedex: 'FedEx',
  dhl: 'DHL',
  local: 'Envío local',
  pickup: 'Retiro en tienda',
  other: 'Otro'
};

export async function sendFulfillmentUpdate({ order, status, carrier, trackingNumber, trackingUrl, method }) {
  const cfg = await getMailConfig();
  if (!cfg.enabled) return { sent: false, reason: 'SMTP no configurado' };

  const to = order.customer_email;
  if (!to) return { sent: false, reason: 'sin email del cliente' };

  const tpl = FULFILLMENT_EMAIL[status];
  if (!tpl) return { sent: false, reason: `sin template para status=${status}` };

  const orderNumber = `WM-${String(order.id || '').padStart(6, '0')}`;
  const customerName = order.customer_name || '';
  const carrierLabel = carrier ? (CARRIER_LABELS[carrier] || carrier) : null;
  const wa = WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hola! Consulta sobre mi pedido ' + orderNumber)}` : null;
  const site = FRONTEND_URL || 'https://waremarkt.com';

  const trackingBlock = (status === 'shipped' && trackingNumber) ? `
    <div style="margin-top:24px;padding:20px;background:#0A2E50;border-radius:12px;color:#fff;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#FFC107;font-weight:600;margin-bottom:6px;">Seguimiento</div>
      ${carrierLabel ? `<div style="font-size:13px;color:rgba(255,255,255,0.7);margin-bottom:4px;">Transportista: ${escape(carrierLabel)}${method ? ' · ' + escape(method) : ''}</div>` : ''}
      <div style="font-family:monospace;font-size:16px;font-weight:700;letter-spacing:1px;">${escape(trackingNumber)}</div>
      ${trackingUrl ? `<div style="margin-top:14px;"><a href="${trackingUrl}" style="display:inline-block;background:#FFC107;color:#07213A;text-decoration:none;font-weight:700;font-size:13px;padding:10px 22px;border-radius:999px;">Rastrear envío →</a></div>` : ''}
    </div>` : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#343A40;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(10,46,80,0.08);">
        <tr><td style="background:linear-gradient(135deg,#0A2E50 0%,#173F69 100%);padding:32px 32px 28px;color:#ffffff;">
          <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:22px;letter-spacing:-0.5px;">WARE<span style="color:#3E9BFF;">MARKT</span></div>
          <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-top:4px;">Actualización de tu pedido</div>
        </td></tr>

        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 8px;font-size:24px;color:#0A2E50;font-weight:700;">${escape(tpl.headline)}${customerName ? ', ' + escape(customerName.split(' ')[0]) : ''}</h1>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">${escape(tpl.body)}</p>

          <div style="background:#f6f8fb;border-radius:12px;padding:16px 20px;margin-bottom:8px;">
            <div style="display:inline-block;width:49%;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:600;">N° de pedido</div>
              <div style="font-family:monospace;font-size:14px;color:#0A2E50;font-weight:600;margin-top:2px;">${escape(orderNumber)}</div>
            </div>
            <div style="display:inline-block;width:49%;vertical-align:top;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:600;">Estado</div>
              <div style="margin-top:4px;"><span style="display:inline-block;background:${tpl.badge.bg};color:${tpl.badge.color};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;">${escape(tpl.badge.label)}</span></div>
            </div>
          </div>

          ${trackingBlock}

          <div style="margin-top:28px;padding:20px;background:linear-gradient(135deg,#FFC107 0%,#FB8F1A 100%);border-radius:12px;text-align:center;">
            <div style="font-size:13px;color:#07213A;font-weight:600;margin-bottom:8px;">¿Preguntas sobre tu pedido?</div>
            ${wa ? `<a href="${wa}" style="display:inline-block;background:#0A2E50;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 24px;border-radius:999px;">Escribínos por WhatsApp</a>` : ''}
          </div>
        </td></tr>

        <tr><td style="padding:24px 32px;background:#f6f8fb;text-align:center;color:#6b7280;font-size:12px;line-height:1.6;">
          <a href="${site}" style="color:#0A2E50;text-decoration:none;font-weight:600;">waremarkt.com</a><br>
          Soluciones logísticas inteligentes · US + LatAm
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    tpl.headline + (customerName ? ', ' + customerName.split(' ')[0] : '') + '!',
    '',
    tpl.body,
    '',
    `Pedido: ${orderNumber}`,
    `Estado: ${tpl.badge.label}`,
    (status === 'shipped' && trackingNumber) ? `\nTransportista: ${carrierLabel || '—'}${method ? ' · ' + method : ''}\nTracking: ${trackingNumber}${trackingUrl ? '\n' + trackingUrl : ''}` : '',
    '',
    WHATSAPP_NUMBER ? `Consultas: WhatsApp +${WHATSAPP_NUMBER}` : '',
    '',
    `— Waremarkt · ${FRONTEND_URL || 'waremarkt.com'}`
  ].filter(Boolean).join('\n');

  return sendRaw({
    to,
    subject: tpl.subject(orderNumber) + ' — Waremarkt',
    text,
    html
  });
}

export async function sendOrderConfirmation({ order, stripeSession }) {
  const cfg = await getMailConfig();
  if (!cfg.enabled) return { sent: false, reason: 'SMTP no configurado' };

  const to = stripeSession.customer_details?.email || order.customer_email;
  if (!to) return { sent: false, reason: 'sin email del cliente' };

  const items = Array.isArray(order.items) ? order.items : [];
  const currency = order.currency || stripeSession.currency || 'usd';
  const totalCents = order.amount_total_cents || stripeSession.amount_total || 0;
  const itemsSubtotal = items.reduce((s, i) => s + (i.price_cents || 0) * (i.quantity || 0), 0);
  const subtotalCents = stripeSession.amount_subtotal ?? itemsSubtotal;
  const discountCents = Number(order.discount_cents) || 0;
  const couponCode = order.coupon_code || null;
  // Calcula envío: total = subtotal − descuento + envío  ⇒  envío = total − (subtotal − descuento)
  const shippingCents = Math.max(0, totalCents - (subtotalCents - discountCents));

  const ship = stripeSession.shipping_details || order.shipping;
  const shippingHtml = formatShipping(ship);
  const shippingText = ship?.address
    ? `${ship.name || ''}\n${[ship.address.line1, ship.address.line2].filter(Boolean).join(', ')}\n${[ship.address.city, ship.address.state, ship.address.postal_code].filter(Boolean).join(', ')}\n${ship.address.country || ''}`.trim()
    : '';

  const orderNumber = `WM-${String(order.id || '').padStart(6, '0')}`;
  const customerName = stripeSession.customer_details?.name || order.customer_name || '';

  const html = renderHtml({ orderNumber, items, subtotalCents, shippingCents, totalCents, currency, customerName, shippingHtml, discountCents, couponCode });
  const text = renderText({ orderNumber, items, subtotalCents, totalCents, currency, shippingText, discountCents, couponCode });

  return sendRaw({
    to,
    subject: `Confirmación de pedido ${orderNumber} — Waremarkt`,
    text,
    html
  });
}
