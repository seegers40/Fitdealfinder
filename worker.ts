interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ADMIN_SECRET: string;
  AWIN_API_KEY?: string;
  AWIN_PRODUCT_FEED_URL?: string;
}

type Goal = "cut" | "bulk" | "lean-bulk";

const GOALS: Goal[] = ["cut", "bulk", "lean-bulk"];

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

  return text
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

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function safeHttps(
  value: string,
): URL {
  const url =
    new URL(value);

  if (
    url.protocol !==
    "https:"
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
      host.endsWith(".awin.com") ||
      host.endsWith(".awin1.com")
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
      .slice(0, 120) ||
    "product"
  );
}

function normalizeGoals(
  value: unknown,
): Goal[] {
  if (
    Array.isArray(value)
  ) {
    const valid =
      value.filter(
        (
          goal,
        ): goal is Goal =>
          typeof goal ===
            "string" &&
          GOALS.includes(
            goal as Goal,
          ),
      );

    if (valid.length) {
      return [
        ...new Set(valid),
      ];
    }
  }

  return [...GOALS];
}

function goalsJson(
  goals: Goal[],
): string {
  return JSON.stringify(
    goals,
  );
}

function parseGoals(
  value: unknown,
): Goal[] {
  if (
    typeof value !==
    "string"
  ) {
    return [...GOALS];
  }

  try {
    return normalizeGoals(
      JSON.parse(value),
    );
  } catch {
    return [...GOALS];
  }
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

function productJson(
  row: ProductRow,
) {
  return {
    id: row.id,

    externalId:
      row.external_id,

    name:
      row.name,

    slug:
      row.slug,

    description:
      row.description,

    brand:
      row.brand,

    category:
      row.category,

    goals:
      parseGoals(
        row.goals,
      ),

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
      Boolean(row.in_stock),

    dealScore:
      Number(
        row.deal_score,
      ),

    discountPercent:
      row.discount_percent ===
      null
        ? null
        : Number(
            row.discount_percent,
          ),

    lastSyncedAt:
      row.last_synced_at,
  };
}

async function handleHealth(
  env: Env,
): Promise<Response> {
  try {
    const result =
      await env.DB
        .prepare(
          "SELECT 1 AS ok",
        )
        .first<{
          ok: number;
        }>();

    return json({
      ok:
        result?.ok === 1,

      service:
        "fitdealfinder",

      database:
        result?.ok === 1
          ? "ok"
          : "error",
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
        url.searchParams.get(
          "offset",
        ) ?? "0",
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

    const where: string[] = [
      "active = 1",
      "in_stock
