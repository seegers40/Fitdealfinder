interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;

  ADMIN_SECRET?: string;

  AWIN_FEED_URL?: string;
  AWIN_PUBLISHER_ID?: string;

  AI_MODEL?: string;

  /*
   * Eén winkel per regel:
   *
   * WINKELNAAM|https://voorbeeld.nl/feed.csv
   *
   * Meerdere regels zijn toegestaan.
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
  message: string,
  status = 200,
): Response {
  return new Response(
    message,
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
  defaultValue = 1,
): number {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return defaultValue;
  }

  if (
    typeof value === "boolean"
  ) {
    return value ? 1 : 0;
  }

  if (
    typeof value === "number"
  ) {
    return value !== 0 ? 1 : 0;
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
        "in stock",
        "instock",
        "available",
        "beschikbaar",
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
        "unavailable",
        "niet beschikbaar",
        "uitverkocht",
      ].includes(normalized)
    ) {
      return 0;
    }
  }

  return defaultValue;
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
    calculateDiscountPercent(
      price,
      oldPrice,
    );

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

function asRecord(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value ===
      "object"
    ? value as Record<
        string,
        unknown
      >
    : {};
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
    if (
      object[key] !==
        undefined &&
      object[key] !== null &&
      object[key] !== ""
    ) {
      return object[key];
    }
  }

  return undefined;
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

  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    return [];
  }

  const object =
    payload as Record<
      string,
      unknown
    >;

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

/* =========================================================
   CSV PARSER
========================================================= */

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
        const record:
          Record<
            string,
            string
          > = {};

        headers.forEach(
          (
            header,
            index,
          ) => {
            record[
              header
            ] =
              values[
                index
              ] ?? "";
          },
        );

        return record;
      },
    );
}

/* =========================================================
   XML PARSER
========================================================= */

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

  const itemMatches =
    xml.match(
      /<(item|product|offer|entry)\b[\s\S]*?<\/\1>/gi,
    ) ?? [];

  for (
    const item of itemMatches
  ) {
    const row:
      Record<
        string,
        string
      > = {};

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
        row[fieldName] =
          match[1]
            .replace(
              /<!\[CDATA\[([\s\S]*?)\]\]>/g,
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
      Object.keys(row)
        .length
    ) {
      products.push(
        row,
      );
    }
  }

  return products;
}

/* =========================================================
   NORMALIZE DIRECT PRODUCT
========================================================= */

function normalizeDirectProduct(
  row: Record<
    string,
    unknown
  >,
  merchantName: string,
): DirectProduct | null {
  const externalId =
    String(
      firstValue(
        row,
        [
          "external_id",
          "externalId",
          "id",
          "product_id",
          "sku",
          "ean",
          "gtin",
          "item_id",
        ],
      ) ?? "",
    ).trim();

  const name =
    String(
      firstValue(
        row,
        [
          "name",
          "title",
          "product_name",
          "product",
        ],
      ) ?? "",
    ).trim();

  const productUrl =
    safeUrl(
      firstValue(
        row,
        [
          "product_url",
          "url",
          "link",
          "product_link",
          "deeplink",
        ],
      ),
    );

  const price =
    numberOrNull(
      firstValue(
        row,
        [
          "price",
          "sale_price",
          "current_price",
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
        row,
        [
          "old_price",
          "original_price",
          "regular_price",
          "was_price",
          "price_old",
          "rrp",
        ],
      ),
    );

  const imageUrl =
    safeUrl(
      firstValue(
        row,
        [
          "image_url",
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
        row,
        [
          "description",
          "product_description",
          "short_description",
        ],
      ) ?? "",
    ).slice(0, 5000);

  const brand =
    String(
      firstValue(
        row,
        [
          "brand",
          "manufacturer",
          "brand_name",
        ],
      ) ?? "",
    ).trim();

  const category =
    String(
      firstValue(
        row,
        [
          "category",
          "product_type",
          "category_name",
          "google_product_category",
        ],
      ) ?? "",
    ).trim();

  const goals =
    normalizeGoals(
      firstValue(
        row,
        [
          "goals",
          "goal",
          "tags",
        ],
      ),
    );

  const stockValue =
    firstValue(
      row,
      [
        "in_stock",
        "inStock",
        "availability",
        "stock",
        "available",
      ],
    );

  const inStock =
    booleanToInteger(
      stockValue,
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

  return {
    external_id:
      externalId,
    name,
    slug:
      slugify(name) ||
      `product-${externalId}`,
    description:
      description || null,
    brand:
      brand || null,
    category:
      category || null,
    goals,
    price,
    old_price:
      oldPrice,
    currency:
      String(
        firstValue(
          row,
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
      null,
    merchant_name:
      merchantName,
    merchant_id:
      String(
        firstValue(
          row,
          [
            "merchant_id",
            "store_id",
          ],
        ) ?? "",
      ).trim() || null,
    network:
      "DIRECT",
    commission:
      null,
    commission_type:
      null,
    in_stock:
      inStock,
    active:
      1,
    deal_score:
      dealScore,
    discount_percent:
      discountPercent,
  };
}

type DirectProduct = {
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
   DIRECT CATALOG FETCH
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
      `Catalogus gaf HTTP ${response.status}.`,
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
   DIRECT CATALOG IMPORT
========================================================= */

async function importDirectProducts(
  env: Env,
  products: DirectProduct[],
): Promise<{
  imported: number;
  updated: number;
  failed: number;
}> {
  let imported = 0;
  let updated = 0;
  let failed = 0;

  const now =
    new Date().toISOString();

  /*
   * We gebruiken kleine batches.
   * Dat voorkomt dat één grote catalogus
   * tegen de D1 statement-limiet loopt.
   */
  const batchSize = 50;

  for (
    let start = 0;
    start < products.length;
    start += batchSize
  ) {
    const chunk =
      products.slice(
        start,
        start + batchSize,
      );

    const statements =
      chunk.map(
        (product) =>
          env.DB
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
              ON CONFLICT(id)
              DO UPDATE SET
                external_id =
                  excluded.external_id,
                name =
                  excluded.name,
                slug =
                  excluded.slug,
                description =
                  excluded.description,
                brand =
                  excluded.brand,
                category =
                  excluded.category,
                goals =
                  excluded.goals,
                price =
                  excluded.price,
                old_price =
                  excluded.old_price,
                currency =
                  excluded.currency,
                image_url =
                  excluded.image_url,
                product_url =
                  excluded.product_url,
                affiliate_url =
                  excluded.affiliate_url,
                merchant_name =
                  excluded.merchant_name,
                merchant_id =
                  excluded.merchant_id,
                network =
                  excluded.network,
                commission =
                  excluded.commission,
                commission_type =
                  excluded.commission_type,
                in_stock =
                  excluded.in_stock,
                active =
                  excluded.active,
                deal_score =
                  excluded.deal_score,
                discount_percent =
                  excluded.discount_percent,
                last_synced_at =
                  excluded.last_synced_at,
                updated_at =
                  excluded.updated_at
              `,
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
            ),
      );

    try {
      const results =
        await env.DB.batch(
          statements,
        );

      for (
        const result of results
      ) {
        if (
          result.success
        ) {
          imported++;
        } else {
          failed++;
        }
      }
    } catch (
      error
    ) {
      console.error(
        "Direct catalog batch error:",
        error,
      );

      failed +=
        chunk.length;
    }
  }

  /*
   * Dubbelen kunnen voorkomen wanneer een feed
   * dezelfde external_id opnieuw levert.
   *
   * Daarom tellen we hieronder het aantal
   * daadwerkelijke DIRECT-producten opnieuw.
   */
  const count =
    await env.DB
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM products
        WHERE network = 'DIRECT'
        AND active = 1
        `,
      )
      .first<{
        count: number;
      }>();

  /*
   * "imported" betekent hier het aantal succesvolle
   * database-operaties. Het aantal actuele producten
   * staat apart in total.
   */
  updated = Math.max(
    0,
    imported -
      products.length,
  );

  return {
    imported,
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
  const configured =
    env.DIRECT_CATALOG_URLS?.trim();

  if (!configured) {
    throw new Error(
      "DIRECT_CATALOG_URLS is niet ingesteld.",
    );
  }

  const sources =
    configured
      .split(/\r?\n/)
      .map(
        (line) =>
          line.trim(),
      )
      .filter(Boolean);

  if (
    !sources.length
  ) {
    throw new Error(
      "DIRECT_CATALOG_URLS bevat geen catalogusbronnen.",
    );
  }

  const results: unknown[] =
    [];

  for (
    const source of sources
  ) {
    const separator =
      source.indexOf("|");

    if (
      separator === -1
    ) {
      results.push({
        ok: false,
        source,
        error:
          "Gebruik WINKELNAAM|FEED_URL",
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
      !feedUrl
    ) {
      results.push({
        ok: false,
        source,
        error:
          "Winkelnaam of feed-URL ontbreekt.",
      });

      continue;
    }

    try {
      const catalog =
        await fetchCatalog(
          feedUrl,
        );

      const contentType =
        catalog.contentType.toLowerCase();

      const body =
        catalog.body.trim();

      let rawProducts:
        Record<
          string,
          unknown
        >[] = [];

      if (
        contentType.includes(
          "application/json",
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
            (item) =>
              asRecord(item),
          );
      } else if (
        contentType.includes(
          "csv",
        ) ||
        body.includes(",")
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
          `Onbekend catalogusformaat: ${catalog.contentType || "onbekend"}`,
        );
      }

      const products =
        rawProducts
          .map(
            (row) =>
              normalizeDirectProduct(
                row,
                merchant,
              ),
          )
          .filter(
            (
              product,
            ): product is DirectProduct =>
              product !== null,
          );

      if (
        !products.length
      ) {
        throw new Error(
          "Geen geldige producten gevonden.",
        );
      }

      const result =
        await importDirectProducts(
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
          error instanceof
          Error
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
   AWIN
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

  const startedAt =
    new Date().toISOString();

  await env.DB.prepare(
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

  let imported = 0;
  let updated = 0;
  let failed = 0;

  let errorMessage:
    | string
    | null = null;

  try {
    const response =
      await fetch(
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

    let payload:
      unknown;

    if (
      contentType.includes(
        "application/json",
      ) ||
      body
        .trim()
        .startsWith("{") ||
      body
        .trim()
        .startsWith("[")
    ) {
      payload =
        JSON.parse(body);
    } else {
      throw new Error(
        "De huidige Awin-import ondersteunt JSON. De ontvangen feed is geen JSON.",
      );
    }

    const items =
      getFeedItems(
        payload,
      );

    for (
      const item of items
    ) {
      try {
        const source =
          asRecord(item);

        const externalId =
          String(
            firstValue(
              source,
              [
                "external_id",
                "externalId",
                "id",
                "aw_product_id",
                "product_id",
              ],
            ) ?? "",
          ).trim();

        const name =
          String(
            firstValue(
              source,
              [
                "name",
                "product_name",
                "title",
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
                "deep_link",
                "deeplink",
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
                "sale_price",
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
          failed++;
          continue;
        }

        const oldPrice =
          numberOrNull(
            firstValue(
              source,
              [
                "old_price",
                "oldPrice",
                "rrp",
                "regular_price",
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
                "aw_image_url",
              ],
            ),
          );

        const affiliateUrl =
          safeUrl(
            firstValue(
              source,
              [
                "affiliate_url",
                "affiliateUrl",
                "tracking_url",
                "trackingUrl",
              ],
            ),
          );

        const merchantName =
          String(
            firstValue(
              source,
              [
                "merchant_name",
                "merchantName",
                "advertiser_name",
              ],
            ) ?? "Awin",
          ).trim();

        const merchantId =
          String(
            firstValue(
              source,
              [
                "merchant_id",
                "merchantId",
                "advertiser_id",
                "advertiserId",
              ],
            ) ?? "",
          ).trim() || null;

        const brand =
          String(
            firstValue(
              source,
              [
                "brand",
                "brand_name",
              ],
            ) ?? "",
          ).trim() || null;

        const category =
          String(
            firstValue(
              source,
              [
                "category",
                "category_name",
              ],
            ) ?? "",
          ).trim() || null;

        const description =
          String(
            firstValue(
              source,
              [
                "description",
                "short_description",
              ],
            ) ?? "",
          ).trim() || null;

        const goals =
          normalizeGoals(
            firstValue(
              source,
              [
                "goals",
                "goal",
              ],
            ),
          );

        const inStock =
          booleanToInteger(
            firstValue(
              source,
              [
                "in_stock",
                "inStock",
                "availability",
                "stock",
              ],
            ),
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

        const existing =
          await env.DB
            .prepare(
              `
              SELECT id, slug
              FROM products
              WHERE network = ?
              AND external_id = ?
              LIMIT 1
              `,
            )
            .bind(
              "AWIN",
              externalId,
            )
            .first<{
              id: string;
              slug: string;
            }>();

        const id =
          existing?.id ??
          crypto.randomUUID();

        let slug =
          existing?.slug ??
          slugify(name);

        if (!slug) {
          slug =
            `product-${externalId}`;
        }

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
            ON CONFLICT(id)
            DO UPDATE SET
              external_id =
                excluded.external_id,
              name =
                excluded.name,
              slug =
                excluded.slug,
              description =
                excluded.description,
              brand =
                excluded.brand,
              category =
                excluded.category,
              goals =
                excluded.goals,
              price =
                excluded.price,
              old_price =
                excluded.old_price,
              currency =
                excluded.currency,
              image_url =
                excluded.image_url,
              product_url =
                excluded.product_url,
              affiliate_url =
                excluded.affiliate_url,
              merchant_name =
                excluded.merchant_name,
              merchant_id =
                excluded.merchant_id,
              network =
                excluded.network,
              in_stock =
                excluded.in_stock,
              active =
                excluded.active,
              deal_score =
                excluded.deal_score,
              discount_percent =
                excluded.discount_percent,
              last_synced_at =
                excluded.last_synced_at,
              updated_at =
                excluded.updated_at
            `,
          )
          .bind(
            id,
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
              firstValue(
                source,
                ["currency"],
              ) ?? "EUR",
            ),
            imageUrl,
            productUrl,
            affiliateUrl,
            merchantName,
            merchantId,
            "AWIN",
            null,
            null,
            inStock,
            1,
            dealScore,
            discountPercent,
            now,
            existing
              ? undefined
              : now,
            now,
          )
          .run();

        if (existing) {
          updated++;
        } else {
          imported++;
        }
      } catch {
        failed++;
      }
    }
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "Onbekende synchronisatiefout.";
  }

  await env.DB.prepare(
    `
    UPDATE sync_logs
    SET
      finished_at = ?,
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
    )
    `,
  )
    .bind(
      new Date().toISOString(),
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

/* =========================================================
   PRODUCTS API
========================================================= */

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

  const limit =
    Math.max(
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

  const binds:
    unknown[] = [];

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
      `%"${goal}"%`,
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
    ORDER BY
      deal_score DESC,
      price ASC,
      name ASC
    LIMIT ?
  `;

  binds.push(
    limit,
  );

  const result =
    await env.DB
      .prepare(query)
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

/* =========================================================
   PRODUCT DETAIL
========================================================= */

async function handleProductBySlug(
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
          result?.count ??
            0,
        ),
      ai:
        Boolean(env.AI),
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

/* =========================================================
   AFFILIATE / PRODUCT REDIRECT
========================================================= */

async function handleAffiliateRedirect(
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
   AI COACH
========================================================= */

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
              role:
                "system",
              content:
                "Je bent de AI-assistent van FitDealFinder, een Nederlandse website voor fitnessproducten en deals. " +
                "Antwoord in duidelijk en natuurlijk Nederlands. " +
                "Geef praktische, concrete antwoorden. " +
                "Verzin geen actuele prijzen, voorraad, aanbiedingen of productgegevens die je niet hebt. " +
                "Als informatie kan veranderen, zeg dat de gebruiker de actuele productpagina moet controleren. " +
                "Gebruik eenvoudige opmaak en maak antwoorden volledig af.",
            },
            {
              role:
                "user",
              content:
                message,
            },
          ],
          max_tokens:
            1024,
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

/* =========================================================
   ADMIN AUTH
========================================================= */

function isAuthorized(
  request: Request,
  env: Env,
): boolean {
  const configuredSecret =
    env.ADMIN_SECRET?.trim() ??
    "";

  if (
    !configuredSecret
  ) {
    return false;
  }

  const authorization =
    request.headers.get(
      "authorization",
    ) ?? "";

  const bearer =
    authorization.startsWith(
      "Bearer ",
    )
      ? authorization
          .slice(7)
          .trim()
      : "";

  const custom =
    request.headers
      .get(
        "x-admin-secret",
      )
      ?.trim() ?? "";

  return (
    bearer ===
      configuredSecret ||
    custom ===
      configuredSecret
  );
}

/* =========================================================
   ADMIN DIRECT SYNC
========================================================= */

async function handleAdminDirectSync(
  request: Request,
  env: Env,
): Promise<Response> {
  if (
    !env.ADMIN_SECRET?.trim()
  ) {
    return errorResponse(
      "ADMIN_SECRET ontbreekt in de runtime van deze Worker.",
      500,
    );
  }

  if (
    !isAuthorized(
      request,
      env,
    )
  ) {
    return errorResponse(
      "ADMIN_SECRET is aanwezig, maar de ingevoerde waarde komt niet overeen.",
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
      network:
        "DIRECT",
      ...result,
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Directe catalogussynchronisatie mislukt.",
      502,
    );
  }
}

/* =========================================================
   ADMIN AWIN SYNC
========================================================= */

async function handleAdminSync(
  request: Request,
  env: Env,
): Promise<Response> {
  if (
    !env.ADMIN_SECRET?.trim()
  ) {
    return errorResponse(
      "ADMIN_SECRET ontbreekt in de runtime van deze Worker.",
      500,
    );
  }

  if (
    !isAuthorized(
      request,
      env,
    )
  ) {
    return errorResponse(
      "ADMIN_SECRET is aanwezig, maar de ingevoerde waarde komt niet overeen.",
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
      network:
        "AWIN",
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

/* =========================================================
   ADMIN LOGS
========================================================= */

async function handleAdminLogs(
  request: Request,
  env: Env,
): Promise<Response> {
  if (
    !env.ADMIN_SECRET?.trim()
  ) {
    return errorResponse(
      "ADMIN_SECRET ontbreekt in de runtime van deze Worker.",
      500,
    );
  }

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
   MAIN WORKER
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
      url.pathname.replace(
        /\/+$/,
        "",
      ) || "/";

    try {
      /* -----------------------------------------------
         HEALTH
      ------------------------------------------------ */

      if (
        request.method ===
          "GET" &&
        path ===
          "/api/health"
      ) {
        return handleHealth(
          env,
        );
      }

      /* -----------------------------------------------
         PRODUCTS
      ------------------------------------------------ */

      if (
        request.method ===
          "GET" &&
        path ===
          "/api/products"
      ) {
        return handleProducts(
          request,
          env,
        );
      }

      /* -----------------------------------------------
         PRODUCT DETAIL
      ------------------------------------------------ */

      if (
        request.method ===
          "GET" &&
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

      /* -----------------------------------------------
         AI COACH
      ------------------------------------------------ */

      if (
        request.method ===
          "POST" &&
        path ===
          "/api/ai/chat"
      ) {
        return handleAiChat(
          request,
          env,
        );
      }

      /* -----------------------------------------------
         DIRECT CATALOG SYNC
      ------------------------------------------------ */

      if (
        request.method ===
          "POST" &&
        (
          path ===
            "/api/admin/sync" ||
          path ===
            "/api/admin/sync-direct"
        )
      ) {
        return handleAdminDirectSync(
          request,
          env,
        );
      }

      /* -----------------------------------------------
         AWIN SYNC
      ------------------------------------------------ */

      if (
        request.method ===
          "POST" &&
        path ===
          "/api/admin/sync-awin"
      ) {
        return handleAdminSync(
          request,
          env,
        );
      }

      /* -----------------------------------------------
         ADMIN LOGS
      ------------------------------------------------ */

      if (
        request.method ===
          "GET" &&
        path ===
          "/api/admin/sync-logs"
      ) {
        return handleAdminLogs(
          request,
          env,
        );
      }

      /* -----------------------------------------------
         PRODUCT REDIRECT
      ------------------------------------------------ */

      if (
        request.method ===
          "GET" &&
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
          env,
        );
      }

      /* -----------------------------------------------
         STATIC ASSETS
      ------------------------------------------------ */

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
     
