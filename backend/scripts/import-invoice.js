// Importa una factura de compra al sistema (suppliers + purchases + purchase_items
// + UPSERT en products). Idempotente: si la factura ya existe, no hace nada.
//
// Uso:  node scripts/import-invoice.js
//
// Para procesar otra factura, edita el objeto INVOICE de abajo o adapta el script
// para que reciba la data como JSON.

import 'dotenv/config';
import { pool, initDb } from '../db/schema.js';

// =====================================================================
// Datos de la factura — EDITAR ESTA SECCIÓN PARA CADA NUEVA FACTURA
// =====================================================================
const INVOICE = {
  supplier: {
    name: '888 Digital Inc (888lots)',
    tax_id: null,
    contact: 'contact@888lots.com | 1-844-888-5687 | 1416 East Linden Ave, Linden, NJ 07036',
    payment_terms: 'Pago al ordenar',
    notes: 'Proveedor US. Envío incluido en factura. Líneas con qty 0 → pedido pero no enviado (ignorar).'
  },
  purchase: {
    invoice_number: 'WI0290109',
    issue_date: '2026-01-21',
    due_date: null,
    currency: 'usd',
    subtotal_cents: 8400,    // $84.00
    tax_cents: 0,
    shipping_cents: 300,     // $3.00
    total_cents: 8700,       // $87.00
    payment_status: 'pagado',
    payment_date: '2026-01-21',
    notes: 'Web Order 2689271050. Productos pre-creados con UPC como SKU; se vinculan por id sin modificar stock (ya cargado manualmente).'
  },
  items: [
    {
      supplier_sku: 'B0C426QPDX',
      link_to_product_id: 2,
      update_stock: false,
      name: 'Wyze Cam Pan v3 Indoor/Outdoor IP65 1080P Security Camera',
      quantity: 1,
      unit_cost_cents: 1800  // $18.00
    },
    {
      supplier_sku: 'B09JVCL7JR',
      link_to_product_id: 5,
      update_stock: false,
      name: 'Amazon Echo Buds (newest model) Glacier White',
      quantity: 2,
      unit_cost_cents: 3300  // $33.00
    }
  ]
};

// =====================================================================
// Lógica del importador (genérica)
// =====================================================================

async function findOrCreateSupplier(conn, supplier) {
  const [existing] = await conn.execute(
    'SELECT id FROM suppliers WHERE name = ?',
    [supplier.name]
  );
  if (existing.length) return existing[0].id;

  const [result] = await conn.execute(
    `INSERT INTO suppliers (name, tax_id, contact, payment_terms, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [supplier.name, supplier.tax_id, supplier.contact, supplier.payment_terms, supplier.notes]
  );
  return result.insertId;
}

async function upsertProduct(conn, item) {
  const stockDelta = item.update_stock === false ? 0 : item.quantity;
  const cost = Math.round(item.final_unit_cost_cents);

  // Vínculo manual a un producto existente (cuando el usuario lo identifica)
  if (item.link_to_product_id) {
    await conn.execute(
      'UPDATE products SET cost_cents = ?, stock = stock + ? WHERE id = ?',
      [cost, stockDelta, item.link_to_product_id]
    );
    return { product_id: item.link_to_product_id, action: 'linked-manually' };
  }

  // Busca por SKU primero (identificador estable del proveedor)
  const [bySku] = await conn.execute(
    'SELECT id, slug, cost_cents, stock FROM products WHERE sku = ?',
    [item.supplier_sku]
  );
  if (bySku.length) {
    const { id, cost_cents: prevCost, stock: prevStock } = bySku[0];
    await conn.execute(
      `UPDATE products
         SET cost_cents = ?, stock = stock + ?
       WHERE id = ?`,
      [cost, stockDelta, id]
    );
    return { product_id: id, action: 'updated', prevCost, prevStock };
  }

  // Si no existe por SKU, intenta por slug (por si fue creado manualmente antes)
  const [bySlug] = await conn.execute(
    'SELECT id FROM products WHERE slug = ?',
    [item.slug]
  );
  if (bySlug.length) {
    const id = bySlug[0].id;
    await conn.execute(
      `UPDATE products
         SET sku = ?, cost_cents = ?, stock = stock + ?
       WHERE id = ?`,
      [item.supplier_sku, cost, stockDelta, id]
    );
    return { product_id: id, action: 'linked-by-slug' };
  }

  // Producto nuevo → INSERT con active=0 y price_cents=0 (sin precio de venta aún)
  const [result] = await conn.execute(
    `INSERT INTO products
       (slug, name, category, brand, description, price_cents, stock,
        icon, badge, featured, active, sku, cost_cents)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, 0, 0, ?, ?)`,
    [
      item.slug,
      item.name,
      item.category,
      item.brand,
      item.description,
      item.quantity,
      item.icon,
      item.supplier_sku,
      Math.round(item.final_unit_cost_cents)
    ]
  );
  return { product_id: result.insertId, action: 'inserted' };
}

async function importInvoice() {
  await initDb();

  // Calcula prorrateo de envío por valor de línea (sobre el subtotal de productos)
  const lineSubtotal = INVOICE.items.reduce(
    (acc, it) => acc + it.unit_cost_cents * it.quantity, 0
  );
  if (lineSubtotal !== INVOICE.purchase.subtotal_cents) {
    console.warn(
      `⚠️  Subtotal de líneas (${lineSubtotal}) ≠ subtotal de factura ` +
      `(${INVOICE.purchase.subtotal_cents}). Revisa los datos.`
    );
  }

  // Asigna shipping a cada item proporcional a su line_total.
  // Se conservan decimales exactos (4 decimales = fracción de centavo) para no
  // perder precisión en el costeo. El último item compensa el residuo de redondeo.
  const round4 = n => Math.round(n * 10000) / 10000;
  let shippingAssigned = 0;
  INVOICE.items.forEach((it, idx) => {
    it.line_total_cents = it.unit_cost_cents * it.quantity;
    const isLast = idx === INVOICE.items.length - 1;
    if (isLast) {
      it.shipping_alloc_cents = round4(INVOICE.purchase.shipping_cents - shippingAssigned);
    } else {
      it.shipping_alloc_cents = round4(
        INVOICE.purchase.shipping_cents * (it.line_total_cents / lineSubtotal)
      );
      shippingAssigned = round4(shippingAssigned + it.shipping_alloc_cents);
    }
    it.final_unit_cost_cents = round4(
      (it.line_total_cents + it.shipping_alloc_cents) / it.quantity
    );
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Proveedor
    const supplierId = await findOrCreateSupplier(conn, INVOICE.supplier);
    console.log(`✓ Proveedor: ${INVOICE.supplier.name} (id=${supplierId})`);

    // 2) ¿Factura ya importada?
    const [existingInv] = await conn.execute(
      'SELECT id FROM purchases WHERE supplier_id = ? AND invoice_number = ?',
      [supplierId, INVOICE.purchase.invoice_number]
    );
    if (existingInv.length) {
      console.log(
        `ℹ️  La factura ${INVOICE.purchase.invoice_number} ya estaba ` +
        `importada (purchase_id=${existingInv[0].id}). Nada que hacer.`
      );
      await conn.commit();
      return;
    }

    // 3) Productos (UPSERT con sku + stock + cost_cents)
    const productResults = [];
    for (const item of INVOICE.items) {
      const r = await upsertProduct(conn, item);
      productResults.push({ ...r, item });
      const stockDelta = item.update_stock === false ? 0 : item.quantity;
      console.log(
        `  • ${item.supplier_sku} ${item.name} → ${r.action} ` +
        `(product_id=${r.product_id}, +stock ${stockDelta}, ` +
        `cost_cents=${item.final_unit_cost_cents})`
      );
    }

    // 4) Cabecera de la factura
    const [purchaseResult] = await conn.execute(
      `INSERT INTO purchases
         (supplier_id, invoice_number, issue_date, due_date, currency,
          subtotal_cents, tax_cents, shipping_cents, total_cents,
          payment_status, payment_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        supplierId,
        INVOICE.purchase.invoice_number,
        INVOICE.purchase.issue_date,
        INVOICE.purchase.due_date,
        INVOICE.purchase.currency,
        INVOICE.purchase.subtotal_cents,
        INVOICE.purchase.tax_cents,
        INVOICE.purchase.shipping_cents,
        INVOICE.purchase.total_cents,
        INVOICE.purchase.payment_status,
        INVOICE.purchase.payment_date,
        INVOICE.purchase.notes
      ]
    );
    const purchaseId = purchaseResult.insertId;
    console.log(
      `✓ Factura ${INVOICE.purchase.invoice_number} registrada ` +
      `(purchase_id=${purchaseId})`
    );

    // 5) Líneas
    for (const r of productResults) {
      const it = r.item;
      await conn.execute(
        `INSERT INTO purchase_items
           (purchase_id, product_id, supplier_sku, description, quantity,
            unit_cost_cents, line_total_cents, shipping_alloc_cents,
            final_unit_cost_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          purchaseId,
          r.product_id,
          it.supplier_sku,
          it.name,
          it.quantity,
          it.unit_cost_cents,
          it.line_total_cents,
          it.shipping_alloc_cents,
          it.final_unit_cost_cents
        ]
      );
    }
    console.log(`✓ ${productResults.length} líneas importadas`);

    await conn.commit();
    console.log('\n✅ Importación completada correctamente.');
  } catch (err) {
    await conn.rollback();
    console.error('\n❌ Error — transacción revertida:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

importInvoice()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
