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
   * Alleen echte feed-URL's gebruiken.
   */
  DIRECT_CATALOG_URLS?: string;
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

type ProductInput = {
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

const DEFAULT_AI_MODEL =
  "@cf/meta/llama-3.1-8b-instruct-fast";

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
  object: Record<string, unknown>,
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

function slugify(
  value: string,
): string {
  const slug =
    value
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
      .slice(
        0,
        180,
      );

  return slug || "product";
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
    typeof value === "number"
  ) {
    return Number.isFinite(
      value,
    )
      ? value
      : null;
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
    if (
      comma > dot
    ) {
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
    Number(
      normalized,
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

function stockValue(
  value: unknown,
): number {
  if (
    value === false ||
    value === 0
  ) {
    return 0;
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
        "false",
        "no",
        "0",
        "out of stock",
        "outofstock",
        "unavailable",
        "uitverkocht",
        "niet beschikbaar",
      ].includes(
        normalized,
      )
    ) {
      return 0;
    }
  }

  return 1;
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
        .map(String)
        .map(
          (item) =>
            item
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
      const parsed: unknown =
        JSON.parse(value);

      if (
        Array.isArray(parsed)
      ) {
        const goals =
          parsed
            .map(String)
            .map(
              (item) =>
                item
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
      // Geen JSON; hieronder als tekst verwerken.
    }

    const goals =
      value
        .split(/[;,|]/)
        .map(
          (item) =>
            item
              .trim()
              .toLowerCase(),
        )
        .filter(Boolean);

    if (
      goals.length
    ) {
      return JSON.stringify(
        goals,
      );
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

function calculateDealScore(
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

  if (
    discount === null
  ) {
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

function detectCsvDelimiter(
  input: string,
): string {
  const sample =
    input
      .split(/\r?\n/)
      .slice(0, 5)
      .join("\n");

  const delimiters = [
    ",",
    ";",
    "|",
    "\t",
  ];

  let selected = ",";
  let bestCount = 0;

  for (
    const delimiter of delimiters
  ) {
    const count =
      sample.split(
        delimiter,
      ).length - 1;

    if (
      count > bestCount
    ) {
      bestCount = count;
      selected =
        delimiter;
    }
  }

  return selected;
}

function parseCsv(
  input: string,
): Record<
  string,
  string
>[] {
  const delimiter =
    detectCsvDelimiter(
      input,
    );

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
        input[i + 1] === '"'
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
      char === delimiter &&
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
        input[i + 1] === "\n"
      ) {
        i++;
      }

      row.push(field);
      field = "";

      if (
        row.some(
          (value) =>
            value.trim() !== "",
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
        value.trim() !== "",
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
          .replace(
            /^\uFEFF/,
            "",
          )
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

function stripXml(
  value: string,
): string {
  return value
    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/gi,
      "$1",
    )
    .replace(
      /<[^>]+>/g,
      "",
    )
    .trim();
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

  const blocks =
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
    const block of blocks
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
          `<[^>]*${escaped}[^>]*>([\\s\\S]*?)<\\/[^>]*${escaped}\\s*>`,
          "i",
        );

      const match =
        block.match(
          regex,
        );

      if (match) {
        result[
          fieldName
        ] =
          stripXml(
            match[1],
          );
      }
    }

    if (
      Object.keys(
        result,
      ).length
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
  source: Record<string, unknown>,
  merchantName: string,
  network: string,
): ProductInput | null {
  const externalId =
    String(
      firstValue(
        source,
        [
          "external_id",
          "externalId",
          "product_id",
          "productId",
          "id",
          "sku",
          "ean",
          "gtin",
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

  const price =
    numberOrNull(
      firstValue(
        source,
        [
          "sale_price",
          "salePrice",
          "price",
          "current_price",
          "currentPrice",
        ],
      ),
    );

  const productUrl =
    safeUrl(
      firstValue(
        source,
        [
          "affiliate_url",
          "affiliateUrl",
          "deep_link",
          "deeplink",
          "product_url",
          "productUrl",
          "link",
          "url",
        ],
      ),
    );

  if (
    !externalId ||
    !name ||
    price === null ||
    !productUrl
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
          "regular_price",
          "regularPrice",
          "rrp",
          "recommended_retail_price",
        ],
      ),
    );

  const inStock =
    stockValue(
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
    );

  const resolvedMerchant =
    String(
      firstValue(
        source,
        [
          "merchant_name",
          "merchantName",
          "advertiser_name",
          "advertiser",
          "shop_name",
          "store_name",
        ],
      ) ??
        merchantName,
    ).trim() ||
    merchantName;

  const affiliateUrl =
    safeUrl(
      firstValue(
        source,
        [
          "affiliate_url",
          "affiliateUrl",
          "deep_link",
          "deeplink",
        ],
      ),
    );

  const discount =
    discountPercent(
      price,
      oldPrice,
    );

  return {
    external_id:
      externalId,

    name,

    slug:
      slugify(
        `${resolvedMerchant}-${name}-${externalId}`,
      ),

    description:
      String(
        firstValue(
          source,
          [
            "description",
            "product_description",
          ],
        ) ?? "",
      ).trim() || null,

    brand:
      String(
        firstValue(
          source,
          [
            "brand",
            "brand_name",
            "brandName",
          ],
        ) ?? "",
      ).trim() || null,

    category:
      String(
        firstValue(
          source,
          [
            "category",
            "merchant_category",
            "merchantCategory",
            "product_type",
            "productType",
          ],
        ) ?? "",
      ).trim() || null,

    goals:
      normalizeGoals(
        firstValue(
          source,
          [
            "goals",
            "goal",
          ],
        ),
      ),

    price,

    old_price:
      oldPrice,

    currency:
      String(
        firstValue(
          source,
          [
            "currency",
            "currency_code",
            "currencyCode",
          ],
        ) ?? "EUR",
      )
        .trim()
        .toUpperCase() ||
      "EUR",

    image_url:
      safeUrl(
        firstValue(
          source,
          [
            "image_url",
            "imageUrl",
            "image_link",
            "imageLink",
            "image",
          ],
        ),
      ),

    product_url:
      productUrl,

    affiliate_url:
      affiliateUrl,

    merchant_name:
      resolvedMerchant,

    merchant_id:
      String(
        firstValue(
          source,
          [
            "merchant_id",
            "merchantId",
            "advertiser_id",
            "advertiserId",
            "program_id",
            "programId",
          ],
        ) ?? "",
      ).trim() || null,

    network,

    commission:
      numberOrNull(
        firstValue(
          source,
          [
            "commission",
            "commission_rate",
            "commissionRate",
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
      calculateDealScore(
        price,
        oldPrice,
        inStock,
      ),

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
            "text/csv,application/csv,application/xml,text/xml,application/json,*/*",
        },
      },
    );

  if (
    !response.ok
  ) {
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
   D1 PRODUCT UPSERT
========================================================= */

async function upsertProducts(
  env: Env,
  products: ProductInput[],
): Promise<{
  inserted: number;
  updated: number;
  failed: number;
}> {
  /*
   * Dedupliceren binnen de ontvangen feed.
   */
  const unique =
    new Map<
      string,
      ProductInput
    >();

  for (
    const product of products
  ) {
    unique.set(
      `${product.network}::${product.external_id}`,
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
   * Bestaande producten eerst opzoeken.
   *
   * We gebruiken bewust niet:
   *
   * ON CONFLICT(id)
   *
   * met een nieuwe UUID. Dat zou bestaande
   * producten niet correct bijwerken.
   */
  const existing =
    new Map<
      string,
      string
    >();

  for (
    let start = 0;
    start <
      cleanProducts.length;
    start += 50
  ) {
    const chunk =
      cleanProducts.slice(
        start,
        start + 50,
      );

    const lookups =
      chunk.map(
        (product) =>
          env.DB
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
            ),
      );

    const results =
      await env.DB.batch(
        lookups,
      );

    results.forEach(
      (
        result,
        index,
      ) => {
        const rows =
          result.results as
            | Array<{
                id: string;
              }>
            | undefined;

        const id =
          rows?.[0]?.id;

        if (id) {
          existing.set(
            `${chunk[index].network}::${chunk[index].external_id}`,
            id,
          );
        }
      },
    );
  }

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
    start <
      cleanProducts.length;
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
            existing.get(
              key,
            );

          if (
            existingId
          ) {
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
    } catch (
      error
    ) {
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
          "Gebruik: WINKELNAAM|FEED_URL",
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
        feed.contentType
          .toLowerCase();

      const body =
        feed.body.trim();

      if (!body) {
        throw new Error(
          "De feed is leeg.",
        );
      }

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
        ) ||
        body.includes(",") ||
        body.includes(";")
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
          `Niet ondersteund feedformaat: ${
            feed.contentType ||
            "onbekend"
          }`,
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
            ): item is ProductInput =>
              item !== null,
          );

      if (
        products.length === 0
      ) {
        throw new Error(
          "Geen geldige producten in feed.",
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
    } catch (
      error
    ) {
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
  inserted: number;
  updated: number;
  failed: number;
}> {
  if (
    !env.AWIN_FEED_URL?.trim()
  ) {
    throw new Error(
      "AWIN_FEED_URL is niet ingesteld.",
    );
  }

  const startedAt =
    new Date().toISOString();

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
        startedAt,
      )
      .run();

  const logId =
    Number(
      log.meta.last_row_id ?? 0,
    );

  let result = {
    inserted: 0,
    updated: 0,
    failed: 0,
  };

  let errorMessage:
    | string
    | null = null;

  try {
    const feed =
      await fetchCatalog(
        env.AWIN_FEED_URL,
      );

    const body =
      feed.body.trim();

    if (!body) {
      throw new Error(
        "De Awin-feed is leeg.",
      );
    }

    const contentType =
      feed.contentType
        .toLowerCase();

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
      ) ||
      body.includes(",") ||
      body.includes(";")
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
        `Niet ondersteund Awin-feedformaat: ${
          feed.contentType ||
          "onbekend"
        }`,
      );
    }

    if (
      rawProducts.length === 0
    ) {
      throw new Error(
        "De Awin-feed bevat geen producten.",
      );
    }

    const products =
      rawProducts
        .map(
          (item) =>
            normalizeProduct(
              item,
              "Awin",
              "AWIN",
            ),
        )
        .filter(
          (
            item,
          ): item is ProductInput =>
            item !== null,
        );

    if (
      products.length === 0
    ) {
      throw new Error(
        "Geen geldige producten in Awin-feed.",
      );
    }

    result =
      await upsertProducts(
        env,
        products,
      );
  } catch (
    error
  ) {
    errorMessage =
      error instanceof Error
        ? error.message
        : String(error);
  }

  await env.DB
    .prepare(
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
      result.inserted,
      result.updated,
      result.failed,
      errorMessage,
      logId,
    )
    .run();

  if (
    errorMessage
  ) {
    throw new Error(
      errorMessage,
    );
  }

  return result;
}

/* =========================================================
   AUTH
========================================================= */

function isAuthorized(
  request: Request,
  env: Env,
): boolean {
  if (
    !env.ADMIN_SECRET
  ) {
    return false;
  }

  const authorization =
    request.headers.get(
      "authorization",
    ) ?? "";

  const adminSecret =
    request.headers.get(
      "x-admin-secret",
    ) ?? "";

  return (
    authorization ===
      `Bearer ${env.ADMIN_SECRET}` ||
    adminSecret ===
      env.ADMIN_SECRET
  );
}

/* =========================================================
   PRODUCTS API
========================================================= */

async function handleProducts(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(
      request.url,
    );

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

  const requestedLimit =
    Number(
      url.searchParams.get(
        "limit",
      ) ?? "100",
    );

  const limit =
    Math.max(
      1,
      Math.min(
        Number.isFinite(
          requestedLimit,
        )
          ? Math.floor(
              requestedLimit,
            )
          : 100,
        100,
      ),
    );

  const conditions: string[] =
    [
      "active = 1",
    ];

  const binds: unknown[] =
    [];

  if (search) {
    conditions.push(
      `
      (
        name LIKE ?
        OR brand LIKE ?
        OR description LIKE ?
        OR merchant_name LIKE ?
      )
      `,
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
    [
      "cut",
      "bulk",
      "lean-bulk",
    ].includes(goal)
  ) {
    conditions.push(
      "goals LIKE ?",
    );

    binds.push(
      `%\"${goal}\"%`,
    );
  }

  if (category) {
    conditions.push(
      "category = ?",
    );

    binds.push(
      category,
    );
  }

  binds.push(
    limit,
  );

  const query = `
    SELECT *
    FROM products
    WHERE ${conditions.join(
      " AND ",
    )}
    ORDER BY
      deal_score DESC,
      price ASC,
      name ASC
    LIMIT ?
  `;

  const result =
    await env.DB
      .prepare(
        query,
      )
      .bind(
        ...binds,
      )
      .all<ProductRow>();

  return json({
    products:
      result.results ?? [],
    count:
      result.results?.length ??
      0,
  });
}

/* =========================================================
   PRODUCT DETAIL
========================================================= */

async function handleProduct(
  slug: string,
  env: Env,
): Promise<Response> {
  const product =
    await env.DB
      .prepare(
        `
        SELECT *
        FROM products
        WHERE slug = ?
          AND active = 1
        LIMIT 1
        `,
      )
      .bind(
        slug,
      )
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

/* =========================================================
   HEALTH
========================================================= */

async function handleHealth(
  env: Env,
): Promise<Response> {
  try {
    const result =
      await env.DB
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM products
          WHERE active = 1
          `,
        )
        .first<{
          count: number;
        }>();

    return json({
      ok: true,
      products:
        Number(
          result?.count ?? 0,
        ),
      timestamp:
        new Date().toISOString(),
    });
  } catch (
    error
  ) {
    console.error(
      "Health check failed:",
      error,
    );

    return errorResponse(
      "Databasecontrole mislukt.",
      500,
    );
  }
}

/* =========================================================
   PRODUCT REDIRECT
========================================================= */

async function handleRedirect(
  productId: string,
  env: Env,
): Promise<Response> {
  const product =
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
        `,
      )
      .bind(
        productId,
      )
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

  await env.DB
    .prepare(
      `
      INSERT INTO affiliate_clicks (
        product_id
      )
      VALUES (?)
      `,
    )
    .bind(
      product.id,
    )
    .run();

  return Response.redirect(
    target,
    302,
  );
}

/* =========================================================
   AI
========================================================= */

async function handleAi(
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

  if (
    message.length > 2000
  ) {
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
                "Je bent de AI-assistent van FitDealFinder. " +
                "Antwoord in het Nederlands. " +
                "Geef duidelijke en praktische antwoorden. " +
                "Verzin geen actuele prijzen, voorraad, aanbiedingen of productgegevens. " +
                "Als actuele informatie nodig is, adviseer dan de actuele productpagina te controleren.",
            },
            {
              role: "user",
              content:
                message,
            },
          ],
          max_tokens: 1024,
        },
      );

    const result =
      response as {
        response?: string;
      };

    return json({
      answer:
        result.response ??
        "Ik kon helaas geen antwoord genereren.",
    });
  } catch (
    error
  ) {
    console.error(
      "AI error:",
      error,
    );

    return errorResponse(
      "AI kon momenteel geen antwoord geven.",
      502,
    );
  }
}

/* =========================================================
   ADMIN SYNC
========================================================= */

async function handleSync(
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
      await syncAwin(
        env,
      );

    return json({
      ok: true,
      network: "AWIN",
      ...result,
    });
  } catch (
    error
  ) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Synchronisatie mislukt.",
      502,
    );
  }
}

async function handleDirectSync(
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
      await syncDirectCatalogs(
        env,
      );

    return json({
      ok: true,
      network: "DIRECT",
      ...result,
    });
  } catch (
    error
  ) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Directe synchronisatie mislukt.",
      502,
    );
  }
}

/* =========================================================
   ADMIN LOGS
========================================================= */

async function handleLogs(
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
    await env.DB
      .prepare(
        `
        SELECT *
        FROM sync_logs
        ORDER BY id DESC
        LIMIT 20
        `,
      )
      .all();

  return json({
    logs:
      result.results ?? [],
  });
}

/* =========================================================
   WORKER
========================================================= */

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url =
      new URL(
        request.url,
      );

    const path =
      url.pathname
        .replace(
          /\/+$/,
          "",
        ) || "/";

    try {
      /* Health */
      if (
        request.method === "GET" &&
        path === "/api/health"
      ) {
        return handleHealth(
          env,
        );
      }

      /* Product list */
      if (
        request.method === "GET" &&
        path === "/api/products"
      ) {
        return handleProducts(
          request,
          env,
        );
      }

      /* Product detail */
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

        return handleProduct(
          slug,
          env,
        );
      }

      /* AI */
      if (
        request.method === "POST" &&
        [
          "/api/ai",
          "/api/ai/chat",
          "/api/coach",
        ].includes(path)
      ) {
        return handleAi(
          request,
          env,
        );
      }

      /* Awin admin sync */
      if (
        request.method === "POST" &&
        [
          "/api/admin/sync",
          "/api/admin/sync-awin",
        ].includes(path)
      ) {
        return handleSync(
          request,
          env,
        );
      }

      /* Direct catalog sync */
      if (
        request.method === "POST" &&
        path ===
          "/api/admin/sync-direct"
      ) {
        return handleDirectSync(
          request,
          env,
        );
      }

      /* Sync logs */
      if (
        request.method === "GET" &&
        path ===
          "/api/admin/sync-logs"
      ) {
        return handleLogs(
          request,
          env,
        );
      }

      /* Product redirect */
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

        return handleRedirect(
          productId,
          env,
        );
      }

      /* Static assets */
      return env.ASSETS.fetch(
        request,
      );
    } catch (
      error
    ) {
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

  async scheduled(
    _controller: ScheduledController,
    env: Env,
  ): Promise<void> {
    if (
      env.DIRECT_CATALOG_URLS?.trim()
    ) {
      try {
        await syncDirectCatalogs(
          env,
        );
      } catch (
        error
      ) {
        console.error(
          "Scheduled direct sync failed:",
          error,
        );
      }
    }

    if (
      env.AWIN_FEED_URL?.trim()
    ) {
      try {
        await syncAwin(
          env,
        );
      } catch (
        error
      ) {
        console.error(
          "Scheduled Awin sync failed:",
          error,
        );
      }
    }
  },
};
