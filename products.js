/**
 * FITDEALFINDER
 * PRODUCTS + AWIN BACKEND
 *
 * Single-file secure starter
 *
 * Install:
 * npm install express pg zod helmet
 * npm install -D typescript tsx @types/express @types/node
 *
 * Environment:
 *
 * DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/fitdealfinder
 * AWIN_API_KEY=YOUR_AWIN_KEY
 * AWIN_PUBLISHER_ID=YOUR_PUBLISHER_ID
 * AWIN_PRODUCT_FEED_URL=https://YOUR-AWIN-FEED-URL
 * ADMIN_SECRET=CHANGE_THIS_TO_A_LONG_RANDOM_SECRET
 * PORT=3000
 * TRUST_PROXY=false
 *
 * NEVER put real secrets directly in this file.
 * NEVER commit .env to GitHub.
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

/* ========================================================================== */
/* CONFIGURATION                                                              */
/* ========================================================================== */

const app = express();

const PORT =
  Number(process.env.PORT ?? 3000);

const DATABASE_URL =
  process.env.DATABASE_URL;

const AWIN_API_KEY =
  process.env.AWIN_API_KEY;

const AWIN_PUBLISHER_ID =
  process.env.AWIN_PUBLISHER_ID;

const AWIN_PRODUCT_FEED_URL =
  process.env.AWIN_PRODUCT_FEED_URL;

const ADMIN_SECRET =
  process.env.ADMIN_SECRET;

const TRUST_PROXY =
  process.env.TRUST_PROXY === "true";

/* ========================================================================== */
/* STARTUP VALIDATION                                                         */
/* ========================================================================== */

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing."
  );
}

if (!ADMIN_SECRET) {
  throw new Error(
    "ADMIN_SECRET is missing."
  );
}

if (ADMIN_SECRET.length < 32) {
  throw new Error(
    "ADMIN_SECRET must contain at least 32 characters."
  );
}

app.set(
  "trust proxy",
  TRUST_PROXY
);

/* ========================================================================== */
/* SECURITY HEADERS                                                           */
/* ========================================================================== */

app.disable(
  "x-powered-by"
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],

        imgSrc: [
          "'self'",
          "https:",
          "data:",
        ],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
        ],

        scriptSrc: [
          "'self'",
        ],

        connectSrc: [
          "'self'",
        ],
      },
    },

    referrerPolicy: {
      policy:
        "strict-origin-when-cross-origin",
    },
  })
);

app.use(
  express.json({
    limit: "100kb",
  })
);

/* ========================================================================== */
/* DATABASE                                                                   */
/* ========================================================================== */

const database = new Pool({
  connectionString:
    DATABASE_URL,

  max: 10,

  idleTimeoutMillis:
    30_000,

  connectionTimeoutMillis:
    5_000,

  ssl:
    process.env.NODE_ENV ===
    "production"
      ? {
          rejectUnauthorized:
            true,
        }
      : undefined,
});

async function db<T = any>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result =
    await database.query(
      sql,
      params
    );

  return result.rows as T[];
}

/* ========================================================================== */
/* DATABASE TABLES                                                            */
/* ========================================================================== */

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

      currency CHAR(3)
        NOT NULL
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

      active BOOLEAN NOT NULL
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

      last_synced_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

      updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS
      products_category_idx
      ON products(category);

    CREATE INDEX IF NOT EXISTS
      products_brand_idx
      ON products(brand);

    CREATE INDEX IF NOT EXISTS
      products_merchant_idx
      ON products(merchant_name);

    CREATE INDEX IF NOT EXISTS
      products_score_idx
      ON products(deal_score DESC);

    CREATE INDEX IF NOT EXISTS
      products_active_idx
      ON products(active);

    CREATE UNIQUE INDEX IF NOT EXISTS
      products_network_external_idx
      ON products(network, external_id)
      WHERE external_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sync_logs (

      id BIGSERIAL PRIMARY KEY,

      network TEXT NOT NULL,

      started_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

      finished_at TIMESTAMPTZ,

      imported INTEGER
        NOT NULL
        DEFAULT 0,

      updated INTEGER
        NOT NULL
        DEFAULT 0,

      failed INTEGER
        NOT NULL
        DEFAULT 0,

      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS affiliate_clicks (

      id BIGSERIAL PRIMARY KEY,

      product_id UUID NOT NULL
        REFERENCES products(id)
        ON DELETE CASCADE,

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS
      affiliate_clicks_product_idx
      ON affiliate_clicks(
        product_id,
        created_at
      );
  `);
}

/* ========================================================================== */
/* VALIDATION                                                                 */
/* ========================================================================== */

const productSchema =
  z.object({

    externalId:
      z.string()
        .trim()
        .min(1)
        .max(200)
        .nullable()
        .optional(),

    name:
      z.string()
        .trim()
        .min(1)
        .max(300),

    description:
      z.string()
        .trim()
        .max(10000)
        .nullable()
        .optional(),

    brand:
      z.string()
        .trim()
        .max(200)
        .nullable()
        .optional(),

    category:
      z.string()
        .trim()
        .max(200)
        .nullable()
        .optional(),

    price:
      z.number()
        .finite()
        .nonnegative(),

    oldPrice:
      z.number()
        .finite()
        .nonnegative()
        .nullable()
        .optional(),

    currency:
      z.string()
        .trim()
        .length(3)
        .transform(
          value =>
            value.toUpperCase()
        ),

    imageUrl:
      z.string()
        .url()
        .max(2048)
        .nullable()
        .optional(),

    productUrl:
      z.string()
        .url()
        .max(2048),

    affiliateUrl:
      z.string()
        .url()
        .max(2048),

    merchantName:
      z.string()
        .trim()
        .min(1)
        .max(200),

    merchantId:
      z.string()
        .trim()
        .max(200)
        .nullable()
        .optional(),

    network:
      z.string()
        .trim()
        .min(1)
        .max(50)
        .default("AWIN"),

    commission:
      z.number()
        .finite()
        .nonnegative()
        .nullable()
        .optional(),

    commissionType:
      z.string()
        .trim()
        .max(50)
        .nullable()
        .optional(),

    inStock:
      z.boolean()
        .default(true),
  });

type ProductInput =
  z.infer<
    typeof productSchema
  >;

/* ========================================================================== */
/* URL SECURITY                                                               */
/* ========================================================================== */

function httpsUrl(
  value: string
): URL {

  const url =
    new URL(value);

  if (
    url.protocol !==
    "https:"
  ) {
    throw new Error(
      "Only HTTPS URLs are allowed."
    );
  }

  return url;
}

/**
 * Alleen Awin URLs worden als affiliate destination
 * geaccepteerd.
 *
 * Later kunnen we gecontroleerde merchant-domeinen
 * toevoegen wanneer dat nodig is.
 */

function isSafeAffiliateUrl(
  value: string
): boolean {

  try {

    const url =
      httpsUrl(value);

    const host =
      url.hostname.toLowerCase();

    return (
      host === "awin.com" ||
      host === "www.awin.com" ||
      host === "awin1.com" ||
      host === "www.awin1.com" ||
      host.endsWith(
        ".awin.com"
      ) ||
      host.endsWith(
        ".awin1.com"
      )
    );

  } catch {

    return false;

  }
}

/* ========================================================================== */
/* SLUG                                                                       */
/* ========================================================================== */

function slugify(
  value: string
): string {

  return value
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    )
    .slice(
      0,
      180
    );
}

async function makeUniqueSlug(
  base: string
): Promise<string> {

  const clean =
    slugify(base) ||
    "product";

  for (
    let i = 0;
    i < 100;
    i++
  ) {

    const slug =
      i === 0
        ? clean
        : `${clean}-${i + 1}`;

    const existing =
      await db(
        `
        SELECT id
        FROM products
        WHERE slug = $1
        LIMIT 1
        `,
        [slug]
      );

    if (
      existing.length === 0
    ) {
      return slug;
    }
  }

  return (
    clean +
    "-" +
    crypto
      .randomUUID()
      .slice(0, 8)
  );
}

/* ========================================================================== */
/* DEAL CALCULATION                                                           */
/* ========================================================================== */

function discountPercentage(
  price: number,
  oldPrice:
    | number
    | null
    | undefined
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
        (
          (oldPrice - price) /
          oldPrice
        ) * 100
      )
    )
  );
}

function dealScore(
  product: {
    price: number;

    oldPrice?:
      | number
      | null;

    commission?:
      | number
      | null;

    inStock: boolean;
  }
): number {

  if (
    !product.inStock
  ) {
    return 0;
  }

  const discount =
    discountPercentage(
      product.price,
      product.oldPrice
    );

  let score = 0;

  if (
    discount !== null
  ) {

    score += Math.min(
      60,
      Math.round(
        discount * 1.5
      )
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
        product.commission
      )
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
    Math.max(
      0,
      score
    )
  );
}

/* ========================================================================== */
/* PRODUCT NORMALIZATION                                                      */
/* ========================================================================== */

function normalizeProduct(
  input: ProductInput
) {

  httpsUrl(
    input.productUrl
  );

  if (
    !isSafeAffiliateUrl(
      input.affiliateUrl
    )
  ) {

    throw new Error(
      "Invalid or unapproved Awin affiliate URL."
    );
  }

  const discount =
    discountPercentage(
      input.price,
      input.oldPrice
    );

  const score =
    dealScore({
      price:
        input.price,

      oldPrice:
        input.oldPrice,

      commission:
        input.commission,

      inStock:
        input.inStock,
    });

  return {
    ...input,

    productUrl:
      httpsUrl(
        input.productUrl
      ).toString(),

    affiliateUrl:
      httpsUrl(
        input.affiliateUrl
      ).toString(),

    discountPercent:
      discount,

    dealScore:
      score,
  };
}

/* ========================================================================== */
/* AWIN TYPE                                                                  */
/* ========================================================================== */

type AwinProduct = {

  id?:
    | string
    | number;

  productId?:
    | string
    | number;

  name?: string;

  title?: string;

  description?: string;

  brand?: string;

  category?: string;

  price?:
    | string
    | number;

  salePrice?:
    | string
    | number;

  currency?: string;

  imageUrl?: string;

  image?: string;

  productUrl?: string;

  affiliateUrl?: string;

  awinLink?: string;

  deepLink?: string;

  merchantName?: string;

  merchantId?:
    | string
    | number;

  commission?:
    | string
    | number;

  commissionType?: string;

  inStock?: boolean;
};

/* ========================================================================== */
/* AWIN HELPERS                                                               */
/* ========================================================================== */

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

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
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

  const result =
    String(value).trim();

  return result || null;
}

/* ========================================================================== */
/* AWIN PRODUCT MAPPING                                                       */
/* ========================================================================== */

function mapAwinProduct(
  raw: AwinProduct
): ProductInput {

  const price =
    toNumber(
      raw.salePrice ??
        raw.price
    );

  if (
    price === null
  ) {
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
      "Product is missing a URL."
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
      raw.salePrice !==
        undefined &&
      raw.price !==
        undefined
        ? toNumber(
            raw.price
          )
        : null,

    currency:
      String(
        raw.currency ??
          "EUR"
      ).slice(
        0,
        3
      ),

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

    network:
      "AWIN",

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

/* ========================================================================== */
/* AWIN FEED                                                                  */
/* ========================================================================== */

/**
 * Gebruik hier de echte feed URL die Awin voor jouw account geeft.
 *
 * We verzinnen geen Awin endpoint.
 */

async function getAwinProducts():
  Promise<AwinProduct[]> {

  if (
    !AWIN_API_KEY
  ) {
    throw new Error(
      "AWIN_API_KEY is missing."
    );
  }

  if (
    !AWIN_PRODUCT_FEED_URL
  ) {
    throw new Error(
      "AWIN_PRODUCT_FEED_URL is missing."
    );
  }

  const feed =
    httpsUrl(
      AWIN_PRODUCT_FEED_URL
    );

  const response =
    await fetch(
      feed,
      {
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
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Awin returned HTTP ${response.status}.`
    );
  }

  const data:
    unknown =
    await response.json();

  if (
    !Array.isArray(data)
  ) {
    throw new Error(
      "Unexpected Awin feed format."
    );
  }

  return data as AwinProduct[];
}

/* ========================================================================== */
/* SAVE PRODUCT                                                               */
/* ========================================================================== */

async function saveProduct(
  input: ProductInput
): Promise<
  "inserted" | "updated"
> {

  const product =
    normalizeProduct(
      input
    );

  if (
    product.externalId
  ) {

    const existing =
      await db<{
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
        ]
      );

    if (
      existing.length > 0
    ) {

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

          existing[0].id,
        ]
      );

      return "updated";
    }
  }

  const id =
    crypto.randomUUID();

  const slug =
    await makeUniqueSlug(
      product.name
    );

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
    ]
  );

  return "inserted";
}

/* ========================================================================== */
/* RATE LIMITING                                                              */
/* ========================================================================== */

type RateBucket = {

  count: number;

  resetAt: number;
};

const rateBuckets =
  new Map<
    string,
    RateBucket
  >();

function rateLimit(
  maxRequests: number,
  windowMs: number
) {

  return (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    const ip =
      req.ip ||
      "unknown";

    const now =
      Date.now();

    const bucket =
      rateBuckets.get(
        ip
      );

    if (
      !bucket ||
      bucket.resetAt <=
        now
    ) {

      rateBuckets.set(
        ip,
        {
          count: 1,

          resetAt:
            now +
            windowMs,
        }
      );

      return next();
    }

    if (
      bucket.count >=
      maxRequests
    ) {

      res.setHeader(
        "Retry-After",
        String(
          Math.ceil(
            (
              bucket.resetAt -
              now
            ) / 1000
          )
        )
      );

      return res
        .status(429)
        .json({
          error:
            "Too many requests.",
        });
    }

    bucket.count += 1;

    return next();
  };
}

/* ========================================================================== */
/* CLEAN RATE LIMITER                                                         */
/* ========================================================================== */

setInterval(
  () => {

    const now =
      Date.now();

    for (
      const [
        key,
        bucket,
      ] of rateBuckets
    ) {

      if (
        bucket.resetAt <=
        now
      ) {

        rateBuckets.delete(
          key
        );
      }
    }
  },

  60_000
).unref();

/* ========================================================================== */
/* ADMIN AUTH                                                                 */
/* ========================================================================== */

function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {

  const supplied =
    req.header(
      "x-admin-secret"
    );

  if (
    !supplied
  ) {

    return res
      .status(401)
      .json({
        error:
          "Unauthorized.",
      });
  }

  const suppliedBuffer =
    Buffer.from(
      supplied
    );

  const expectedBuffer =
    Buffer.from(
      ADMIN_SECRET!
    );

  if (
    suppliedBuffer.length !==
      expectedBuffer.length ||
    !crypto.timingSafeEqual(
      suppliedBuffer,
      expectedBuffer
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
/* GET PRODUCTS                                                               */
/* ========================================================================== */

app.get(
  "/api/products",

  rateLimit(
    120,
    60_000
  ),

  async (
    req: Request,
    res: Response
  ) => {

    try {

      let limit =
        Number(
          req.query.limit ??
            24
        );

      let offset =
        Number(
          req.query.offset ??
            0
        );

      if (
        !Number.isFinite(
          limit
        )
      ) {
        limit = 24;
      }

      if (
        !Number.isFinite(
          offset
        )
      ) {
        offset = 0;
      }

      limit =
        Math.min(
          Math.max(
            Math.floor(
              limit
            ),
            1
          ),
          100
        );

      offset =
        Math.max(
          Math.floor(
            offset
          ),
          0
        );

      const category =
        typeof req.query.category ===
        "string"
          ? req.query.category
              .trim()
              .slice(0, 200)
          : null;

      const search =
        typeof req.query.search ===
        "string"
          ? req.query.search
              .trim()
              .slice(0, 200)
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
        await db(
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

            discount_percent
              AS "discountPercent"

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
          ]
        );

      return res.json({
        products,

        limit,

        offset,
      });

    } catch (error) {

      console.error(
        "Products error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Internal server error.",
        });
    }
  }
);

/* ========================================================================== */
/* GET SINGLE PRODUCT                                                         */
/* ========================================================================== */

app.get(
  "/api/products/:slug",

  rateLimit(
    120,
    60_000
  ),

  async (
    req: Request,
    res: Response
  ) => {

    try {

      const slug =
        String(
          req.params.slug
        )
        .trim()
        .slice(
          0,
          200
        );

      const products =
        await db(
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

            discount_percent
              AS "discountPercent"

          FROM products

          WHERE slug = $1

          AND active = TRUE

          LIMIT 1
          `,
          [
            slug,
          ]
        );

      if (
        products.length ===
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
        products[0]
      );

    } catch (error) {

      console.error(
        "Product detail error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Internal server error.",
        });
    }
  }
);

/* ========================================================================== */
/* SAFE AFFILIATE CLICK                                                       */
/* ========================================================================== */

/**
 * NOOIT een URL van de bezoeker gebruiken.
 *
 * FOUT:
 *
 * /go?url=https://example.com
 *
 * GOED:
 *
 * /go/<product-id>
 *
 * De server zoekt de affiliate URL zelf op.
 */

app.get(
  "/go/:id",

  rateLimit(
    60,
    60_000
  ),

  async (
    req: Request,
    res: Response
  ) => {

    try {

      const id =
        String(
          req.params.id
        );

      if (
        !/^[0-9a-f-]{36}$/i.test(
          id
        )
      ) {

        return res
          .status(400)
          .send(
            "Invalid product."
          );
      }

      const products =
        await db<{
          id: string;

          affiliate_url:
            string;

          active:
            boolean;
        }>(
          `
          SELECT

            id,

            affiliate_url,

            active

          FROM products

          WHERE id =
            $1::uuid

          LIMIT 1
          `,
          [
            id,
          ]
        );

      if (
        products.length ===
          0 ||
        !products[0].active
      ) {

        return res
          .status(404)
          .send(
            "Product not found."
          );
      }

      const affiliateUrl =
        products[0]
          .affiliate_url;

      if (
        !isSafeAffiliateUrl(
          affiliateUrl
        )
      ) {

        console.error(
          "Unsafe affiliate URL:",
          id
        );

        return res
          .status(410)
          .send(
            "Affiliate destination unavailable."
          );
      }

      await db(
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
        ]
      );

      return res.redirect(
        302,
        affiliateUrl
      );

    } catch (error) {

      console.error(
        "Affiliate redirect error:",
        error
      );

      return res
        .status(500)
        .send(
          "Unable to process affiliate click."
        );
    }
  }
);

/* ========================================================================== */
/* ADMIN CREATE / UPDATE                                                      */
/* ========================================================================== */

app.post(
  "/api/admin/products",

  rateLimit(
    30,
    60_000
  ),

  requireAdmin,

  async (
    req: Request,
    res: Response
  ) => {

    try {

      const parsed =
        productSchema.safeParse(
          req.body
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
        await saveProduct(
          parsed.data
        );

      return res
        .status(
          action ===
            "inserted"
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
  }
);

/* ========================================================================== */
/* ADMIN DELETE / DEACTIVATE                                                  */
/* ========================================================================== */

app.delete(
  "/api/admin/products/:id",

  rateLimit(
    30,
    60_000
  ),

  requireAdmin,

  async (
    req: Request,
    res: Response
  ) => {

    try {

      const id =
        String(
          req.params.id
        );

      if (
        !/^[0-9a-f-]{36}$/i.test(
          id
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
        await database.query(
          `
          UPDATE products

          SET

            active = FALSE,

            updated_at =
              NOW()

          WHERE id =
            $1::uuid
          `,
          [
            id,
          ]
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
        "Delete product error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Internal server error.",
        });
    }
  }
);

/* ========================================================================== */
/* ADMIN AWIN SYNC                                                            */
/* ========================================================================== */

let syncRunning =
  false;

app.post(
  "/api/admin/sync-awin",

  rateLimit(
    5,
    60_000
  ),

  requireAdmin,

  async (
    _req: Request,
    res: Response
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

    let imported =
      0;

    let updated =
      0;

    let failed =
      0;

    const logs =
      await db<{
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
        `
      );

    const logId =
      logs[0].id;

    try {

      const awinProducts =
        await getAwinProducts();

      const MAX_PRODUCTS =
        100000;

      if (
        awinProducts.length >
        MAX_PRODUCTS
      ) {

        throw new Error(
          "Awin feed is larger than the allowed limit."
        );
      }

      for (
        const raw
        of awinProducts
      ) {

        try {

          const product =
            mapAwinProduct(
              raw
            );

          const result =
            await saveProduct(
              product
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
            "Product import failed:",
            error
          );
        }
      }

      await database.query(
        `
        UPDATE sync_logs

        SET

          finished_at =
            NOW(),

          imported =
            $1,

          updated =
            $2,

          failed =
            $3

        WHERE id =
          $4
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
        error instanceof
        Error
          ? error.message
          : "Unknown error.";

      await database.query(
        `
        UPDATE sync_logs

        SET

          finished_at =
            NOW(),

          imported =
            $1,

          updated =
            $2,

          failed =
            $3,

          error_message =
            $4

        WHERE id =
          $5
        `,
        [
          imported,

          updated,

          failed,

          message.slice(
            0,
            5000
          ),

          logId,
        ]
      );

      console.error(
        "Awin sync failed:",
        error
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
  }
);

/* ========================================================================== */
/* HEALTH CHECK                                                               */
/* ========================================================================== */

app.get(
  "/health",

  async (
    _req,
    res
  ) => {

    try {

      await database.query(
        "SELECT 1"
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
  }
);

/* ========================================================================== */
/* 404                                                                        */
/* ========================================================================== */

app.use(
  (
    _req: Request,
    res: Response
  ) => {

    return res
      .status(404)
      .json({
        error:
          "Not found.",
      });
  }
);

/* ========================================================================== */
/* ERROR HANDLER                                                              */
/* ========================================================================== */

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

    return res
      .status(500)
      .json({
        error:
          "Internal server error.",
      });
  }
);

/* ========================================================================== */
/* START                                                                      */
/* ========================================================================== */

async function main() {

  await createDatabase();

  app.listen(
    PORT,
    () => {

      console.log(
        `FitDealFinder Products API running on port ${PORT}`
      );

      if (
        AWIN_PUBLISHER_ID
      ) {

        console.log(
          "Awin publisher configured."
        );
      } else {

        console.log(
          "Awin publisher ID not configured yet."
        );
      }
    }
  );
}

main().catch(
  error => {

    console.error(
      "Fatal startup error:",
      error
    );

    process.exit(
      1
    );
  }
);
