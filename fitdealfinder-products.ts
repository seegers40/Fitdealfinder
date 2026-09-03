

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

const PORT = Number(process.env.PORT ?? 3000);

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const AWIN_API_KEY = process.env.AWIN_API_KEY;
const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID;
const AWIN_PRODUCT_FEED_URL = process.env.AWIN_PRODUCT_FEED_URL;

const TRUST_PROXY = process.env.TRUST_PROXY === "true";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

if (!ADMIN_SECRET) {
  throw new Error("ADMIN_SECRET is required");
}

if (ADMIN_SECRET.length < 32) {
  throw new Error("ADMIN_SECRET must be at least 32 characters long");
}

const app = express();

if (TRUST_PROXY) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

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
        upgradeInsecureRequests: [],
      },
    },
    referrerPolicy: {
      policy: "strict-origin-when-cross-origin",
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

type Goal = "cut" | "bulk" | "lean-bulk";

const VALID_GOALS: Goal[] = ["cut", "bulk", "lean-bulk"];

const goalSchema = z.enum(VALID_GOALS);

const productSchema = z.object({
  externalId: z.string().trim().min(1).max(255).nullable().optional(),
  name: z.string().trim().min(1).max(255),
  slug: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  brand: z.string().trim().max(255).nullable().optional(),
  category: z.string().trim().min(1).max(100),
  goals: z.array(goalSchema).min(1).max(3).default(VALID_GOALS),
  price: z.number().nonnegative(),
  oldPrice: z.number().nonnegative().nullable().optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/)
    .default("EUR"),
  imageUrl: z.string().url().nullable().optional(),
  productUrl: z.string().url(),
  affiliateUrl: z.string().url().nullable().optional(),
  merchantName: z.string().trim().max(255).nullable().optional(),
  merchantId: z.string().trim().max(255).nullable().optional(),
  network: z.string().trim().max(100).default("direct"),
  commission: z.number().nonnegative().nullable().optional(),
  commissionType: z.string().trim().max(100).nullable().optional(),
  inStock: z.boolean().default(true),
  active: z.boolean().default(true),
});

type ProductInput = z.infer<typeof productSchema>;

type NormalizedProduct = {
  externalId: string | null;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string;
  goals: Goal[];
  price: number;
  oldPrice: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string;
  affiliateUrl: string | null;
  merchantName: string | null;
  merchantId: string | null;
  network: string;
  commission: number | null;
  commissionType: string | null;
  inStock: boolean;
  active: boolean;
  discountPercent: number;
  dealScore: number;
};

const isValidGoal = (value: string): value is Goal =>
  VALID_GOALS.includes(value as Goal);

const uniqueGoals = (goals: Goal[]): Goal[] =>
  [...new Set(goals)].filter(isValidGoal);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function discountPercentage(price: number, oldPrice: number | null): number {
  if (!oldPrice || oldPrice <= price || oldPrice <= 0) {
    return 0;
  }

  return Math.round(((oldPrice - price) / oldPrice) * 100);
}

function calculateDealScore(
  price: number,
  oldPrice: number | null,
  inStock: boolean,
): number {
  const discount = discountPercentage(price, oldPrice);

  let score = discount * 2;

  if (inStock) {
    score += 20;
  }

  if (price > 0 && price < 25) {
    score += 10;
  }

  return Math.min(100, Math.round(score));
}

function normalizeProduct(input: ProductInput): NormalizedProduct {
  const goals = uniqueGoals(input.goals);

  return {
    externalId: input.externalId ?? null,
    name: input.name,
    slug: slugify(input.slug ?? input.name),
    description: input.description ?? null,
    brand: input.brand ?? null,
    category: input.category,
    goals: goals.length > 0 ? goals : [...VALID_GOALS],
    price: input.price,
    oldPrice: input.oldPrice ?? null,
    currency: input.currency,
    imageUrl: input.imageUrl ?? null,
    productUrl: input.productUrl,
    affiliateUrl: input.affiliateUrl ?? null,
    merchantName: input.merchantName ?? null,
    merchantId: input.merchantId ?? null,
    network: input.network,
    commission: input.commission ?? null,
    commissionType: input.commissionType ?? null,
    inStock: input.inStock,
    active: input.active,
    discountPercent: discountPercentage(
      input.price,
      input.oldPrice ?? null,
    ),
    dealScore: calculateDealScore(
      input.price,
      input.oldPrice ?? null,
      input.inStock,
    ),
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeAwinUrl(value: string): boolean {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      return false;
    }

    const hostname = url.hostname.toLowerCase();

    return (
      hostname === "awin.com" ||
      hostname.endsWith(".awin.com") ||
      hostname === "awin1.com" ||
      hostname.endsWith(".awin1.com")
    );
  } catch {
    return false;
  }
}

function timingSafeSecretMatches(
  provided: string | undefined,
): boolean {
  if (!provided) {
    return false;
  }

  const expected = Buffer.from(ADMIN_SECRET, "utf8");
  const actual = Buffer.from(provided, "utf8");

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

function requireAdmin(req: Request, res: Response): boolean {
  const provided = req.header("x-admin-secret");

  if (!timingSafeSecretMatches(provided)) {
    res.status(401).json({
      error: "Unauthorized",
    });

    return false;
  }

  return true;
}

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

function rateLimit(
  maxRequests: number,
  windowMs: number,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
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

    existing.count += 1;

    if (existing.count > maxRequests) {
      res.status(429).json({
        error: "Too many requests",
      });

      return;
    }

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

async function createDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      external_id TEXT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      brand TEXT,
      category TEXT NOT NULL,

      goals TEXT[] NOT NULL
        DEFAULT ARRAY['cut','bulk','lean-bulk']::text[],

      price NUMERIC(12,2) NOT NULL,
      old_price NUMERIC(12,2),

      currency CHAR(3) NOT NULL DEFAULT 'EUR',

      image_url TEXT,
      product_url TEXT NOT NULL,
      affiliate_url TEXT,

      merchant_name TEXT,
      merchant_id TEXT,

      network TEXT NOT NULL DEFAULT 'direct',

      commission NUMERIC(10,2),
      commission_type TEXT,

      in_stock BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,

      deal_score NUMERIC(6,2) NOT NULL DEFAULT 0,
      discount_percent NUMERIC(6,2) NOT NULL DEFAULT 0,

      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS goals TEXT[]
    NOT NULL
    DEFAULT ARRAY['cut','bulk','lean-bulk']::text[];
  `);

  await pool.query(`
    ALTER TABLE products
    ALTER COLUMN affiliate_url DROP NOT NULL;
  `);

  await pool.query(`
    UPDATE products
    SET goals = ARRAY['cut','bulk','lean-bulk']::text[]
    WHERE goals IS NULL
       OR cardinality(goals) = 0;
  `);

  await pool.query(`
    ALTER TABLE products
    DROP CONSTRAINT IF EXISTS products_goals_valid;
  `);

  await pool.query(`
    ALTER TABLE products
    ADD CONSTRAINT products_goals_valid
    CHECK (
      cardinality(goals) BETWEEN 1 AND 3
      AND goals <@ ARRAY['cut','bulk','lean-bulk']::text[]
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS products_category_idx
    ON products(category);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS products_brand_idx
    ON products(brand);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS products_merchant_idx
    ON products(merchant_name);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS products_deal_score_idx
    ON products(deal_score DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS products_active_idx
    ON products(active);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS products_goals_idx
    ON products USING GIN(goals);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS products_network_external_idx
    ON products(network, external_id)
    WHERE external_id IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      network TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      imported INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      error_message TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      destination TEXT NOT NULL,
      ip_hash TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS affiliate_clicks_product_idx
    ON affiliate_clicks(product_id);
  `);
}

async function createUniqueSlug(
  baseSlug: string,
  existingId?: string,
): Promise<string> {
  const safeBase = baseSlug || "product";

  const result = await pool.query<{ slug: string }>(
    `
      SELECT slug
      FROM products
      WHERE slug = $1
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      LIMIT 1
    `,
    [safeBase, existingId ?? null],
  );

  if (result.rowCount === 0) {
    return safeBase;
  }

  for (let i = 2; i <= 1000; i += 1) {
    const candidate = `${safeBase}-${i}`;

    const candidateResult = await pool.query<{ slug: string }>(
      `
        SELECT slug
        FROM products
        WHERE slug = $1
          AND ($2::uuid IS NULL OR id <> $2::uuid)
        LIMIT 1
      `,
      [candidate, existingId ?? null],
    );

    if (candidateResult.rowCount === 0) {
      return candidate;
    }
  }

  throw new Error("Unable to generate unique slug");
}

async function saveProduct(
  input: ProductInput,
): Promise<void> {
  const product = normalizeProduct(input);

  if (product.externalId) {
    await pool.query(
      `
        INSERT INTO products (
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
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,NOW(),NOW()
        )
        ON CONFLICT (network, external_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          description = EXCLUDED.description,
          brand = EXCLUDED.brand,
          category = EXCLUDED.category,
          goals = EXCLUDED.goals,
          price = EXCLUDED.price,
          old_price = EXCLUDED.old_price,
          currency = EXCLUDED.currency,
          image_url = EXCLUDED.image_url,
          product_url = EXCLUDED.product_url,
          affiliate_url = EXCLUDED.affiliate_url,
          merchant_name = EXCLUDED.merchant_name,
          merchant_id = EXCLUDED.merchant_id,
          commission = EXCLUDED.commission,
          commission_type = EXCLUDED.commission_type,
          in_stock = EXCLUDED.in_stock,
          active = EXCLUDED.active,
          deal_score = EXCLUDED.deal_score,
          discount_percent = EXCLUDED.discount_percent,
          last_synced_at = NOW(),
          updated_at = NOW()
      `,
      [
        product.externalId,
        product.name,
        product.slug,
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
        product.network,
        product.commission,
        product.commissionType,
        product.inStock,
        product.active,
        product.dealScore,
        product.discountPercent,
      ],
    );

    return;
  }

  const slug = await createUniqueSlug(product.slug);

  await pool.query(
    `
      INSERT INTO products (
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
        discount_percent
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      )
    `,
    [
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
      product.network,
      product.commission,
      product.commissionType,
      product.inStock,
      product.active,
      product.dealScore,
      product.discountPercent,
    ],
  );
}

function publicProduct(row: Record<string, unknown>) {
  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    brand: row.brand,
    category: row.category,
    goals: row.goals,
    price: Number(row.price),
    oldPrice:
      row.old_price === null
        ? null
        : Number(row.old_price),
    currency: row.currency,
    imageUrl: row.image_url,
    merchantName: row.merchant_name,
    network: row.network,
    inStock: row.in_stock,
    active: row.active,
    dealScore: Number(row.deal_score),
    discountPercent: Number(row.discount_percent),
    lastSyncedAt: row.last_synced_at,
  };
}

app.get(
  "/api/products",
  rateLimit(120, 60_000),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawLimit = Number(req.query.limit ?? 50);
      const rawOffset = Number(req.query.offset ?? 0);

      const limit = Math.min(
        Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1),
        100,
      );

      const offset = Math.max(
        Number.isFinite(rawOffset) ? rawOffset : 0,
        0,
      );

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

      const allowedSorts: Record<string, string> = {
        deal_score: "deal_score DESC, price ASC",
        price_asc: "price ASC",
        price_desc: "price DESC",
        newest: "created_at DESC",
        name: "name ASC",
      };

      const orderBy =
        allowedSorts[sort] ?? allowedSorts.deal_score;

      const values: unknown[] = [];
      const conditions = ["active = TRUE"];

      if (category) {
        values.push(category);
        conditions.push(`category = $${values.length}`);
      }

      if (search) {
        values.push(`%${search}%`);
        conditions.push(
          `(name ILIKE $${values.length}
            OR brand ILIKE $${values.length})`,
        );
      }

      if (goal && isValidGoal(goal)) {
        values.push(goal);
        conditions.push(
          `$${values.length} = ANY(goals)`,
        );
      }

      values.push(limit);
      const limitParam = values.length;

      values.push(offset);
      const offsetParam = values.length;

      const result = await pool.query(
        `
          SELECT
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
            merchant_name,
            network,
            in_stock,
            active,
            deal_score,
            discount_percent,
            last_synced_at
          FROM products
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${orderBy}
          LIMIT $${limitParam}
          OFFSET $${offsetParam}
        `,
        values,
      );

      res.json({
        products: result.rows.map(publicProduct),
        limit,
        offset,
        count: result.rowCount,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/products/:slug",
  rateLimit(120, 60_000),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await pool.query(
        `
          SELECT
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
            merchant_name,
            network,
            in_stock,
            active,
            deal_score,
            discount_percent,
            last_synced_at
          FROM products
          WHERE slug = $1
            AND active = TRUE
          LIMIT 1
        `,
        [req.params.slug],
      );

      if (result.rowCount === 0) {
        res.status(404).json({
          error: "Product not found",
        });

        return;
      }

      res.json(publicProduct(result.rows[0]));
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/go/:id",
  rateLimit(60, 60_000),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          id,
        )
      ) {
        res.status(400).json({
          error: "Invalid product id",
        });

        return;
      }

      const result = await pool.query<{
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

      if (result.rowCount === 0) {
        res.status(404).json({
          error: "Product not found",
        });

        return;
      }

      const product = result.rows[0];

      const destination =
        product.affiliate_url &&
        isSafeAwinUrl(product.affiliate_url)
          ? product.affiliate_url
          : product.product_url;

      if (!isHttpsUrl(destination)) {
        res.status(500).json({
          error: "Invalid destination URL",
        });

        return;
      }

      const ip =
        typeof req.ip === "string"
          ? crypto
              .createHash("sha256")
              .update(req.ip)
              .digest("hex")
          : null;

      await pool.query(
        `
          INSERT INTO affiliate_clicks (
            product_id,
            destination,
            ip_hash,
            user_agent
          )
          VALUES ($1, $2, $3, $4)
        `,
        [
          product.id,
          destination,
          ip,
          req.get("user-agent") ?? null,
        ],
      );

      res.redirect(302, destination);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/products",
  rateLimit(30, 60_000),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!requireAdmin(req, res)) {
        return;
      }

      const parsed = productSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid product data",
          details: parsed.error.flatten(),
        });

        return;
      }

      await saveProduct(parsed.data);

      res.status(201).json({
        success: true,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/products/:id",
  rateLimit(30, 60_000),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!requireAdmin(req, res)) {
        return;
      }

      const id = req.params.id;

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
          error: "Product not found",
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

type AwinProduct = Record<string, unknown>;

function toNumber(
  value: unknown,
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
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
    typeof value === "string" &&
    value.trim().length > 0
  ) {
    return value.trim();
  }

  return null;
}

function mapAwinProduct(
  item: AwinProduct,
): ProductInput | null {
  const name =
    toStringOrNull(
      item.productName ??
        item.name ??
        item.title,
    );

  const productUrl =
    toStringOrNull(
      item.productUrl ??
        item.product_url ??
        item.url,
    );

  const affiliateUrl =
    toStringOrNull(
      item.awinLink ??
        item.affiliateUrl ??
        item.affiliate_url ??
        item.deepLink,
    );

  const price =
    toNumber(
      item.searchPrice ??
        item.price ??
        item.currentPrice,
    );

  if (
    !name ||
    !productUrl ||
    !affiliateUrl ||
    price === null
  ) {
    return null;
  }

  if (!isHttpsUrl(productUrl)) {
    return null;
  }

  if (!isSafeAwinUrl(affiliateUrl)) {
    return null;
  }

  const oldPrice =
    toNumber(
      item.previousPrice ??
        item.oldPrice ??
        item.old_price,
    );

  const currency =
    toStringOrNull(
      item.currency ??
        item.currencyCode,
    ) ?? "EUR";

  const normalizedCurrency =
    currency.toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    return null;
  }

  /*
   * Awin levert niet gegarandeerd een betrouwbare FitDealFinder-
   * doelcategorie mee.
   *
   * Daarom gebruiken we voorlopig alle drie de doelen.
   * Zodra de echte Awin-feed bekend is, kunnen we hier gericht
   * mappen op categorie/producttype.
   */
  const goals: Goal[] = [
    "cut",
    "bulk",
    "lean-bulk",
  ];

  return {
    externalId:
      toStringOrNull(
        item.productId ??
          item.awinProductId ??
          item.id,
      ),
    name,
    description:
      toStringOrNull(
        item.description,
      ),
    brand:
      toStringOrNull(
        item.brand ??
          item.manufacturer,
      ),
    category:
      toStringOrNull(
        item.category ??
          item.productType,
      ) ?? "overig",
    goals,
    price,
    oldPrice,
    currency: normalizedCurrency,
    imageUrl:
      toStringOrNull(
        item.imageUrl ??
          item.image_url ??
          item.image,
      ),
    productUrl,
    affiliateUrl,
    merchantName:
      toStringOrNull(
        item.merchantName ??
          item.merchant,
      ),
    merchantId:
      toStringOrNull(
        item.merchantId,
      ),
    network: "awin",
    commission:
      toNumber(
        item.commission,
      ),
    commissionType:
      toStringOrNull(
        item.commissionType,
      ),
    inStock:
      item.inStock !== false &&
      item.in_stock !== false,
    active: true,
  };
}

async function getAwinProducts(): Promise<AwinProduct[]> {
  if (!AWIN_PRODUCT_FEED_URL) {
    throw new Error(
      "AWIN_PRODUCT_FEED_URL is not configured",
    );
  }

  if (
    !AWIN_API_KEY ||
    !AWIN_PUBLISHER_ID
  ) {
    throw new Error(
      "AWIN_API_KEY and AWIN_PUBLISHER_ID are required for Awin sync",
    );
  }

  if (
    AWIN_API_KEY === "YOUR_AWIN_API_KEY" ||
    AWIN_PUBLISHER_ID === "YOUR_PUBLISHER_ID" ||
    AWIN_PRODUCT_FEED_URL.includes(
      "YOUR-AWIN-FEED-URL",
    )
  ) {
    throw new Error(
      "Awin credentials/feed URL are still placeholders",
    );
  }

  const response = await fetch(
    AWIN_PRODUCT_FEED_URL,
    {
      headers: {
        Authorization: `Bearer ${AWIN_API_KEY}`,
        Accept: "application/json",
        "User-Agent":
          "FitDealFinder/1.0",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Awin feed request failed with status ${response.status}`,
    );
  }

  const data: unknown =
    await response.json();

  if (Array.isArray(data)) {
    return data as AwinProduct[];
  }

  if (
    typeof data === "object" &&
    data !== null &&
    "products" in data &&
    Array.isArray(
      (data as { products: unknown }).products,
    )
  ) {
    return (
      (data as {
        products: AwinProduct[];
      }).products
    );
  }

  throw new Error(
    "Unsupported Awin feed response format",
  );
}

let syncRunning = false;

app.post(
  "/api/admin/awin/sync",
  rateLimit(5, 60_000),
  async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) {
      return;
    }

    if (syncRunning) {
      res.status(409).json({
        error: "Awin sync already running",
      });

      return;
    }

    syncRunning = true;

    let logId: string | null = null;

    try {
      const logResult = await pool.query<{
        id: string;
      }>(
        `
          INSERT INTO sync_logs (
            network,
            status
          )
          VALUES ('awin', 'running')
          RETURNING id
        `,
      );

      logId = logResult.rows[0].id;

      const awinProducts =
        await getAwinProducts();

      let imported = 0;
      let failed = 0;

      for (const item of awinProducts.slice(
        0,
        100_000,
      )) {
        try {
          const mapped =
            mapAwinProduct(item);

          if (!mapped) {
            failed += 1;
            continue;
          }

          const parsed =
            productSchema.safeParse(mapped);

          if (!parsed.success) {
            failed += 1;
            continue;
          }

          await saveProduct(parsed.data);

          imported += 1;
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
            failed = $2,
            status = 'completed'
          WHERE id = $3
        `,
        [imported, failed, logId],
      );

      res.json({
        success: true,
        imported,
        failed,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown Awin sync error";

      if (logId) {
        await pool.query(
          `
            UPDATE sync_logs
            SET
              finished_at = NOW(),
              status = 'failed',
              error_message = $1
            WHERE id = $2
          `,
          [message, logId],
        );
      }

      res.status(500).json({
        error: "Awin sync failed",
      });
    } finally {
      syncRunning = false;
    }
  },
);

app.get(
  "/api/health",
  async (_req: Request, res: Response) => {
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

const publicDirectory = path.join(
  process.cwd(),
  "public",
);

app.use(
  express.static(publicDirectory, {
    extensions: ["html"],
  }),
);

app.use(
  (
    req: Request,
    res: Response,
  ) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({
        error: "Not found",
      });

      return;
    }

    res.sendFile(
      path.join(
        publicDirectory,
        "index.html",
      ),
    );
  },
);

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

    res.status(500).json({
      error: "Internal server error",
    });
  },
);

async function start(): Promise<void> {
  await createDatabase();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `FitDealFinder server running on port ${PORT}`,
    );
  });
}

start().catch((error) => {
  console.error(
    "Failed to start FitDealFinder:",
    error,
  );

  process.exit(1);
});
