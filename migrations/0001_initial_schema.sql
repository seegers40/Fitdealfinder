-- FitDealFinder final hardening / data-quality migration

CREATE INDEX IF NOT EXISTS products_last_synced_idx
ON products(last_synced_at);

CREATE INDEX IF NOT EXISTS products_in_stock_active_idx
ON products(active, in_stock);

CREATE INDEX IF NOT EXISTS products_network_active_idx
ON products(network, active);

-- Product URLs must be present for visible products.
-- Existing rows are not modified automatically.

-- Keep affiliate URLs nullable:
-- normal shop links are used until an affiliate program is approved.

-- Add a privacy-safe click timestamp index.
CREATE INDEX IF NOT EXISTS affiliate_clicks_created_idx
ON affiliate_clicks(created_at);

-- Prevent duplicate external IDs inside a network where possible.
CREATE UNIQUE INDEX IF NOT EXISTS products_network_external_unique_idx
ON products(network, external_id)
WHERE external_id IS NOT NULL; 
