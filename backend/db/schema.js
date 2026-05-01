import mysql from 'mysql2/promise';

const {
  MYSQL_HOST,
  MYSQL_PORT = '3306',
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE
} = process.env;

if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_DATABASE) {
  throw new Error('Faltan variables MySQL (MYSQL_HOST, MYSQL_USER, MYSQL_DATABASE). Revisa tu .env o el panel de Hostinger.');
}

export const pool = mysql.createPool({
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT),
  user: MYSQL_USER,
  password: MYSQL_PASSWORD || '',
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z'
});

async function ensureColumn(table, column, definition) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (rows[0].n === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${definition}`);
  }
}

// Modifica el tipo de una columna existente solo si su DATA_TYPE actual difiere del esperado.
// Usado para upgrades de schema (ej. INT → DECIMAL).
async function ensureColumnType(table, column, expectedDataType, fullDefinition) {
  const [rows] = await pool.execute(
    `SELECT DATA_TYPE FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (rows.length && rows[0].DATA_TYPE.toLowerCase() !== expectedDataType.toLowerCase()) {
    await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${fullDefinition}`);
  }
}

async function ensureIndex(table, indexName, columns) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS n FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, indexName]
  );
  if (rows[0].n === 0) {
    await pool.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (${columns})`);
  }
}

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      slug        VARCHAR(80) NOT NULL UNIQUE,
      name_es     VARCHAR(120) NOT NULL,
      name_en     VARCHAR(120) NOT NULL,
      icon        VARCHAR(40) DEFAULT 'package',
      sort_order  INT NOT NULL DEFAULT 0,
      active      TINYINT NOT NULL DEFAULT 1,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_categories_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id               INT PRIMARY KEY AUTO_INCREMENT,
      slug             VARCHAR(120) NOT NULL UNIQUE,
      name             VARCHAR(200) NOT NULL,
      category         VARCHAR(80) NOT NULL,
      brand            VARCHAR(120),
      description      TEXT,
      price_cents      INT NOT NULL,
      compare_at_cents INT,
      stock            INT NOT NULL DEFAULT 0,
      image_url        TEXT,
      media_json       TEXT,
      icon             VARCHAR(40),
      badge            VARCHAR(40),
      featured         TINYINT NOT NULL DEFAULT 0,
      active           TINYINT NOT NULL DEFAULT 1,
      created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_products_category (category),
      INDEX idx_products_featured (featured),
      INDEX idx_products_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id                    INT PRIMARY KEY AUTO_INCREMENT,
      stripe_session_id     VARCHAR(255) UNIQUE,
      stripe_payment_intent VARCHAR(255),
      customer_email        VARCHAR(255),
      customer_name         VARCHAR(255),
      amount_total_cents    INT NOT NULL,
      currency              VARCHAR(8) NOT NULL DEFAULT 'usd',
      status                VARCHAR(32) NOT NULL DEFAULT 'pending',
      items_json            TEXT NOT NULL,
      shipping_json         TEXT,
      created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_orders_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\`      VARCHAR(64) PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      name          VARCHAR(200) NOT NULL,
      tax_id        VARCHAR(40) NULL,
      contact       TEXT,
      payment_terms VARCHAR(120),
      notes         TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_supplier_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migraciones idempotentes para bases ya creadas sin estas columnas
  await ensureColumn('products', 'media_json', 'TEXT');
  await ensureColumn('categories', 'parent_id', 'INT NULL');
  await ensureColumn('products', 'sku', 'VARCHAR(80) NULL');
  await ensureIndex('products', 'idx_products_sku', 'sku');
  await ensureColumn('products', 'cost_cents', 'INT NULL');
  // Fulfillment / envío de pedidos
  await ensureColumn('orders', 'fulfillment_status', "VARCHAR(32) NOT NULL DEFAULT 'unfulfilled'");
  await ensureColumn('orders', 'shipping_carrier', 'VARCHAR(40) NULL');
  await ensureColumn('orders', 'shipping_method', 'VARCHAR(80) NULL');
  await ensureColumn('orders', 'tracking_number', 'VARCHAR(120) NULL');
  await ensureColumn('orders', 'tracking_url', 'VARCHAR(500) NULL');
  await ensureColumn('orders', 'shipped_at', 'TIMESTAMP NULL');
  await ensureColumn('orders', 'delivered_at', 'TIMESTAMP NULL');
  await ensureColumn('orders', 'fulfillment_notes', 'TEXT NULL');
  await ensureIndex('orders', 'idx_orders_fulfillment', 'fulfillment_status');
  // Pagos multi-proveedor (Stripe / NowPayments / Transferencia Zelle)
  await ensureColumn('orders', 'payment_provider', 'VARCHAR(20) NULL');
  await ensureColumn('orders', 'customer_phone', 'VARCHAR(40) NULL');
  await ensureColumn('orders', 'nowpayments_invoice_id', 'VARCHAR(120) NULL');
  await ensureColumn('orders', 'nowpayments_payment_id', 'VARCHAR(120) NULL');
  await ensureColumn('orders', 'pay_currency', 'VARCHAR(20) NULL');
  await ensureIndex('orders', 'idx_orders_payment_provider', 'payment_provider');
  await ensureColumn('suppliers', 'website', 'VARCHAR(255) NULL');
  await ensureColumn('suppliers', 'email', 'VARCHAR(120) NULL');
  await ensureColumn('suppliers', 'phone', 'VARCHAR(40) NULL');
  await ensureColumn('suppliers', 'country', 'VARCHAR(60) NULL');
  await ensureColumn('suppliers', 'currency', "VARCHAR(8) NOT NULL DEFAULT 'usd'");
  await ensureColumn('suppliers', 'shipping_in_invoice', 'TINYINT NOT NULL DEFAULT 1');
  await ensureColumn('suppliers', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  // Para preservar fracciones de centavo del prorrateo de envío (importante para
  // que el costeo coincida exactamente con la factura del proveedor).
  await ensureColumnType('purchase_items', 'shipping_alloc_cents', 'decimal', 'DECIMAL(14,4) NOT NULL DEFAULT 0');
  await ensureColumnType('purchase_items', 'final_unit_cost_cents', 'decimal', 'DECIMAL(14,4) NOT NULL');

  // Seed categorías si está vacía
  const [catRows] = await pool.query('SELECT COUNT(*) AS n FROM categories');
  if (catRows[0].n === 0) {
    await pool.query(
      `INSERT INTO categories (slug, name_es, name_en, icon, sort_order) VALUES
        ('computacion', 'Computación', 'Computers', 'laptop', 1),
        ('accesorios', 'Accesorios', 'Accessories', 'headphones', 2)`
    );
  }

  // Settings defaults (INSERT IGNORE no sobreescribe valores existentes)
  const DEFAULT_SETTINGS = {
    store_name: 'Waremarkt',
    store_email: 'hola@waremarkt.com',
    store_phone: '+1 407 943 4098',
    currency: 'usd',
    shipping_flat_cents: '0',
    tax_enabled: '0',
    tax_behavior: 'exclusive',
    checkout_success_url: '/success.html',
    checkout_cancel_url: '/cancel.html',
    whatsapp_number: '14079434098',
    // Transferencia / Zelle
    zelle_email: '',
    zelle_phone: '',
    zelle_account_holder: '',
    transfer_instructions: '',
    // NowPayments (cripto)
    nowpayments_api_key: '',
    nowpayments_ipn_secret: '',
    nowpayments_enabled: '0',
    nowpayments_sandbox: '1'
  };
  const values = Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, v]);
  await pool.query(
    'INSERT IGNORE INTO settings (`key`, value) VALUES ?',
    [values]
  );
}

export async function getSetting(key, fallback = null) {
  const [rows] = await pool.execute('SELECT value FROM settings WHERE `key` = ?', [key]);
  return rows.length ? rows[0].value : fallback;
}

export async function getAllSettings() {
  const [rows] = await pool.query('SELECT `key`, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
