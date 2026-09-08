-- FitDealFinder final database hardening

CREATE INDEX IF NOT EXISTS products_last_synced_idx
ON products(last_synced_at);

CREATE INDEX IF NOT EXISTS products_in_stock_active_idx
ON products(active, in_stock);

CREATE INDEX IF NOT EXISTS products_network_active_idx
ON products(network, active);

CREATE INDEX IF NOT EXISTS affiliate_clicks_created_idx
ON affiliate_clicks(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS products_network_external_unique_idx
ON products(network, external_id)
WHERE external_id IS NOT NULL;
