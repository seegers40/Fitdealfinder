interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;

  ADMIN_SECRET?: string;

  AWIN_FEED_URL?: string;
  AWIN_PUBLISHER_ID?: string;

  AI_MODEL?: string;

  /*
   * Eén catalogus per regel:
   *
   * WINKELNAAM|https://echte-feed-url.nl/feed.csv
   *
   * Geen fictieve URL's invullen.
   */
  DIRECT_CATALOG_URLS?: string;
}

const DEFAULT_AI_MODEL =
  "@cf/meta/llama-3.1-8b-instruct-fast";

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

type NormalizedProduct = {
  external_id: string;
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
};

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function json(
  data: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8",
        "cache-control":
          "no-store",
        "x-content-type-options":
          "nosniff",
      },
    },
  );
}

function text(
  value: string,
  status = 200,
): Response {
  return new Response(
    value,
    {
      status,
      headers: {
        "content-type":
          "text/plain; charset=UTF-8",
        "cache-control":
          "no-store",
        "x-content-type-options":
          "nosniff",
      },
    },
  );
}

function errorResponse(
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

/* =========================================================
   GENERAL HELPERS
========================================================= */

function slugify(
  value: string,
): string {
  return value
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .toLowerCase()
    .trim()
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

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value !== "string"
  ) {
    return null;
  }

  let normalized =
    value
      .trim()
      .replace(
        /[^\d,.-]/g,
        "",
      );

  if (!normalized) {
    return null;
  }

  const comma =
    normalized.lastIndexOf(",");

  const dot =
    normalized.lastIndexOf(".");

  if (
    comma >= 0 &&
    dot >= 0
  ) {
    if (comma > dot) {
      normalized =
        normalized
          .replace(
            /\./g,
            "",
          )
          .replace(
            ",",
            ".",
          );
    } else {
      normalized =
        normalized.replace(
          /,/g,
          "",
        );
    }
  } else if (
    comma >= 0
  ) {
    normalized =
      normalized.replace(
        ",",
        ".",
      );
  }

  const parsed =
    Number(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function booleanToInteger(
  value: unknown,
  fallback = 1,
): number {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  if (
    typeof value === "boolean"
  ) {
    return value ? 1 : 0;
  }

  if (
    typeof value === "number"
  ) {
    return value !== 0
      ? 1
      : 0;
  }

  if (
    typeof value === "string"
  ) {
    const normalized =
      value
        .trim()
        .toLowerCase();

    if (
      [
        "true",
        "yes",
        "y",
        "1",
        "available",
        "beschikbaar",
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
        "unavailable",
        "niet beschikbaar",
        "out of stock",
        "outofstock",
        "uitverkocht",
      ].includes(normalized)
    ) {
      return 0;
    }
  }

  return fallback;
}

function safeUrl(
  value: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return null;
  }

  try {
    const url =
      new URL(
        value.trim(),
      );

    if (
      url.protocol !==
        "http:" &&
      url.protocol !==
        "https:"
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function asRecord(
  value: unknown,
): Record<string, unknown> {
  if (
    value &&
    typeof value === "object"
  ) {
    return value as Record<
      string,
      unknown
    >;
  }

  return {};
}

function firstValue(
  object: Record<
    string,
    unknown
  >,
  keys: string[],
): unknown {
  for (
    const key of keys
  ) {
    const value =
      object[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return undefined;
}

function normalizeGoals(
  value: unknown,
): string {
  const defaults = [
    "cut",
    "bulk",
    "lean-bulk",
  ];

  if (
    Array.isArray(value)
  ) {
    const goals =
      value
        .map((item) =>
          String(item)
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean);

    return JSON.stringify(
      goals.length
        ? goals
        : defaults,
    );
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    try {
      const parsed =
        JSON.parse(value);

      if (
        Array.isArray(parsed)
      ) {
        const goals =
          parsed
            .map((item) =>
              String(item)
                .trim()
                .toLowerCase(),
            )
            .filter(Boolean);

        return JSON.stringify(
          goals.length
            ? goals
            : defaults,
        );
      }
    } catch {
      const goals =
        value
          .split(/[;,|]/)
          .map((item) =>
            item
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean);

      if (goals.length) {
        return JSON.stringify(
          goals,
        );
      }
    }
  }

  return JSON.stringify(
    defaults,
  );
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

  return Math.round(
    (
      (oldPrice - price) /
      oldPrice
    ) * 100,
  );
}

function dealScore(
  price: number,
  oldPrice: number | null,
  inStock: number,
): number {
  if (!inStock) {
    return 0;
  }

  const discount =
    discountPercent(
      price,
      oldPrice,
    );

  if (discount === null) {
    return 20;
  }

  return Math.min(
    100,
    20 +
      discount * 2,
  );
}

/* =========================================================
   FEED PARSING
========================================================= */

function getFeedItems(
  payload: unknown,
): unknown[] {
  if (
    Array.isArray(payload)
  ) {
    return payload;
  }

  const object =
    asRecord(payload);

  for (
    const key of [
      "products",
      "items",
      "data",
      "results",
      "offers",
      "catalog",
    ]
  ) {
    if (
      Array.isArray(
        object[key],
      )
    ) {
      return object[
        key
      ] as unknown[];
    }
  }

  return [];
}

function parseCsv(
  input: string,
): Record<
  string,
  string
>[] {
  const rows:
    string[][] = [];

  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (
    let i = 0;
    i < input.length;
    i++
  ) {
    const char =
      input[i];

    if (
      char === '"'
    ) {
      if (
        quoted &&
        input[i + 1] ===
          '"'
      ) {
        field += '"';
        i++;
      } else {
        quoted =
          !quoted;
      }

      continue;
    }

    if (
      char === "," &&
      !quoted
    ) {
      row.push(field);
      field = "";
      continue;
    }

    if (
      (
        char === "\n" ||
        char === "\r"
      ) &&
      !quoted
    ) {
      if (
        char === "\r" &&
        input[i + 1] ===
          "\n"
      ) {
        i++;
      }

      row.push(field);
      field = "";

      if (
        row.some(
          (value) =>
            value.trim() !==
            "",
        )
      ) {
        rows.push(row);
      }

      row = [];

      continue;
    }

    field += char;
  }

  row.push(field);

  if (
    row.some(
      (value) =>
        value.trim() !==
        "",
    )
  ) {
    rows.push(row);
  }

  if (
    rows.length < 2
  ) {
    return [];
  }

  const headers =
    rows[0].map(
      (header) =>
        header
          .trim()
          .toLowerCase()
          .replace(
            /[\s-]+/g,
            "_",
          ),
    );

  return rows
    .slice(1)
    .map(
      (values) => {
        const result:
          Record<
            string,
            string
          > = {};

        headers.forEach(
          (
            header,
            index,
          ) => {
            result[
              header
            ] =
              values[
                index
              ] ?? "";
          },
        );

        return result;
      },
    );
}

function parseXmlProducts(
  xml: string,
): Record<
  string,
  string
>[] {
  const products:
    Record<
      string,
      string
    >[] = [];

  const matches =
    xml.match(
      /<(item|product|offer|entry)\b[\s\S]*?<\/\1>/gi,
    ) ?? [];

  const fields = [
    "id",
    "product_id",
    "sku",
    "ean",
    "gtin",
    "title",
    "name",
    "description",
    "brand",
    "category",
    "price",
    "sale_price",
    "old_price",
    "availability",
    "link",
    "product_url",
    "image_link",
    "image_url",
  ];

  for (
    const item of matches
  ) {
    const result:
      Record<
        string,
        string
      > = {};

    for (
      const fieldName of fields
    ) {
      const escaped =
        fieldName.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );

      const regex =
        new RegExp(
          `<(?:g:)?${escaped}[^>]*>([\\s\\S]*?)<\\/(?:g:)?${escaped}>`,
          "i",
        );

      const match =
        item.match(
          regex,
        );

      if (match) {
        result[
          fieldName
        ] =
          match[1]
            .replace(
              /<!CDATA\[([\s\S]*?)\]>/g,
              "$1",
            )
            .replace(
              /<[^>]+>/g,
              "",
            )
            .trim();
      }
    }

    if (
      Object.keys(result)
        .length
    ) {
      products.push(
        result,
      );
    }
  }

  return products;
}

/* =========================================================
   PRODUCT NORMALIZATION
========================================================= */

function normalizeProduct(
  source: Record<
    string,
    unknown
  >,
  merchantName: string,
  network: string,
): NormalizedProduct | null {
  const externalId =
    String(
      firstValue(
        source,
        [
          "external_id",
          "externalId",
          "id",
          "product_id",
          "productId",
          "sku",
          "ean",
          "gtin",
          "aw_product_id",
        ],
      ) ?? "",
    ).trim();

  const name =
    String(
      firstValue(
        source,
        [
          "name",
          "title",
          "product_name",
          "productName",
        ],
      ) ?? "",
    ).trim();

  const productUrl =
    safeUrl(
      firstValue(
        source,
        [
          "product_url",
          "productUrl",
          "url",
          "link",
          "product_link",
          "deeplink",
          "deep_link",
        ],
      ),
    );

  const price =
    numberOrNull(
      firstValue(
        source,
        [
          "price",
          "current_price",
          "currentPrice",
          "sale_price",
          "selling_price",
        ],
      ),
    );

  if (
    !externalId ||
    !name ||
    !productUrl ||
    price === null ||
    price < 0
  ) {
    return null;
  }

  const oldPrice =
    numberOrNull(
      firstValue(
        source,
        [
          "old_price",
          "oldPrice",
          "original_price",
          "regular_price",
          "was_price",
          "rrp",
        ],
      ),
    );

  const imageUrl =
    safeUrl(
      firstValue(
        source,
        [
          "image_url",
          "imageUrl",
          "image",
          "image_link",
          "picture",
          "thumbnail",
        ],
      ),
    );

  const description =
    String(
      firstValue(
        source,
        [
          "description",
          "product_description",
          "short_description",
        ],
      ) ?? "",
    ).trim();

  const brand =
    String(
      firstValue(
        source,
        [
          "brand",
          "brand_name",
          "manufacturer",
        ],
      ) ?? "",
    ).trim();

  const category =
    String(
      firstValue(
        source,
        [
          "category",
          "category_name",
          "product_type",
          "google_product_category",
        ],
      ) ?? "",
    ).trim();

  const inStock =
    booleanToInteger(
      firstValue(
        source,
        [
          "in_stock",
          "inStock",
          "availability",
          "stock",
          "available",
        ],
      ),
      1,
    );

  const oldPriceValue =
    oldPrice !== null &&
    oldPrice > price
      ? oldPrice
      : null;

  const discount =
    discountPercent(
      price,
      oldPriceValue,
    );

  const score =
    dealScore(
      price,
      oldPriceValue,
      inStock,
    );

  const merchantId =
    String(
      firstValue(
        source,
        [
          "merchant_id",
          "merchantId",
          "advertiser_id",
          "advertiserId",
          "store_id",
        ],
      ) ?? "",
    ).trim();

  const affiliateUrl =
    network === "AWIN"
      ? safeUrl(
          firstValue(
            source,
            [
              "affiliate_url",
              "affiliateUrl",
              "tracking_url",
              "trackingUrl",
              "deep_link",
              "deeplink",
            ],
          ),
        )
      : null;

  /*
   * Slug bevat winkel + external ID.
   * Daardoor kunnen twee winkels hetzelfde
   * product aanbieden zonder UNIQUE-conflict.
   */
  const baseSlug =
    slugify(
      `${merchantName}-${name}-${externalId}`,
    );

  return {
    external_id:
      externalId,

    name,

    slug:
      baseSlug ||
      slugify(name) ||
      `product-${externalId}`,

    description:
      description || null,

    brand:
      brand || null,

    category:
      category || null,

    goals:
      normalizeGoals(
        firstValue(
          source,
          [
            "goals",
            "goal",
            "tags",
          ],
        ),
      ),

    price,

    old_price:
      oldPriceValue,

    currency:
      String(
        firstValue(
          source,
          [
            "currency",
            "currency_code",
          ],
        ) ?? "EUR",
      ).trim() || "EUR",

    image_url:
      imageUrl,

    product_url:
      productUrl,

    affiliate_url:
      affiliateUrl,

    merchant_name:
      merchantName,

    merchant_id:
      merchantId || null,

    network,

    commission:
      numberOrNull(
        firstValue(
          source,
          [
            "commission",
            "commission_rate",
          ],
        ),
      ),

    commission_type:
      String(
        firstValue(
          source,
          [
            "commission_type",
            "commissionType",
          ],
        ) ?? "",
      ).trim() || null,

    in_stock:
      inStock,

    active:
      1,

    deal_score:
      score,

    discount_percent:
      discount,
  };
}

/* =========================================================
   CATALOG FETCH
========================================================= */

async function fetchCatalog(
  url: string,
): Promise<{
  contentType: string;
  body: string;
}> {
  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "FitDealFinder/1.0",
          Accept:
            "application/json,text/csv,application/xml,text/xml,*/*",
        },
      },
    );

  if (!response.ok) {
    throw new Error(
      `Feed gaf HTTP ${response.status}.`,
    );
  }

  return {
    contentType:
      response.headers.get(
        "content-type",
      ) ?? "",
    body:
      await response.text(),
  };
}

/* =========================================================
   D1 UPSERT
========================================================= */

async function upsertProducts(
  env: Env,
  products: NormalizedProduct[],
): Promise<{
  inserted: number;
  updated: number;
  failed: number;
}> {
  /*
   * Eerst dedupliceren binnen de ontvangen feed.
   */
  const unique =
    new Map<
      string,
      NormalizedProduct
    >();

  for (
    const product of products
  ) {
    const key =
      `${product.network}::${product.external_id}`;

    unique.set(
      key,
      product,
    );
  }

  const cleanProducts =
    Array.from(
      unique.values(),
    );

  let inserted = 0;
  let updated = 0;
  let failed = 0;

  const now =
    new Date().toISOString();

  /*
   * Eerst bepalen we per product of het al bestaat.
   *
   * Dit is bewust vóór de INSERT/UPDATE:
   * daarmee zijn we niet afhankelijk van
   * ON CONFLICT(id) met een willekeurige UUID.
   */
  const existing =
    new Map<
      string,
      string
    >();

  for (
    let start = 0;
    start < cleanProducts.length;
    start += 50
  ) {
    const chunk =
      cleanProducts.slice(
        start,
        start + 50,
      );

    for (
      const product of chunk
    ) {
      const row =
        await env.DB
          .prepare(
            `
            SELECT id
            FROM products
            WHERE network = ?
              AND external_id = ?
            LIMIT 1
            `,
          )
          .bind(
            product.network,
            product.external_id,
          )
          .first<{
            id: string;
          }>();

      if (row?.id) {
        existing.set(
          `${product.network}::${product.external_id}`,
          row.id,
        );
      }
    }
  }

  /*
   * We maken per product een UPSERT op basis van
   * het bestaande primaire ID wanneer dat bestaat.
   */
  const insertSql = `
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
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?
    )
  `;

  const updateSql = `
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
      active = ?,
      deal_score = ?,
      discount_percent = ?,
      last_synced_at = ?,
      updated_at = ?
    WHERE id = ?
  `;

  for (
    let start = 0;
    start < cleanProducts.length;
    start += 50
  ) {
    const chunk =
      cleanProducts.slice(
        start,
        start + 50,
      );

    const statements =
      chunk.map(
        (product) => {
          const key =
            `${product.network}::${product.external_id}`;

          const existingId =
            existing.get(key);

          if (existingId) {
            return env.DB
              .prepare(
                updateSql,
              )
              .bind(
                product.name,
                product.slug,
                product.description,
                product.brand,
                product.category,
                product.goals,
                product.price,
                product.old_price,
                product.currency,
                product.image_url,
                product.product_url,
                product.affiliate_url,
                product.merchant_name,
                product.merchant_id,
                product.commission,
                product.commission_type,
                product.in_stock,
                product.active,
                product.deal_score,
                product.discount_percent,
                now,
                now,
                existingId,
              );
          }

          return env.DB
            .prepare(
              insertSql,
            )
            .bind(
              crypto.randomUUID(),
              product.external_id,
              product.name,
              product.slug,
              product.description,
              product.brand,
              product.category,
              product.goals,
              product.price,
              product.old_price,
              product.currency,
              product.image_url,
              product.product_url,
              product.affiliate_url,
              product.merchant_name,
              product.merchant_id,
              product.network,
              product.commission,
              product.commission_type,
              product.in_stock,
              product.active,
              product.deal_score,
              product.discount_percent,
              now,
              now,
              now,
            );
        },
      );

    try {
      const results =
        await env.DB.batch(
          statements,
        );

      results.forEach(
        (
          result,
          index,
        ) => {
          if (
            result.success
          ) {
            const product =
              chunk[index];

            const key =
              `${product.network}::${product.external_id}`;

            if (
              existing.has(key)
            ) {
              updated++;
            } else {
              inserted++;
            }
          } else {
            failed++;
          }
        },
      );
    } catch (error) {
      console.error(
        "D1 batch failed:",
        error,
      );

      failed +=
        chunk.length;
    }
  }

  return {
    inserted,
    updated,
    failed,
  };
}

/* =========================================================
   DIRECT CATALOG SYNC
========================================================= */

async function syncDirectCatalogs(
  env: Env,
): Promise<{
  stores: unknown[];
}> {
  const config =
    env.DIRECT_CATALOG_URLS?.trim();

  if (!config) {
    throw new Error(
      "DIRECT_CATALOG_URLS is niet ingesteld.",
    );
  }

  const sources =
    config
      .split(/\r?\n/)
      .map(
        (line) =>
          line.trim(),
      )
      .filter(Boolean);

  const results: unknown[] =
    [];

  for (
    const source of sources
  ) {
    const separator =
      source.indexOf("|");

    if (
      separator <= 0
    ) {
      results.push({
        ok: false,
        source,
        error:
          "Gebruik exact: WINKELNAAM|FEED_URL",
      });

      continue;
    }

    const merchant =
      source
        .slice(
          0,
          separator,
        )
        .trim();

    const feedUrl =
      source
        .slice(
          separator + 1,
        )
        .trim();

    if (
      !merchant ||
      !safeUrl(feedUrl)
    ) {
      results.push({
        ok: false,
        merchant,
        source: feedUrl,
        error:
          "Ongeldige feed-URL.",
      });

      continue;
    }

    try {
      const feed =
        await fetchCatalog(
          feedUrl,
        );

      const contentType =
        feed.contentType.toLowerCase();

      const body =
        feed.body.trim();

      let rawProducts:
        Record<
          string,
          unknown
        >[] = [];

      if (
        contentType.includes(
          "json",
        ) ||
        body.startsWith("{") ||
        body.startsWith("[")
      ) {
        const payload =
          JSON.parse(body);

        rawProducts =
          getFeedItems(
            payload,
          ).map(
            asRecord,
          );
      } else if (
        contentType.includes(
          "csv",
        )
      ) {
        rawProducts =
          parseCsv(
            body,
          ) as Record<
            string,
            unknown
          >[];
      } else if (
        contentType.includes(
          "xml",
        ) ||
        body.startsWith("<")
      ) {
        rawProducts =
          parseXmlProducts(
            body,
          ) as Record<
            string,
            unknown
          >[];
      } else {
        throw new Error(
          `Niet ondersteund feedformaat: ${feed.contentType || "onbekend"}`,
        );
      }

      const products =
        rawProducts
          .map(
            (item) =>
              normalizeProduct(
                item,
                merchant,
                "DIRECT",
              ),
          )
          .filter(
            (
              item,
            ): item is NormalizedProduct =>
              item !== null,
          );

      if (
        products.length === 0
      ) {
        throw new Error(
          "De feed bevat geen geldige producten.",
        );
      }

      const result =
        await upsertProducts(
          env,
          products,
        );

      results.push({
        ok: true,
        merchant,
        source: feedUrl,
        received:
          rawProducts.length,
        valid:
          products.length,
        ...result,
      });
    } catch (error) {
      results.push({
        ok: false,
        merchant,
        source: feedUrl,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  return {
    stores: results,
  };
}

/* =========================================================
   AWIN SYNC
========================================================= */

async function syncAwin(
  env: Env,
): Promise<{
  imported: number;
  updated: number;
  failed: number;
}> {
  if (
    !env.AWIN_FEED_URL
  ) {
    throw new Error(
      "AWIN_FEED_URL is niet ingesteld.",
    );
  }

  const log =
    await env.DB
      .prepare(
        `
        INSERT INTO sync_logs (
          network,
          started_at
        )
        VALUES (?, ?)
        `,
      )
      .bind(
        "AWIN",
        new Date().toISOString(),
      )
      .run();

  const logId =
    log.meta.last_row_id;

  try {
    const feed =
      await fetchCatalog(
        env.AWIN_FEED_URL
