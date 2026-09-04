/**
 * FitDealFinder — Node/Express backend
 *
 * Required environment:
 *   DATABASE_URL
 *   ADMIN_SECRET (minimum 32 characters)
 *
 * Optional:
 *   PORT=3000
 *   TRUST_PROXY=false
 *   NODE_ENV=production
 *   AWIN_API_KEY
 *   AWIN_PRODUCT_FEED_URL
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { Pool } from "pg";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const app = express();

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const AWIN_API_KEY = process.env.AWIN_API_KEY;
const AWIN_PRODUCT_FEED_URL =
  process.env.AWIN_PRODUCT_FEED_URL;
const TRUST_PROXY =
  process.env.TRUST_PROXY === "true";
const NODE_ENV =
  process.env.NODE_ENV ?? "development";

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing.",
  );
}

if (
  !ADMIN_SECRET ||
  ADMIN_SECRET.length < 32
) {
  throw new Error(
    "ADMIN_SECRET must contain at least 32 characters.",
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
        imgSrc: [
          "'self'",
          "https:",
          "data:",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
        ],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
    referrerPolicy: {
      policy:
        "strict-origin-when-cross-origin",
    },
  }),
);

app.use(
  express.json({
    limit: "100kb",
  }),
);

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl:
    NODE_ENV === "production"
      ? {
          rejectUnauthorized: true,
        }
      : undefined,
});

async function db<
  T = Record<string, unknown>,
>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result =
    await pool.query(
      sql,
      params,
    );

  return result.rows as T[];
}

function safeHttps(
  value: string,
): URL {
  const url = new URL(value);

  if (
    url.protocol !== "https:"
  ) {
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
      host.endsWith(
        ".awin.com",
      ) ||
      host.endsWith(
        ".awin1.com",
      )
    );
  } catch {
    return false;
  }
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
      .slice(0, 180) ||
    "product"
  );
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

  const number =
    Number(value);

  return Number.isFinite(
    number,
  )
    ? number
    : null;
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

  return text || null;
}

function discountPercent(
  price: number,
  oldPrice: number | null,
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
    Math.round(
      discount * 1.5,
    ),
  );

  if (
    price > 0 &&
    price < 50
  ) {
    score += 10;
  }

  if (
    oldPrice &&
    oldPrice > price
  ) {
    score += 5;
  }

  return Math.min(
    100,
    Math.max(0, score),
  );
}

const productInputSchema =
  z.object({
    externalId: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional(),

    name: z
      .string()
      .trim()
      .min(1)
      .max(300),

    description: z
      .string()
      .trim()
      .max(10000)
      .nullable()
      .optional(),

    brand: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional(),

    category: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional(),

    goals: z
      .array(
        z.enum([
          "cut",
          "bulk",
          "lean-bulk",
        ]),
      )
      .default([
        "cut",
        "bulk",
        "lean-bulk",
      ]),

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
      .trim()
      .length(3)
      .transform(
        (value) =>
          value.toUpperCase(),
      )
      .default("EUR"),

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
      .trim()
      .min(1)
      .max(200),

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
      .default("AWIN"),

    commission: z
      .number()
      .finite()
      .nonnegative()
      .nullable()
      .optional(),

    commissionType: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional(),

    inStock: z
      .boolean()
      .default(true),
  });

type ProductInput =
  z.infer<
    typeof productInputSchema
  >;

async function ensureDatabase(): Promise<void> {
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
  `);

  await db(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS
      goals TEXT[] NOT NULL
      DEFAULT ARRAY['cut','bulk','lean-bulk']
  `);

  await db(`
    ALTER TABLE products
    ALTER COLUMN affiliate_url DROP NOT NULL
  `);

  await db(`
    CREATE INDEX IF NOT EXISTS
      products_goals_idx
      ON products USING GIN(goals)
  `);
}

function normalizeProduct(
  input: ProductInput,
) {
  safeHttps(
    input.productUrl,
  );

  if (
    input.affiliateUrl &&
    !isAwinUrl(
      input.affiliateUrl,
    )
  ) {
    throw new Error(
      "Affiliate URL must be a valid Awin URL.",
    );
  }

  const oldPrice =
    input.oldPrice ?? null;

  const discount =
    discountPercent(
      input.price,
      oldPrice,
    );

  return {
    ...input,

    goals:
      input.goals.length > 0
        ? input.goals
        : [
            "cut",
            "bulk",
            "lean-bulk",
          ],

    productUrl:
      safeHttps(
        input.productUrl,
      ).toString(),

    affiliateUrl:
      input.affiliateUrl
        ? safeHttps(
            input.affiliateUrl,
          ).toString()
        : null,

    oldPrice,

    discountPercent:
      discount,

    dealScore:
      dealScore(
        input.price,
        oldPrice,
        input.inStock,
      ),
  };
}

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

function mapAwinProduct(
  raw: AwinProduct,
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
    textOrNull(
      raw.productUrl,
    );

  const affiliateUrl =
    textOrNull(
      raw.affiliateUrl ??
        raw.awinLink ??
        raw.deepLink,
    );

  if (!productUrl) {
    throw new Error(
      "Awin product has no product URL.",
    );
  }

  return productInputSchema.parse({
    externalId:
      textOrNull(
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
      ).trim(),

    merchantId:
      textOrNull(
        raw.merchantId,
      ),

    network: "AWIN",

    commission:
      numberOrNull(
        raw.commission,
      ),

    commissionType:
      textOrNull(
        raw.commissionType,
      ),

    inStock:
      raw.inStock !== false,
  });
}

async function saveProduct(
  input: ProductInput,
): Promise<
  "inserted" | "updated"
> {
  const product =
    normalizeProduct(
      input,
    );

  if (product.externalId) {
    const existing =
      await db<{ id: string }>(
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
      deal_score,
      discount_percent,
      last_synced_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,
      $20,$21,$22,NOW()
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
      product.goals,
      product.price,
      product.oldPrice,
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

async function fetchAwinFeed(): Promise<
  AwinProduct[]
> {
  if (!AWIN_API_KEY) {
    throw new Error(
      "AWIN_API_KEY is missing.",
    );
  }

  if (!AWIN_PRODUCT_FEED_URL) {
    throw new Error(
      "AWIN_PRODUCT_FEED_URL is missing.",
    );
  }

  const url =
    safeHttps(
      AWIN_PRODUCT_FEED_URL,
    );

  const response =
    await fetch(
      url,
      {
        headers: {
          Accept:
            "application/json, text/csv, text/xml",
          Authorization:
            `Bearer ${AWIN_API_KEY}`,
          "User-Agent":
            "FitDealFinder/2.0",
        },
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
    contentType.includes(
      "application/json",
    )
  ) {
    const data: unknown =
      await response.json();

    if (
      !Array.isArray(data)
    ) {
      throw new Error(
        "Awin JSON feed is not an array.",
      );
    }

    return data as AwinProduct[];
  }

  throw new Error(
    "The configured Awin feed is not JSON. Configure the actual feed format before enabling automatic import.",
  );
}

async function syncAwin(): Promise<{
  imported: number;
  updated: number;
  failed: number;
}> {
  const log =
    await db<{ id: string }>(
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
    const rawProducts =
      await fetchAwinFeed();

    for (
      const raw of rawProducts
    ) {
      try {
        const result =
          await saveProduct(
            mapAwinProduct(
              raw,
            ),
          );

        if (
          result === "inserted"
        ) {
          imported++;
        } else {
          updated++;
        }
      } catch {
        failed++;
      }
    }
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown sync error.";
  }

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

function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const supplied =
    req.header(
      "x-admin-secret",
    );

  if (
    !supplied ||
    supplied.length !==
      ADMIN_SECRET.length
  ) {
    res.status(401).json({
      error: "Unauthorized.",
    });

    return;
  }

  const a =
    Buffer.from(
      supplied,
    );

  const b =
    Buffer.from(
      ADMIN_SECRET,
    );

  if (
    !crypto.timingSafeEqual(
      a,
      b,
    )
  ) {
    res.status(401).json({
      error: "Unauthorized.",
    });

    return;
  }

  next();
}

function productJson(
  row: Record<
    string,
    unknown
  >,
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
      Array.isArray(
        row.goals,
      )
        ? row.goals
        : [
            "cut",
            "bulk",
            "lean-bulk",
          ],

    price:
      Number(row.price),

    oldPrice:
      row.old_price === null
        ? null
        : Number(
            row.old_price,
          ),

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

app.get(
  "/api/health",
  async (
    _req,
    res,
  ) => {
    try {
      await db(
        "SELECT 1",
      );

      res.json({
        ok: true,
        service:
          "fitdealfinder",
        database:
          "ok",
      });
    } catch {
      res.status(503).json({
        ok: false,
        service:
          "fitdealfinder",
        database:
          "error",
      });
    }
  },
);

app.get(
  "/api/products",
  async (
    req,
    res,
    next,
  ) => {
    try {
      const requestedLimit =
        Number(
          req.query.limit ??
            100,
        );

      const limit =
        Math.min(
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
          req.query.offset ??
            0,
        );

      const offset =
        Math.max(
          Number.isFinite(
            requestedOffset,
          )
            ? requestedOffset
            : 0,
          0,
        );

      const search =
        textOrNull(
          req.query.search,
        );

      const category =
        textOrNull(
          req.query.category,
        );

      const goal =
        textOrNull(
          req.query.goal,
        );

      const merchant =
        textOrNull(
          req.query.merchant,
        );

      const params:
        unknown[] = [];

      const where:
        string[] = [
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
        [
          "cut",
          "bulk",
          "lean-bulk",
        ].includes(
          goal,
        )
      ) {
        params.push(
          goal,
        );

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

      params.push(
        limit,
      );

      const limitParam =
        params.length;

      params.push(
        offset,
      );

      const offsetParam =
        params.length;

      const rows =
        await db(
          `
          SELECT *
          FROM products
          WHERE ${where.join(
            " AND ",
          )}
          ORDER BY
            price ASC,
            deal_score DESC,
            updated_at DESC
          LIMIT $${limitParam}
          OFFSET $${offsetParam}
          `,
          params,
        );

      res.json({
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
      next(error);
    }
  },
);

app.get(
  "/api/products/:slug",
  async (
    req,
    res,
    next,
  ) => {
    try {
      const rows =
        await db(
          `
          SELECT *
          FROM products
          WHERE slug = $1
            AND active = TRUE
          LIMIT 1
          `,
          [
            req.params.slug,
          ],
        );

      if (
        rows.length ===
        0
      ) {
        res.status(404).json({
          error:
            "Product not found.",
        });

        return;
      }

      res.json({
        product:
          productJson(
            rows[0],
          ),
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/sync-awin",
  requireAdmin,
  async (
    _req,
    res,
    next,
  ) => {
    try {
      const result =
        await syncAwin();

      res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/sync-logs",
  requireAdmin,
  async (
    _req,
    res,
    next,
  ) => {
    try {
      const rows =
        await db(
          `
          SELECT *
          FROM sync_logs
          ORDER BY started_at DESC
          LIMIT 20
          `,
        );

      res.json({
        logs: rows,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/go/:id",
  async (
    req,
    res,
    next,
  ) => {
    try {
      const rows =
        await db<{
          id: string;
          affiliate_url:
            | string
            | null;
          product_url: string;
          active: boolean;
        }>(
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
          [
            req.params.id,
          ],
        );

      if (
        rows.length ===
          0 ||
        !rows[0].active
      ) {
        res
          .status(404)
          .send(
            "Product not found.",
          );

        return;
      }

      const destination =
        rows[0]
          .affiliate_url &&
        isAwinUrl(
          rows[0]
            .affiliate_url,
        )
          ? rows[0]
              .affiliate_url
          : rows[0]
              .product_url;

      await db(
        `
        INSERT INTO affiliate_clicks(
          product_id
        )
        VALUES($1)
        `,
        [
          rows[0].id,
        ],
      );

      res.redirect(
        302,
        destination,
      );
    } catch (error) {
      next(error);
    }
  },
);

const __filename =
  fileURLToPath(
    import.meta.url,
  );

const __dirname =
  path.dirname(
    __filename,
  );

const publicDir =
  path.join(
    __dirname,
    "public",
  );

app.use(
  express.static(
    publicDir,
  ),
);

/*
 * Express 5:
 * the wildcard must have a name.
 * { *splat } also allows the root "/" path.
 */
app.get(
  "/{*splat}",
  (
    req,
    res,
    next,
  ) => {
    if (
      req.path.startsWith(
        "/api/",
      ) ||
      req.path.startsWith(
        "/go/",
      )
    ) {
      next();
      return;
    }

    res.sendFile(
      path.join(
        publicDir,
        "index.html",
      ),
    );
  },
);

app.use(
  (
    _req,
    res,
  ) => {
    res.status(404).json({
      error:
        "Not found.",
    });
  },
);

app.use(
  (
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    console.error(
      error,
    );

    res.status(500).json({
      error:
        "Internal server error.",
    });
  },
);

async function start(): Promise<void> {
  await ensureDatabase();

  const server =
    app.listen(
      PORT,
      () => {
        console.log(
          `FitDealFinder listening on port ${PORT}`,
        );
      },
    );

  const shutdown =
    async (
      signal: string,
    ) => {
      console.log(
        `${signal}: shutting down`,
      );

      server.close(
        async () => {
          await pool.end();

          process.exit(
            0,
          );
        },
      );
    };

  process.once(
    "SIGINT",
    () =>
      void shutdown(
        "SIGINT",
      ),
  );

  process.once(
    "SIGTERM",
    () =>
      void shutdown(
        "SIGTERM",
      ),
  );
}

void start().catch(
  async (
    error,
  ) => {
    console.error(
      "Startup failed:",
      error,
    );

    await pool.end();

    process.exit(
      1,
    );
  },
);

