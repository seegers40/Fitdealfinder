export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;

  ADMIN_SECRET?: string;

  AWIN_FEED_URL?: string;
  AWIN_PUBLISHER_ID?: string;

  AI_MODEL?: string;
}

interface ProductRow {
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
}

interface AwinProduct {
  id?: string | number;
  external_id?: string | number;
  name?: string;
  title?: string;
  description?: string;
  brand?: string;
  category?: string;
  price?: number | string;
  old_price?: number | string;
  sale_price?: number | string;
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
  stock?: boolean | number;
  goals?: string[] | string;
}

const DEFAULT_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function text(
  value: string,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(value, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function errorResponse(message: string, status = 500): Response {
  return json(
    {
      error: message,
    },
    status,
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function booleanToInteger(value: unknown, fallback = 1): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "number") {
    return value > 0 ? 1 : 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["false", "0", "no", "out", "outofstock"].includes(normalized)) {
      return 0;
    }

    if (["true", "1", "yes", "in", "instock"].includes(normalized)) {
      return 1;
    }
  }

  return fallback;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function normalizeGoals(value: unknown): string {
  const allowed = new Set(["cut", "bulk", "lean-bulk"]);

  let values: string[] = [];

  if (Array.isArray(value)) {
    values = value.map(String);
  } else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        values = parsed.map(String);
      } else {
        values = value.split(/[,\s]+/);
      }
    } catch {
      values = value.split(/[,\s]+/);
    }
  }

  const normalized = values
    .map((item) => item.trim().toLowerCase())
    .map((item) => {
      if (item === "leanbulk" || item === "lean_bulk") {
        return "lean-bulk";
      }

      return item;
    })
    .filter((item) => allowed.has(item));

  const unique = [...new Set(normalized)];

  return JSON.stringify(
    unique.length > 0 ? unique : ["cut", "bulk", "lean-bulk"],
  );
}

function calculateDiscount(
  price: number,
  oldPrice: number | null,
): number | null {
  if (
    oldPrice === null ||
    oldPrice <= 0 ||
    price < 0 ||
    oldPrice <= price
  ) {
    return null;
  }

  return Math.round(((oldPrice - price) / oldPrice) * 100);
}

function calculateDealScore(
  price: number,
  oldPrice: number | null,
  inStock: number,
): number {
  if (!inStock) {
    return 0;
  }

  const discount = calculateDiscount(price, oldPrice) ?? 0;

  return Math.max(0, Math.min(100, discount * 2));
}

function mapProduct(product: AwinProduct): {
  externalId: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  goals: string;
  price: number;
  oldPrice: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string;
  affiliateUrl: string | null;
  merchantName: string;
  merchantId: string | null;
  commission: number | null;
  commissionType: string | null;
  inStock: number;
} {
  const externalId = String(
    product.external_id ??
      product.id ??
      crypto.randomUUID(),
  );

  const name = String(
    product.name ??
      product.title ??
      "Onbekend product",
  ).trim();

  const price =
    numberOrNull(
      product.sale_price ??
        product.price,
    ) ?? 0;

  const oldPrice =
    numberOrNull(product.old_price);

  const productUrl =
    safeUrl(
      product.product_url ??
        product.url,
    ) ?? "";

  const imageUrl =
    safeUrl(
      product.image_url ??
        product.image,
    );

  const affiliateUrl =
    safeUrl(product.affiliate_url);

  const inStock = booleanToInteger(
    product.in_stock ??
      product.stock,
    1,
  );

  return {
    externalId,
    name,
    slug: slugify(name) || `product-${externalId}`,
    description:
      typeof product.description === "string"
        ? product.description.trim()
        : null,
    brand:
      typeof product.brand === "string"
        ? product.brand.trim()
        : null,
    category:
      typeof product.category === "string"
        ? product.category.trim()
        : null,
    goals: normalizeGoals(product.goals),
    price,
    oldPrice,
    currency:
      typeof product.currency === "string" &&
      product.currency.trim()
        ? product.currency.trim().toUpperCase()
        : "EUR",
    imageUrl,
    productUrl,
    affiliateUrl,
    merchantName:
      typeof product.merchant_name === "string" &&
      product.merchant_name.trim()
        ? product.merchant_name.trim()
        : "Awin merchant",
    merchantId:
      product.merchant_id !== undefined &&
      product.merchant_id !== null
        ? String(product.merchant_id)
        : null,
    commission:
      numberOrNull(product.commission),
    commissionType:
      typeof product.commission_type === "string"
        ? product.commission_type
        : null,
    inStock,
  };
}

function getProductsFromFeed(data: unknown): AwinProduct[] {
  if (Array.isArray(data)) {
    return data as AwinProduct[];
  }

  if (!data || typeof data !== "object") {
    return [];
  }

  const object = data as Record<string, unknown>;

  for (const key of [
    "products",
    "items",
    "data",
    "results",
  ]) {
    if (Array.isArray(object[key])) {
      return object[key] as AwinProduct[];
    }
  }

  return [];
}

async function parseAwinFeed(response: Response): Promise<AwinProduct[]> {
  const contentType =
    response.headers.get("content-type") ?? "";

  const body = await response.text();

  if (
    contentType.includes("application/json") ||
    body.trim().startsWith("{") ||
    body.trim().startsWith("[")
  ) {
    try {
      return getProductsFromFeed(JSON.parse(body));
    } catch {
      throw new Error("Awin-feed bevat geen geldige JSON.");
    }
  }

  throw new Error(
    "Awin-feed formaat is nog niet herkend. Eerst de echte Awin-feed controleren.",
  );
}

async function syncAwin(env: Env): Promise<{
  imported: number;
  updated: number;
  failed: number;
}> {
  if (!env.AWIN_FEED_URL) {
    throw new Error("AWIN_FEED_URL is nog niet ingesteld.");
  }

  const startedAt = new Date().toISOString();

  const logResult = await env.DB.prepare(
    `
      INSERT INTO sync_logs (
        network,
        started_at
      )
      VALUES (?, ?)
    `,
  )
    .bind("AWIN", startedAt)
    .run();

  const logId = Number(logResult.meta.last_row_id);

  let imported = 0;
  let updated = 0;
  let failed = 0;

  try {
    const feedResponse = await fetch(env.AWIN_FEED_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!feedResponse.ok) {
      throw new Error(
        `Awin-feed gaf HTTP ${feedResponse.status}.`,
      );
    }

    const products =
      await parseAwinFeed(feedResponse);

    for (const rawProduct of products) {
      try {
        const product = mapProduct(rawProduct);

        if (!product.productUrl) {
          failed++;
          continue;
        }

        const now = new Date().toISOString();

        const existing = await env.DB.prepare(
          `
            SELECT id
            FROM products
            WHERE network = ?
              AND external_id = ?
            LIMIT 1
          `,
        )
          .bind("AWIN", product.externalId)
          .first<{ id: string }>();

        if (existing) {
          await env.DB.prepare(
            `
              UPDATE products
              SET
                name = ?,
                slug = ?,
                description = ?,
                brand = ?,
                category = ?,
                goals = ?,
                price = ?,
                old_price = ?,
                currency = ?,
                image_url = ?,
                product_url = ?,
                affiliate_url = ?,
                merchant_name = ?,
                merchant_id = ?,
                commission = ?,
                commission_type = ?,
                in_stock = ?,
                active = 1,
                deal_score = ?,
                discount_percent = ?,
                last_synced_at = ?,
                updated_at = ?
              WHERE id = ?
            `,
          )
            .bind(
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
              product.commission,
              product.commissionType,
              product.inStock,
              calculateDealScore(
                product.price,
                product.oldPrice,
                product.inStock,
              ),
              calculateDiscount(
                product.price,
                product.oldPrice,
              ),
              now,
              now,
              existing.id,
            )
            .run();

          updated++;
        } else {
          const id = crypto.randomUUID();

          await env.DB.prepare(
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
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?
              )
            `,
          )
            .bind(
              id,
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
              "AWIN",
              product.commission,
              product.commissionType,
              product.inStock,
              1,
              calculateDealScore(
                product.price,
                product.oldPrice,
                product.inStock,
              ),
              calculateDiscount(
                product.price,
                product.oldPrice,
              ),
              now,
            )
            .run();

          imported++;
        }
      } catch {
        failed++;
      }
    }

    await env.DB.prepare(
      `
        UPDATE sync_logs
        SET
          finished_at = ?,
          imported = ?,
          updated = ?,
          failed = ?
        WHERE id = ?
      `,
    )
      .bind(
        new Date().toISOString(),
        imported,
        updated,
        failed,
        logId,
      )
      .run();

    return {
      imported,
      updated,
      failed,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    await env.DB.prepare(
      `
        UPDATE sync_logs
        SET
          finished_at = ?,
          imported = ?,
          updated = ?,
          failed = ?,
          error_message = ?
        WHERE id = ?
      `,
    )
      .bind(
        new Date().toISOString(),
        imported,
        updated,
        failed + 1,
        message,
        logId,
      )
      .run();

    throw error;
  }
}

function adminAuthorized(
  request: Request,
  env: Env,
): boolean {
  if (!env.ADMIN_SECRET) {
    return false;
  }

  const supplied =
    request.headers.get("Authorization");

  if (!supplied) {
    return false;
  }

  return supplied === `Bearer ${env.ADMIN_SECRET}`;
}

async function handleProducts(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  const search =
    url.searchParams.get("search")?.trim() ?? "";

  const goal =
    url.searchParams.get("goal")?.trim() ?? "";

  const category =
    url.searchParams.get("category")?.trim() ?? "";

  const limitRaw =
    Number(url.searchParams.get("limit") ?? "50");

  const limit = Math.min(
    Math.max(
      Number.isFinite(limitRaw)
        ? Math.floor(limitRaw)
        : 50,
      1,
    ),
    100,
  );

  const offsetRaw =
    Number(url.searchParams.get("offset") ?? "0");

  const offset = Math.max(
    Number.isFinite(offsetRaw)
      ? Math.floor(offsetRaw)
      : 0,
    0,
  );

  const conditions = [
    "active = 1",
    "in_stock = 1",
  ];

  const params: unknown[] = [];

  if (search) {
    conditions.push(
      `
        (
          name LIKE ?
          OR brand LIKE ?
          OR category LIKE ?
          OR merchant_name LIKE ?
        )
      `,
    );

    const value = `%${search}%`;

    params.push(
      value,
      value,
      value,
      value,
    );
  }

  if (goal && ["cut", "bulk", "lean-bulk"].includes(goal)) {
    conditions.push("goals LIKE ?");
    params.push(`%\"${goal}\"%`);
  }

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }

  const where = conditions.join(" AND ");

  const countResult = await env.DB.prepare(
    `
      SELECT COUNT(*) AS total
      FROM products
      WHERE ${where}
    `,
  )
    .bind(...params)
    .first<{ total: number }>();

  const rows = await env.DB.prepare(
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
      FROM products
      WHERE ${where}
      ORDER BY deal_score DESC, updated_at DESC
      LIMIT ? OFFSET ?
    `,
  )
    .bind(
      ...params,
      limit,
      offset,
    )
    .all<ProductRow>();

  return json({
    products: rows.results,
    total: Number(countResult?.total ?? 0),
    limit,
    offset,
  });
}

async function handleProductBySlug(
  env: Env,
  slug: string,
): Promise<Response> {
  const product = await env.DB.prepare(
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
      FROM products
      WHERE slug = ?
        AND active = 1
      LIMIT 1
    `,
  )
    .bind(slug)
    .first<ProductRow>();

  if (!product) {
    return errorResponse(
      "Product niet gevonden.",
      404,
    );
  }

  return json({
    product,
  });
}

async function handleAiChat(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(
      "Methode niet toegestaan.",
      405,
    );
  }

  let body: {
    message?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse(
      "Ongeldige JSON.",
      400,
    );
  }

  const message =
    typeof body.message === "string"
      ? body.message.trim()
      : "";

  if (!message) {
    return errorResponse(
      "Vul een vraag in.",
      400,
    );
  }

  if (message.length > 2000) {
    return errorResponse(
      "Vraag is te lang.",
      400,
    );
  }

  const systemPrompt = `
Je bent de AI-assistent van FitDealFinder.

FitDealFinder vergelijkt fitnessproducten en deals
voor cut, bulk en lean-bulk.

Antwoord in het Nederlands.
Wees praktisch, kort en duidelijk.
Geef geen medische diagnose.
Verzin geen actuele prijzen, kortingen, producten,
winkels of beschikbaarheid.

Als er geen actuele productgegevens zijn,
zeg dat eerlijk.

Help gebruikers met:
- cut
- bulk
- lean-bulk
- supplementen
- fitnessvoeding
- productvergelijkingen
- algemene fitnessvragen

Zeg nooit dat een product momenteel op voorraad is
als dat niet uit actuele gegevens blijkt.
  `.trim();

  try {
    const result = await env.AI.run(
      env.AI_MODEL || DEFAULT_AI_MODEL,
      {
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: message,
          },
        ],
      },
    );

    const response =
      result as {
        response?: string;
      };

    return json({
      answer:
        response.response ??
        "Ik kon helaas geen antwoord genereren.",
    });
  } catch (error) {
    console.error("Workers AI error:", error);

    return errorResponse(
      "De AI kon momenteel geen antwoord geven.",
      502,
    );
  }
}

async function handleHealth(
  env: Env,
): Promise<Response> {
  try {
    const result = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM products",
    ).first<{ count: number }>();

    return json({
      ok: true,
      database: "connected",
      products: Number(result?.count ?? 0),
      ai: true,
    });
  } catch (error) {
    console.error("Health check error:", error);

    return json(
      {
        ok: false,
        database: "error",
        ai: true,
      },
      500,
    );
  }
}

async function handleAffiliateRedirect(
  request: Request,
  env: Env,
  productId: string,
): Promise<Response> {
  const product = await env.DB.prepare(
    `
      SELECT
        id,
        product_url,
        affiliate_url,
        active
      FROM products
      WHERE id = ?
      LIMIT 1
    `,
  )
    .bind(productId)
    .first<{
      id: string;
      product_url: string;
      affiliate_url: string | null;
      active: number;
    }>();

  if (!product || product.active !== 1) {
    return errorResponse(
      "Product niet gevonden.",
      404,
    );
  }

  await env.DB.prepare(
    `
      INSERT INTO affiliate_clicks (
        product_id
      )
      VALUES (?)
    `,
  )
    .bind(product.id)
    .run();

  const destination =
    safeUrl(product.affiliate_url) ??
    safeUrl(product.product_url);

  if (!destination) {
    return errorResponse(
      "Productlink is ongeldig.",
      500,
    );
  }

  return Response.redirect(
    destination,
    302,
  );
}

async function handleSync(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!adminAuthorized(request, env)) {
    return errorResponse(
      "Niet geautoriseerd.",
      401,
    );
  }

  if (request.method !== "POST") {
    return errorResponse(
      "Gebruik POST.",
      405,
    );
  }

  try {
    const result = await syncAwin(env);

    return json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return errorResponse(
      message,
      500,
    );
  }
}

async function handleSyncLogs(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!adminAuthorized(request, env)) {
    return errorResponse(
      "Niet geautoriseerd.",
      401,
    );
  }

  const logs = await env.DB.prepare(
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
    `,
  ).all();

  return json({
    logs: logs.results,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        return await handleHealth(env);
      }

      if (
        url.pathname === "/api/products" &&
        request.method === "GET"
      ) {
        return await handleProducts(
          request,
          env,
        );
      }

      if (
        url.pathname.startsWith("/api/products/")
      ) {
        const slug =
          url.pathname.slice(
            "/api/products/".length,
          );

        if (slug) {
          return await handleProductBySlug(
            env,
            slug,
          );
        }
      }

      if (url.pathname === "/api/ai/chat") {
        return await handleAiChat(
          request,
          env,
        );
      }

      if (url.pathname === "/api/admin/sync") {
        return await handleSync(
          request,
          env,
        );
      }

      if (
        url.pathname ===
        "/api/admin/sync-logs"
      ) {
        return await handleSyncLogs(
          request,
          env,
        );
      }

      if (
        url.pathname.startsWith("/go/")
      ) {
        const productId =
          url.pathname.slice(4);

        if (!productId) {
          return errorResponse(
            "Product ontbreekt.",
            400,
          );
        }

        return await handleAffiliateRedirect(
          request,
          env,
          productId,
        );
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Worker error:", error);

      return errorResponse(
        "Interne serverfout.",
        500,
      );
    }
  },
};

