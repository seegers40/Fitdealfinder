import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { Pool, type QueryResultRow } from "pg";
import { z } from "zod";
import crypto from "crypto";
import path from "path";

const app = express();

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const AWIN_API_KEY = process.env.AWIN_API_KEY;
const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID;
const AWIN_PRODUCT_FEED_URL = process.env.AWIN_PRODUCT_FEED_URL;

const TRUST_PROXY = process.env.TRUST_PROXY === "true";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL ontbreekt.");
}

if (!ADMIN_SECRET || ADMIN_SECRET.length < 32) {
  throw new Error("ADMIN_SECRET ontbreekt of is korter dan 32 tekens.");
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

const ALL_GOALS: Goal[] = ["cut", "bulk", "lean-bulk"];

const productSchema = z.object({
  externalId: z.string().max(200).nullable().optional(),
  name: z.string().min(1).max(300),
  description: z.string().max(10_000).nullable().optional(),
  brand: z.string().max(200).nullable().optional(),
  category: z.string().max(200).nullable().optional(),

  goals: z
    .array(z.enum(["cut", "bulk", "lean-bulk"]))
    .min(1)
    .max(3)
    .default(ALL_GOALS),

  price: z.number().finite().nonnegative(),
  oldPrice: z.number().finite().nonnegative().nullable().optional(),

  currency: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase()),

  imageUrl: z.string().url().max(2048).nullable().optional(),
  productUrl: z.string().url().max(2048),
  affiliateUrl: z.string().url().max(2048).nullable().optional(),

  merchantName: z.string().min(1).max(200),
  merchantId: z.string().max(200).nullable().optional(),

  network: z.string().min(1).max(100).default("DIRECT"),

  commission: z.number().finite().nonnegative().nullable().optional(),
  commissionType: z.string().max(100).nullable().optional(),

  inStock: z.boolean().default(true),
});

type ProductInput = z.infer<typeof productSchema>;

interface ProductRow extends QueryResultRow {
  id: string;
  external_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  goals: Goal[];
  price: number | string;
  old_price: number | string | null;
  currency: string;
  image_url: string | null;
  merchant_name: string;
  merchant_id: string | null;
  network: string;
  commission: number | string | null;
  commission_type: string | null;
  in_stock: boolean;
  active: boolean;
  deal_score: number;
  discount_percent: number | null;
  created_at: Date;
  updated_at: Date;
  last_synced_at: Date | null;
}

interface PublicProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  goals: Goal[];
  price: number;
  oldPrice: number | null;
  currency: string;
  imageUrl: string | null;
  merchantName: string;
  merchantId: string | null;
  network: string;
  inStock: boolean;
  active: boolean;
  dealScore: number;
  discountPercent: number | null;
  createdAt: string;
  updatedAt: string;
}

function db<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return pool.query<T>(text, values);
}

function httpsUrl(value: string | null | undefined, fieldName: string) {
  if (!value) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${fieldName} is geen geldige URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${fieldName} moet HTTPS gebruiken.`);
  }

  return parsed.toString();
}

function isSafeAwinUrl(value: string) {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    return (
      hostname === "awin.com" ||
      hostname === "www.awin.com" ||
      hostname.endsWith(".awin.com") ||
      hostname === "awin1.com" ||
      hostname === "www.awin1.com" ||
      hostname.endsWith(".awin1.com")
    );
  } catch {
    return false;
  }
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

async function makeUniqueSlug(name: string, excludeId?: string) {
  const base = slugify(name) || "product";

  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;

    const result = excludeId
      ? await db<{ id: string }>(
          `
            SELECT id
            FROM products
            WHERE slug = $1
              AND id <> $2
            LIMIT 1
          `,
          [candidate, excludeId],
        )
      : await db<{ id: string }>(
          `
            SELECT id
            FROM products
            WHERE slug = $1
            LIMIT 1
          `,
          [candidate],
        );

    if (result.rowCount === 0) {
      return candidate;
    }
  }

  return `${base}-${crypto.randomUUID()}`;
}

function discountPercentage(
  price: number,
  oldPrice: number | null | undefined,
) {
  if (
    oldPrice === null ||
    oldPrice === undefined ||
    oldPrice <= 0 ||
    oldPrice <= price
  ) {
    return null;
  }

  const discount = ((oldPrice - price) / oldPrice) * 100;

  return Math.max(0, Math.min(100, Math.round(discount)));
}

function calculateDealScore(input: {
  price: number;
  oldPrice?: number | null;
  commission?: number | null;
  inStock: boolean;
}) {
  let score = 50;

  const discount = discountPercentage(input.price, input.oldPrice);

  if (discount !== null) {
    score += Math.min(30, Math.round(discount * 0.75));
  }

  if (input.commission !== null && input.commission !== undefined) {
    score += Math.min(10, Math.round(input.commission * 0.5));
  }

  if (input.price <= 10) {
    score += 5;
  } else if (input.price <= 25) {
    score += 3;
  }

  if (!input.inStock) {
    score -= 30;
  }

  return Math.max(0, Math.min(100, score));
}

function normalizeProduct(input: ProductInput) {
  const productUrl = httpsUrl(input.productUrl, "productUrl");

  if (!productUrl) {
    throw new Error("productUrl ontbreekt.");
  }

  const imageUrl = httpsUrl(input.imageUrl, "imageUrl");
  const affiliateUrl = httpsUrl(input.affiliateUrl, "affiliateUrl");

  const oldPrice =
    input.oldPrice !== null && input.oldPrice !== undefined
      ? Number(input.oldPrice)
      : null;

  const price = Number(input.price);

  const goals = Array.from(new Set(input.goals)) as Goal[];

  if (goals.length === 0) {
    throw new Error("Een product moet minimaal één doel hebben.");
  }

  return {
    externalId: input.externalId ?? null,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    brand: input.brand?.trim() || null,
    category: input.category?.trim() || null,
    goals,
    price,
    oldPrice,
    currency: input.currency,
    imageUrl,
    productUrl,
    affiliateUrl,
    merchantName: input.merchantName.trim(),
    merchantId: input.merchantId?.trim() || null,
    network: input.network.trim().toUpperCase(),
    commission:
      input.commission !== null && input.commission !== undefined
        ? Number(input.commission)
        : null,
    commissionType: input.commissionType?.trim() || null,
    inStock: input.inStock,
  };
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

      goals TEXT[] NOT NULL
        DEFAULT ARRAY['cut', 'bulk', 'lean-bulk']::TEXT[],

      price NUMERIC(12, 2) NOT NULL
        CHECK (price >= 0),

      old_price NUMERIC(12, 2)
        CHECK (old_price IS NULL OR old_price >= 0),

      currency CHAR(3) NOT NULL DEFAULT 'EUR',

      image_url TEXT,
      product_url TEXT NOT NULL,
      affiliate_url TEXT,

      merchant_name TEXT NOT NULL,
      merchant_id TEXT,

      network TEXT NOT NULL DEFAULT 'DIRECT',

      commission NUMERIC(12, 4),
      commission_type TEXT,

      in_stock BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,

      deal_score INTEGER NOT NULL DEFAULT 50
        CHECK (deal_score BETWEEN 0 AND 100),

      discount_percent INTEGER
        CHECK (
          discount_percent IS NULL
          OR discount_percent BETWEEN 0 AND 100
        ),

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_synced_at TIMESTAMPTZ
    );
  `);

  await db(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS goals TEXT[]
      DEFAULT ARRAY['cut', 'bulk', 'lean-bulk']::TEXT[];
  `);

  await db(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS affiliate_url TEXT;
  `);

  await db(`
    UPDATE products
    SET goals = ARRAY['cut', 'bulk', 'lean-bulk']::TEXT[]
    WHERE goals IS NULL
       OR cardinality(goals) = 0
       OR COALESCE(
            goals <@ ARRAY['cut', 'bulk', 'lean-bulk']::TEXT[],
            FALSE
          ) = FALSE;
  `);

  await db(`
    ALTER TABLE products
    ALTER COLUMN goals SET DEFAULT
      ARRAY['cut', 'bulk', 'lean-bulk']::TEXT[];
  `);

  await db(`
    ALTER TABLE products
    ALTER COLUMN goals SET NOT NULL;
  `);

  await db(`
    ALTER TABLE products
    ALTER COLUMN affiliate_url DROP NOT NULL;
  `);

  await db(`
    ALTER TABLE products
    DROP CONSTRAINT IF EXISTS products_goals_valid;
  `);

  await db(`
    ALTER TABLE products
    ADD CONSTRAINT products_goals_valid
    CHECK (
      cardinality(goals) BETWEEN 1 AND 3
      AND goals <@ ARRAY['cut', 'bulk', 'lean-bulk']::TEXT[]
    );
  `);

  await db(`
    CREATE INDEX IF NOT EXISTS products_category_idx
      ON products(category);
  `);

  await db(`
    CREATE INDEX IF NOT EXISTS products_brand_idx
      ON products(brand);
  `);

  await db(`
    CREATE INDEX IF NOT EXISTS products_merchant_idx
      ON products(merchant_name);
  `);

  await db(`
    CREATE INDEX IF NOT EXISTS products_deal_score_idx
      ON products(deal_score DESC);
  `);

  await db(`
    CREATE INDEX IF NOT EXISTS products_active_idx
      ON products(active);
  `);

  await db(`
    CREATE INDEX IF NOT EXISTS products_goals_idx
      ON products USING GIN(goals);
  `);

  await db(`
    CREATE UNIQUE INDEX IF NOT EXISTS products_network_external_idx
      ON products(network, external_id)
      WHERE external_id IS NOT NULL;
  `);

  await db(`
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
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id BIGSERIAL PRIMARY KEY,
      product_id UUID NOT NULL
        REFERENCES products(id)
        ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db(`
    CREATE INDEX IF NOT EXISTS affiliate_clicks_product_idx
      ON affiliate_clicks(product_id);
  `);

  await db(`
    CREATE INDEX IF NOT EXISTS affiliate_clicks_created_idx
      ON affiliate_clicks(created_at DESC);
  `);
}

function productToPublic(row: ProductRow): PublicProduct {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    brand: row.brand,
    category: row.category,
    goals: row.goals,
    price: Number(row.price),
    oldPrice:
      row.old_price === null ? null : Number(row.old_price),
    currency: row.currency.trim(),
    imageUrl: row.image_url,
    merchantName: row.merchant_name,
    merchantId: row.merchant_id,
    network: row.network,
    inStock: row.in_stock,
    active: row.active,
    dealScore: row.deal_score,
    discountPercent: row.discount_percent,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function saveProduct(input: ProductInput) {
  const product = normalizeProduct(input);

  const dealScore = calculateDealScore({
    price: product.price,
    oldPrice: product.oldPrice,
    commission: product.commission,
    inStock: product.inStock,
  });

  const discountPercent = discountPercentage(
    product.price,
    product.oldPrice,
  );

  if (product.externalId) {
    const existing = await db<{ id: string }>(
      `
        SELECT id
        FROM products
        WHERE network = $1
          AND external_id = $2
        LIMIT 1
      `,
      [product.network, product.externalId],
    );

    if (existing.rowCount && existing.rows[0]) {
      const id = existing.rows[0].id;

      const updated = await db<ProductRow>(
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
          RETURNING *
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
          dealScore,
          discountPercent,
          id,
        ],
      );

      return {
        action: "updated" as const,
        product: updated.rows[0],
      };
    }
  }

  const slug = await makeUniqueSlug(product.name);
  const id = crypto.randomUUID();

  const inserted = await db<ProductRow>(
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
        NOW()
      )
      RETURNING *
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
      product.network,
      product.commission,
      product.commissionType,
      product.inStock,
      dealScore,
      discountPercent,
    ],
  );

  return {
    action: "inserted" as const,
    product: inserted.rows[0],
  };
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function rateLimit(options: {
  windowMs: number;
  max: number;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const forwarded = req.ip || "unknown";
    const key = `${req.path}:${forwarded}`;
    const now = Date.now();

    const current = rateLimitStore.get(key);

    if (!current || current.resetAt <= now) {
      rateLimitStore.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });

      next();
      return;
    }

    current.count += 1;

    if (current.count > options.max) {
      const retryAfter = Math.max(
        1,
        Math.ceil((current.resetAt - now) / 1000),
      );

      res.setHeader("Retry-After", String(retryAfter));

      res.status(429).json({
        error: "Te veel verzoeken. Probeer het later opnieuw.",
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

function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const supplied = req.header("x-admin-secret");

  if (!supplied) {
    res.status(401).json({
      error: "Niet geautoriseerd.",
    });

    return;
  }

  const expectedBuffer = Buffer.from(ADMIN_SECRET);
  const suppliedBuffer = Buffer.from(supplied);

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    res.status(401).json({
      error: "Niet geautoriseerd.",
    });

    return;
  }

  next();
}

const publicProductSelect = `
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
    merchant_id,
    network,
    in_stock,
    active,
    deal_score,
    discount_percent,
    created_at,
    updated_at,
    last_synced_at
  FROM products
`;

app.get(
  "/api/products",
  rateLimit({
    windowMs: 60_000,
    max: 120,
  }),
  async (req, res, next) => {
    try {
      const rawLimit = Number(req.query.limit ?? 100);
      const rawOffset = Number(req.query.offset ?? 0);

      const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(100, Math.floor(rawLimit)))
        : 100;

      const offset = Number.isFinite(rawOffset)
        ? Math.max(0, Math.floor(rawOffset))
        : 0;

      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim()
          : "";

      const category =
        typeof req.query.category === "string"
          ? req.query.category.trim()
          : "";

      const goal =
        typeof req.query.goal === "string"
          ? req.query.goal.trim()
          : "";

      if (goal && !ALL_GOALS.includes(goal as Goal)) {
        res.status(400).json({
          error: "Ongeldig doel.",
        });

        return;
      }

      const sort =
        typeof req.query.sort === "string"
          ? req.query.sort
          : "deal_score";

      const values: unknown[] = [];
      const conditions: string[] = ["active = TRUE"];

      if (search) {
        values.push(`%${search}%`);
        const parameter = `$${values.length}`;

        conditions.push(`
          (
            name ILIKE ${parameter}
            OR COALESCE(brand, '') ILIKE ${parameter}
            OR merchant_name ILIKE ${parameter}
          )
        `);
      }

      if (category) {
        values.push(category);
        conditions.push(`category = $${values.length}`);
      }

      if (goal) {
        values.push(goal);
        conditions.push(`$${values.length} = ANY(goals)`);
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

      const result = await db<ProductRow>(
        `
          ${publicProductSelect}
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${orderBy}
          LIMIT ${limitParameter}
          OFFSET ${offsetParameter}
        `,
        values,
      );

      res.json({
        products: result.rows.map(productToPublic),
        limit,
        offset,
        count: result.rows.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/products/:slug",
  rateLimit({
    windowMs: 60_000,
    max: 120,
  }),
  async (req, res, next) => {
    try {
      const result = await db<ProductRow>(
        `
          ${publicProductSelect}
          WHERE slug = $1
            AND active = TRUE
          LIMIT 1
        `,
        [req.params.slug],
      );

      if (result.rowCount === 0) {
        res.status(404).json({
          error: "Product niet gevonden.",
        });

        return;
      }

      res.json({
        product: productToPublic(result.rows[0]),
      });
    } catch (error) {
      next(error);
    }
  },
);

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

app.get(
  "/go/:id",
  rateLimit({
    windowMs: 60_000,
    max: 60,
  }),
  async (req, res, next) => {
    try {
      const id = req.params.id;

      if (!isUuid(id)) {
        res.status(400).send("Ongeldige product-ID.");
        return;
      }

      const result = await db<{
        id: string;
        product_url: string;
        affiliate_url: string | null;
        network: string;
      }>(
        `
          SELECT
            id,
            product_url,
            affiliate_url,
            network
          FROM products
          WHERE id = $1
            AND active = TRUE
          LIMIT 1
        `,
        [id],
      );

      if (result.rowCount === 0) {
        res.status(404).send("Product niet gevonden.");
        return;
      }

      const product = result.rows[0];

      let destination: string | null = null;

      if (
        product.affiliate_url &&
        product.network === "AWIN" &&
        isSafeAwinUrl(product.affiliate_url)
      ) {
        destination = product.affiliate_url;
      }

      if (!destination) {
        destination = httpsUrl(
          product.product_url,
          "product_url",
        );
      }

      if (!destination) {
        res.status(404).send("Geen geldige productlink beschikbaar.");
        return;
      }

      await db(
        `
          INSERT INTO affiliate_clicks(product_id)
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

app.post(
  "/api/admin/products",
  rateLimit({
    windowMs: 60_000,
    max: 30,
  }),
  requireAdmin,
  async (req, res, next) => {
    try {
      const parsed = productSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: "Ongeldige productgegevens.",
          details: parsed.error.flatten(),
        });

        return;
      }

      const result = await saveProduct(parsed.data);

      res.status(result.action === "inserted" ? 201 : 200).json({
        action: result.action,
        product: productToPublic(result.product),
      });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/products/:id",
  rateLimit({
    windowMs: 60_000,
    max: 30,
  }),
  requireAdmin,
  async (req, res, next) => {
    try {
      const id = req.params.id;

      if (!isUuid(id)) {
        res.status(400).json({
          error: "Ongeldige product-ID.",
        });

        return;
      }

      const result = await db(
        `
          UPDATE products
          SET
            active = FALSE,
            updated_at = NOW()
          WHERE id = $1
            AND active = TRUE
        `,
        [id],
      );

      if (result.rowCount === 0) {
        res.status(404).json({
          error: "Product niet gevonden.",
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

interface AwinProduct {
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

  inStock?: boolean | string | number;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const normalized = value.replace(",", ".");
    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

function toBoolean(
  value: unknown,
  fallback = true,
) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (
      [
        "true",
        "1",
        "yes",
        "in stock",
        "instock",
      ].includes(normalized)
    ) {
      return true;
    }

    if (
      [
        "false",
        "0",
        "no",
        "out of stock",
        "outofstock",
      ].includes(normalized)
    ) {
      return false;
    }
  }

  return fallback;
}

function mapAwinProduct(
  item: AwinProduct,
): ProductInput | null {
  const name =
    toStringOrNull(item.name) ??
    toStringOrNull(item.title);

  const productUrl = toStringOrNull(item.productUrl);

  if (!name || !productUrl) {
    return null;
  }

  const price =
    toNumber(item.salePrice) ??
    toNumber(item.price);

  if (price === null || price < 0) {
    return null;
  }

  const originalPrice = toNumber(item.price);
  const salePrice = toNumber(item.salePrice);

  const oldPrice =
    salePrice !== null &&
    originalPrice !== null &&
    originalPrice > salePrice
      ? originalPrice
      : null;

  const affiliateUrl =
    toStringOrNull(item.affiliateUrl) ??
    toStringOrNull(item.awinLink) ??
    toStringOrNull(item.deepLink);

  const currency =
    toStringOrNull(item.currency)?.toUpperCase() ??
    "EUR";

  if (!/^[A-Z]{3}$/.test(currency)) {
    return null;
  }

  const externalId =
    toStringOrNull(item.id) ??
    toStringOrNull(item.productId);

  const merchantName =
    toStringOrNull(item.merchantName) ??
    "Onbekende aanbieder";

  const merchantId =
    toStringOrNull(item.merchantId);

  const brand =
    toStringOrNull(item.brand);

  const category =
    toStringOrNull(item.category);

  const description =
    toStringOrNull(item.description);

  const imageUrl =
    toStringOrNull(item.imageUrl) ??
    toStringOrNull(item.image);

  const commission =
    toNumber(item.commission);

  const commissionType =
    toStringOrNull(item.commissionType);

  return {
    externalId,
    name,
    description,
    brand,
    category,
    goals: ALL_GOALS,
    price,
    oldPrice,
    currency,
    imageUrl,
    productUrl,
    affiliateUrl,
    merchantName,
    merchantId,
    network: "AWIN",
    commission,
    commissionType,
    inStock: toBoolean(item.inStock, true),
  };
}

async function getAwinProducts(): Promise<AwinProduct[]> {
  if (!AWIN_API_KEY) {
    throw new Error("AWIN_API_KEY ontbreekt.");
  }

  if (!AWIN_PRODUCT_FEED_URL) {
    throw new Error("AWIN_PRODUCT_FEED_URL ontbreekt.");
  }

  httpsUrl(
    AWIN_PRODUCT_FEED_URL,
    "AWIN_PRODUCT_FEED_URL",
  );

  const response = await fetch(
    AWIN_PRODUCT_FEED_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${AWIN_API_KEY}`,
        Accept: "application/json",
        "User-Agent": "FitDealFinder/1.0",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Awin feed gaf HTTP ${response.status}.`,
    );
  }

  const contentType =
    response.headers.get("content-type") ?? "";

  if (
    !contentType
      .toLowerCase()
      .includes("json")
  ) {
    throw new Error(
      "De opgegeven Awin feed levert geen JSON. De feed moet eerst worden aangepast aan het werkelijke Awin-formaat.",
    );
  }

  const payload: unknown =
    await response.json();

  if (!Array.isArray(payload)) {
    throw new Error(
      "De Awin feed bevat geen JSON-array.",
    );
  }

  return payload as AwinProduct[];
}

let syncRunning = false;

app.post(
  "/api/admin/sync-awin",
  rateLimit({
    windowMs: 60_000,
    max: 5,
  }),
  requireAdmin,
  async (_req, res, next) => {
    if (syncRunning) {
      res.status(409).json({
        error:
          "Er draait al een Awin-synchronisatie.",
      });

      return;
    }

    syncRunning = true;

    const syncLog = await db<{ id: string }>(
      `
        INSERT INTO sync_logs(network)
        VALUES ('AWIN')
        RETURNING id
      `,
    );

    const syncId = syncLog.rows[0].id;

    let imported = 0;
    let updated = 0;
    let failed = 0;

    try {
      const products =
        await getAwinProducts();

      if (products.length > 100_000) {
        throw new Error(
          "Awin feed bevat meer dan 100.000 producten.",
        );
      }

      for (const item of products) {
        try {
          const mapped =
            mapAwinProduct(item);

          if (!mapped) {
            failed += 1;
            continue;
          }

          const result =
            await saveProduct(mapped);

          if (
            result.action === "inserted"
          ) {
            imported += 1;
          } else {
            updated += 1;
          }
        } catch {
          failed += 1;
        }
      }

      await db(
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
          syncId,
        ],
      );

      res.json({
        success: true,
        network: "AWIN",
        publisherIdConfigured:
          Boolean(AWIN_PUBLISHER_ID),
        imported,
        updated,
        failed,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Onbekende fout.";

      await db(
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
          message.slice(0, 2_000),
          syncId,
        ],
      ).catch(() => undefined);

      next(error);
    } finally {
      syncRunning = false;
    }
  },
);

app.get("/health", async (_req, res) => {
  try {
    await db("SELECT 1");

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
});

const publicDirectory = path.join(
  process.cwd(),
  "public",
);

app.use(
  express.static(publicDirectory, {
    index: "index.html",
  }),
);

app.use((_req, res) => {
  res.status(404).json({
    error: "Niet gevonden.",
  });
});

const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  console.error(error);

  if (res.headersSent) {
    next(error);
    return;
  }

  res.status(500).json({
    error: "Interne serverfout.",
  });
};

app.use(errorHandler);

async function start() {
  await createDatabase();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `FitDealFinder draait op poort ${PORT}.`,
    );
  });
}

start().catch((error) => {
  console.error(
    "FitDealFinder kon niet starten:",
    error,
  );

  process.exit(1);
});

