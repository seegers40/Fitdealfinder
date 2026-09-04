export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  AWIN_API_KEY?: string;
  AWIN_PUBLISHER_ID?: string;
  AWIN_PRODUCT_FEED_URL?: string;
  ADMIN_SECRET?: string;
}

type ProductRow = {
  id: string;
  external_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  goals: string;
  price: number;
  old_price: number | null;
  currency: string;
  image_url: string | null;
  product_url: string;
  affiliate_url: string | null;
  merchant_name: string;
  merchant_id: string | null;
  network: string;
  commission: number | null;
  commission_type: string | null;
  in_stock: number;
  active: number;
  deal_score: number;
  discount_percent: number | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type AwinProduct = {
  id?: string | number;
  product_id?: string | number;
  name?: string;
  title?: string;
  description?: string;
  brand?: string;
  category?: string;
  price?: number | string;
  sale_price?: number | string;
  old_price?: number | string;
  currency?: string;
  image_url?: string;
  image?: string;
  product_url?: string;
  url?: string;
  affiliate_url?: string;
  merchant_name?: string;
  merchant_id?: string | number;
  commission?: number | string;
  commission_type?: string;
  in_stock?: boolean | number;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function text(data: string, status = 200): Response {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/plain; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateDiscount(
  price: number,
  oldPrice: number | null
): number | null {
  if (
    oldPrice === null ||
    oldPrice <= 0 ||
    price < 0 ||
    price >= oldPrice
  ) {
    return null;
  }

  return Math.round(((oldPrice - price) / oldPrice) * 100);
}

function calculateDealScore(
  price: number,
  oldPrice: number | null,
  inStock: boolean
): number {
  if (!inStock) {
    return 0;
  }

  const discount = calculateDiscount(price, oldPrice);

  if (discount === null) {
    return 10;
  }

  return Math.max(0, Math.min(100, discount * 2));
}

function normalizeGoals(value: unknown): string[] {
  if (Array.isArray(value)) {
    const allowed = new Set(["cut", "bulk", "lean-bulk"]);

    const result = value
      .map((item) => String(item).trim().toLowerCase())
      .filter((item) => allowed.has(item));

    if (result.length > 0) {
      return [...new Set(result)];
    }
  }

  return ["cut", "bulk", "lean-bulk"];
}

function productFromRow(row: ProductRow) {
  let goals: string[] = [];

  try {
    const parsed = JSON.parse(row.goals);
    goals = normalizeGoals(parsed);
  } catch {
    goals = ["cut", "bulk", "lean-bulk"];
  }

  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    brand: row.brand,
    category: row.category,
    goals,
    price: row.price,
    oldPrice: row.old_price,
    currency: row.currency,
    imageUrl: row.image_url,
    productUrl: row.product_url,
    affiliateUrl: row.affiliate_url,
    merchantName: row.merchant_name,
    merchantId: row.merchant_id,
    network: row.network,
    commission: row.commission,
    commissionType: row.commission_type,
    inStock: row.in_stock === 1,
    active: row.active === 1,
    dealScore: row.deal_score,
    discountPercent: row.discount_percent,
    lastSyncedAt: row.last_synced_at,
  };
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

async function getProducts(
  env: Env,
  request: Request
): Promise<Response> {
  const url = new URL(request.url);

  const limitRaw = Number(
    url.searchParams.get("limit") ?? "100"
  );

  const limit = Math.max(
    1,
    Math.min(
      200,
      Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100
    )
  );

  const category = url.searchParams.get("category");
  const goal = url.searchParams.get("goal");
  const merchant = url.searchParams.get("merchant");
  const search = url.searchParams.get("search");

  const where: string[] = ["active = 1"];
  const bindings: unknown[] = [];

  if (category) {
    where.push("LOWER(category) = LOWER(?)");
    bindings.push(category);
  }

  if (merchant) {
    where.push("LOWER(merchant_name) = LOWER(?)");
    bindings.push(merchant);
  }

  if (goal) {
    where.push("goals LIKE ?");
    bindings.push(`%"${goal.toLowerCase()}"%`);
  }

  if (search) {
    where.push(
      "(LOWER(name) LIKE LOWER(?) OR LOWER(brand) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?))"
    );

    const term = `%${search}%`;
    bindings.push(term, term, term);
  }

  const sql = `
    SELECT *
    FROM products
    WHERE ${where.join(" AND ")}
    ORDER BY deal_score DESC, price ASC, name ASC
    LIMIT ?
  `;

  bindings.push(limit);

  const result = await env.DB
    .prepare(sql)
    .bind(...bindings)
    .all<ProductRow>();

  return json({
    products: result.results.map(productFromRow),
    count: result.results.length,
  });
}

async function getProduct(
  env: Env,
  slug: string
): Promise<Response> {
  const row = await env.DB
    .prepare(
      `
        SELECT *
        FROM products
        WHERE slug = ?
          AND active = 1
        LIMIT 1
      `
    )
    .bind(slug)
    .first<ProductRow>();

  if (!row) {
    return json(
      {
        error: "Product not found",
      },
      404
    );
  }

  return json(productFromRow(row));
}

async function health(env: Env): Promise<Response> {
  try {
    const result = await env.DB
      .prepare("SELECT 1 AS ok")
      .first<{ ok: number }>();

    return json({
      ok: result?.ok === 1,
      service: "fitdealfinder",
      database: "D1",
    });
  } catch (error) {
    return json(
      {
        ok: false,
        service: "fitdealfinder",
        database: "D1",
        error:
          error instanceof Error
            ? error.message
            : "Database error",
      },
      500
    );
  }
}

function getAdminSecret(request: Request): string {
  return request.headers.get("x-admin-secret") ?? "";
}

function isAdmin(request: Request, env: Env): boolean {
  if (!env.ADMIN_SECRET) {
    return false;
  }

  const supplied = getAdminSecret(request);

  return supplied.length > 0 && supplied === env.ADMIN_SECRET;
}

function getString(
  value: unknown,
  fallback = ""
): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return fallback;
}

function getProductPrice(item: AwinProduct): number | null {
  const salePrice = numberOrNull(item.sale_price);

  if (salePrice !== null && salePrice >= 0) {
    return salePrice;
  }

  const price = numberOrNull(item.price);

  if (price !== null && price >= 0) {
    return price;
  }

  return null;
}

function getProductExternalId(
  item: AwinProduct
): string | null {
  const value = item.id ?? item.product_id;

  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  return String(value).trim();
}

function getMerchantName(
  item: AwinProduct
): string {
  const value = getString(
    item.merchant_name,
    "Awin merchant"
  );

  return value || "Awin merchant";
}

function getProductUrl(
  item: AwinProduct
): string {
  return getString(
    item.product_url ?? item.url
  );
}

function getAffiliateUrl(
  item: AwinProduct
): string | null {
  const value = getString(item.affiliate_url);

  return value || null;
}

function getInStock(
  item: AwinProduct
): boolean {
  if (typeof item.in_stock === "boolean") {
    return item.in_stock;
  }

  if (typeof item.in_stock === "number") {
    return item.in_stock !== 0;
  }

  return true;
}

function mapAwinProduct(
  item: AwinProduct
): {
  externalId: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  price: number;
  oldPrice: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string;
  affiliateUrl: string | null;
  merchantName: string;
  merchantId: string | null;
  commission: number | null;
  commissionType: string | null;
  inStock: boolean;
  goals: string[];
} | null {
  const externalId = getProductExternalId(item);
  const name = getString(item.name ?? item.title);
  const price = getProductPrice(item);
  const productUrl = getProductUrl(item);

  if (
    !externalId ||
    !name ||
    price === null ||
    !productUrl ||
    !isSafeHttpsUrl(productUrl)
  ) {
    return null;
  }

  const oldPrice = numberOrNull(item.old_price);

  const imageValue = getString(
    item.image_url ?? item.image
  );

  const imageUrl =
    imageValue && isSafeHttpsUrl(imageValue)
      ? imageValue
      : null;

  const affiliateValue = getAffiliateUrl(item);

  const affiliateUrl =
    affiliateValue && isSafeHttpsUrl(affiliateValue)
      ? affiliateValue
      : null;

  return {
    externalId,
    name,
    description: getString(item.description) || null,
    brand: getString(item.brand) || null,
    category: getString(item.category) || null,
    price,
    oldPrice,
    currency:
      getString(item.currency, "EUR").toUpperCase() || "EUR",
    imageUrl,
    productUrl,
    affiliateUrl,
    merchantName: getMerchantName(item),
    merchantId:
      getString(item.merchant_id) || null,
    commission: numberOrNull(item.commission),
    commissionType:
      getString(item.commission_type) || null,
    inStock: getInStock(item),
    goals: ["cut", "bulk", "lean-bulk"],
  };
}

function parseAwinFeed(
  data: unknown
): AwinProduct[] {
  if (Array.isArray(data)) {
    return data as AwinProduct[];
  }

  if (
    typeof data === "object" &&
    data !== null
  ) {
    const record = data as Record<string, unknown>;

    const possibleKeys = [
      "products",
      "items",
      "data",
      "results",
    ];

    for (const key of possibleKeys) {
      const value = record[key];

      if (Array.isArray(value)) {
        return value as AwinProduct[];
      }
    }
  }

  return [];
}

async function syncAwin(
  env: Env,
  request: Request
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return json(
      {
        error: "Unauthorized",
      },
      401
    );
  }

  if (!env.AWIN_PRODUCT_FEED_URL) {
    return json(
      {
        error: "AWIN_PRODUCT_FEED_URL is not configured",
      },
      500
    );
  }

  const startedAt = new Date().toISOString();

  let imported = 0;
  let updated = 0;
  let failed = 0;
  let errorMessage: string | null = null;

  try {
    const headers = new Headers({
      accept: "application/json",
    });

    if (env.AWIN_API_KEY) {
      headers.set(
        "authorization",
        `Bearer ${env.AWIN_API_KEY}`
      );
    }

    const response = await fetch(
      env.AWIN_PRODUCT_FEED_URL,
      {
        method: "GET",
        headers,
      }
    );

    if (!response.ok) {
      throw new Error(
        `Awin feed request failed with HTTP ${response.status}`
      );
    }

    const data: unknown = await response.json();
    const feedProducts = parseAwinFeed(data);

    if (feedProducts.length === 0) {
      throw new Error(
        "Awin feed contained no products"
      );
    }

    for (const item of feedProducts) {
      const mapped = mapAwinProduct(item);

      if (!mapped) {
        failed += 1;
        continue;
      }

      const existing = await env.DB
        .prepare(
          `
            SELECT id
            FROM products
            WHERE network = ?
              AND external_id = ?
            LIMIT 1
          `
        )
        .bind("AWIN", mapped.externalId)
        .first<{ id: string }>();

      const id =
        existing?.id ??
        crypto.randomUUID();

      const baseSlug =
        slugify(mapped.name) ||
        `product-${mapped.externalId}`;

      const slug =
        existing?.id
          ? baseSlug
          : `${baseSlug}-${mapped.externalId}`
              .slice(0, 160);

      const discountPercent =
        calculateDiscount(
          mapped.price,
          mapped.oldPrice
        );

      const dealScore =
        calculateDealScore(
          mapped.price,
          mapped.oldPrice,
          mapped.inStock
        );

      await env.DB
        .prepare(
          `
            INSERT INTO products (
              id,
              external_id,
              name,
              slug,
              description,
              brand,
              category,
              goals,
              price,
              old_price,
              currency,
              image_url,
              product_url,
              affiliate_url,
              merchant_name,
              merchant_id,
              network,
              commission,
              commission_type,
              in_stock,
              active,
              deal_score,
              discount_percent,
              last_synced_at,
              created_at,
              updated_at
            )
            VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'),
              datetime('now'), datetime('now')
            )
            ON CONFLICT(network, external_id)
            DO UPDATE SET
              name = excluded.name,
              slug = excluded.slug,
              description = excluded.description,
              brand = excluded.brand,
              category = excluded.category,
              goals = excluded.goals,
              price = excluded.price,
              old_price = excluded.old_price,
              currency = excluded.currency,
              image_url = excluded.image_url,
              product_url = excluded.product_url,
              affiliate_url = excluded.affiliate_url,
              merchant_name = excluded.merchant_name,
              merchant_id = excluded.merchant_id,
              commission = excluded.commission,
              commission_type = excluded.commission_type,
              in_stock = excluded.in_stock,
              active = excluded.active,
              deal_score = excluded.deal_score,
              discount_percent = excluded.discount_percent,
              last_synced_at = datetime('now'),
              updated_at = datetime('now')
          `
        )
        .bind(
          id,
          mapped.externalId,
          mapped.name,
          slug,
          mapped.description,
          mapped.brand,
          mapped.category,
          JSON.stringify(mapped.goals),
          mapped.price,
          mapped.oldPrice,
          mapped.currency,
          mapped.imageUrl,
          mapped.productUrl,
          mapped.affiliateUrl,
          mapped.merchantName,
          mapped.merchantId,
          "AWIN",
          mapped.commission,
          mapped.commissionType,
          mapped.inStock ? 1 : 0,
          1,
          dealScore,
          discountPercent
        )
        .run();

      if (existing) {
        updated += 1;
      } else {
        imported += 1;
      }
    }
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown sync error";
  }

  await env.DB
    .prepare(
      `
        INSERT INTO sync_logs (
          network,
          started_at,
          finished_at,
          imported,
          updated,
          failed,
          error_message
        )
        VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
      `
    )
    .bind(
      "AWIN",
      startedAt,
      imported,
      updated,
      failed,
      errorMessage
    )
    .run();

  if (errorMessage) {
    return json(
      {
        ok: false,
        network: "AWIN",
        imported,
        updated,
        failed,
        error: errorMessage,
      },
      500
    );
  }

  return json({
    ok: true,
    network: "AWIN",
    imported,
    updated,
    failed,
  });
}

async function getSyncLogs(
  env: Env,
  request: Request
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return json(
      {
        error: "Unauthorized",
      },
      401
    );
  }

  const result = await env.DB
    .prepare(
      `
        SELECT
          id,
          network,
          started_at,
          finished_at,
          imported,
          updated,
          failed,
          error_message
        FROM sync_logs
        ORDER BY started_at DESC
        LIMIT 50
      `
    )
    .all();

  return json({
    logs: result.results,
  });
}

async function redirectToProduct(
  env: Env,
  request: Request,
  id: string
): Promise<Response> {
  const row = await env.DB
    .prepare(
      `
        SELECT
          id,
          product_url,
          affiliate_url,
          active
        FROM products
        WHERE id = ?
        LIMIT 1
      `
    )
    .bind(id)
    .first<{
      id: string;
      product_url: string;
      affiliate_url: string | null;
      active: number;
    }>();

  if (!row || row.active !== 1) {
    return text("Product not found", 404);
  }

  await env.DB
    .prepare(
      `
        INSERT INTO affiliate_clicks (
          product_id
        )
        VALUES (?)
      `
    )
    .bind(row.id)
    .run();

  const destination =
    row.affiliate_url &&
    isSafeHttpsUrl(row.affiliate_url)
      ? row.affiliate_url
      : row.product_url;

  if (!isSafeHttpsUrl(destination)) {
    return text(
      "Product destination is not available",
      500
    );
  }

  return Response.redirect(destination, 302);
}

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (
        request.method === "GET" &&
        path === "/api/health"
      ) {
        return await health(env);
      }

      if (
        request.method === "GET" &&
        path === "/api/products"
      ) {
        return await getProducts(env, request);
      }

      if (
        request.method === "GET" &&
        path.startsWith("/api/products/")
      ) {
        const slug = decodeURIComponent(
          path.slice("/api/products/".length)
        );

        return await getProduct(env, slug);
      }

      if (
        request.method === "POST" &&
        path === "/api/admin/sync-awin"
      ) {
        return await syncAwin(env, request);
      }

      if (
        request.method === "GET" &&
        path === "/api/admin/sync-logs"
      ) {
        return await getSyncLogs(env, request);
      }

      if (
        request.method === "GET" &&
        path.startsWith("/go/")
      ) {
        const id = decodeURIComponent(
          path.slice("/go/".length)
        );

        return await redirectToProduct(
          env,
          request,
          id
        );
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Internal server error",
        },
        500
      );
    }
  },
};
