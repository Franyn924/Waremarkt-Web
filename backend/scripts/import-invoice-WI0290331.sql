-- =====================================================================
-- Factura 888lots WI0290331 · 2026-01-23 · USD 39.20
-- Para ejecutar en phpMyAdmin (Hostinger) en la BD u729908391_WaremarktWebDB
-- Idempotente: puedes ejecutarlo varias veces sin duplicar datos.
-- =====================================================================

-- ---------- 1) Tablas nuevas (suppliers / purchases / purchase_items) ----------
CREATE TABLE IF NOT EXISTS suppliers (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(200) NOT NULL,
  tax_id        VARCHAR(40) NULL,
  contact       TEXT,
  payment_terms VARCHAR(120),
  notes         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_supplier_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchases (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  supplier_id     INT NOT NULL,
  invoice_number  VARCHAR(80) NOT NULL,
  issue_date      DATE NOT NULL,
  due_date        DATE NULL,
  currency        VARCHAR(8) NOT NULL DEFAULT 'usd',
  subtotal_cents  INT NOT NULL DEFAULT 0,
  tax_cents       INT NOT NULL DEFAULT 0,
  shipping_cents  INT NOT NULL DEFAULT 0,
  total_cents     INT NOT NULL DEFAULT 0,
  payment_status  VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  payment_date    DATE NULL,
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_supplier_invoice (supplier_id, invoice_number),
  INDEX idx_purchases_status (payment_status),
  INDEX idx_purchases_due_date (due_date),
  CONSTRAINT fk_purchases_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchase_items (
  id                    INT PRIMARY KEY AUTO_INCREMENT,
  purchase_id           INT NOT NULL,
  product_id            INT NULL,
  supplier_sku          VARCHAR(120),
  description           TEXT,
  quantity              INT NOT NULL,
  unit_cost_cents       INT NOT NULL,
  line_total_cents      INT NOT NULL,
  shipping_alloc_cents  DECIMAL(14,4) NOT NULL DEFAULT 0,
  final_unit_cost_cents DECIMAL(14,4) NOT NULL,
  INDEX idx_pi_purchase (purchase_id),
  INDEX idx_pi_product (product_id),
  CONSTRAINT fk_pi_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 2) Proveedor 888lots ----------
INSERT INTO suppliers (name, tax_id, contact, payment_terms, notes)
VALUES (
  '888 Digital Inc (888lots)',
  NULL,
  'contact@888lots.com | 1-844-888-5687 | 1416 East Linden Ave, Linden, NJ 07036',
  'Pago al ordenar',
  'Proveedor US. Envío incluido en factura. A veces lista líneas con qty 0 (productos pedidos pero no enviados).'
)
ON DUPLICATE KEY UPDATE
  contact = VALUES(contact),
  payment_terms = VALUES(payment_terms),
  notes = VALUES(notes);

SET @supplier_id := (SELECT id FROM suppliers WHERE name = '888 Digital Inc (888lots)');

-- ---------- 3) Productos ----------
-- ROGOB SSD 512GB (ASIN B0BL2MRSK5) — costo final unitario 1180 cents = $11.80
INSERT INTO products (slug, name, category, brand, description, price_cents, stock,
                      icon, badge, featured, active, sku, cost_cents)
VALUES (
  'rogob-ssd-m2-nvme-512gb',
  'ROGOB 512GB M.2 NVMe 2242 SSD',
  'computacion',
  'ROGOB',
  'ROGOB 512GB M.2 NVMe 2242 SSD PCIe Gen3*2 B&M Key Disk Form Factor 42mm NGFF Internal Solid State Hard Drive for PC Laptop Desktop\n\n[Importado de 888 Digital Inc (888lots) — ASIN B0BL2MRSK5]',
  0, 1, 'hard-drive', NULL, 0, 0, 'B0BL2MRSK5', 1180
)
ON DUPLICATE KEY UPDATE
  sku        = VALUES(sku),
  cost_cents = VALUES(cost_cents),
  stock      = stock + VALUES(stock);

-- SGIN Tablet 10.1" (ASIN B0BZ3CKFWK) — costo final unitario 2740 cents = $27.40
INSERT INTO products (slug, name, category, brand, description, price_cents, stock,
                      icon, badge, featured, active, sku, cost_cents)
VALUES (
  'sgin-tablet-10-android-12-32gb',
  'SGIN Tablet 10.1" Android 12',
  'computacion',
  'SGIN',
  'SGIN Tablet 10.1 Inch Android 12 Tablet, 2GB RAM 32GB ROM, Quad-Core A133 1.6GHz, 2MP+5MP Camera, Bluetooth, GPS, 5000mAh (Black)\n\n[Importado de 888 Digital Inc (888lots) — ASIN B0BZ3CKFWK]',
  0, 1, 'tablet', NULL, 0, 0, 'B0BZ3CKFWK', 2740
)
ON DUPLICATE KEY UPDATE
  sku        = VALUES(sku),
  cost_cents = VALUES(cost_cents),
  stock      = stock + VALUES(stock);

-- ---------- 4) Cabecera de la factura ----------
INSERT INTO purchases (supplier_id, invoice_number, issue_date, due_date, currency,
                       subtotal_cents, tax_cents, shipping_cents, total_cents,
                       payment_status, payment_date, notes)
VALUES (
  @supplier_id, 'WI0290331', '2026-01-23', NULL, 'usd',
  3720, 0, 200, 3920,
  'pagado', '2026-01-23',
  'Web Order 2652223405. Línea SAMSON G Track Pro (B075KL6ZLC) facturada con qty 0 → no enviada, no se importa.'
)
ON DUPLICATE KEY UPDATE
  payment_status = VALUES(payment_status),
  payment_date   = VALUES(payment_date),
  notes          = VALUES(notes);

SET @purchase_id := (SELECT id FROM purchases
                     WHERE supplier_id = @supplier_id AND invoice_number = 'WI0290331');

-- ---------- 5) Líneas de la factura ----------
-- Borra líneas previas si existían (para que sea reentrante sin duplicar)
DELETE FROM purchase_items WHERE purchase_id = @purchase_id;

-- shipping_alloc_cents y final_unit_cost_cents conservan decimales de cent
-- (DECIMAL 14,4) para no perder precisión en el prorrateo. El último item
-- compensa el residuo para que la suma exacta = shipping_cents de la factura.
INSERT INTO purchase_items (purchase_id, product_id, supplier_sku, description, quantity,
                            unit_cost_cents, line_total_cents,
                            shipping_alloc_cents, final_unit_cost_cents)
VALUES
  (@purchase_id, (SELECT id FROM products WHERE sku = 'B0BL2MRSK5'),
   'B0BL2MRSK5', 'ROGOB 512GB M.2 NVMe 2242 SSD',
   1, 1120, 1120, 60.2151, 1180.2151),
  (@purchase_id, (SELECT id FROM products WHERE sku = 'B0BZ3CKFWK'),
   'B0BZ3CKFWK', 'SGIN Tablet 10.1" Android 12',
   1, 2600, 2600, 139.7849, 2739.7849);

-- ---------- 6) Verificación final ----------
SELECT 'Resumen' AS '#', '' AS detalle UNION ALL
SELECT 'Proveedor', s.name FROM suppliers s WHERE s.id = @supplier_id UNION ALL
SELECT 'Factura', CONCAT(p.invoice_number, ' · ', p.issue_date, ' · USD ',
                         FORMAT(p.total_cents/100, 2), ' · ', p.payment_status)
FROM purchases p WHERE p.id = @purchase_id UNION ALL
SELECT CONCAT('Item ', pi.supplier_sku),
       CONCAT('qty=', pi.quantity,
              ' · costo final unit. $', FORMAT(pi.final_unit_cost_cents/100, 2),
              ' · línea $', FORMAT(pi.line_total_cents/100, 2),
              ' · envío $', FORMAT(pi.shipping_alloc_cents/100, 2))
FROM purchase_items pi WHERE pi.purchase_id = @purchase_id;
