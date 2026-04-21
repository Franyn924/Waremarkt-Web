import nodemailer from 'nodemailer';

const {
  SMTP_HOST,
  SMTP_PORT = '465',
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  FRONTEND_URL,
  WHATSAPP_NUMBER
} = process.env;

export const MAILER_ENABLED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

const transporter = MAILER_ENABLED
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    })
  : null;

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

function renderHtml({ orderNumber, items, subtotalCents, shippingCents, totalCents, currency, customerName, shippingHtml }) {
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

function renderText({ orderNumber, items, totalCents, currency, shippingText }) {
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
    `Total pagado: ${money(totalCents, currency)}`,
    shippingText ? `\nEnvío a:\n${shippingText}` : '',
    ``,
    `Te avisaremos en cuanto tu pedido salga a despacho.`,
    `Consultas: ${WHATSAPP_NUMBER ? 'WhatsApp +' + WHATSAPP_NUMBER : (SMTP_FROM || SMTP_USER)}`,
    ``,
    `— Waremarkt · ${FRONTEND_URL || 'waremarkt.com'}`
  ].filter(Boolean).join('\n');
}

export async function sendOrderConfirmation({ order, stripeSession }) {
  if (!MAILER_ENABLED) {
    console.warn('[mailer] SMTP no configurado, skip envío de confirmación');
    return { sent: false, reason: 'SMTP no configurado' };
  }

  const to = stripeSession.customer_details?.email || order.customer_email;
  if (!to) return { sent: false, reason: 'sin email del cliente' };

  const items = Array.isArray(order.items) ? order.items : [];
  const currency = order.currency || stripeSession.currency || 'usd';
  const totalCents = order.amount_total_cents || stripeSession.amount_total || 0;
  const subtotalCents = stripeSession.amount_subtotal ?? items.reduce((s, i) => s + (i.price_cents || 0) * (i.quantity || 0), 0);
  const shippingCents = Math.max(0, totalCents - subtotalCents);

  const ship = stripeSession.shipping_details || order.shipping;
  const shippingHtml = formatShipping(ship);
  const shippingText = ship?.address
    ? `${ship.name || ''}\n${[ship.address.line1, ship.address.line2].filter(Boolean).join(', ')}\n${[ship.address.city, ship.address.state, ship.address.postal_code].filter(Boolean).join(', ')}\n${ship.address.country || ''}`.trim()
    : '';

  const orderNumber = `WM-${String(order.id || '').padStart(6, '0')}`;
  const customerName = stripeSession.customer_details?.name || order.customer_name || '';

  const html = renderHtml({ orderNumber, items, subtotalCents, shippingCents, totalCents, currency, customerName, shippingHtml });
  const text = renderText({ orderNumber, items, totalCents, currency, shippingText });

  try {
    const info = await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to,
      subject: `Confirmación de pedido ${orderNumber} — Waremarkt`,
      text,
      html
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mailer] Error enviando confirmación:', err.message);
    return { sent: false, reason: err.message };
  }
}
