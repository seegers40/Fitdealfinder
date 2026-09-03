/**
 * FitDealFinder
 * Products API + PostgreSQL + toekomstige Awin-integratie
 *
 * Vereiste environment variables:
 * DATABASE_URL
 * ADMIN_SECRET
 *
 * Optioneel voor later:
 * AWIN_API_KEY
 * AWIN_PUBLISHER_ID
 * AWIN_PRODUCT_FEED_URL
 *
 * PORT=3000
 * TRUST_PROXY=false
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { Pool } from "pg";
import { z } from "zod";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const AWIN_API_KEY = process.env.AWIN_API_KEY;
const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID;
const AWIN_PRODUCT_FEED_URL = process.env.AWIN_PRODUCT_FEED_URL;

const TRUST_PROXY = process.env.TRUST_PROXY === "true";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

if (!ADMIN_SECRET) {
  throw new Error("ADMIN_SECRET is missing.");
}

if (ADMIN_SECRET.length < 32) {
  throw new Error(
    "ADMIN_SECRET must contain at least 32 characters."
  );
}

app.disable("x-powered-by");
app.set("trust proxy", TRUST_PROXY);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        imgSrc: ["'self'", "https:", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
    referrerPolicy: {
      policy: "strict-origin-when-cross-origin",
    },
  })
);

app.use(
  express.json({
    limit: "100kb",
  })
);

/* -------------------------------------------------------------------------- */
/* DATABASE                                                                    */
/* -------------------------------------------------------------------------- */

const database = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: true }
      : undefined,
});

async function db<T = any>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await database.query(sql, params);
  return result.rows as T[];
}

async function createDatabase() {
  await db(`
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY,
      external_id TEXT,

      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,

      brand TEXT,
      category TEXT,

      price NUMERIC(12,2) NOT NULL
        CHECK (price >= 0),

      old_price NUMERIC(12,2)
        CHECK (
          old_price IS NULL
          OR old_price >= 0
        ),

      currency CHAR(3) NOT NULL DEFAULT 'EUR',

      image_url TEXT,
      product_url TEXT NOT NULL,

      affiliate_url TEXT,

      merchant_name TEXT NOT NULL,
      merchant_id TEXT,

      network TEXT NOT NULL DEFAULT 'DIRECT',

      commission NUMERIC(12,2),
      commission_type TEXT,

      in_stock BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,

      deal_score INTEGER NOT NULL DEFAULT 0
        CHECK (deal_score BETWEEN 0 AND 100),

      discount_percent INTEGER
        CHECK (
          discount_percent IS NULL
          OR discount_percent BETWEEN 0 AND 100
        ),

      last_synced_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE products
      ALTER COLUMN affiliate_url DROP NOT NULL;

    CREATE INDEX IF NOT EXISTS products_category_idx
      ON products(category);

    CREATE INDEX IF NOT EXISTS products_brand_idx
      ON products(brand);

    CREATE INDEX IF NOT EXISTS products_merchant_idx
      ON products(merchant_name);

    CREATE INDEX IF NOT EXISTS products_score_idx
      ON products(deal_score DESC);

    CREATE INDEX IF NOT EXISTS products_active_idx
      ON products(active);

    CREATE UNIQUE INDEX IF NOT EXISTS products_network_external_idx
      ON products(network, external_id)
      WHERE external_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sync_logs (
      id BIGSERIAL PRIMARY KEY,
      network TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,

      imported INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,

      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id BIGSERIAL PRIMARY KEY,

      product_id UUID NOT NULL
        REFERENCES products(id)
        ON DELETE CASCADE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS affiliate_clicks_product_idx
      ON affiliate_clicks(product_id, created_at);
  `);
}

/* -------------------------------------------------------------------------- */
/* VALIDATION                                                                  */
/* -------------------------------------------------------------------------- */

const productSchema = z.object({
  externalId: z.string().trim().min(1).max(200).nullable().optional(),

  name: z.string().trim().min(1).max(300),

  description: z
    .string()
    .trim()
    .max(10000)
    .nullable()
    .optional(),

  brand: z.string().trim().max(200).nullable().optional(),

  category: z.string().trim().max(200).nullable().optional(),

  price: z.number().finite().nonnegative(),

  oldPrice: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .optional(),

  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),

  imageUrl: z
    .string()
    .url()
    .max(2048)
    .nullable()
    .optional(),

  productUrl: z
    .string()
    .url()
    .max(2048),

  affiliateUrl: z
    .string()
    .url()
    .max(2048)
    .nullable()
    .optional(),

  merchantName: z.string().trim().min(1).max(200),

  merchantId: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional(),

  network: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .default("DIRECT"),

  commission: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .optional(),

  commissionType: z
    .string()
    .trim()
    .max(50)
    .nullable()
    .optional(),

  inStock: z.boolean().default(true),
});

type ProductInput = z.infer<typeof productSchema>;

/* -------------------------------------------------------------------------- */
/* URL SECURITY                                                                */
/* -------------------------------------------------------------------------- */

function httpsUrl(value: string): URL {
  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed.");
  }

  return url;
}

function isSafeAwinUrl(value: string): boolean {
  try {
    const host = httpsUrl(value).hostname.toLowerCase();

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

/* -------------------------------------------------------------------------- */
/* PRODUCT HELPERS                                                             */
/* -------------------------------------------------------------------------- */

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

async function makeUniqueSlug(base: string): Promise<string> {
  const clean = slugify(base) || "product";

  for (let i = 0; i < 100; i++) {
    const slug = i === 0 ? clean : `${clean}-${i + 1}`;

    const existing = await db(
      `
      SELECT id
      FROM products
      WHERE slug = $1
      LIMIT 1
      `,
      [slug]
    );

    if (existing.length === 0) {
      return slug;
    }
  }

  return `${clean}-${crypto.randomUUID().slice(0, 8)}`;
}

function discountPercentage(
  price: number,
  oldPrice?: number | null
): number | null {
  if (!oldPrice || oldPrice <= price || oldPrice <= 0) {
    return null;
  }

  return Math.min(
    100,
    Math.max(
      0,
      Math.round(((oldPrice - price) / oldPrice) * 100)
    )
  );
}

function dealScore(product: {
  price: number;
  oldPrice?: number | null;
  commission?: number | null;
  inStock: boolean;
}): number {
  if (!product.inStock) {
    return 0;
  }

  const discount = discountPercentage(
    product.price,
    product.oldPrice
  );

  let score = 0;

  if (discount !== null) {
    score += Math.min(60, Math.round(discount * 1.5));
  }

  if (
    product.commission !== null &&
    product.commission !== undefined
  ) {
    score += Math.min(20, Math.round(product.commission));
  }

  if (product.price > 0 && product.price < 50) {
    score += 10;
  }

  if (
    product.oldPrice &&
    product.oldPrice > product.price
  ) {
    score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

function normalizeProduct(input: ProductInput) {
  const productUrl = httpsUrl(input.productUrl);

  let affiliateUrl: string | null = null;

  if (input.affiliateUrl) {
    if (!isSafeAwinUrl(input.affiliateUrl)) {
      throw new Error(
        "Affiliate URL must be a valid approved Awin URL."
      );
    }

    affiliateUrl = httpsUrl(
      input.affiliateUrl
    ).toString();
  }

  const discount = discountPercentage(
    input.price,
    input.oldPrice
  );

  const score = dealScore({
    price: input.price,
    oldPrice: input.oldPrice,
    commission: input.commission,
    inStock: input.inStock,
  });

  return {
    ...input,
    productUrl: productUrl.toString(),
    affiliateUrl,
    discountPercent: discount,
    dealScore: score,
  };
}

/* -------------------------------------------------------------------------- */
/* RATE LIMITING                                                               */
/* -------------------------------------------------------------------------- */

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const ip = req.ip || "unknown";
    const now = Date.now();

    const bucket = rateBuckets.get(ip);

    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(ip, {
        count: 1,
        resetAt: now + windowMs,
      });

      return next();
    }

    if (bucket.count >= maxRequests) {
      res.setHeader(
        "Retry-After",
        String(
          Math.ceil((bucket.resetAt - now) / 1000)
        )
      );

      return res.status(429).json({
        error: "Too many requests.",
      });
    }

    bucket.count += 1;

    return next();
  };
}

setInterval(() => {
  const now = Date.now();

  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) {
      rateBuckets.delete(key);
    }
  }
}, 60_000).unref();

/* -------------------------------------------------------------------------- */
/* ADMIN AUTH                                                                  */
/* -------------------------------------------------------------------------- */

function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const supplied = req.header("x-admin-secret");

  if (!supplied) {
    return res.status(401).json({
      error: "Unauthorized.",
    });
  }

  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(ADMIN_SECRET!);

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(
      suppliedBuffer,
      expectedBuffer
    )
  ) {
    return res.status(401).json({
      error: "Unauthorized.",
    });
  }

  return next();
}

/* -------------------------------------------------------------------------- */
/* SAVE PRODUCT                                                                */
/* -------------------------------------------------------------------------- */

async function saveProduct(
  input: ProductInput
): Promise<"inserted" | "updated"> {
  const product = normalizeProduct(input);

  if (product.externalId) {
    const existing = await db<{ id: string }>(
      `
      SELECT id
      FROM products
      WHERE network = $1
        AND external_id = $2
      LIMIT 1
      `,
      [
        product.network,
        product.externalId,
      ]
    );

    if (existing.length > 0) {
      await db(
        `
        UPDATE products
        SET
          name = $1,
          description = $2,
          brand = $3,
          category = $4,
          price = $5,
          old_price = $6,
          currency = $7,
          image_url = $8,
          product_url = $9,
          affiliate_url = $10,
          merchant_name = $11,
          merchant_id = $12,
          commission = $13,
          commission_type = $14,
          in_stock = $15,
          deal_score = $16,
          discount_percent = $17,
          active = TRUE,
          last_synced_at = NOW(),
          updated_at = NOW()
        WHERE id = $18::uuid
        `,
        [
          product.name,
          product.description ?? null,
          product.brand ?? null,
          product.category ?? null,
          product.price,
          product.oldPrice ?? null,
          product.currency,
          product.imageUrl ?? null,
          product.productUrl,
          product.affiliateUrl,
          product.merchantName,
          product.merchantId ?? null,
          product.commission ?? null,
          product.commissionType ?? null,
          product.inStock,
          product.dealScore,
          product.discountPercent,
          existing[0].id,
        ]
      );

      return "updated";
    }
  }

  const id = crypto.randomUUID();

  const slug = await makeUniqueSlug(product.name);

  await db(
    `
    INSERT INTO products (
      id,
      external_id,
      name,
      slug,
      description,
      brand,
      category,
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
      deal_score,
      discount_percent,
      active,
      last_synced_at
    )
    VALUES (
      $1::uuid,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      $13,
      $14,
      $15,
      $16,
      $17,
      $18,
      $19,
      $20,
      $21,
      TRUE,
      NOW()
    )
    `,
    [
      id,
      product.externalId ?? null,
      product.name,
      slug,
      product.description ?? null,
      product.brand ?? null,
      product.category ?? null,
      product.price,
      product.oldPrice ?? null,
      product.currency,
      product.imageUrl ?? null,
      product.productUrl,
      product.affiliateUrl,
      product.merchantName,
      product.merchantId ?? null,
      product.network,
      product.commission ?? null,
      product.commissionType ?? null,
      product.inStock,
      product.dealScore,
      product.discountPercent,
    ]
  );

  return "inserted";
}

/* -------------------------------------------------------------------------- */
/* PUBLIC API                                                                  */
/* -------------------------------------------------------------------------- */

app.get(
  "/api/products",
  rateLimit(120, 60_000),
  async (req: Request, res: Response) => {
    try {
      let limit = Number(req.query.limit ?? 100);
      let offset = Number(req.query.offset ?? 0);

      if (!Number.isFinite(limit)) {
        limit = 100;
      }

      if (!Number.isFinite(offset)) {
        offset = 0;
      }

      limit = Math.min(
        Math.max(Math.floor(limit), 1),
        100
      );

      offset = Math.max(
        Math.floor(offset),
        0
      );

      const category =
        typeof req.query.category === "string"
          ? req.query.category.trim().slice(0, 200)
          : null;

      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim().slice(0, 200)
          : null;

      const sort =
        req.query.sort === "price_asc"
          ? "price ASC"
          : req.query.sort === "price_desc"
            ? "price DESC"
            : req.query.sort === "newest"
              ? "created_at DESC"
              : "deal_score DESC";

      const products = await db(
        `
        SELECT
          id,
          name,
          slug,
          description,
          brand,
          category,
          price,
          old_price AS "oldPrice",
          currency,
          image_url AS "imageUrl",
          product_url AS "productUrl",
          affiliate_url AS "affiliateUrl",
          merchant_name AS "merchantName",
          network,
          in_stock AS "inStock",
          deal_score AS "dealScore",
          discount_percent AS "discountPercent"
        FROM products
        WHERE active = TRUE

        AND (
          $1::text IS NULL
          OR category = $1
        )

        AND (
          $2::text IS NULL
          OR name ILIKE '%' || $2 || '%'
          OR brand ILIKE '%' || $2 || '%'
        )

        ORDER BY ${sort}
        LIMIT $3
        OFFSET $4
        `,
        [
          category,
          search,
          limit,
          offset,
        ]
      );

      return res.json({
        products,
        limit,
        offset,
      });
    } catch (error) {
      console.error("Products error:", error);

      return res.status(500).json({
        error: "Internal server error.",
      });
    }
  }
);

/* -------------------------------------------------------------------------- */
/* SINGLE PRODUCT                                                              */
/* -------------------------------------------------------------------------- */

app.get(
  "/api/products/:slug",
  rateLimit(120, 60_000),
  async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug)
        .trim()
        .slice(0, 200);

      const products = await db(
        `
        SELECT
          id,
          name,
          slug,
          description,
          brand,
          category,
          price,
          old_price AS "oldPrice",
          currency,
          image_url AS "imageUrl",
          product_url AS "productUrl",
          affiliate_url AS "affiliateUrl",
          merchant_name AS "merchantName",
          network,
          in_stock AS "inStock",
          deal_score AS "dealScore",
          discount_percent AS "discountPercent"
        FROM products
        WHERE slug = $1
          AND active = TRUE
        LIMIT 1
        `,
        [slug]
      );

      if (products.length === 0) {
        return res.status(404).json({
          error: "Product not found.",
        });
      }

      return res.json(products[0]);
    } catch (error) {
      console.error(
        "Product detail error:",
        error
      );

      return res.status(500).json({
        error: "Internal server error.",
      });
    }
  }
);

/* -------------------------------------------------------------------------- */
/* SAFE PRODUCT REDIRECT                                                       */
/* -------------------------------------------------------------------------- */

app.get(
  "/go/:id",
  rateLimit(60, 60_000),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);

      if (
        !/^[0-9a-f-]{36}$/i.test(id)
      ) {
        return res
          .status(400)
          .send("Invalid product.");
      }

      const products = await db<{
        id: string;
        product_url: string;
        affiliate_url: string | null;
        active: boolean;
      }>(
        `
        SELECT
          id,
          product_url,
          affiliate_url,
          active
        FROM products
        WHERE id = $1::uuid
        LIMIT 1
        `,
        [id]
      );

      if (
        products.length === 0 ||
        !products[0].active
      ) {
        return res
          .status(404)
          .send("Product not found.");
      }

      const product = products[0];

      let destination = product.product_url;

      if (
        product.affiliate_url &&
        isSafeAwinUrl(product.affiliate_url)
      ) {
        destination = product.affiliate_url;
      }

      const safeDestination =
        httpsUrl(destination).toString();

      await db(
        `
        INSERT INTO affiliate_clicks (
          product_id
        )
        VALUES ($1::uuid)
        `,
        [id]
      );

      return res.redirect(
        302,
        safeDestination
      );
    } catch (error) {
      console.error(
        "Redirect error:",
        error
      );

      return res
        .status(500)
        .send(
          "Unable to process product link."
        );
    }
  }
);

/* -------------------------------------------------------------------------- */
/* ADMIN CREATE / UPDATE                                                       */
/* -------------------------------------------------------------------------- */

app.post(
  "/api/admin/products",
  rateLimit(30, 60_000),
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const parsed =
        productSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid product.",
          details:
            parsed.error.flatten(),
        });
      }

      const action =
        await saveProduct(parsed.data);

      return res
        .status(
          action === "inserted"
            ? 201
            : 200
        )
        .json({
          ok: true,
          action,
        });
    } catch (error) {
      console.error(
        "Admin product error:",
        error
      );

      return res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Invalid product.",
      });
    }
  }
);

/* -------------------------------------------------------------------------- */
/* ADMIN DEACTIVATE                                                           */
/* -------------------------------------------------------------------------- */

app.delete(
  "/api/admin/products/:id",
  rateLimit(30, 60_000),
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);

      if (
        !/^[0-9a-f-]{36}$/i.test(id)
      ) {
        return res.status(400).json({
          error: "Invalid product ID.",
        });
      }

      const result =
        await database.query(
          `
          UPDATE products
          SET
            active = FALSE,
            updated_at = NOW()
          WHERE id = $1::uuid
          `,
          [id]
        );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "Product not found.",
        });
      }

      return res.json({
        ok: true,
      });
    } catch (error) {
      console.error(
        "Delete product error:",
        error
      );

      return res.status(500).json({
        error: "Internal server error.",
      });
    }
  }
);

/* -------------------------------------------------------------------------- */
/* AWIN SUPPORT                                                               */
/* -------------------------------------------------------------------------- */

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

function toNumber(
  value: unknown
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

function toStringOrNull(
  value: unknown
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const result = String(value).trim();

  return result || null;
}

function mapAwinProduct(
  raw: AwinProduct
): ProductInput {
  const price = toNumber(
    raw.salePrice ?? raw.price
  );

  if (price === null) {
    throw new Error(
      "Product has no valid price."
    );
  }

  const productUrl =
    toStringOrNull(
      raw.productUrl
    );

  const affiliateUrl =
    toStringOrNull(
      raw.affiliateUrl ??
        raw.awinLink ??
        raw.deepLink
    );

  if (
    !productUrl ||
    !affiliateUrl
  ) {
    throw new Error(
      "Awin product is missing a URL."
    );
  }

  return productSchema.parse({
    externalId:
      toStringOrNull(
        raw.id ??
          raw.productId
      ),

    name:
      String(
        raw.name ??
          raw.title ??
          ""
      ).trim(),

    description:
      toStringOrNull(
        raw.description
      ),

    brand:
      toStringOrNull(
        raw.brand
      ),

    category:
      toStringOrNull(
        raw.category
      ),

    price,

    oldPrice:
      raw.salePrice !== undefined &&
      raw.price !== undefined
        ? toNumber(raw.price)
        : null,

    currency:
      String(
        raw.currency ?? "EUR"
      ).slice(0, 3),

    imageUrl:
      toStringOrNull(
        raw.imageUrl ??
          raw.image
      ),

    productUrl,

    affiliateUrl,

    merchantName:
      String(
        raw.merchantName ??
          "Unknown merchant"
      ).trim(),

    merchantId:
      toStringOrNull(
        raw.merchantId
      ),

    network: "AWIN",

    commission:
      toNumber(
        raw.commission
      ),

    commissionType:
      toStringOrNull(
        raw.commissionType
      ),

    inStock:
      raw.inStock !== false,
  });
}

async function getAwinProducts():
  Promise<AwinProduct[]> {
  if (!AWIN_API_KEY) {
    throw new Error(
      "AWIN_API_KEY is missing."
    );
  }

  if (!AWIN_PRODUCT_FEED_URL) {
    throw new Error(
      "AWIN_PRODUCT_FEED_URL is missing."
    );
  }

  const feed =
    httpsUrl(
      AWIN_PRODUCT_FEED_URL
    );

  const response =
    await fetch(feed, {
      method: "GET",

      headers: {
        Accept:
          "application/json",

        Authorization:
          `Bearer ${AWIN_API_KEY}`,

        "User-Agent":
          "FitDealFinder/1.0",
      },

      signal:
        AbortSignal.timeout(
          30_000
        ),
    });

  if (!response.ok) {
    throw new Error(
      `Awin returned HTTP ${response.status}.`
    );
  }

  const data: unknown =
    await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      "Unexpected Awin feed format."
    );
  }

  return data as AwinProduct[];
}

let syncRunning = false;

app.post(
  "/api/admin/sync-awin",
  rateLimit(5, 60_000),
  requireAdmin,
  async (
    _req: Request,
    res: Response
  ) => {
    if (syncRunning) {
      return res.status(409).json({
        error:
          "Awin synchronization is already running.",
      });
    }

    syncRunning = true;

    let imported = 0;
    let updated = 0;
    let failed = 0;

    const logs = await db<{ id: string }>(
      `
      INSERT INTO sync_logs (network)
      VALUES ('AWIN')
      RETURNING id
      `
    );

    const logId = logs[0].id;

    try {
      const awinProducts =
        await getAwinProducts();

      if (awinProducts.length > 100000) {
        throw new Error(
          "Awin feed is larger than the allowed limit."
        );
      }

      for (
        const raw of awinProducts
      ) {
        try {
          const product =
            mapAwinProduct(raw);

          const result =
            await saveProduct(
              product
            );

          if (
            result === "inserted"
          ) {
            imported++;
          } else {
            updated++;
          }
        } catch (error) {
          failed++;

          console.error(
            "Awin product import failed:",
            error
          );
        }
      }

      await database.query(
        `
        UPDATE sync_logs
        SET
          finished_at = NOW(),
          imported = $1,
          updated = $2,
          failed = $3
        WHERE id = $4
        `,
        [
          imported,
          updated,
          failed,
          logId,
        ]
      );

      return res.json({
        ok: true,
        imported,
        updated,
        failed,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error.";

      await database.query(
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
          message.slice(0, 5000),
          logId,
        ]
      );

      console.error(
        "Awin sync failed:",
        error
      );

      return res.status(500).json({
        error:
          "Awin synchronization failed.",
        imported,
        updated,
        failed,
      });
    } finally {
      syncRunning = false;
    }
  }
);

/* -------------------------------------------------------------------------- */
/* HEALTH                                                                      */
/* -------------------------------------------------------------------------- */

app.get(
  "/health",
  async (
    _req: Request,
    res: Response
  ) => {
    try {
      await database.query(
        "SELECT 1"
      );

      return res.json({
        ok: true,
      });
    } catch {
      return res.status(503).json({
        ok: false,
      });
    }
  }
);

/* -------------------------------------------------------------------------- */
/* STATIC FRONTEND                                                             */
/* -------------------------------------------------------------------------- */

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const publicDirectory =
  path.join(
    __dirname,
    "public"
  );

app.use(
  express.static(
    publicDirectory
  )
);

/* -------------------------------------------------------------------------- */
/* 404                                                                         */
/* -------------------------------------------------------------------------- */

app.use(
  (
    _req: Request,
    res: Response
  ) => {
    res.status(404).json({
      error: "Not found.",
    });
  }
);

/* -------------------------------------------------------------------------- */
/* ERROR HANDLER                                                               */
/* -------------------------------------------------------------------------- */

app.use(
  (
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    console.error(
      "Unhandled error:",
      error
    );

    return res.status(500).json({
      error:
        "Internal server error.",
    });
  }
);

/* -------------------------------------------------------------------------- */
/* START                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  await createDatabase();

  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `FitDealFinder running on port ${PORT}`
      );

      console.log(
        AWIN_PUBLISHER_ID
          ? "Awin publisher configured."
          : "Awin not configured yet."
      );
    }
  );
}

main().catch(
  (error) => {
    console.error(
      "Fatal startup error:",
      error
    );

    process.exit(1);
  }
);
