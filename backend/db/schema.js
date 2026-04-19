import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'waremarkt.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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

  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
  CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`);
