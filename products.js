
/**
 * FitDealFinder — Products module
 *
 * Security-first starter
 *
 * Stack:
 *   Node.js + TypeScript + PostgreSQL
 *
 * Functionaliteit:
 *   - PostgreSQL product database
 *   - Productvalidatie met Zod
 *   - Awin import-laag
 *   - Veilige affiliate redirects
 *   - Rate limiting
 *   - Security headers
 *   - Admin-authenticatie
 *   - SQL-injection bescherming
 *   - XSS-basisbescherming
 *   - Deal score
 *   - Product zoeken/filteren/sorteren
 *   - Affiliate click tracking
 *   - Sync logging
 *   - Health check
 *
 * BELANGRIJK:
 *   Zet NOOIT echte wachtwoorden/API-keys in dit bestand.
 *
 * Benodigde packages:
 *
 *   npm install express pg zod helmet
 *   npm install -D typescript tsx @types/express @types/node
 *
 * Environment variables:
 *
 *   DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/fitdealfinder
 *   AWIN_API_KEY=...
 *   AWIN_PUBLISHER_ID=...
 *   AWIN_PRODUCT_FEED_URL=...
 *   ADMIN_SECRET=een-heel-lang-random-geheim
 *   PORT=3000
 *   TRUST_PROXY=false
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";

import helmet from "helmet";
import { Pool } from "pg";
import { z } from "zod";
import crypto from "node:crypto";

/* ========================================================================== */
/* APP                                                                        */
/* ========================================================================== */

const app = express();

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
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
    referrerPolicy: {
      policy: "strict-origin-when-cross-origin",
    },
  }),
);

app.use(
  express.json({
    limit: "100kb",
  }),
);

/* ========================================================================== */
/* ENVIRONMENT                                                                */
/* ========================================================================== */

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  AWIN_API_KEY: z.string().optional(),

  AWIN_PUBLISHER_ID: z.string().optional(),

  AWIN_PRODUCT_FEED_URL: z.string().url().optional(),

  ADMIN_SECRET: z.string().min(32),

  PORT: z.coerce.number().int().positive().default(3000),

  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false"),
});

const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,

  AWIN_API_KEY: process.env.AWIN_API_KEY,

  AWIN_PUBLISHER_ID:
    process.env.AWIN_PUBLISHER_ID,

  AWIN_PRODUCT_FEED_URL:
    process.env.AWIN_PRODUCT_FEED_URL,

  ADMIN_SECRET:
    process.env.ADMIN_SECRET,

  PORT:
    process.env.PORT,

  TRUST_PROXY:
    process.env.TRUST_PROXY,
});

app.set(
  "trust proxy",
  env.TRUST_PROXY === "true",
);

/* ========================================================================== */
/* DATABASE                                                                   */
/* ========================================================================== */

const pool = new Pool({
  connectionString: env.DATABASE_URL,

  max: 10,

  idleTimeoutMillis: 30_000,

  connectionTimeoutMillis: 5_000,

  ssl:
    process.env.NODE_ENV === "production"
      ? {
          rejectUnauthorized: true,
        }
      : undefined,
});

async function query<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(
    text,
    params,
  );

  return result.rows as T[];
}

/* ========================================================================== */
/* DATABASE INITIALIZATION                                                    */
/* ========================================================================== */

async function initDatabase(): Promise<void> {
  await query(`
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

      currency CHAR(3) NOT NULL
        DEFAULT 'EUR',

      image_url TEXT,

      product_url TEXT NOT NULL,

      affiliate_url TEXT NOT NULL,

      merchant_name TEXT NOT NULL,

      merchant_id TEXT,

      network TEXT NOT NULL
        DEFAULT 'AWIN',

      commission NUMERIC(12,2),

      commission_type TEXT,

      in_stock BOOLEAN NOT NULL
        DEFAULT TRUE,

      deal_score INTEGER NOT NULL
        DEFAULT 0
        CHECK (
          deal_score BETWEEN 0 AND 100
        ),

      discount_percent INTEGER
        CHECK (
          discount_percent IS NULL
          OR discount_percent BETWEEN 0 AND 100
        ),

      active BOOLEAN NOT NULL
        DEFAULT TRUE,

      last_synced_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

      updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_products_category
      ON products(category);

    CREATE INDEX IF NOT EXISTS idx_products_brand
      ON products(brand);

    CREATE INDEX IF NOT EXISTS idx_products_merchant
      ON products(merchant_name);

    CREATE INDEX IF NOT EXISTS idx_products_deal_score
      ON products(deal_score DESC);

    CREATE INDEX IF NOT EXISTS idx_products_active
      ON products(active);

    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_products_network_external
      ON products(network, external_id)
      WHERE external_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sync_logs (
      id BIGSERIAL PRIMARY KEY,

      network TEXT NOT NULL,

      started_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

      finished_at TIMESTAMPTZ,

      imported INTEGER NOT NULL
        DEFAULT 0,

      updated INTEGER NOT NULL
        DEFAULT 0,

      failed INTEGER NOT NULL
        DEFAULT 0,

      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id BIGSERIAL PRIMARY KEY,

      product_id UUID NOT NULL
        REFERENCES products(id)
        ON DELETE CASCADE,

      created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS
      idx_affiliate_clicks_product_date
      ON affiliate_clicks(
        product_id,
        created_at
      );
  `);
}

/* ========================================================================== */
/* PRODUCT VALIDATION                                                         */
/* ========================================================================== */

const productInputSchema =
  z.object({
    externalId:
      z
        .string()
        .trim()
        .min(1)
        .max(200)
        .nullable()
        .optional(),

    name:
      z
        .string()
        .trim()
        .min(1)
        .max(300),

    description:
      z
        .string()
        .trim()
        .max(10_000)
        .nullable()
        .optional(),

    brand:
      z
        .string()
        .trim()
        .max(200)
        .nullable()
        .optional(),

    category:
      z
        .string()
        .trim()
        .max(200)
        .nullable()
        .optional(),

    price:
      z
        .number()
        .finite()
        .nonnegative(),

    oldPrice:
      z
        .number()
        .finite()
        .nonnegative()
        .nullable()
        .optional(),

    currency:
      z
        .string()
        .trim()
        .length(3)
        .transform(
          (value) =>
            value.toUpperCase(),
        ),

    imageUrl:
      z
        .string()
        .url()
        .max(2048)
        .nullable()
        .optional(),

    productUrl:
      z
        .string()
        .url()
        .max(2048),

    affiliateUrl:
      z
        .string()
        .url()
        .max(2048),

    merchantName:
      z
        .string()
        .trim()
        .min(1)
        .max(200),

    merchantId:
      z
        .string()
        .trim()
        .max(200)
        .nullable()
        .optional(),

    network:
      z
        .string()
        .trim()
        .min(1)
        .max(50)
        .default("AWIN"),

    commission:
      z
        .number()
        .finite()
        .nonnegative()
        .nullable()
        .optional(),

    commissionType:
      z
        .string()
        .trim()
        .max(50)
        .nullable()
        .optional(),

    inStock:
      z
        .boolean()
        .default(true),
  });

type ProductInput =
  z.infer<
    typeof productInputSchema
  >;

/* ========================================================================== */
/* URL SECURITY                                                               */
/* ========================================================================== */

/**
 * Alleen HTTPS.
 *
 * We accepteren geen http:// voor affiliate destinations.
 */

function assertHttpsUrl(
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

/**
 * Belangrijk:
 *
 * De bezoeker mag NOOIT zelf de redirect URL bepalen.
 *
 * De URL komt uitsluitend uit onze eigen
 * database en wordt opnieuw gecontroleerd.
 */

function isAllowedAffiliateUrl(
  value: string,
): boolean {
  try {
    const url =
      assertHttpsUrl(value);

    const host =
      url.hostname.toLowerCase();

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

/* ========================================================================== */
/* SLUGS                                                                      */
/* ========================================================================== */

function slugify(
  input: string,
): string {
  return input
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
    .slice(0, 180);
}

async function uniqueSlug(
  base: string,
  excludeId?: string,
): Promise<string> {
  const safeBase =
    base || "product";

  for (
    let i = 0;
    i < 100;
    i++
  ) {
    const candidate =
      i === 0
        ? safeBase
        : `${safeBase}-${i + 1}`;

    const rows =
      await query<{ id: string }>(
        `
        SELECT id
        FROM products
        WHERE slug = $1
          AND (
            $2::uuid IS NULL
            OR id <> $2::uuid
          )
        LIMIT 1
        `,
        [
          candidate,
          excludeId ?? null,
        ],
      );

    if (rows.length === 0) {
      return candidate;
    }
  }

  return `${safeBase}-${crypto
    .randomUUID()
    .slice(0, 8)}`;
}

/* ========================================================================== */
/* DEAL CALCULATION                                                           */
/* ========================================================================== */

function calculateDiscount(
  price: number,
  oldPrice:
    | number
    | null
    | undefined,
): number | null {
  if (
    !oldPrice ||
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

function calculateDealScore(
  product: {
    price: number;

    oldPrice?:
      | number
      | null;

    commission?:
      | number
      | null;

    inStock: boolean;
  },
): number {
  if (!product.inStock) {
    return 0;
  }

  const discount =
    calculateDiscount(
      product.price,
      product.oldPrice,
    );

  let score = 0;

  if (discount !== null) {
    score += Math.min(
      60,
      Math.round(
        discount * 1.5,
      ),
    );
  }

  if (
    product.commission !==
      null &&
    product.commission !==
      undefined
  ) {
    score += Math.min(
      20,
      Math.round(
        product.commission,
      ),
    );
  }

  if (
    product.price > 0 &&
    product.price < 50
  ) {
    score += 10;
  }

  if (
    product.oldPrice &&
    product.oldPrice >
      product.price
  ) {
    score += 5;
  }

  return Math.min(
    100,
    Math.max(0, score),
  );
}

/* ========================================================================== */
/* PRODUCT NORMALIZATION                                                      */
/* ========================================================================== */

function normalizeProduct(
  input: ProductInput,
) {
  const productUrl =
    assertHttpsUrl(
      input.productUrl,
    ).toString();

  if (
    !isAllowedAffiliateUrl(
      input.affiliateUrl,
    )
  ) {
    throw new Error(
      "Affiliate URL is not an approved Awin destination.",
    );
  }

  const discountPercent =
    calculateDiscount(
      input.price,
      input.oldPrice,
    );

  const dealScore =
    calculateDealScore({
      price: input.price,
      oldPrice:
        input.oldPrice,
      commission:
        input.commission,
      inStock:
        input.inStock,
    });

  return {
    ...input,

    productUrl,

    affiliateUrl:
      assertHttpsUrl(
        input.affiliateUrl,
      ).toString(),

    discountPercent,

    dealScore,
  };
}

/* ========================================================================== */
/* AWIN TYPES                                                                 */
/* ========================================================================== */

/**
 * Awin kan afhankelijk van je account/feed
 * verschillende velden leveren.
 *
 * Daarom houden we Awin achter een adapter.
 */

type AwinRawProduct = {
  id?: string | number;

  productId?:
    | string
    | number;

  name?: string;

  title?: string;

  description?: string;

  brand?: string;

  category?: string;

  price?:
    | number
    | string;

  salePrice?:
    | number
    | string;

  currency?: string;

  imageUrl?: string;

  image?: string;

  productUrl?: string;

  deepLink?: string;

  affiliateUrl?: string;

  awinLink?: string;

  merchantName?: string;

  merchantId?:
    | string
    | number;

  commission?:
    | number
    | string;

  commissionType?: string;

  inStock?: boolean;
};

/* ========================================================================== */
/* HELPER FUNCTIONS                                                           */
/* ========================================================================== */

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

  const number =
    Number(value);

  return Number.isFinite(
    number,
  )
    ? number
    : null;
}

function stringOrNull(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const string =
    String(value).trim();

  return string
    ? string
    : null;
}

/* ========================================================================== */
/* AWIN NORMALIZATION                                                         */
/* ========================================================================== */

function mapAwinProduct(
  raw: AwinRawProduct,
): ProductInput {
  const price =
    numberOrNull(
      raw.salePrice ??
        raw.price,
    );

  if (price === null) {
    throw new Error(
      "Awin product has no valid price.",
    );
  }

  const productUrl =
    stringOrNull(
      raw.productUrl,
    );

  const affiliateUrl =
    stringOrNull(
      raw.affiliateUrl ??
        raw.awinLink ??
        raw.deepLink,
    );

  if (
    !productUrl ||
    !affiliateUrl
  ) {
    throw new Error(
      "Awin product is missing a URL.",
    );
  }

  return productInputSchema.parse(
    {
      externalId:
        stringOrNull(
          raw.id ??
            raw.productId,
        ),

      name:
        String(
          raw.name ??
            raw.title ??
            "",
        ).trim(),

      description:
        stringOrNull(
          raw.description,
        ),

      brand:
        stringOrNull(
          raw.brand,
        ),

      category:
        stringOrNull(
          raw.category,
        ),

      price,

      oldPrice:
        raw.salePrice !==
          undefined &&
        raw.price !==
          undefined
          ? numberOrNull(
              raw.price,
            )
          : null,

      currency:
        String(
          raw.currency ??
            "EUR",
        ).slice(0, 3),

      imageUrl:
        stringOrNull(
          raw.imageUrl ??
            raw.image,
        ),

      productUrl,

      affiliateUrl,

      merchantName:
        String(
          raw.merchantName ??
            "Unknown merchant",
        ).trim(),

      merchantId:
        stringOrNull(
          raw.merchantId,
        ),

      network:
        "AWIN",

      commission:
        numberOrNull(
          raw.commission,
        ),

      commissionType:
        stringOrNull(
          raw.commissionType,
        ),

      inStock:
        raw.inStock !== false,
    },
  );
}

/* ========================================================================== */
/* AWIN FETCH                                                                 */
/* ========================================================================== */

/**
 * Gebruik hier uitsluitend de exacte feed/API URL
 * die Awin aan jouw publisher-account verstrekt.
 *
 * We gokken NIET met een endpoint.
 */

async function fetchAwinProducts(): Promise<
  AwinRawProduct[]
> {
  if (!env.AWIN_API_KEY) {
    throw new Error(
      "AWIN_API_KEY is not configured.",
    );
  }

  if (
    !env.AWIN_PRODUCT_FEED_URL
  ) {
    throw new Error(
      "AWIN_PRODUCT_FEED_URL is not configured.",
    );
  }

  const feedUrl =
    assertHttpsUrl(
      env.AWIN_PRODUCT_FEED_URL,
    );

  const response =
    await fetch(
      feedUrl,
      {
        method: "GET",

        headers: {
          Accept:
            "application/json",

          Authorization:
            `Bearer ${env.AWIN_API_KEY}`,

          "User-Agent":
            "FitDealFinder/1.0",
        },

        signal:
          AbortSignal.timeout(
            30_000,
          ),
      },
    );

  if (!response.ok) {
    throw new Error(
      `Awin feed failed with HTTP ${response.status}.`,
    );
  }

  const data: unknown =
    await response.json();

  if (
    !Array.isArray(data)
  ) {
    throw new Error(
      "Awin feed response is not an array. Adapt the Awin adapter to the exact feed format.",
    );
  }

  return data as AwinRawProduct[];
}

/* ========================================================================== */
/* PRODUCT UPSERT                                                             */
/* ========================================================================== */

async function upsertProduct(
  input: ProductInput,
): Promise<
  "inserted" | "updated"
> {
  const product =
    normalizeProduct(
      input,
    );

  const existing =
    product.externalId
      ? await query<{
          id: string;
        }>(
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
        )
      : [];

  /* ---------------------------------------------------------------------- */
  /* UPDATE                                                                 */
  /* ---------------------------------------------------------------------- */

  if (
    existing.length > 0
  ) {
    const id =
      existing[0].id;

    await query(
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

        product.description ??
          null,

        product.brand ??
          null,

        product.category ??
          null,

        product.price,

        product.oldPrice ??
          null,

        product.currency,

        product.imageUrl ??
          null,

        product.productUrl,

        product.affiliateUrl,

        product.merchantName,

        product.merchantId ??
          null,

        product.commission ??
          null,

        product.commissionType ??
          null,

        product.inStock,

        product.dealScore,

        product.discountPercent,

        id,
      ],
    );

    return "updated";
  }

  /* ---------------------------------------------------------------------- */
  /* INSERT                                                                 */
  /* ---------------------------------------------------------------------- */

  const id =
    crypto.randomUUID();

  const slug =
    await uniqueSlug(
      slugify(
        product.name,
      ),
    );

  await query(
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

      product.externalId ??
        null,

      product.name,

      slug,

      product.description ??
        null,

      product.brand ??
        null,

      product.category ??
        null,

      product.price,

      product.oldPrice ??
        null,

      product.currency,

      product.imageUrl ??
        null,

      product.productUrl,

      product.affiliateUrl,

      product.merchantName,

      product.merchantId ??
        null,

      product.network,

      product.commission ??
        null,

      product.commissionType ??
        null,

      product.inStock,

      product.dealScore,

      product.discountPercent,
    ],
  );

  return "inserted";
}

/* ========================================================================== */
/* RATE LIMITER                                                               */
/* ========================================================================== */

/**
 * Dit is een eenvoudige limiter voor één serverproces.
 *
 * Als FitDealFinder later meerdere servers/instances gebruikt,
 * vervangen we dit door Redis of een andere gedeelde limiter.
 */

type Bucket = {
  count: number;

  resetAt: number;
};

const buckets =
  new Map<
    string,
    Bucket
  >();

function rateLimit(
  maxRequests: number,
  windowMs: number,
) {
  return (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const ip =
      req.ip ||
      "unknown";

    const now =
      Date.now();

    const current =
      buckets.get(ip);

    if (
      !current ||
      current.resetAt <=
        now
    ) {
      buckets.set(
        ip,
        {
          count: 1,

          resetAt:
            now +
            windowMs,
        },
      );

      return next();
    }

    if (
      current.count >=
      maxRequests
    ) {
      const retryAfter =
        Math.ceil(
          (current.resetAt -
            now) /
            1000,
        );

      res.setHeader(
        "Retry-After",
        String(
          retryAfter,
        ),
      );

      return res
        .status(429)
        .json({
          error:
            "Too many requests. Try again later.",
        });
    }

    current.count +=
      1;

    return next();
  };
}

/* ========================================================================== */
/* CLEAN RATE LIMITER MEMORY                                                  */
/* ========================================================================== */

setInterval(() => {
  const now =
    Date.now();

  for (
    const [
      key,
      bucket,
    ] of buckets
  ) {
    if (
      bucket.resetAt <=
      now
    ) {
      buckets.delete(
        key,
      );
    }
  }
}, 60_000).unref();

/* ========================================================================== */
/* ADMIN AUTHENTICATION                                                       */
/* ========================================================================== */

/**
 * Dit is expres simpel gehouden voor dit ene bestand.
 *
 * In de uiteindelijke website zou ik admin-authenticatie vervangen door
 * een echte login/session-oplossing met HttpOnly/Secure cookies en rollen.
 */

function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const supplied =
    req.header(
      "x-admin-secret",
    );

  if (!supplied) {
    return res
      .status(401)
      .json({
        error:
          "Unauthorized.",
      });
  }

  const suppliedBuffer =
    Buffer.from(
      supplied,
    );

  const expectedBuffer =
    Buffer.from(
      env.ADMIN_SECRET,
    );

  if (
    suppliedBuffer.length !==
      expectedBuffer.length ||
    !crypto.timingSafeEqual(
      suppliedBuffer,
      expectedBuffer,
    )
  ) {
    return res
      .status(401)
      .json({
        error:
          "Unauthorized.",
      });
  }

  return next();
}

/* ========================================================================== */
/* PUBLIC PRODUCTS API                                                       */
/* ========================================================================== */

app.get(
  "/api/products",

  rateLimit(
    120,
    60_000,
  ),

  async (
    req: Request,
    res: Response,
  ) => {
    try {
      const limit =
        Math.min(
          Math.max(
            Number(
              req.query
                .limit ??
                24,
            ),
            1,
          ),
          100,
        );

      const offset =
        Math.max(
          Number(
            req.query
              .offset ??
              0,
          ),
          0,
        );

      const category =
        typeof req.query
          .category ===
        "string"
          ? req.query.category
              .trim()
              .slice(
                0,
                200,
              )
          : null;

      const search =
        typeof req.query
          .search ===
        "string"
          ? req.query.search
              .trim()
              .slice(
                0,
                200,
              )
          : null;

      const sort =
        req.query.sort ===
        "price_asc"
          ? "price ASC"
          : req.query.sort ===
            "price_desc"
            ? "price DESC"
            : req.query.sort ===
              "newest"
              ? "created_at DESC"
              : "deal_score DESC";

      const products =
        await query(
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

            merchant_name AS "merchantName",

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

              OR name ILIKE
                '%' || $2 || '%'

              OR brand ILIKE
                '%' || $2 || '%'
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
          ],
        );

      return res.json({
        products,

        limit,

        offset,
      });
    } catch (error) {
      console.error(
        "GET /api/products:",
        error,
      );

      return res
        .status(500)
        .json({
          error:
            "Internal server error.",
        });
    }
  },
);

/* ========================================================================== */
/* SINGLE PRODUCT                                                             */
/* ========================================================================== */

app.get(
  "/api/products/:slug",

  rateLimit(
    120,
    60_000,
  ),

  async (
    req: Request,
    res: Response,
  ) => {
    try {
      const slug =
        req.params.slug
          .slice(
            0,
            200,
          );

      const rows =
        await query(
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

            merchant_name AS "merchantName",

            in_stock AS "inStock",

            deal_score AS "dealScore",

            discount_percent AS "discountPercent"

          FROM products

          WHERE slug = $1

            AND active = TRUE

          LIMIT 1
          `,
          [
            slug,
          ],
        );

      if (
        rows.length ===
        0
      ) {
        return res
          .status(404)
          .json({
            error:
              "Product not found.",
          });
      }

      return res.json(
        rows[0],
      );
    } catch (error) {
      console.error(
        "GET /api/products/:slug:",
        error,
      );

      return res
        .status(500)
        .json({
          error:
            "Internal server error.",
        });
    }
  },
);

/* ========================================================================== */
/* SAFE AFFILIATE REDIRECT                                                   */
/* ========================================================================== */

/**
 * NOOIT:
 *
 * /go?url=https://example.com
 *
 * De gebruiker mag geen bestemming meegeven.
 *
 * WEL:
 *
 * /go/<product-id>
 *
 * Vervolgens zoeken wij de affiliate URL op in onze eigen database.
 */

app.get(
  "/go/:id",

  rateLimit(
    60,
    60_000,
  ),

  async (
    req: Request,
    res: Response,
  ) => {
    try {
      const id =
        req.params.id;

      if (
        !/^[0-9a-f-]{36}$/i.test(
          id,
        )
      ) {
        return res
          .status(400)
          .send(
            "Invalid product.",
          );
      }

      const rows =
        await query<{
          id: string;

          affiliate_url: string;

          active: boolean;
        }>(
          `
          SELECT

            id,

            affiliate_url,

            active

          FROM products

          WHERE id = $1::uuid

          LIMIT 1
          `,
          [
            id,
          ],
        );

      if (
        rows.length ===
          0 ||
        !rows[0].active
      ) {
        return res
          .status(404)
          .send(
            "Product not found.",
          );
      }

      const affiliateUrl =
        rows[0]
          .affiliate_url;

      if (
        !isAllowedAffiliateUrl(
          affiliateUrl,
        )
      ) {
        console.error(
          "Blocked invalid stored affiliate URL:",
          id,
        );

        return res
          .status(410)
          .send(
            "Affiliate destination unavailable.",
          );
      }

      await query(
        `
        INSERT INTO affiliate_clicks (
          product_id
        )

        VALUES (
          $1::uuid
        )
        `,
        [
          id,
        ],
      );

      return res.redirect(
        302,
        affiliateUrl,
      );
    } catch (error) {
      console.error(
        "GET /go/:id:",
        error,
      );

      return res
        .status(500)
        .send(
          "Unable to process affiliate click.",
        );
    }
  },
);

/* ========================================================================== */
/* ADMIN — CREATE / UPDATE PRODUCT                                            */
/* ========================================================================== */

app.post(
  "/api/admin/products",

  rateLimit(
    30,
    60_000,
  ),

  requireAdmin,

  async (
    req: Request,
    res: Response,
  ) => {
    try {
      const parsed =
        productInputSchema.safeParse(
          req.body,
        );

      if (
        !parsed.success
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid product.",

            details:
              parsed.error.flatten(),
          });
      }

      const action =
        await upsertProduct(
          parsed.data,
        );

      return res
        .status(
          action ===
            "inserted"
            ? 201
            : 200,
        )
        .json({
          ok: true,

          action,
        });
    } catch (error) {
      console.error(
        "POST /api/admin/products:",
        error,
      );

      return res
        .status(400)
        .json({
          error:
            error instanceof
            Error
              ? error.message
              : "Invalid product.",
        });
    }
  },
);

/* ========================================================================== */
/* ADMIN — DEACTIVATE PRODUCT                                                 */
/* ========================================================================== */

app.delete(
  "/api/admin/products/:id",

  rateLimit(
    30,
    60_000,
  ),

  requireAdmin,

  async (
    req: Request,
    res: Response,
  ) => {
    try {
      const id =
        req.params.id;

      if (
        !/^[0-9a-f-]{36}$/i.test(
          id,
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid product ID.",
          });
      }

      const result =
        await pool.query(
          `
          UPDATE products

          SET

            active = FALSE,

            updated_at = NOW()

          WHERE id =
            $1::uuid
          `,
          [
            id,
          ],
        );

      if (
        result.rowCount ===
        0
      ) {
        return res
          .status(404)
          .json({
            error:
              "Product not found.",
          });
      }

      return res.json({
        ok: true,
      });
    } catch (error) {
      console.error(
        "DELETE /api/admin/products/:id:",
        error,
      );

      return res
        .status(500)
        .json({
          error:
            "Internal server error.",
        });
    }
  },
);

/* ========================================================================== */
/* ADMIN — AWIN SYNC                                                          */
/* ========================================================================== */

let syncRunning =
  false;

app.post(
  "/api/admin/sync-awin",

  rateLimit(
    5,
    60_000,
  ),

  requireAdmin,

  async (
    _req: Request,
    res: Response,
  ) => {
    if (
      syncRunning
    ) {
      return res
        .status(409)
        .json({
          error:
            "Awin synchronization is already running.",
        });
    }

    syncRunning =
      true;

    const logRows =
      await query<{
        id: string;
      }>(
        `
        INSERT INTO sync_logs (
          network
        )

        VALUES (
          'AWIN'
        )

        RETURNING id
        `,
      );

    const logId =
      logRows[0].id;

    let imported =
      0;

    let updated =
      0;

    let failed =
      0;

    try {
      const rawProducts =
        await fetchAwinProducts();

      /**
       * Bescherming tegen een foutieve feed
       * die bijvoorbeeld miljoenen producten bevat.
       */

      const MAX_PRODUCTS_PER_SYNC =
        100_000;

      if (
        rawProducts.length >
        MAX_PRODUCTS_PER_SYNC
      ) {
        throw new Error(
          "Awin feed exceeds the configured maximum size.",
        );
      }

      for (
        const raw of rawProducts
      ) {
        try {
          const input =
            mapAwinProduct(
              raw,
            );

          const result =
            await upsertProduct(
              input,
            );

          if (
            result ===
            "inserted"
          ) {
            imported +=
              1;
          } else {
            updated +=
              1;
          }
        } catch (error) {
          failed +=
            1;

          console.error(
            "Failed to import Awin product:",
            error,
          );
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

          logId,
        ],
      );

      return res.json({
        ok: true,

        imported,

        updated,

        failed,
      });
    } catch (error) {
      const message =
        error instanceof
        Error
          ? error.message
          : "Unknown sync error.";

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

          message.slice(
            0,
            5_000,
          ),

          logId,
        ],
      );

      console.error(
        "Awin sync failed:",
        error,
      );

      return res
        .status(500)
        .json({
          error:
            "Awin synchronization failed.",

          imported,

          updated,

          failed,
        });
    } finally {
      syncRunning =
        false;
    }
  },
);

/* ========================================================================== */
/* HEALTH CHECK                                                               */
/* ========================================================================== */

app.get(
  "/health",
  async (
    _req,
    res,
  ) => {
    try {
      await pool.query(
        "SELECT 1",
      );

      return res.json({
        ok: true,
      });
    } catch {
      return res
        .status(503)
        .json({
          ok: false,
        });
    }
  },
);

/* ========================================================================== */
/* ERROR HANDLER                                                              */
/* ========================================================================== */

app.use(
  (
    error: unknown,

    _req: Request,

    res: Response,

    _next: NextFunction,
  ) => {
    console.error(
      "Unhandled application error:",
      error,
    );

    return res
      .status(500)
      .json({
        error:
          "Internal server error.",
      });
  },
);

/* ========================================================================== */
/* START                                                                      */
/* ========================================================================== */

async function main() {
  await initDatabase();

  app.listen(
    env.PORT,
    () => {
      console.log(
        `FitDealFinder Products API running on port ${env.PORT}`,
      );
    },
  );
}

main().catch(
  (error) => {
    console.error(
      "Fatal startup error:",
      error,
    );

    process.exit(1);
  },
);
