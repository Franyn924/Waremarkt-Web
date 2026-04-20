import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'waremarkt.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    name_es     TEXT NOT NULL,
    name_en     TEXT NOT NULL,
    icon        TEXT DEFAULT 'package',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    brand       TEXT,
    description TEXT,
    price_cents INTEGER NOT NULL,
    compare_at_cents INTEGER,
    stock       INTEGER NOT NULL DEFAULT 0,
    image_url   TEXT,
    icon        TEXT,
    badge       TEXT,
    featured    INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_session_id    TEXT UNIQUE,
    stripe_payment_intent TEXT,
    customer_email       TEXT,
    customer_name        TEXT,
    amount_total_cents   INTEGER NOT NULL,
    currency             TEXT NOT NULL DEFAULT 'usd',
    status               TEXT NOT NULL DEFAULT 'pending',
    items_json           TEXT NOT NULL,
    shipping_json        TEXT,
    created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
  CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(active);
`);

// Migraciones idempotentes para bases de datos ya creadas
const productCols = db.prepare('PRAGMA table_info(products)').all().map(c => c.name);
if (!productCols.includes('media_json')) {
  db.exec('ALTER TABLE products ADD COLUMN media_json TEXT');
}

// Seed categorías por defecto si la tabla está vacía (productos existentes siguen funcionando)
const catCount = db.prepare('SELECT COUNT(*) as n FROM categories').get().n;
if (catCount === 0) {
  const insertCat = db.prepare(`
    INSERT INTO categories (slug, name_es, name_en, icon, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertCat.run('computacion', 'Computación', 'Computers', 'laptop', 1);
  insertCat.run('accesorios', 'Accesorios', 'Accessories', 'headphones', 2);
}

// Settings: defaults idempotentes (INSERT OR IGNORE no sobreescribe valores existentes)
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
  whatsapp_number: '14079434098'
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
