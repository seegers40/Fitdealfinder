interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  ADMIN_SECRET?: string;
  AWIN_FEED_URL?: string;
  AWIN_PUBLISHER_ID?: string;
  AI_MODEL?: string;
}

const DEFAULT_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function text(message: string, status = 200): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(message: string, status = 500): Response {
  return json({ error: message }, status);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function booleanToInteger(
  value: unknown,
  defaultValue = 1,
): number {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "number") {
    return value !== 0 ? 1 : 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (
      [
        "true",
        "yes",
        "y",
        "1",
        "in stock",
        "instock",
      ].includes(normalized)
    ) {
      return 1;
    }

    if (
      [
        "false",
        "no",
        "n",
        "0",
        "out of stock",
        "outofstock",
      ].includes(normalized)
    ) {
      return 0;
    }
  }

  return defaultValue;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function normalizeGoals(value: unknown): string {
  const defaults = [
    "cut",
    "bulk",
    "lean-bulk",
  ];

  if (Array.isArray(value)) {
    const goals = value
      .map((item) =>
        String(item).trim().toLowerCase(),
      )
      .filter(Boolean);

    return JSON.stringify(
      goals.length ? goals : defaults,
    );
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return JSON.stringify(
          parsed
            .map((item) =>
              String(item).trim().toLowerCase(),
            )
            .filter(Boolean),
        );
      }
    } catch {
      const goals = value
        .split(/[;,|]/)
        .map((item) =>
          item.trim().toLowerCase(),
        )
        .filter(Boolean);

      if (goals.length) {
        return JSON.stringify(goals);
      }
    }
  }

  return JSON.stringify(defaults);
}

function calculateDiscountPercent(
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

  return Math.round(
    ((oldPrice - price) / oldPrice) * 100,
  );
}

function calculateDealScore(
  price: number,
  oldPrice: number | null,
  inStock: number,
): number {
  if (!inStock) {
    return 0;
  }

  const discount =
    calculateDiscountPercent(price, oldPrice);

  if (discount === null) {
    return 20;
  }

  return Math.max(
    0,
    Math.min(
      100,
      20 + discount * 2,
    ),
  );
}

function getFeedItems(
  payload: unknown,
): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (
    !payload ||
    typeof payload !== "object"
  ) {
    return [];
  }

  const object =
    payload as Record<string, unknown>;

  for (
    const key of [
      "products",
      "items",
      "data",
      "results",
    ]
  ) {
    if (Array.isArray(object[key])) {
      return object[key] as unknown[];
    }
  }

  return [];
}

function asRecord(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function firstValue(
  object: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (
      object[key] !== undefined &&
      object[key] !== null &&
      object[key] !== ""
    ) {
      return object[key];
    }
  }

  return undefined;
}

async function syncAwin(
  env: Env,
): Promise<{
  imported: number;
  updated: number;
  failed: number;
}> {
  if (!env.AWIN_FEED_URL) {
    throw new Error(
      "AWIN_FEED_URL is niet ingesteld.",
    );
  }

  const startedAt =
    new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO sync_logs (network, started_at)
     VALUES (?, ?)`,
  )
    .bind("AWIN", startedAt)
    .run();

  let imported = 0;
  let updated = 0;
  let failed = 0;
  let errorMessage: string | null =
    null;

  try {
    const response = await fetch(
      env.AWIN_FEED_URL,
      {
        headers: {
          accept:
            "application/json,text/plain,*/*",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Awin feed gaf HTTP ${response.status}.`,
      );
    }

    const contentType =
      response.headers.get(
        "content-type",
      ) ?? "";

    const body =
      await response.text();

    let payload: unknown;

    if (
      contentType.includes(
        "application/json",
      ) ||
      body.trim().startsWith("{") ||
      body.trim().startsWith("[")
    ) {
      payload = JSON.parse(body);
    } else {
      throw new Error(
        "De huidige Awin-import ondersteunt JSON. De ontvangen feed is geen JSON.",
      );
    }

    const items =
      getFeedItems(payload);

    for (const item of items) {
      try {
        const source =
          asRecord(item);

        const externalId =
          String(
            firstValue(source, [
              "external_id",
              "externalId",
              "id",
              "aw_product_id",
              "product_id",
            ]) ?? "",
          ).trim();

        const name =
          String(
            firstValue(source, [
              "name",
              "product_name",
              "title",
            ]) ?? "",
          ).trim();

        const productUrl =
          safeUrl(
            firstValue(source, [
              "product_url",
              "productUrl",
              "url",
              "deep_link",
              "deeplink",
            ]),
          );

        const price =
          numberOrNull(
            firstValue(source, [
              "price",
              "current_price",
              "sale_price",
            ]),
          );

        if (
          !externalId ||
          !name ||
          !productUrl ||
          price === null ||
          price < 0
        ) {
          failed += 1;
          continue;
        }

        const oldPrice =
          numberOrNull(
            firstValue(source, [
              "old_price",
              "oldPrice",
              "rrp",
              "regular_price",
            ]),
          );

        const imageUrl =
          safeUrl(
            firstValue(source, [
              "image_url",
              "imageUrl",
              "image",
              "aw_image_url",
            ]),
          );

        const affiliateUrl =
          safeUrl(
            firstValue(source, [
              "affiliate_url",
              "affiliateUrl",
              "tracking_url",
              "trackingUrl",
            ]),
          );

        const merchantName =
          String(
            firstValue(source, [
              "merchant_name",
              "merchantName",
              "advertiser_name",
            ]) ?? "Awin",
          ).trim();

        const merchantIdValue =
          firstValue(source, [
            "merchant_id",
            "merchantId",
            "advertiser_id",
            "advertiserId",
          ]);

        const merchantId =
          merchantIdValue ===
            undefined ||
          merchantIdValue === null
            ? null
            : String(
                merchantIdValue,
              );

        const brandValue =
          firstValue(source, [
            "brand",
            "brand_name",
          ]);

        const categoryValue =
          firstValue(source, [
            "category",
            "category_name",
          ]);

        const descriptionValue =
          firstValue(source, [
            "description",
            "short_description",
          ]);

        const brand =
          brandValue === undefined ||
          brandValue === null
            ? null
            : String(
                brandValue,
              ).trim();

        const category =
          categoryValue ===
            undefined ||
          categoryValue === null
            ? null
            : String(
                categoryValue,
              ).trim();

        const description =
          descriptionValue ===
            undefined ||
          descriptionValue === null
            ? null
            : String(
                descriptionValue,
              ).trim();

        const goals =
          normalizeGoals(
            firstValue(source, [
              "goals",
              "goal",
            ]),
          );

        const inStock =
          booleanToInteger(
            firstValue(source, [
              "in_stock",
              "inStock",
              "availability",
              "stock",
            ]),
            1,
          );

        const discountPercent =
          calculateDiscountPercent(
            price,
            oldPrice,
          );

        const dealScore =
          calculateDealScore(
            price,
            oldPrice,
            inStock,
          );

        const now =
          new Date().toISOString();

        const baseSlug =
          slugify(name) ||
          `product-${externalId}`;

        let slug = baseSlug;

        const existingByExternal =
          await env.DB.prepare(
            `SELECT id, slug
             FROM products
             WHERE network = ? AND external_id = ?
             LIMIT 1`,
          )
            .bind(
              "AWIN",
              externalId,
            )
            .first<{
              id: string;
              slug: string;
            }>();

        if (!existingByExternal) {
          let suffix = 1;

          while (
            await env.DB.prepare(
              `SELECT id
               FROM products
               WHERE slug = ?
               LIMIT 1`,
            )
              .bind(slug)
              .first()
          ) {
            suffix += 1;
            slug =
              `${baseSlug}-${suffix}`;
          }
        } else {
          slug =
            existingByExternal.slug;
        }

        const existingById =
          existingByExternal?.id ??
          crypto.randomUUID();

        const result =
          await env.DB.prepare(
            `INSERT INTO products (
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
               in_stock,
               active,
               deal_score,
               discount_percent,
               last_synced_at,
               updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               external_id = excluded.external_id,
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
               network = excluded.network,
               in_stock = excluded.in_stock,
               active = excluded.active,
               deal_score = excluded.deal_score,
               discount_percent = excluded.discount_percent,
               last_synced_at = excluded.last_synced_at,
               updated_at = excluded.updated_at`,
          )
            .bind(
              existingById,
              externalId,
              name,
              slug,
              description,
              brand,
              category,
              goals,
              price,
              oldPrice,
              String(
                firstValue(source, [
                  "currency",
                ]) ?? "EUR",
              ),
              imageUrl,
              productUrl,
              affiliateUrl,
              merchantName,
              merchantId,
              "AWIN",
              inStock,
              dealScore,
              discountPercent,
              now,
              now,
            )
            .run();

        if (result.success) {
          if (existingByExternal) {
            updated += 1;
          } else {
            imported += 1;
          }
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "Onbekende synchronisatiefout.";
  }

  const finishedAt =
    new Date().toISOString();

  await env.DB.prepare(
    `UPDATE sync_logs
     SET finished_at = ?,
         imported = ?,
         updated = ?,
         failed = ?,
         error_message = ?
     WHERE id = (
       SELECT id
       FROM sync_logs
       WHERE network = ?
       ORDER BY id DESC
       LIMIT 1
     )`,
  )
    .bind(
      finishedAt,
      imported,
      updated,
      failed,
      errorMessage,
      "AWIN",
    )
    .run();

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

async function handleProducts(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(request.url);

  const search =
    url.searchParams
      .get("search")
      ?.trim() ?? "";

  const goal =
    url.searchParams
      .get("goal")
      ?.trim()
      .toLowerCase() ?? "";

  const category =
    url.searchParams
      .get("category")
      ?.trim() ?? "";

  const limitValue =
    Number(
      url.searchParams.get(
        "limit",
      ) ?? "60",
    );

  const limit = Math.max(
    1,
    Math.min(
      Number.isFinite(
        limitValue,
      )
        ? Math.floor(
            limitValue,
          )
        : 60,
      100,
    ),
  );

  const conditions = [
    "active = 1",
  ];

  const binds: unknown[] = [];

  if (search) {
    conditions.push(
      `(name LIKE ? OR brand LIKE ? OR description LIKE ? OR merchant_name LIKE ?)`,
    );

    const pattern =
      `%${search}%`;

    binds.push(
      pattern,
      pattern,
      pattern,
      pattern,
    );
  }

  if (
    goal &&
    [
      "cut",
      "bulk",
      "lean-bulk",
    ].includes(goal)
  ) {
    conditions.push(
      `goals LIKE ?`,
    );

    binds.push(
      `%"${goal}"%`,
    );
  }

  if (category) {
    conditions.push(
      `category = ?`,
    );

    binds.push(category);
  }

  const query = `
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
    WHERE ${conditions.join(
      " AND ",
    )}
    ORDER BY deal_score DESC,
             price ASC,
             name ASC
    LIMIT ?
  `;

  binds.push(limit);

  const result =
    await env.DB.prepare(
      query,
    )
      .bind(...binds)
      .all<ProductRow>();

  return json({
    products:
      result.results ?? [],
    count:
      result.results?.length ??
      0,
  });
}

async function handleProductBySlug(
  slug: string,
  env: Env,
): Promise<Response> {
  const product =
    await env.DB.prepare(
      `SELECT *
       FROM products
       WHERE slug = ? AND active = 1
       LIMIT 1`,
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

async function handleHealth(
  env: Env,
): Promise<Response> {
  try {
    const result =
      await env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM products
         WHERE active = 1`,
      )
        .first<{
          count: number;
        }>();

    return json({
      ok: true,
      products: Number(
        result?.count ?? 0,
      ),
      ai: Boolean(env.AI),
      timestamp:
        new Date().toISOString(),
    });
  } catch {
    return errorResponse(
      "Databasecontrole mislukt.",
      500,
    );
  }
}

async function handleAffiliateRedirect(
  productId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const product =
    await env.DB.prepare(
      `SELECT id,
              product_url,
              affiliate_url,
              active
       FROM products
       WHERE id = ?
       LIMIT 1`,
    )
      .bind(productId)
      .first<{
        id: string;
        product_url: string;
        affiliate_url:
          | string
          | null;
        active: number;
      }>();

  if (
    !product ||
    product.active !== 1
  ) {
    return text(
      "Product niet gevonden.",
      404,
    );
  }

  const target =
    safeUrl(
      product.affiliate_url,
    ) ??
    safeUrl(
      product.product_url,
    );

  if (!target) {
    return text(
      "Geen geldige productlink beschikbaar.",
      404,
    );
  }

  await env.DB.prepare(
    `INSERT INTO affiliate_clicks (
       product_id
     )
     VALUES (?)`,
  )
    .bind(product.id)
    .run();

  return Response.redirect(
    target,
    302,
  );
}

async function handleAiChat(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: unknown;

  try {
    body =
      await request.json();
  } catch {
    return errorResponse(
      "Ongeldige JSON.",
      400,
    );
  }

  const object =
    asRecord(body);

  const message =
    String(
      object.message ?? "",
    ).trim();

  if (!message) {
    return errorResponse(
      "Stel eerst een vraag.",
      400,
    );
  }

  if (message.length > 2000) {
    return errorResponse(
      "De vraag is te lang. Gebruik maximaal 2000 tekens.",
      400,
    );
  }

  const model =
    env.AI_MODEL?.trim() ||
    DEFAULT_AI_MODEL;

  try {
    const response =
      await env.AI.run(
        model,
        {
          messages: [
            {
              role: "system",
              content:
                "Je bent de AI-assistent van FitDealFinder, een Nederlandse website voor fitnessproducten en deals. " +
                "Antwoord in duidelijk en natuurlijk Nederlands. " +
                "Geef praktische, concrete antwoorden. " +
                "Verzin geen actuele prijzen, voorraad, aanbiedingen of productgegevens die je niet hebt. " +
                "Als informatie kan veranderen, zeg dat de gebruiker de actuele productpagina moet controleren. " +
                "Gebruik eenvoudige opmaak en maak antwoorden volledig af.",
            },
            {
              role: "user",
              content: message,
            },
          ],

          // Verhoogd van de standaard 256
          // zodat langere antwoorden niet
          // midden in een zin worden afgekapt.
          max_tokens: 1024,
        },
      );

    return json({
      answer:
        response.response ??
        "Ik kon helaas geen antwoord genereren.",
    });
  } catch (error) {
    console.error(
      "Workers AI error:",
      error,
    );

    return errorResponse(
      "AI kon momenteel geen antwoord geven.",
      502,
    );
  }
}

function isAuthorized(
  request: Request,
  env: Env,
): boolean {
  if (!env.ADMIN_SECRET) {
    return false;
  }

  const supplied =
    request.headers.get(
      "authorization",
    ) ?? "";

  const expected =
    `Bearer ${env.ADMIN_SECRET}`;

  return supplied === expected;
}

async function handleAdminSync(
  request: Request,
  env: Env,
): Promise<Response> {
  if (
    !isAuthorized(
      request,
      env,
    )
  ) {
    return errorResponse(
      "Niet geautoriseerd.",
      401,
    );
  }

  try {
    const result =
      await syncAwin(env);

    return json({
      ok: true,
      network: "AWIN",
      ...result,
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Synchronisatie mislukt.",
      502,
    );
  }
}

async function handleAdminLogs(
  request: Request,
  env: Env,
): Promise<Response> {
  if (
    !isAuthorized(
      request,
      env,
    )
  ) {
    return errorResponse(
      "Niet geautoriseerd.",
      401,
    );
  }

  const result =
    await env.DB.prepare(
      `SELECT *
       FROM sync_logs
       ORDER BY id DESC
       LIMIT 20`,
    ).all();

  return json({
    logs:
      result.results ?? [],
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url =
      new URL(request.url);

    const path =
      url.pathname.replace(
        /\/+$/,
        "",
      ) || "/";

    try {
      if (
        request.method === "GET" &&
        path === "/api/health"
      ) {
        return handleHealth(
          env,
        );
      }

      if (
        request.method === "GET" &&
        path === "/api/products"
      ) {
        return handleProducts(
          request,
          env,
        );
      }

      if (
        request.method === "GET" &&
        path.startsWith(
          "/api/products/",
        )
      ) {
        const slug =
          decodeURIComponent(
            path.slice(
              "/api/products/"
                .length,
            ),
          ).trim();

        if (!slug) {
          return errorResponse(
            "Product niet gevonden.",
            404,
          );
        }

        return handleProductBySlug(
          slug,
          env,
        );
      }

      if (
        request.method === "POST" &&
        path ===
          "/api/ai/chat"
      ) {
        return handleAiChat(
          request,
          env,
        );
      }

      if (
        request.method === "POST" &&
        path ===
          "/api/admin/sync-awin"
      ) {
        return handleAdminSync(
          request,
          env,
        );
      }

      if (
        request.method === "GET" &&
        path ===
          "/api/admin/sync-logs"
      ) {
        return handleAdminLogs(
          request,
          env,
        );
      }

      if (
        request.method === "GET" &&
        path.startsWith(
          "/go/",
        )
      ) {
        const productId =
          decodeURIComponent(
            path.slice(
              "/go/".length,
            ),
          ).trim();

        if (!productId) {
          return text(
            "Product niet gevonden.",
            404,
          );
        }

        return handleAffiliateRedirect(
          productId,
          request,
          env,
        );
      }

      return env.ASSETS.fetch(
        request,
      );
    } catch (error) {
      console.error(
        "Worker error:",
        error,
      );

      return errorResponse(
        "Interne serverfout.",
        500,
      );
    }
  },
};

        

