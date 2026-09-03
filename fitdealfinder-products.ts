import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { Pool } from "pg";
import { z } from "zod";
import crypto from "node:crypto";
import path from "node:path";

const app = express();

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const AWIN_API_KEY = process.env.AWIN_API_KEY;
const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID;
const AWIN_PRODUCT_FEED_URL = process.env.AWIN_PRODUCT_FEED_URL;

const TRUST_PROXY = process.env.TRUST_PROXY === "true";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

if (!ADMIN_SECRET) {
  throw new Error("ADMIN_SECRET is required.");
}

if (ADMIN_SECRET.length < 32) {
  throw new Error("ADMIN_SECRET must contain at least 32 characters.");
}

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
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        referrerPolicy: ["strict-origin-when-cross-origin"],
      },
    },
  }),
);

app.use(express.json({ limit: "100kb" }));

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

type DbRow = Record<string, unknown>;

async function db<T extends DbRow = DbRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

/* ============================================================
   DATABASE
   ============================================================ */

async function createDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY,
      external_id TEXT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      brand TEXT,
      category TEXT,
      goals TEXT[] NOT NULL DEFAULT ARRAY['cut', 'bulk', 'lean-bulk']::TEXT[],
      price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
      old_price NUMERIC(12, 2) CHECK (old_price IS NULL OR old_price >= 0),
      currency CHAR(3) NOT NULL DEFAULT 'EUR',
      image_url TEXT,
      product_url TEXT NOT NULL,
      affiliate_url TEXT,
      merchant_name TEXT NOT NULL,
      merchant_id TEXT,
      network TEXT NOT NULL DEFAULT 'DIRECT',
      commission NUMERIC(12, 2),
      commission_type TEXT,
      in_stock BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      deal_score INTEGER NOT NULL DEFAULT 0 CHECK (deal_score BETWEEN 0 AND 100),
      discount_percent INTEGER CHECK (
        discount_percent IS NULL
        OR discount_percent BETWEEN 0 AND 100
      ),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_synced_at TIMESTAMPTZ
    );

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS goals
      TEXT[] NOT NULL DEFAULT ARRAY['cut', 'bulk', 'lean-bulk']::TEXT[];

    ALTER TABLE products
      ALTER COLUMN affiliate_url DROP NOT NULL;

    UPDATE products
    SET goals = ARRAY['cut', 'bulk', 'lean-bulk']::TEXT[]
    WHERE goals IS NULL
       OR cardinality(goals) = 0;

    ALTER TABLE products
      DROP CONSTRAINT IF EXISTS products_goals_valid;

    ALTER TABLE products
      ADD CONSTRAINT products_goals_valid
      CHECK (
        cardinality(goals) BETWEEN 1 AND 3
        AND goals <@ ARRAY['cut', 'bulk', 'lean-bulk']::TEXT[]
      );

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

    CREATE INDEX IF NOT EXISTS products_goals_idx
      ON products USING GIN(goals);

    CREATE UNIQUE INDEX IF NOT EXISTS products_network_external_id_idx
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
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS affiliate_clicks_product_idx
      ON affiliate_clicks(product_id);

    CREATE INDEX IF NOT EXISTS affiliate_clicks_created_idx
      ON affiliate_clicks(created_at);
  `);
}

/* ============================================================
   VALIDATION
   ============================================================ */

const goalSchema = z.enum(["cut", "bulk", "lean-bulk"]);

const productSchema = z.object({
  externalId: z
    .string()
    .max(200)
    .nullable()
    .optional(),

  name: z
    .string()
    .min(1)
    .max(300),

  description: z
    .string()
    .max(10_000)
    .nullable()
    .optional(),

  brand: z
    .string()
    .max(200)
    .nullable()
    .optional(),

  category: z
    .string()
    .max(200)
    .nullable()
    .optional(),

  goals: z
    .array(goalSchema)
    .min(1)
    .max(3)
    .default(["cut", "bulk", "lean-bulk"]),

  price: z
    .number()
    .finite()
    .nonnegative(),

  oldPrice: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .optional(),

  currency: z
    .string()
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

  merchantName: z
    .string()
    .min(1)
    .max(200),

  merchantId: z
    .string()
    .max(200)
    .nullable()
    .optional(),

  network: z
    .string()
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
    .max(50)
    .nullable()
    .optional(),

  inStock: z
    .boolean()
    .default(true),
});

type ProductInput = z.infer<typeof productSchema>;

/* ============================================================
   URL SECURITY
   ============================================================ */

function httpsUrl(value: string): string {
  const parsed = new URL(value);

  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed.");
  }

  return parsed.toString();
}

function isSafeAwinUrl(value: string): boolean {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    return (
      hostname === "awin.com" ||
      hostname === "www.awin.com" ||
      hostname === "awin1.com" ||
      hostname === "www.awin1.com" ||
      hostname.endsWith(".awin.com") ||
      hostname.endsWith(".awin1.com")
    );
  } catch {
    return false;
  }
}

/* ============================================================
   PRODUCT HELPERS
   ============================================================ */

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "product";
}

async function makeUniqueSlug(
  name: string,
  excludeId?: string,
): Promise<string> {
  const base = slugify(name);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate =
      attempt === 0
        ? base
        : `${base}-${attempt + 1}`;

    const rows = await db<{ id: string }>(
      `
        SELECT id
        FROM products
        WHERE slug = $1
        LIMIT 1
      `,
      [candidate],
    );

    if (rows.length === 0 || rows[0].id === excludeId) {
      return candidate;
    }
  }

  return `${base}-${crypto.randomUUID()}`;
}

function discountPercentage(
  price: number,
  oldPrice: number | null,
): number | null {
  if (
    oldPrice === null ||
    oldPrice <= 0 ||
    oldPrice <= price
  ) {
    return null;
  }

  const percentage = ((oldPrice - price) / oldPrice) * 100;

  return Math.max(0, Math.min(100, Math.round(percentage)));
}

function dealScore(product: ProductInput): number {
  let score = 40;

  const discount = discountPercentage(
    product.price,
    product.oldPrice ?? null,
  );

  if (discount !== null) {
    score += Math.min(30, Math.round(discount * 0.75));
  }

  if (product.commission !== null && product.commission !== undefined) {
    score += Math.min(10, Math.round(product.commission));
  }

  if (product.price <= 10) {
    score += 10;
  } else if (product.price <= 25) {
    score += 5;
  }

  if (!product.inStock) {
    score -= 25;
  }

  return Math.max(0, Math.min(100, score));
}

async function normalizeProduct(
  input: ProductInput,
): Promise<ProductInput> {
  const normalizedProductUrl = httpsUrl(input.productUrl);

  let normalizedAffiliateUrl: string | null = null;

  if (input.affiliateUrl) {
    if (!isSafeAwinUrl(input.affiliateUrl)) {
      throw new Error(
        "affiliateUrl must be a valid HTTPS Awin URL.",
      );
    }

    normalizedAffiliateUrl = httpsUrl(input.affiliateUrl);
  }

  let normalizedImageUrl: string | null = null;

  if (input.imageUrl) {
    normalizedImageUrl = httpsUrl(input.imageUrl);
  }

  return {
    ...input,
    productUrl: normalizedProductUrl,
    affiliateUrl: normalizedAffiliateUrl,
    imageUrl: normalizedImageUrl,
    currency: input.currency.toUpperCase(),
    goals: [...new Set(input.goals)],
  };
}

/* ============================================================
   RATE LIMITING
   ============================================================ */

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function rateLimit(
  maxRequests: number,
  windowMs: number,
) {
  return (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const key = `${getClientIp(req)}:${req.path}`;
    const now = Date.now();

    const existing = rateLimitStore.get(key);

    if (!existing || existing.resetAt <= now) {
      rateLimitStore.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });

      next();
      return;
    }

    if (existing.count >= maxRequests) {
      const retryAfter = Math.ceil(
        (existing.resetAt - now) / 1000,
      );

      res.setHeader("Retry-After", String(retryAfter));

      res.status(429).json({
        error: "Too many requests. Please try again later.",
      });

      return;
    }

    existing.count += 1;
    next();
  };
}

setInterval(() => {
  const now = Date.now();

  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}, 60_000).unref();

/* ============================================================
   ADMIN AUTH
   ============================================================ */

function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const supplied = req.header("x-admin-secret");

  if (!supplied) {
    res.status(401).json({
      error: "Unauthorized.",
    });

    return;
  }

  const expectedBuffer = Buffer.from(ADMIN_SECRET);
  const suppliedBuffer = Buffer.from(supplied);

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(
      expectedBuffer,
      suppliedBuffer,
    )
  ) {
    res.status(401).json({
      error: "Unauthorized.",
    });

    return;
  }

  next();
}

/* ============================================================
   DATABASE PRODUCT OPERATIONS
   ============================================================ */

type SavedProductResult = {
  id: string;
  created: boolean;
};

async function saveProduct(
  rawProduct: ProductInput,
): Promise<SavedProductResult> {
  const product = await normalizeProduct(rawProduct);

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
      ],
    );

    if (existing.length > 0) {
      const id = existing[0].id;

      await pool.query(
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
            updated_at = NOW(),
            last_synced_at = NOW()
          WHERE id = $19
        `,
        [
          product.name,
          product.description ?? null,
          product.brand ?? null,
          product.category ?? null,
          product.goals,
          product.price,
          product.oldPrice ?? null,
          product.currency,
          product.imageUrl ?? null,
          product.productUrl,
          product.affiliateUrl ?? null,
          product.merchantName,
          product.merchantId ?? null,
          product.commission ?? null,
          product.commissionType ?? null,
          product.inStock,
          dealScore(product),
          discountPercentage(
            product.price,
            product.oldPrice ?? null,
          ),
          id,
        ],
      );

      return {
        id,
        created: false,
      };
    }
  }

  const id = crypto.randomUUID();
  const slug = await makeUniqueSlug(product.name);

  await pool.query(
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
        created_at,
        updated_at,
        last_synced_at
      )
      VALUES (
        $1,
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
        TRUE,
        $21,
        $22,
        NOW(),
        NOW(),
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
      product.goals,
      product.price,
      product.oldPrice ?? null,
      product.currency,
      product.imageUrl ?? null,
      product.productUrl,
      product.affiliateUrl ?? null,
      product.merchantName,
      product.merchantId ?? null,
      product.network,
      product.commission ?? null,
      product.commissionType ?? null,
      product.inStock,
      dealScore(product),
      discountPercentage(
        product.price,
        product.oldPrice ?? null,
      ),
    ],
  );

  return {
    id,
    created: true,
  };
}

/* ============================================================
   PUBLIC PRODUCT RESPONSE
   ============================================================ */

type PublicProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  goals: string[];
  price: number;
  oldPrice: number | null;
  currency: string;
  imageUrl: string | null;
  merchantName: string;
  network: string;
  inStock: boolean;
  dealScore: number;
  discountPercent: number | null;
  createdAt: string;
};

function toNumberOrNull(
  value: unknown,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function publicProduct(row: DbRow): PublicProduct {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description:
      row.description === null || row.description === undefined
        ? null
        : String(row.description),
    brand:
      row.brand === null || row.brand === undefined
        ? null
        : String(row.brand),
    category:
      row.category === null || row.category === undefined
        ? null
        : String(row.category),
    goals: Array.isArray(row.goals)
      ? row.goals.map(String)
      : [],
    price: Number(row.price),
    oldPrice: toNumberOrNull(row.old_price),
    currency: String(row.currency).trim(),
    imageUrl:
      row.image_url === null || row.image_url === undefined
        ? null
        : String(row.image_url),
    merchantName: String(row.merchant_name),
    network: String(row.network),
    inStock: Boolean(row.in_stock),
    dealScore: Number(row.deal_score),
    discountPercent: toNumberOrNull(
      row.discount_percent,
    ),
    createdAt: new Date(
      String(row.created_at),
    ).toISOString(),
  };
}

/* ============================================================
   API - PRODUCTS
   ============================================================ */

app.get(
  "/api/products",
  rateLimit(120, 60_000),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limitRaw = Number(req.query.limit ?? 100);
      const offsetRaw = Number(req.query.offset ?? 0);

      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
        : 100;

      const offset = Number.isFinite(offsetRaw)
        ? Math.max(0, Math.floor(offsetRaw))
        : 0;

      const category =
        typeof req.query.category === "string"
          ? req.query.category.trim()
          : "";

      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim()
          : "";

      const goal =
        typeof req.query.goal === "string"
          ? req.query.goal.trim()
          : "";

      const sort =
        typeof req.query.sort === "string"
          ? req.query.sort
          : "deal_score";

      const values: unknown[] = [];
      const conditions: string[] = [
        "active = TRUE",
      ];

      if (category) {
        values.push(category);
        conditions.push(
          `category = $${values.length}`,
        );
      }

      if (search) {
        values.push(`%${search}%`);
        conditions.push(`
          (
            name ILIKE $${values.length}
            OR brand ILIKE $${values.length}
            OR merchant_name ILIKE $${values.length}
          )
        `);
      }

      if (goal) {
        const parsedGoal = goalSchema.safeParse(goal);

        if (!parsedGoal.success) {
          res.status(400).json({
            error:
              "Invalid goal. Use cut, bulk or lean-bulk.",
          });

          return;
        }

        values.push(parsedGoal.data);
        conditions.push(
          `goals @> ARRAY[$${values.length}]::TEXT[]`,
        );
      }

      let orderBy = "deal_score DESC, created_at DESC";

      if (sort === "price_asc") {
        orderBy = "price ASC, deal_score DESC";
      } else if (sort === "price_desc") {
        orderBy = "price DESC, deal_score DESC";
      } else if (sort === "newest") {
        orderBy = "created_at DESC";
      }

      values.push(limit);
      const limitParameter = `$${values.length}`;

      values.push(offset);
      const offsetParameter = `$${values.length}`;

      const rows = await db(
        `
          SELECT
            id,
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
            merchant_name,
            network,
            in_stock,
            deal_score,
            discount_percent,
            created_at
          FROM products
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${orderBy}
          LIMIT ${limitParameter}
          OFFSET ${offsetParameter}
        `,
        values,
      );

      res.json({
        products: rows.map(publicProduct),
        count: rows.length,
        limit,
        offset,
      });
    } catch (error) {
      next(error);
    }
  },
);

/* ============================================================
   API - SINGLE PRODUCT
   ============================================================ */

app.get(
  "/api/products/:slug",
  rateLimit(120, 60_000),
  async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const slug = req.params.slug;

      const rows = await db(
        `
          SELECT
            id,
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
            merchant_name,
            network,
            in_stock,
            deal_score,
            discount_percent,
            created_at
          FROM products
          WHERE slug = $1
            AND active = TRUE
          LIMIT 1
        `,
        [slug],
      );

      if (rows.length === 0) {
        res.status(404).json({
          error: "Product not found.",
        });

        return;
      }

      res.json({
        product: publicProduct(rows[0]),
      });
    } catch (error) {
      next(error);
    }
  },
);

/* ============================================================
   PRODUCT REDIRECT
   ============================================================ */

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

app.get(
  "/go/:id",
  rateLimit(60, 60_000),
  async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const id = req.params.id;

      if (!isUuid(id)) {
        res.status(400).send("Invalid product ID.");
        return;
      }

      const rows = await db<{
        id: string;
        product_url: string;
        affiliate_url: string | null;
      }>(
        `
          SELECT
            id,
            product_url,
            affiliate_url
          FROM products
          WHERE id = $1
            AND active = TRUE
          LIMIT 1
        `,
        [id],
      );

      if (rows.length === 0) {
        res.status(404).send("Product not found.");
        return;
      }

      const product = rows[0];

      let destination = product.product_url;

      if (
        product.affiliate_url &&
        isSafeAwinUrl(product.affiliate_url)
      ) {
        destination = product.affiliate_url;
      }

      destination = httpsUrl(destination);

      await pool.query(
        `
          INSERT INTO affiliate_clicks (
            product_id
          )
          VALUES ($1)
        `,
        [product.id],
      );

      res.redirect(302, destination);
    } catch (error) {
      next(error);
    }
  },
);

/* ============================================================
   ADMIN - CREATE / UPDATE PRODUCT
   ============================================================ */

app.post(
  "/api/admin/products",
  rateLimit(30, 60_000),
  requireAdmin,
  async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const parsed = productSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid product data.",
          details: parsed.error.flatten(),
        });

        return;
      }

      const result = await saveProduct(parsed.data);

      res.status(result.created ? 201 : 200).json({
        success: true,
        id: result.id,
        created: result.created,
      });
    } catch (error) {
      next(error);
    }
  },
);

/* ============================================================
   ADMIN - DEACTIVATE PRODUCT
   ============================================================ */

app.delete(
  "/api/admin/products/:id",
  rateLimit(30, 60_000),
  requireAdmin,
  async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const id = req.params.id;

      if (!isUuid(id)) {
        res.status(400).json({
          error: "Invalid product ID.",
        });

        return;
      }

      const result = await pool.query(
        `
          UPDATE products
          SET
            active = FALSE,
            updated_at = NOW()
          WHERE id = $1
        `,
        [id],
      );

      if (result.rowCount === 0) {
        res.status(404).json({
          error: "Product not found.",
        });

        return;
      }

      res.json({
        success: true,
      });
    } catch (error) {
      next(error);
    }
  },
);

/* ============================================================
   AWIN
   ============================================================ */

type AwinProduct = {
  id?: string | number | null;
  productId?: string | number | null;

  name?: string | null;
  title?: string | null;

  description?: string | null;
  brand?: string | null;
  category?: string | null;

  price?: number | string | null;
  salePrice?: number | string | null;
  currency?: string | null;

  imageUrl?: string | null;
  image?: string | null;

  productUrl?: string | null;
  affiliateUrl?: string | null;
  awinLink?: string | null;
  deepLink?: string | null;

  merchantName?: string | null;
  merchantId?: string | number | null;

  commission?: number | string | null;
  commissionType?: string | null;

  inStock?: boolean | null;
};

function toNumber(
  value: unknown,
): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toStringOrNull(
  value: unknown,
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
  item: AwinProduct,
): ProductInput {
  const name =
    toStringOrNull(item.name) ??
    toStringOrNull(item.title);

  const productUrl =
    toStringOrNull(item.productUrl);

  const affiliateUrl =
    toStringOrNull(item.affiliateUrl) ??
    toStringOrNull(item.awinLink) ??
    toStringOrNull(item.deepLink);

  const price =
    toNumber(item.salePrice) ??
    toNumber(item.price);

  const originalPrice =
    toNumber(item.price);

  if (!name) {
    throw new Error(
      "Awin product has no name.",
    );
  }

  if (price === null || price < 0) {
    throw new Error(
      `Awin product "${name}" has an invalid price.`,
    );
  }

  if (!productUrl) {
    throw new Error(
      `Awin product "${name}" has no product URL.`,
    );
  }

  if (!affiliateUrl) {
    throw new Error(
      `Awin product "${name}" has no affiliate URL.`,
    );
  }

  const currency =
    toStringOrNull(item.currency)?.toUpperCase() ??
    "EUR";

  if (currency.length !== 3) {
    throw new Error(
      `Awin product "${name}" has an invalid currency.`,
    );
  }

  const oldPrice =
    originalPrice !== null &&
    originalPrice > price
      ? originalPrice
      : null;

  const externalId =
    toStringOrNull(item.id) ??
    toStringOrNull(item.productId);

  const merchantId =
    toStringOrNull(item.merchantId);

  return {
    externalId,
    name,
    description:
      toStringOrNull(item.description),
    brand:
      toStringOrNull(item.brand),
    category:
      toStringOrNull(item.category),

    goals: [
      "cut",
      "bulk",
      "lean-bulk",
    ],

    price,
    oldPrice,
    currency,

    imageUrl:
      toStringOrNull(item.imageUrl) ??
      toStringOrNull(item.image),

    productUrl,
    affiliateUrl,

    merchantName:
      toStringOrNull(item.merchantName) ??
      "Unknown merchant",

    merchantId,

    network: "AWIN",

    commission:
      toNumber(item.commission),

    commissionType:
      toStringOrNull(item.commissionType),

    inStock:
      item.inStock ?? true,
  };
}

async function getAwinProducts(): Promise<AwinProduct[]> {
  if (!AWIN_API_KEY) {
    throw new Error(
      "AWIN_API_KEY is not configured.",
    );
  }

  if (!AWIN_PRODUCT_FEED_URL) {
    throw new Error(
      "AWIN_PRODUCT_FEED_URL is not configured.",
    );
  }

  const feedUrl = httpsUrl(
    AWIN_PRODUCT_FEED_URL,
  );

  const response = await fetch(feedUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${AWIN_API_KEY}`,
      "User-Agent":
        "FitDealFinder/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Awin feed request failed with HTTP ${response.status}.`,
    );
  }

  const data: unknown = await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      "Awin feed response must be a JSON array.",
    );
  }

  return data as AwinProduct[];
}

/* ============================================================
   ADMIN - AWIN SYNC
   ============================================================ */

let syncRunning = false;

app.post(
  "/api/admin/sync-awin",
  rateLimit(5, 60_000),
  requireAdmin,
  async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (syncRunning) {
      res.status(409).json({
        error: "An Awin sync is already running.",
      });

      return;
    }

    syncRunning = true;

    const logResult = await pool.query<{
      id: string;
    }>(
      `
        INSERT INTO sync_logs (
          network,
          started_at
        )
        VALUES (
          'AWIN',
          NOW()
        )
        RETURNING id
      `,
    );

    const syncLogId = logResult.rows[0].id;

    let imported = 0;
    let updated = 0;
    let failed = 0;

    try {
      const awinProducts =
        await getAwinProducts();

      if (awinProducts.length > 100_000) {
        throw new Error(
          "Awin feed contains more than 100,000 products.",
        );
      }

      for (const item of awinProducts) {
        try {
          const mapped =
            mapAwinProduct(item);

          const result =
            await saveProduct(mapped);

          if (result.created) {
            imported += 1;
          } else {
            updated += 1;
          }
        } catch {
          failed += 1;
        }
      }

      await pool.query(
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
          syncLogId,
        ],
      );

      res.json({
        success: true,
        network: "AWIN",
        publisherId:
          AWIN_PUBLISHER_ID ?? null,
        imported,
        updated,
        failed,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown Awin sync error.";

      await pool.query(
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
          message,
          syncLogId,
        ],
      );

      next(error);
    } finally {
      syncRunning = false;
    }
  },
);

/* ============================================================
   HEALTH
   ============================================================ */

app.get(
  "/health",
  async (
    _req: Request,
    res: Response,
  ) => {
    try {
      await pool.query("SELECT 1");

      res.json({
        status: "ok",
        database: "ok",
      });
    } catch {
      res.status(503).json({
        status: "error",
        database: "unavailable",
      });
    }
  },
);

/* ============================================================
   STATIC FRONTEND
   ============================================================ */

const publicDirectory = path.join(
  process.cwd(),
  "public",
);

app.use(
  express.static(publicDirectory, {
    extensions: ["html"],
  }),
);

/* ============================================================
   404
   ============================================================ */

app.use(
  (
    req: Request,
    res: Response,
  ) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({
        error: "Not found.",
      });

      return;
    }

    res.status(404).send("Page not found.");
  },
);

/* ============================================================
   ERROR HANDLER
   ============================================================ */

app.use(
  (
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    console.error(error);

    if (res.headersSent) {
      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : "Internal server error.";

    res.status(500).json({
      error: message,
    });
  },
);

/* ============================================================
   START SERVER
   ============================================================ */

async function start(): Promise<void> {
  try {
    await createDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `FitDealFinder server running on port ${PORT}`,
        );
      },
    );
  } catch (error) {
    console.error(
      "Failed to start FitDealFinder:",
      error,
    );

    await pool.end();

    process.exit(1);
  }
}

void start();

