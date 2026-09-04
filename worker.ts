export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  AWIN_API_KEY?: string;
  AWIN_PUBLISHER_ID?: string;
  AWIN_PRODUCT_FEED_URL?: string;

  ADMIN_SECRET?: string;

  AI_API_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
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

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });

const text = (data: string, status = 200): Response =>
  new Response(data, {
    status,
    headers: {
      "content-type": "text/plain; charset=UTF-8",
      "cache-control": "no-store",
    },
  });

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
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
  const allowed = ["cut", "bulk", "lean-bulk"];

  if (Array.isArray(value)) {
    const result = [
      ...new Set(
        value
          .map((item) => String(item).trim().toLowerCase())
          .filter((item) => allowed.includes(item))
      ),
    ];

    if (result.length > 0) {
      return result;
    }
  }

  return allowed;
}

function productFromRow(row: ProductRow) {
  let parsedGoals: unknown = null;

  try {
    parsedGoals = JSON.parse(row.goals);
  } catch {
    parsedGoals = null;
  }

  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    brand: row.brand,
    category: row.category,
    goals: normalizeGoals(parsedGoals),
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

async function getProducts(
  env: Env,
  request: Request
): Promise<Response> {
  const url = new URL(request.url);

  const rawLimit = Number(
    url.searchParams.get("limit") ?? "100"
  );

  const limit = Math.max(
    1,
    Math.min(
      200,
      Number.isFinite(rawLimit)
        ? Math.floor(rawLimit)
        : 100
    )
  );

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
    where.push("goals LIKE ?");
    bindings.push(`%"${goal.toLowerCase()}"%`);
  }

  if (search) {
    where.push(
      "(LOWER(name) LIKE LOWER(?) OR " +
        "LOWER(brand) LIKE LOWER(?) OR " +
        "LOWER(category) LIKE LOWER(?))"
    );

    const term = `%${search}%`;

    bindings.push(
      term,
      term,
      term
    );
  }

  bindings.push(limit);

  const result = await env.DB
    .prepare(
      `
        SELECT *
        FROM products
        WHERE ${where.join(" AND ")}
        ORDER BY
          deal_score DESC,
          price ASC,
          name ASC
        LIMIT ?
      `
    )
    .bind(...bindings)
    .all<ProductRow>();

  return json({
    products: result.results.map(productFromRow),
    count: result.results.length,
  });
}

async function getProduct(
  env: Env,
  slug: string
): Promise<Response> {
  const row = await env.DB
    .prepare(
      `
        SELECT *
        FROM products
        WHERE slug = ?
          AND active = 1
        LIMIT 1
      `
    )
    .bind(slug)
    .first<ProductRow>();

  if (!row) {
    return json(
      {
        error: "Product not found",
      },
      404
    );
  }

  return json(productFromRow(row));
}

async function health(
  env: Env
): Promise<Response> {
  try {
    const result = await env.DB
      .prepare(
        "SELECT 1 AS ok"
      )
      .first<{ ok: number }>();

    return json({
      ok: result?.ok === 1,
      service: "fitdealfinder",
      database: "D1",
    });
  } catch (error) {
    return json(
      {
        ok: false,
        service: "fitdealfinder",
        database: "D1",
        error:
          error instanceof Error
            ? error.message
            : "Database error",
      },
      500
    );
  }
}

function isAdmin(
  request: Request,
  env: Env
): boolean {
  if (!env.ADMIN_SECRET) {
    return false;
  }

  return (
    request.headers.get("x-admin-secret") ===
    env.ADMIN_SECRET
  );
}

function mapAwinProduct(
  item: AwinProduct
) {
  const externalId =
    item.id ?? item.product_id;

  const name = String(
    item.name ?? item.title ?? ""
  ).trim();

  const salePrice =
    numberOrNull(item.sale_price);

  const normalPrice =
    numberOrNull(item.price);

  const price =
    salePrice !== null
      ? salePrice
      : normalPrice;

  const productUrl = String(
    item.product_url ??
      item.url ??
      ""
  ).trim();

  if (
    externalId === undefined ||
    externalId === null ||
    !String(externalId).trim() ||
    !name ||
    price === null ||
    price < 0 ||
    !productUrl ||
    !isSafeHttpsUrl(productUrl)
  ) {
    return null;
  }

  const oldPrice =
    numberOrNull(item.old_price);

  const imageUrlValue = String(
    item.image_url ??
      item.image ??
      ""
  ).trim();

  const affiliateUrlValue =
    String(
      item.affiliate_url ?? ""
    ).trim();

  return {
    externalId:
      String(externalId).trim(),

    name,

    description:
      String(
        item.description ?? ""
      ).trim() || null,

    brand:
      String(
        item.brand ?? ""
      ).trim() || null,

    category:
      String(
        item.category ?? ""
      ).trim() || null,

    price,

    oldPrice,

    currency:
      String(
        item.currency ?? "EUR"
      )
        .trim()
        .toUpperCase() || "EUR",

    imageUrl:
      imageUrlValue &&
      isSafeHttpsUrl(imageUrlValue)
        ? imageUrlValue
        : null,

    productUrl,

    affiliateUrl:
      affiliateUrlValue &&
      isSafeHttpsUrl(
        affiliateUrlValue
      )
        ? affiliateUrlValue
        : null,

    merchantName:
      String(
        item.merchant_name ??
          "Awin merchant"
      ).trim() ||
      "Awin merchant",

    merchantId:
      item.merchant_id ===
        undefined ||
      item.merchant_id === null
        ? null
        : String(
            item.merchant_id
          ),

    commission:
      numberOrNull(
        item.commission
      ),

    commissionType:
      String(
        item.commission_type ??
          ""
      ).trim() || null,

    inStock:
      typeof item.in_stock ===
      "boolean"
        ? item.in_stock
        : typeof item.in_stock ===
          "number"
        ? item.in_stock !== 0
        : true,

    goals: [
      "cut",
      "bulk",
      "lean-bulk",
    ],
  };
}

function parseAwinFeed(
  data: unknown
): AwinProduct[] {
  if (Array.isArray(data)) {
    return data as AwinProduct[];
  }

  if (
    data !== null &&
    typeof data === "object"
  ) {
    const record =
      data as Record<
        string,
        unknown
      >;

    for (
      const key of [
        "products",
        "items",
        "data",
        "results",
      ]
    ) {
      if (
        Array.isArray(record[key])
      ) {
        return record[key] as AwinProduct[];
      }
    }
  }

  return [];
}

async function syncAwin(
  env: Env,
  request: Request
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return json(
      {
        error: "Unauthorized",
      },
      401
    );
  }

  if (
    !env.AWIN_PRODUCT_FEED_URL
  ) {
    return json(
      {
        error:
          "AWIN_PRODUCT_FEED_URL is not configured",
      },
      500
    );
  }

  const startedAt =
    new Date().toISOString();

  let imported = 0;
  let updated = 0;
  let failed = 0;
  let errorMessage:
    | string
    | null = null;

  try {
    const headers =
      new Headers({
        accept:
          "application/json",
      });

    if (env.AWIN_API_KEY) {
      headers.set(
        "authorization",
        `Bearer ${env.AWIN_API_KEY}`
      );
    }

    const response =
      await fetch(
        env.AWIN_PRODUCT_FEED_URL,
        {
          method: "GET",
          headers,
        }
      );

    if (!response.ok) {
      throw new Error(
        `Awin feed request failed with HTTP ${response.status}`
      );
    }

    const data: unknown =
      await response.json();

    const feedProducts =
      parseAwinFeed(data);

    if (
      feedProducts.length === 0
    ) {
      throw new Error(
        "Awin feed contained no products"
      );
    }

    for (
      const item of feedProducts
    ) {
      const mapped =
        mapAwinProduct(item);

      if (!mapped) {
        failed += 1;
        continue;
      }

      const existing =
        await env.DB
          .prepare(
            `
              SELECT id, slug
              FROM products
              WHERE network = ?
                AND external_id = ?
              LIMIT 1
            `
          )
          .bind(
            "AWIN",
            mapped.externalId
          )
          .first<{
            id: string;
            slug: string;
          }>();

      let slug =
        slugify(mapped.name) ||
        `product-${mapped.externalId}`;

      if (!existing) {
        const slugTaken =
          await env.DB
            .prepare(
              `
                SELECT id
                FROM products
                WHERE slug = ?
                LIMIT 1
              `
            )
            .bind(slug)
            .first<{
              id: string;
            }>();

        if (slugTaken) {
          slug =
            `${slug}-${mapped.externalId}`
              .slice(0, 160);
        }
      }

      const id =
        existing?.id ??
        crypto.randomUUID();

      const discountPercent =
        calculateDiscount(
          mapped.price,
          mapped.oldPrice
        );

      const dealScore =
        calculateDealScore(
          mapped.price,
          mapped.oldPrice,
          mapped.inStock
        );

      await env.DB
        .prepare(
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
              last_synced_at,
              created_at,
              updated_at
            )
            VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?,
              datetime('now'),
              datetime('now'),
              datetime('now')
            )
            ON CONFLICT(network, external_id)
            DO UPDATE SET
              name = excluded.name,
              slug = excluded.slug,
              description = excluded.description,
              brand = excluded.brand,
              category = excluded.category,
              goals = excluded.goals,
              price = excluded.price,
              old_price = excluded.old_price,
              currency = excluded.currency,
              image_url = excluded.image_url,
              product_url = excluded.product_url,
              affiliate_url = excluded.affiliate_url,
              merchant_name = excluded.merchant_name,
              merchant_id = excluded.merchant_id,
              commission = excluded.commission,
              commission_type = excluded.commission_type,
              in_stock = excluded.in_stock,
              active = excluded.active,
              deal_score = excluded.deal_score,
              discount_percent = excluded.discount_percent,
              last_synced_at = datetime('now'),
              updated_at = datetime('now')
          `
        )
        .bind(
          id,
          mapped.externalId,
          mapped.name,
          slug,
          mapped.description,
          mapped.brand,
          mapped.category,
          JSON.stringify(
            mapped.goals
          ),
          mapped.price,
          mapped.oldPrice,
          mapped.currency,
          mapped.imageUrl,
          mapped.productUrl,
          mapped.affiliateUrl,
          mapped.merchantName,
          mapped.merchantId,
          "AWIN",
          mapped.commission,
          mapped.commissionType,
          mapped.inStock ? 1 : 0,
          1,
          dealScore,
          discountPercent
        )
        .run();

      if (existing) {
        updated += 1;
      } else {
        imported += 1;
      }
    }
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown sync error";
  }

  await env.DB
    .prepare(
      `
        INSERT INTO sync_logs (
          network,
          started_at,
          finished_at,
          imported,
          updated,
          failed,
          error_message
        )
        VALUES (
          ?,
          ?,
          datetime('now'),
          ?,
          ?,
          ?,
          ?
        )
      `
    )
    .bind(
      "AWIN",
      startedAt,
      imported,
      updated,
      failed,
      errorMessage
    )
    .run();

  return json(
    {
      ok: !errorMessage,
      network: "AWIN",
      imported,
      updated,
      failed,
      error: errorMessage,
    },
    errorMessage ? 500 : 200
  );
}

async function aiChat(
  env: Env,
  request: Request
): Promise<Response> {
  if (
    !env.AI_API_URL ||
    !env.AI_API_KEY
  ) {
    return json(
      {
        error:
          "AI service is not configured",
      },
      503
    );
  }

  const body =
    (await request
      .json()
      .catch(() => null)) as
      | {
          message?: unknown;
        }
      | null;

  const message =
    typeof body?.message ===
    "string"
      ? body.message.trim()
      : "";

  if (!message) {
    return json(
      {
        error:
          "Message is required",
      },
      400
    );
  }

  const response =
    await fetch(
      env.AI_API_URL,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          authorization:
            `Bearer ${env.AI_API_KEY}`,
        },
        body: JSON.stringify({
          model:
            env.AI_MODEL ??
            "gpt-4o-mini",

          messages: [
            {
              role: "system",
              content:
                "Je bent de FitDealFinder AI-assistent. " +
                "Je helpt in het Nederlands met fitnessproducten, " +
                "cut, bulk en lean-bulk. " +
                "Geef praktische, korte antwoorden. " +
                "Verzin nooit productprijzen, kortingen of voorraad. " +
                "Adviseer gebruikers om prijzen en productinformatie " +
                "te controleren voordat ze kopen.",
            },
            {
              role: "user",
              content: message,
            },
          ],

          temperature: 0.4,
        }),
      }
    );

  const data =
    (await response
      .json()
      .catch(() => null)) as
      | {
          choices?: Array<{
            message?: {
              content?: string;
            };
          }>;
        }
      | null;

  if (!response.ok) {
    return json(
      {
        error:
          "AI service request failed",
      },
      502
    );
  }

  const reply =
    data?.choices?.[0]?.message
      ?.content ??
    "Geen antwoord ontvangen.";

  return json({
    reply,
  });
}

async function getSyncLogs(
  env: Env,
  request: Request
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return json(
      {
        error: "Unauthorized",
      },
      401
    );
  }

  const result =
    await env.DB
      .prepare(
        `
          SELECT
            id,
            network,
            started_at,
            finished_at,
            imported,
            updated,
            failed,
            error_message
          FROM sync_logs
          ORDER BY started_at DESC
          LIMIT 50
        `
      )
      .all();

  return json({
    logs: result.results,
  });
}

async function redirectToProduct(
  env: Env,
  id: string
): Promise<Response> {
  const row =
    await env.DB
      .prepare(
        `
          SELECT
            id,
            product_url,
            affiliate_url,
            active
          FROM products
          WHERE id = ?
          LIMIT 1
        `
      )
      .bind(id)
      .first<{
        id: string;
        product_url: string;
        affiliate_url:
          | string
          | null;
        active: number;
      }>();

  if (
    !row ||
    row.active !== 1
  ) {
    return text(
      "Product not found",
      404
    );
  }

  await env.DB
    .prepare(
      `
        INSERT INTO affiliate_clicks (
          product_id
        )
        VALUES (?)
      `
    )
    .bind(row.id)
    .run();

  const destination =
    row.affiliate_url &&
    isSafeHttpsUrl(
      row.affiliate_url
    )
      ? row.affiliate_url
      : row.product_url;

  if (
    !isSafeHttpsUrl(
      destination
    )
  ) {
    return text(
      "Product destination is not available",
      500
    );
  }

  return Response.redirect(
    destination,
    302
  );
}

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const url =
      new URL(request.url);

    const path =
      url.pathname;

    try {
      if (
        request.method ===
          "GET" &&
        path ===
          "/api/health"
      ) {
        return health(env);
      }

      if (
        request.method ===
          "GET" &&
        path ===
          "/api/products"
      ) {
        return getProducts(
          env,
          request
        );
      }

      if (
        request.method ===
          "GET" &&
        path.startsWith(
          "/api/products/"
        )
      ) {
        const slug =
          decodeURIComponent(
            path.slice(
              "/api/products/"
                .length
            )
          );

        return getProduct(
          env,
          slug
        );
      }

      if (
        request.method ===
          "POST" &&
        path ===
          "/api/admin/sync-awin"
      ) {
        return syncAwin(
          env,
          request
        );
      }

      if (
        request.method ===
          "GET" &&
        path ===
          "/api/admin/sync-logs"
      ) {
        return getSyncLogs(
          env,
          request
        );
      }

      if (
        request.method ===
          "POST" &&
        path ===
          "/api/ai/chat"
      ) {
        return aiChat(
          env,
          request
        );
      }

      if (
        request.method ===
          "GET" &&
        path.startsWith(
          "/go/"
        )
      ) {
        const id =
          decodeURIComponent(
            path.slice(
              "/go/".length
            )
          );

        return redirectToProduct(
          env,
          id
        );
      }

      return env.ASSETS.fetch(
        request
      );
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Internal server error",
        },
        500
      );
    }
  },
};

