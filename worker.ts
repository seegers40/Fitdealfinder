import { Client } from "pg";

interface Env {
  ASSETS: Fetcher;
  HYPERDRIVE: {
    connectionString: string;
  };

  ADMIN_SECRET: string;

  AWIN_API_KEY?: string;
  AWIN_PRODUCT_FEED_URL?: string;
}

type Goal = "cut" | "bulk" | "lean-bulk";

const GOALS: Goal[] = [
  "cut",
  "bulk",
  "lean-bulk",
];

type ProductRow = {
  id: string;
  external_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  goals: string[];
  price: string | number;
  old_price: string | number | null;
  currency: string;
  image_url: string | null;
  product_url: string;
  affiliate_url: string | null;
  merchant_name: string;
  merchant_id: string | null;
  network: string;
  in_stock: boolean;
  deal_score: number;
  discount_percent: number | null;
  last_synced_at: string | null;
};

type AwinProduct = {
  id?: string | number;
  productId?: string | number;

  name?: string;
  title?: string;

  description?: string;
  brand?: string;
  category?: string;

  price?: string | number;
  salePrice?: string | number;
  currency?: string;

  imageUrl?: string;
  image?: string;

  productUrl?: string;
  affiliateUrl?: string;
  awinLink?: string;
  deepLink?: string;

  merchantName?: string;
  merchantId?: string | number;

  commission?: string | number;
  commissionType?: string;

  inStock?: boolean;
};

function json(
  data: unknown,
  status = 200,
): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control":
        status === 200
          ? "public, max-age=60, s-maxage=300"
          : "no-store",
    },
  });
}

function errorJson(
  message: string,
  status = 500,
): Response {
  return json(
    {
      error: message,
    },
    status,
  );
}

async function query<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({
    connectionString:
      env.HYPERDRIVE.connectionString,
  });

  try {
    await client.connect();

    const result = await client.query(
      sql,
      params,
    );

    return result.rows as T[];
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureDatabase(
  env: Env,
): Promise<void> {
  await query(
    env,
    `
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY,
        external_id TEXT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        brand TEXT,
        category TEXT,
        goals TEXT[] NOT NULL
          DEFAULT ARRAY['cut','bulk','lean-bulk'],
        price NUMERIC(12,2) NOT NULL
          CHECK (price >= 0),
        old_price NUMERIC(12,2),
        currency CHAR(3) NOT NULL
          DEFAULT 'EUR',
        image_url TEXT,
        product_url TEXT NOT NULL,
        affiliate_url TEXT,
        merchant_name TEXT NOT NULL,
        merchant_id TEXT,
        network TEXT NOT NULL
          DEFAULT 'AWIN',
        commission NUMERIC(12,2),
        commission_type TEXT,
        in_stock BOOLEAN NOT NULL
          DEFAULT TRUE,
        active BOOLEAN NOT NULL
          DEFAULT TRUE,
        deal_score INTEGER NOT NULL
          DEFAULT 0
          CHECK (deal_score BETWEEN 0 AND 100),
        discount_percent INTEGER,
        last_synced_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL
          DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL
          DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS products_category_idx
        ON products(category);

      CREATE INDEX IF NOT EXISTS products_brand_idx
        ON products(brand);

      CREATE INDEX IF NOT EXISTS products_merchant_idx
        ON products(merchant_name);

      CREATE INDEX IF NOT EXISTS products_active_idx
        ON products(active);

      CREATE INDEX IF NOT EXISTS products_price_idx
        ON products(price);

      CREATE INDEX IF NOT EXISTS products_goals_idx
        ON products USING GIN(goals);

      CREATE UNIQUE INDEX IF NOT EXISTS
        products_network_external_idx
        ON products(network, external_id)
        WHERE external_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS affiliate_clicks (
        id BIGSERIAL PRIMARY KEY,
        product_id UUID NOT NULL
          REFERENCES products(id)
          ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL
          DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS
        affiliate_clicks_product_idx
        ON affiliate_clicks(product_id, created_at);

      CREATE TABLE IF NOT EXISTS sync_logs (
        id BIGSERIAL PRIMARY KEY,
        network TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL
          DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        imported INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      );
    `,
  );

  await query(
    env,
    `
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS goals TEXT[]
      NOT NULL
      DEFAULT ARRAY['cut','bulk','lean-bulk']
    `,
  );

  await query(
    env,
    `
      ALTER TABLE products
      ALTER COLUMN affiliate_url DROP NOT NULL
    `,
  );
}

function safeHttps(
  value: string,
): URL {
  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error(
      "Only HTTPS URLs are allowed.",
    );
  }

  return url;
}

function isAwinUrl(
  value: string,
): boolean {
  try {
    const host =
      safeHttps(value)
        .hostname
        .toLowerCase();

    return (
      host === "awin.com" ||
      host === "www.awin.com" ||
      host === "awin1.com" ||
      host === "www.awin1.com" ||
      host.endsWith(".awin.com") ||
      host.endsWith(".awin1.com")
    );
  } catch {
    return false;
  }
}

function textOrNull(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value).trim();

  return text.length > 0
    ? text
    : null;
}

function numberOrNull(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function slugify(
  value: string,
): string {
  return (
    value
      .normalize("NFKD")
      .replace(
        /[\u0300-\u036f]/g,
        "",
      )
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-",
      )
      .replace(
        /^-+|-+$/g,
        "",
      )
      .slice(0, 150) ||
    "product"
  );
}

function discountPercent(
  price: number,
  oldPrice: number | null,
): number | null {
  if (
    oldPrice === null ||
    oldPrice <= price ||
    oldPrice <= 0
  ) {
    return null;
  }

  return Math.min(
    100,
    Math.max(
      0,
      Math.round(
        ((oldPrice - price) /
          oldPrice) *
          100,
      ),
    ),
  );
}

function dealScore(
  price: number,
  oldPrice: number | null,
  inStock: boolean,
): number {
  if (!inStock) {
    return 0;
  }

  const discount =
    discountPercent(
      price,
      oldPrice,
    ) ?? 0;

  let score = Math.min(
    60,
    Math.round(discount * 1.5),
  );

  if (
    price > 0 &&
    price < 50
  ) {
    score += 10;
  }

  if (
    oldPrice !== null &&
    oldPrice > price
  ) {
    score += 5;
  }

  return Math.min(
    100,
    Math.max(0, score),
  );
}

function normalizeGoals(
  value: unknown,
): Goal[] {
  if (!Array.isArray(value)) {
    return [...GOALS];
  }

  const valid =
    value.filter(
      (goal): goal is Goal =>
        typeof goal === "string" &&
        GOALS.includes(
          goal as Goal,
        ),
    );

  return valid.length > 0
    ? [...new Set(valid)]
    : [...GOALS];
}

function productJson(
  row: ProductRow,
) {
  return {
    id: row.id,
    externalId:
      row.external_id,
    name: row.name,
    slug: row.slug,
    description:
      row.description,
    brand: row.brand,
    category:
      row.category,
    goals:
      normalizeGoals(row.goals),
    price: Number(row.price),
    oldPrice:
      row.old_price === null
        ? null
        : Number(row.old_price),
    currency:
      row.currency,
    imageUrl:
      row.image_url,
    productUrl:
      row.product_url,
    affiliateUrl:
      row.affiliate_url,
    merchantName:
      row.merchant_name,
    merchantId:
      row.merchant_id,
    network:
      row.network,
    inStock:
      row.in_stock,
    dealScore:
      row.deal_score,
    discountPercent:
      row.discount_percent,
    lastSyncedAt:
      row.last_synced_at,
  };
}

async function handleHealth(
  env: Env,
): Promise<Response> {
  try {
    await ensureDatabase(env);

    await query(
      env,
      "SELECT 1",
    );

    return json({
      ok: true,
      service:
        "fitdealfinder",
      database:
        "ok",
    });
  } catch (error) {
    console.error(
      "Health check failed:",
      error,
    );

    return errorJson(
      "Database unavailable.",
      503,
    );
  }
}

async function handleProducts(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const url =
      new URL(request.url);

    const requestedLimit =
      Number(
        url.searchParams.get(
          "limit",
        ) ?? "100",
      );

    const limit = Math.min(
      Math.max(
        Number.isFinite(
          requestedLimit,
        )
          ? requestedLimit
          : 100,
        1,
      ),
      500,
    );

    const requestedOffset =
      Number(
        url.searchParams.get(
          "offset",
        ) ?? "0",
      );

    const offset = Math.max(
      Number.isFinite(
        requestedOffset,
      )
        ? requestedOffset
        : 0,
      0,
    );

    const search =
      textOrNull(
        url.searchParams.get(
          "search",
        ),
      );

    const category =
      textOrNull(
        url.searchParams.get(
          "category",
        ),
      );

    const goal =
      textOrNull(
        url.searchParams.get(
          "goal",
        ),
      );

    const merchant =
      textOrNull(
        url.searchParams.get(
          "merchant",
        ),
      );

    const params: unknown[] =
      [];

    const where: string[] = [
      "active = TRUE",
      "in_stock = TRUE",
    ];

    if (search) {
      params.push(
        `%${search}%`,
      );

      where.push(
        `(name ILIKE $${params.length} OR brand ILIKE $${params.length})`,
      );
    }

    if (category) {
      params.push(
        category,
      );

      where.push(
        `LOWER(category) = LOWER($${params.length})`,
      );
    }

    if (
      goal &&
      GOALS.includes(
        goal as Goal,
      )
    ) {
      params.push(goal);

      where.push(
        `$${params.length} = ANY(goals)`,
      );
    }

    if (merchant) {
      params.push(
        merchant,
      );

      where.push(
        `merchant_name = $${params.length}`,
      );
    }

    params.push(limit);
    const limitParam =
      params.length;

    params.push(offset);
    const offsetParam =
      params.length;

    const rows =
      await query<ProductRow>(
        env,
        `
          SELECT *
          FROM products
          WHERE ${where.join(
            " AND ",
          )}
          ORDER BY
            deal_score DESC,
            price ASC,
            updated_at DESC
          LIMIT $${limitParam}
          OFFSET $${offsetParam}
        `,
        params,
      );

    return json({
      products:
        rows.map(
          productJson,
        ),
      count:
        rows.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error(
      "Products request failed:",
      error,
    );

    return errorJson(
      "Unable to load products.",
    );
  }
}

async function handleProductBySlug(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  try {
    const rows =
      await query<ProductRow>(
        env,
        `
          SELECT *
          FROM products
          WHERE slug = $1
            AND active = TRUE
          LIMIT 1
        `,
        [slug],
      );

    if (rows.length === 0) {
      return errorJson(
        "Product not found.",
        404,
      );
    }

    return json({
      product:
        productJson(
          rows[0],
        ),
    });
  } catch (error) {
    console.error(
      "Product request failed:",
      error,
    );

    return errorJson(
      "Unable to load product.",
    );
  }
}

function adminAuthorized(
  request: Request,
  env: Env,
): boolean {
  const supplied =
    request.headers.get(
      "x-admin-secret",
    );

  if (
    !supplied ||
    !env.ADMIN_SECRET
  ) {
    return false;
  }

  if (
    supplied.length !==
    env.ADMIN_SECRET.length
  ) {
    return false;
  }

  const encoder =
    new TextEncoder();

  const a =
    encoder.encode(
      supplied,
    );

  const b =
    encoder.encode(
      env.ADMIN_SECRET,
    );

  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    difference |=
      a[i] ^ b[i];
  }

  return difference === 0;
}

async function fetchAwinFeed(
  env: Env,
): Promise<AwinProduct[]> {
  if (
    !env.AWIN_PRODUCT_FEED_URL
  ) {
    throw new Error(
      "AWIN_PRODUCT_FEED_URL is not configured.",
    );
  }

  const url =
    safeHttps(
      env.AWIN_PRODUCT_FEED_URL,
    );

  const headers =
    new Headers();

  headers.set(
    "Accept",
    "application/json",
  );

  headers.set(
    "User-Agent",
    "FitDealFinder/3.0",
  );

  if (env.AWIN_API_KEY) {
    headers.set(
      "Authorization",
      `Bearer ${env.AWIN_API_KEY}`,
    );
  }

  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers,
        signal:
          AbortSignal.timeout(
            30_000,
          ),
      },
    );

  if (!response.ok) {
    throw new Error(
      `Awin returned HTTP ${response.status}.`,
    );
  }

  const contentType =
    response.headers.get(
      "content-type",
    ) ?? "";

  if (
    !contentType.includes(
      "application/json",
    ) &&
    !contentType.includes(
      "text/json",
    )
  ) {
    throw new Error(
      "The configured Awin feed is not JSON. Automatic import is not enabled for this feed format yet.",
    );
  }

  const data: unknown =
    await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      "Awin JSON feed must contain an array of products.",
    );
  }

  return data as AwinProduct[];
}

function mapAwinProduct(
  raw: AwinProduct,
) {
  const price =
    numberOrNull(
      raw.salePrice ??
        raw.price,
    );

  if (
    price === null ||
    price < 0
  ) {
    throw new Error(
      "Product has no valid price.",
    );
  }

  const productUrl =
    textOrNull(
      raw.productUrl,
    );

  if (!productUrl) {
    throw new Error(
      "Product has no product URL.",
    );
  }

  safeHttps(
    productUrl,
  );

  const affiliateUrl =
    textOrNull(
      raw.affiliateUrl ??
        raw.awinLink ??
        raw.deepLink,
    );

  if (
    affiliateUrl &&
    !isAwinUrl(
      affiliateUrl,
    )
  ) {
    throw new Error(
      "Invalid Awin affiliate URL.",
    );
  }

  const oldPrice =
    raw.salePrice !==
      undefined &&
    raw.price !==
      undefined
      ? numberOrNull(
          raw.price,
        )
      : null;

  const name =
    String(
      raw.name ??
        raw.title ??
        "",
    ).trim();

  if (!name) {
    throw new Error(
      "Product has no name.",
    );
  }

  const currency =
    String(
      raw.currency ??
        "EUR",
    )
      .trim()
      .toUpperCase()
      .slice(0, 3);

  const inStock =
    raw.inStock !== false;

  return {
    externalId:
      textOrNull(
        raw.id ??
          raw.productId,
      ),

    name,

    description:
      textOrNull(
        raw.description,
      ),

    brand:
      textOrNull(
        raw.brand,
      ),

    category:
      textOrNull(
        raw.category,
      ),

    goals: [
      "cut",
      "bulk",
      "lean-bulk",
    ],

    price,

    oldPrice,

    currency:
      currency.length === 3
        ? currency
        : "EUR",

    imageUrl:
      textOrNull(
        raw.imageUrl ??
          raw.image,
      ),

    productUrl,

    affiliateUrl,

    merchantName:
      String(
        raw.merchantName ??
          "Onbekende winkel",
      ).trim() ||
      "Onbekende winkel",

    merchantId:
      textOrNull(
        raw.merchantId,
      ),

    commission:
      numberOrNull(
        raw.commission,
      ),

    commissionType:
      textOrNull(
        raw.commissionType,
      ),

    inStock,
  };
}

async function saveProduct(
  env: Env,
  product: ReturnType<
    typeof mapAwinProduct
  >,
): Promise<
  "inserted" | "updated"
> {
  const discount =
    discountPercent(
      product.price,
      product.oldPrice,
    );

  const score =
    dealScore(
      product.price,
      product.oldPrice,
      product.inStock,
    );

  if (product.externalId) {
    const existing =
      await query<{
        id: string;
      }>(
        env,
        `
          SELECT id
          FROM products
          WHERE network = 'AWIN'
            AND external_id = $1
          LIMIT 1
        `,
        [
          product.externalId,
        ],
      );

    if (existing.length > 0) {
      await query(
        env,
        `
          UPDATE products
          SET
            name = $1,
            description = $2,
            brand = $3,
            category = $4,
            goals = $5,
            price = $6,
            old_price = $7,
            currency = $8,
            image_url = $9,
            product_url = $10,
            affiliate_url = $11,
            merchant_name = $12,
            merchant_id = $13,
            commission = $14,
            commission_type = $15,
            in_stock = $16,
            active = TRUE,
            deal_score = $17,
            discount_percent = $18,
            last_synced_at = NOW(),
            updated_at = NOW()
          WHERE id = $19
        `,
        [
          product.name,
          product.description,
          product.brand,
          product.category,
          product.goals,
          product.price,
          product.oldPrice,
          product.currency,
          product.imageUrl,
          product.productUrl,
          product.affiliateUrl,
          product.merchantName,
          product.merchantId,
          product.commission,
          product.commissionType,
          product.inStock,
          score,
          discount,
          existing[0].id,
        ],
      );

      return "updated";
    }
  }

  const id =
    crypto.randomUUID();

  const baseSlug =
    slugify(
      `${product.brand ?? ""}-${product.name}`,
    );

  const slug =
    `${baseSlug}-${id.slice(
      0,
      8,
    )}`;

  await query(
    env,
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
        last_synced_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24
      )
    `,
    [
      id,
      product.externalId,
      product.name,
      slug,
      product.description,
      product.brand,
      product.category,
      product.goals,
      product.price,
      product.oldPrice,
      product.currency,
      product.imageUrl,
      product.productUrl,
      product.affiliateUrl,
      product.merchantName,
      product.merchantId,
      "AWIN",
      product.commission,
      product.commissionType,
      product.inStock,
      true,
      score,
      discount,
    ],
  );

  return "inserted";
}

async function syncAwin(
  env: Env,
): Promise<{
  imported: number;
  updated: number;
  failed: number;
}> {
  const log =
    await query<{
      id: string;
    }>(
      env,
      `
        INSERT INTO sync_logs(network)
        VALUES('AWIN')
        RETURNING id
      `,
    );

  let imported = 0;
  let updated = 0;
  let failed = 0;
  let errorMessage:
    | string
    | null = null;

  try {
    const products =
      await fetchAwinFeed(
        env,
      );

    for (
      const raw of products
    ) {
      try {
        const product =
          mapAwinProduct(
            raw,
          );

        const result =
          await saveProduct(
            env,
            product,
          );

        if (
          result ===
          "inserted"
        ) {
          imported++;
        } else {
          updated++;
        }
      } catch (error) {
        failed++;

        console.error(
          "Awin product import failed:",
          error,
        );
      }
    }
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown Awin sync error.";
  }

  await query(
    env,
    `
      UPDATE sync_logs
      SET
        finished_at = NOW(),
        imported = $1,
        updated = $2,
        failed = $3,
        error_message = $4
      WHERE id = $5
    `,
    [
      imported,
      updated,
      failed,
      errorMessage,
      log[0].id,
    ],
  );

  if (errorMessage) {
    throw new Error(
      errorMessage,
    );
  }

  return {
    imported,
    updated,
    failed,
  };
}

async function handleAffiliateRedirect(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  try {
    const rows =
      await query<{
        id: string;
        affiliate_url:
          | string
          | null;
        product_url: string;
        active: boolean;
      }>(
        env,
        `
          SELECT
            id,
            affiliate_url,
            product_url,
            active
          FROM products
          WHERE id = $1
          LIMIT 1
        `,
        [id],
      );

    if (
      rows.length === 0 ||
      !rows[0].active
    ) {
      return new Response(
        "Product not found.",
        {
          status: 404,
        },
      );
    }

    const row = rows[0];

    const destination =
      row.affiliate_url &&
      isAwinUrl(
        row.affiliate_url,
      )
        ? row.affiliate_url
        : row.product_url;

    await query(
      env,
      `
        INSERT INTO affiliate_clicks(
          product_id
        )
        VALUES($1)
      `,
      [row.id],
    );

    return Response.redirect(
      destination,
      302,
    );
  } catch (error) {
    console.error(
      "Affiliate redirect failed:",
      error,
    );

    return errorJson(
      "Unable to redirect to product.",
    );
  }
}

async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(request.url);

  const pathname =
    url.pathname;

  if (
    request.method === "GET" &&
    pathname === "/api/health"
  ) {
    return handleHealth(
      env,
    );
  }

  if (
    request.method === "GET" &&
    pathname === "/api/products"
  ) {
    return handleProducts(
      request,
      env,
    );
  }

  if (
    request.method === "GET" &&
    pathname.startsWith(
      "/api/products/",
    )
  ) {
    const slug =
      decodeURIComponent(
        pathname.slice(
          "/api/products/".length,
        ),
      );

    return handleProductBySlug(
      request,
      env,
      slug,
    );
  }

  if (
    pathname ===
      "/api/admin/sync-awin" &&
    request.method === "POST"
  ) {
    if (
      !adminAuthorized(
        request,
        env,
      )
    ) {
      return errorJson(
        "Unauthorized.",
        401,
      );
    }

    try {
      const result =
        await syncAwin(
          env,
        );

      return json({
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(
        "Awin sync failed:",
        error,
      );

      return errorJson(
        error instanceof Error
          ? error.message
          : "Awin sync failed.",
      );
    }
  }

  if (
    pathname ===
      "/api/admin/sync-logs" &&
    request.method === "GET"
  ) {
    if (
      !adminAuthorized(
        request,
        env,
      )
    ) {
      return errorJson(
        "Unauthorized.",
        401,
      );
    }

    try {
      const rows =
        await query(
          env,
          `
            SELECT *
            FROM sync_logs
            ORDER BY started_at DESC
            LIMIT 20
          `,
        );

      return json({
        logs: rows,
      });
    } catch (error) {
      console.error(
        "Sync log request failed:",
        error,
      );

      return errorJson(
        "Unable to load sync logs.",
      );
    }
  }

  if (
    request.method === "GET" &&
    pathname.startsWith(
      "/go/",
    )
  ) {
    const id =
      pathname.slice(
        "/go/".length,
      );

    return handleAffiliateRedirect(
      request,
      env,
      id,
    );
  }

  return env.ASSETS.fetch(
    request,
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    try {
      return await handleRequest(
        request,
        env,
      );
    } catch (error) {
      console.error(
        "Unhandled Worker error:",
        error,
      );

      return errorJson(
        "Internal server error.",
      );
    }
  },
};
