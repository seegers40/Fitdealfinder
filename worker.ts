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
    goals = JSON.parse(row.goals);
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

  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 100));

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
    where.push(`goals LIKE ?`);
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
  env
