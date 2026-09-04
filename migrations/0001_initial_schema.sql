CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,

  external_id TEXT,

  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,

  description TEXT,
  brand TEXT,
  category TEXT,

  goals TEXT NOT NULL
    DEFAULT '["cut","bulk","lean-bulk"]',

  price REAL NOT NULL
    CHECK (price >= 0),

  old_price REAL,

  currency TEXT NOT NULL
    DEFAULT 'EUR',

  image_url TEXT,

  product_url TEXT NOT NULL,

  affiliate_url TEXT,

  merchant_name TEXT NOT NULL,

  merchant_id TEXT,

  network TEXT NOT NULL
    DEFAULT 'AWIN',

  commission REAL,

  commission_type TEXT,

  in_stock INTEGER NOT NULL
    DEFAULT 1
    CHECK (in_stock IN (0,1)),

  active INTEGER NOT NULL
    DEFAULT 1
    CHECK (active IN (0,1)),

  deal_score INTEGER NOT NULL
    DEFAULT 0
    CHECK (deal_score BETWEEN 0 AND 100),

  discount_percent INTEGER,

  last_synced_at TEXT,

  created_at TEXT NOT NULL
    DEFAULT (datetime('now')),

  updated_at TEXT NOT NULL
    DEFAULT (datetime('now'))
);


CREATE INDEX IF NOT EXISTS
  products_category_idx
ON products(category);


CREATE INDEX IF NOT EXISTS
  products_brand_idx
ON products(brand);


CREATE INDEX IF NOT EXISTS
  products_merchant_idx
ON products(merchant_name);


CREATE INDEX IF NOT EXISTS
  products_active_idx
ON products(active);


CREATE INDEX IF NOT EXISTS
  products_price_idx
ON products(price);


CREATE INDEX IF NOT EXISTS
  products_deal_score_idx
ON products(deal_score);


CREATE UNIQUE INDEX IF NOT EXISTS
  products_network_external_idx
ON products(network, external_id);


CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  product_id TEXT NOT NULL
    REFERENCES products(id)
    ON DELETE CASCADE,

  created_at TEXT NOT NULL
    DEFAULT (datetime('now'))
);


CREATE INDEX IF NOT EXISTS
  affiliate_clicks_product_idx
ON affiliate_clicks(
  product_id,
  created_at
);


CREATE TABLE IF NOT EXISTS sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  network TEXT NOT NULL,

  started_at TEXT NOT NULL
    DEFAULT (datetime('now')),

  finished_at TEXT,

  imported INTEGER NOT NULL
    DEFAULT 0,

  updated INTEGER NOT NULL
    DEFAULT 0,

  failed INTEGER NOT NULL
    DEFAULT 0,

  error_message TEXT
);


CREATE INDEX IF NOT EXISTS
  sync_logs_started_idx
ON sync_logs(started_at);
