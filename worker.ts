interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  ADMIN_SECRET?: string;
  AWIN_FEED_URL?: string;
  AWIN_PUBLISHER_ID?: string;
  AI_MODEL?: string;
  DIRECT_CATALOG_URLS?: string;
}

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

const MAX_PRODUCTS_API = 2000;
const DEFAULT_PRODUCTS_API = 200;
const MAX_SYNC_PRODUCTS_PER_SOURCE = 5000;

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
  for (const key of keys) {
    const value = object[key];

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
  base?: string,
): string | null {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return null;
  }

  try {
    const url = new URL(
      value.trim(),
      base,
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

  return (
    slug ||
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

  if (
    typeof value === "number"
  ) {
    return Number.isFinite(value)
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
    Number(normalized);

  return Number.isFinite(parsed)
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
      // Tekstformaat.
    }

    const goals =
      value
        .split(
          /[;,|]/,
        )
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
      return object[key] as unknown[];
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
      .slice(
        0,
        5,
      )
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
    const delimiter of
      delimiters
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
): Record<string, string>[] {
  const delimiter =
    detectCsvDelimiter(input);

  const rows: string[][] =
    [];

  let row: string[] =
    [];

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
          Record<string, string> =
          {};

        headers.forEach(
          (
            header,
            index,
          ) => {
            result[header] =
              values[index] ??
              "";
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
): Record<string, string>[] {
  const products:
    Record<string, string>[] =
    [];

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
      Record<string, string> =
      {};

    for (
      const fieldName of
        fields
    ) {
      const escaped =
        fieldName.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );

      const regex =
        new RegExp(
          `<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`,
          "i",
        );

      const match =
        block.match(regex);

      if (match) {
        result[fieldName] =
          stripXml(match[1]);
      }
    }

    if (
      Object.keys(result)
        .length
    ) {
      products.push(result);
    }
  }

  return products;
}

async function fetchCatalog(
  url: string,
): Promise<unknown> {
  const response =
    await fetch(
      url,
      {
        redirect:
          "follow",

        headers: {
          accept:
            "application/json,text/csv,text/xml,application/xml;q=0.9,*/*;q=0.8",

          "user-agent":
            "Mozilla/5.0 (compatible; FitDealFinder/4.0; catalog-sync)",
        },
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Catalogus HTTP ${response.status}: ${url}`,
    );
  }

  const contentType =
    response.headers
      .get("content-type")
      ?.toLowerCase() ??
    "";

  const body =
    await response.text();

  const trimmed =
    body.trim();

  if (
    contentType.includes(
      "text/html",
    ) ||
    contentType.includes(
      "application/xhtml",
    ) ||
    /^<!doctype\s+html/i.test(
      trimmed,
    ) ||
    /^<html[\s>]/i.test(
      trimmed,
    )
  ) {
    throw new Error(
      `Catalogus gaf HTML terug in plaats van een productfeed: ${url}`,
    );
  }

  if (
    contentType.includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(
        `Catalogus bevat geen geldige JSON: ${url}`,
      );
    }
  }

  if (
    contentType.includes("xml") ||
    contentType.includes("rss") ||
    trimmed.startsWith("<")
  ) {
    const products =
      parseXmlProducts(body);

    if (
      !products.length
    ) {
      throw new Error(
        `XML-catalogus bevat geen herkenbare producten: ${url}`,
      );
    }

    return products;
  }

  const rows =
    parseCsv(body);

  if (
    !rows.length
  ) {
    throw new Error(
      `Catalogus bevat geen herkenbare CSV-producten: ${url}`,
    );
  }

  return rows;
}

function getShopifyFallbackUrls(
  sourceUrl: string,
): string[] {
  try {
    const source =
      new URL(sourceUrl);

    const origin =
      source.origin;

    const urls = [
      `${origin}/products.json?limit=250`,
      `${origin}/collections/all/products.json?limit=250`,
    ];

    return Array.from(
      new Set(
        urls.filter(
          (candidate) =>
            candidate !==
            source.toString(),
        ),
      ),
    );
  } catch {
    return [];
  }
}

async function fetchShopifyCatalog(
  sourceUrl: string,
): Promise<unknown> {
  const candidates = [
    sourceUrl,
    ...getShopifyFallbackUrls(
      sourceUrl,
    ),
  ];

  const errors: string[] =
    [];

  for (
    const candidate of
      candidates
  ) {
    try {
      const payload =
        await fetchCatalog(
          candidate,
        );

      const items =
        getFeedItems(payload);

      if (
        items.length > 0
      ) {
        return payload;
      }

      errors.push(
        `${candidate}: 0 producten`,
      );
    } catch (
      error
    ) {
      errors.push(
        error instanceof Error
          ? error.message
          : String(error),
      );
    }
  }

  throw new Error(
    `Shopify-catalogus kon niet worden ingelezen. Pogingen: ${errors.join(
      " | ",
    )}`,
  );
}

async function fetchDirectCatalog(
  url: string,
): Promise<unknown> {
  const isLikelyShopify =
    /\/products\.json(?:\?|$)/i.test(
      url,
    ) ||
    /\/collections\/[^/]+\/products\.json(?:\?|$)/i.test(
      url,
    );

  if (
    isLikelyShopify
  ) {
    return fetchShopifyCatalog(
      url,
    );
  }

  return fetchCatalog(url);
}

function normalizeProduct(
  source: Record<string, unknown>,
  merchantName: string,
  network: string,
  baseUrl?: string,
): ProductInput | null {
  const variants =
    Array.isArray(
      source.variants,
    )
      ? source.variants
      : [];

  const variant =
    asRecord(
      variants[0],
    );

  const images =
    Array.isArray(
      source.images,
    )
      ? source.images
      : [];

  const firstImage =
    asRecord(
      images[0],
    );

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
      ) ??
        firstValue(
          variant,
          [
            "id",
            "sku",
            "barcode",
          ],
        ) ??
        "",
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
      ) ??
        firstValue(
          variant,
          ["price"],
        ),
    );

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
      ) ??
        firstValue(
          variant,
          [
            "compare_at_price",
          ],
        ),
    );

  let productUrl =
    safeUrl(
      firstValue(
        source,
        [
          "product_url",
          "productUrl",
          "link",
          "url",
        ],
      ),
      baseUrl,
    );

  if (!productUrl) {
    const handle =
      String(
        firstValue(
          source,
          ["handle"],
        ) ?? "",
      ).trim();

    if (
      handle &&
      baseUrl
    ) {
      productUrl =
        safeUrl(
          `/products/${handle}`,
          baseUrl,
        );
    }
  }

  if (
    !externalId ||
    !name ||
    price === null ||
    !productUrl
  ) {
    return null;
  }

  let inStock = 1;

  if (
    typeof variant.available ===
    "boolean"
  ) {
    inStock =
      variant.available
        ? 1
        : 0;
  } else if (
    typeof variant.inventory_quantity ===
    "number"
  ) {
    inStock =
      variant.inventory_quantity >
      0
        ? 1
        : 0;
  } else {
    inStock =
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
  }

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
      baseUrl,
    );

  const discount =
    discountPercent(
      price,
      oldPrice,
    );

  const brand =
    String(
      firstValue(
        source,
        [
          "brand",
          "brand_name",
          "brandName",
          "vendor",
        ],
      ) ?? "",
    ).trim() ||
    null;

  const category =
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
    ).trim() ||
    null;

  const description =
    String(
      firstValue(
        source,
        [
          "description",
          "product_description",
          "body_html",
        ],
      ) ?? "",
    ).trim() ||
    null;

  const imageUrl =
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
      ) ??
        firstValue(
          firstImage,
          [
            "src",
            "url",
          ],
        ),
      baseUrl,
    );

  const currency =
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
    "EUR";

  return {
    external_id:
      externalId,

    name,

    slug:
      slugify(
        `${resolvedMerchant}-${name}-${externalId}`,
      ),

    description,

    brand,

    category,

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

    currency,

    image_url:
      imageUrl,

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
      ).trim() ||
      null,

    network,

    commission:
      null,

    commission_type:
      null,

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

function chunks<T>(
  items: T[],
  size: number,
): T[][] {
  const result: T[][] =
    [];

  for (
    let i = 0;
    i < items.length;
    i += size
  ) {
    result.push(
      items.slice(
        i,
        i + size,
      ),
    );
  }

  return result;
}

async function upsertProducts(
  env: Env,
  products: ProductInput[],
): Promise<{
  imported: number;
  updated: number;
  skipped: number;
}> {
  const unique =
    new Map<
      string,
      ProductInput
    >();

  for (
    const product of
      products
  ) {
    unique.set(
      `${product.network}:${product.external_id}`,
      product,
    );
  }

  const list =
    Array.from(
      unique.values(),
    );

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  const now =
    new Date().toISOString();

  for (
    const batch of chunks(
      list,
      50,
    )
  ) {
    const keys =
      batch.map(
        (product) =>
          `${product.network}:${product.external_id}`,
      );

    const placeholders =
      keys
        .map(() => "?")
        .join(",");

    const existingResult =
      await env.DB.prepare(
        `
        SELECT id, network, external_id
        FROM products
        WHERE network || ':' || external_id
        IN (${placeholders})
        `,
      )
        .bind(...keys)
        .all<{
          id: string;
          network: string;
          external_id:
            | string
            | null;
        }>();

    const existing =
      new Map<
        string,
        string
      >();

    for (
      const row of
        existingResult.results
    ) {
      if (
        row.external_id
      ) {
        existing.set(
          `${row.network}:${row.external_id}`,
          row.id,
        );
      }
    }

    for (
      const product of
        batch
    ) {
      const key =
        `${product.network}:${product.external_id}`;

      const existingId =
        existing.get(key);

      try {
        if (
          existingId
        ) {
          await env.DB.prepare(
            `
            UPDATE products
            SET
              external_id=?,
              name=?,
              slug=?,
              description=?,
              brand=?,
              category=?,
              goals=?,
              price=?,
              old_price=?,
              currency=?,
              image_url=?,
              product_url=?,
              affiliate_url=?,
              merchant_name=?,
              merchant_id=?,
              network=?,
              commission=?,
              commission_type=?,
              in_stock=?,
              active=?,
              deal_score=?,
              discount_percent=?,
              last_synced_at=?,
              updated_at=?
            WHERE id=?
            `,
          )
            .bind(
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
              existingId,
            )
            .run();

          updated++;
        } else {
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
              last_synced_at,
              created_at,
              updated_at
            )
            VALUES (
              ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
            )
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
            )
            .run();

          imported++;
        }
      } catch {
        skipped++;
      }
    }
  }

  return {
    imported,
    updated,
    skipped,
  };
}

function parseDirectCatalogConfig(
  value: string,
): {
  merchant: string;
  url: string;
}[] {
  return value
    .split(/\r?\n/)
    .map(
      (line) =>
        line.trim(),
    )
    .filter(Boolean)
    .map(
      (line) => {
        const separator =
          line.indexOf("|");

        if (
          separator <= 0
        ) {
          throw new Error(
            `Ongeldige DIRECT_CATALOG_URLS-regel: ${line}`,
          );
        }

        const merchant =
          line
            .slice(
              0,
              separator,
            )
            .trim();

        const url =
          line
            .slice(
              separator + 1,
            )
            .trim();

        if (
          !merchant ||
          !url
        ) {
          throw new Error(
            `Ongeldige DIRECT_CATALOG_URLS-regel: ${line}`,
          );
        }

        return {
          merchant,
          url,
        };
      },
    );
}

async function syncDirectCatalogs(
  env: Env,
): Promise<{
  stores: Array<{
    merchant: string;
    source: string;
    received: number;
    normalized: number;
    imported: number;
    updated: number;
    skipped: number;
  }>;
}> {
  const config =
    env.DIRECT_CATALOG_URLS?.trim();

  if (!config) {
    throw new Error(
      "DIRECT_CATALOG_URLS is niet ingesteld.",
    );
  }

  const catalogs =
    parseDirectCatalogConfig(
      config,
    );

  const stores: Array<{
    merchant: string;
    source: string;
    received: number;
    normalized: number;
    imported: number;
    updated: number;
    skipped: number;
  }> = [];

  for (
    const catalog of
      catalogs
  ) {
    const feed =
      await fetchDirectCatalog(
        catalog.url,
      );

    const rawItems =
      getFeedItems(feed);

    if (
      rawItems.length ===
      0
    ) {
      throw new Error(
        `${catalog.merchant}: catalogus is bereikbaar maar bevat 0 herkenbare producten.`,
      );
    }

    const limitedItems =
      rawItems.slice(
        0,
        MAX_SYNC_PRODUCTS_PER_SOURCE,
      );

    const baseUrl =
      new URL(
        catalog.url,
      ).origin;

    const products =
      limitedItems
        .map(
          (raw) =>
            normalizeProduct(
              asRecord(raw),
              catalog.merchant,
              "DIRECT",
              baseUrl,
            ),
        )
        .filter(
          (
            product,
          ): product is ProductInput =>
            product !== null,
        );

    if (
      products.length ===
      0
    ) {
      throw new Error(
        `${catalog.merchant}: ${rawItems.length} producten ontvangen, maar 0 producten konden worden verwerkt.`,
      );
    }

    const result =
      await upsertProducts(
        env,
        products,
      );

    stores.push({
      merchant:
        catalog.merchant,

      source:
        catalog.url,

      received:
        rawItems.length,

      normalized:
        products.length,

      ...result,
    });
  }

  return {
    stores,
  };
}

async function syncAwin(
  env: Env,
): Promise<{
  imported: number;
  updated: number;
  failed: number;
  received: number;
  normalized: number;
}> {
  if (
    !env.AWIN_FEED_URL?.trim()
  ) {
    throw new Error(
      "AWIN_FEED_URL is niet ingesteld.",
    );
  }

  const started =
    new Date().toISOString();

  const log =
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
        started,
      )
      .run();

  const logId =
    Number(
      log.meta?.last_row_id ??
        0,
    );

  try {
    const feed =
      await fetchCatalog(
        env.AWIN_FEED_URL,
      );

    const rawItems =
      getFeedItems(feed);

    const limitedItems =
      rawItems.slice(
        0,
        MAX_SYNC_PRODUCTS_PER_SOURCE,
      );

    const products =
      limitedItems
        .map(
          (raw) =>
            normalizeProduct(
              asRecord(raw),
              "AWIN",
              "AWIN",
            ),
        )
        .filter(
          (
            product,
          ): product is ProductInput =>
            product !== null,
        );

    const result =
      await upsertProducts(
        env,
        products,
      );

    await env.DB.prepare(
      `
      UPDATE sync_logs
      SET
        finished_at=?,
        imported=?,
        updated=?,
        failed=?
      WHERE id=?
      `,
    )
      .bind(
        new Date().toISOString(),
        result.imported,
        result.updated,
        result.skipped,
        logId,
      )
      .run();

    return {
      imported:
        result.imported,

      updated:
        result.updated,

      failed:
        result.skipped,

      received:
        rawItems.length,

      normalized:
        products.length,
    };
  } catch (
    error
  ) {
    await env.DB.prepare(
      `
      UPDATE sync_logs
      SET
        finished_at=?,
        failed=?,
        error_message=?
      WHERE id=?
      `,
    )
      .bind(
        new Date().toISOString(),
        1,
        error instanceof Error
          ? error.message
          : String(error),
        logId,
      )
      .run();

    throw error;
  }
}

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

  const bearer =
    authorization.startsWith(
      "Bearer ",
    )
      ? authorization
          .slice(7)
          .trim()
      : "";

  const supplied =
    bearer ||
    request.headers
      .get(
        "x-admin-secret",
      )
      ?.trim() ||
    "";

  return (
    supplied.length > 0 &&
    supplied ===
      env.ADMIN_SECRET
  );
}

/**
 * Server-side category matching.
 *
 * Dit voorkomt dat bijvoorbeeld:
 * - "Whey Protein" niet onder Proteïne verschijnt
 * - "Creatine Monohydraat" niet onder Creatine verschijnt
 * - "5150 Pre Workout" niet onder Pre-workout verschijnt
 */
function categoryTerms(
  category: string,
): string[] {
  const normalized =
    category
      .normalize("NFKD")
      .replace(
        /[\u0300-\u036f]/g,
        "",
      )
      .toLowerCase()
      .trim();

  if (
    normalized ===
    "proteine"
  ) {
    return [
      "proteine",
      "protein",
      "whey",
      "isolaat",
      "isolate",
      "casein",
      "caseine",
      "eiwit",
      "egg protein",
      "beef protein",
      "clear whey",
      "mass gainer",
      "gainer",
    ];
  }

  if (
    normalized ===
    "creatine"
  ) {
    return [
      "creatine",
      "crea",
      "creatine monohydraat",
      "creatine monohydrate",
    ];
  }

  if (
    normalized ===
    "pre-workout" ||
    normalized ===
    "pre workout"
  ) {
    return [
      "pre-workout",
      "pre workout",
      "preworkout",
      "pump",
      "nox",
      "5150",
      "abe",
    ];
  }

  if (
    normalized ===
    "supplementen"
  ) {
    return [
      "supplement",
      "vitamine",
      "vitamin",
      "mineral",
      "mineraal",
      "omega",
      "bcaa",
      "eaa",
      "amino",
      "amino acid",
      "carnitine",
      "glutamine",
      "magnesium",
      "zinc",
      "zink",
      "ashwagandha",
      "electrolyte",
      "elektrolyt",
      "collagen",
      "collageen",
      "multivitamin",
      "fish oil",
      "visolie",
    ];
  }

  return [
    normalized,
  ];
}

function productMatchesCategory(
  product: Record<string, unknown>,
  requestedCategory: string,
): boolean {
  const terms =
    categoryTerms(
      requestedCategory,
    );

  if (
    !terms.length
  ) {
    return true;
  }

  const text =
    [
      product.category,
      product.name,
      product.brand,
      product.description,
    ]
      .filter(
        (
          value,
        ) =>
          value !== null &&
          value !== undefined,
      )
      .map(String)
      .join(" ")
      .normalize("NFKD")
      .replace(
        /[\u0300-\u036f]/g,
        "",
      )
      .toLowerCase();

  return terms.some(
    (term) =>
      text.includes(term),
  );
}

async function handleProducts(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(request.url);

  const requestedLimit =
    Number(
      url.searchParams.get(
        "limit",
      ) ??
        String(
          DEFAULT_PRODUCTS_API,
        ),
    );

  const limit =
    Math.min(
      MAX_PRODUCTS_API,
      Math.max(
        1,
        Number.isFinite(
          requestedLimit,
        )
          ? Math.floor(
              requestedLimit,
            )
          : DEFAULT_PRODUCTS_API,
      ),
    );

  const requestedOffset =
    Number(
      url.searchParams.get(
        "offset",
      ) ?? "0",
    );

  const offset =
    Math.max(
      0,
      Number.isFinite(
        requestedOffset,
      )
        ? Math.floor(
            requestedOffset,
          )
        : 0,
    );

  const search =
    url.searchParams
      .get("search")
      ?.trim() ??
    "";

  const goal =
    url.searchParams
      .get("goal")
      ?.trim()
      .toLowerCase() ??
    "";

  const category =
    url.searchParams
      .get("category")
      ?.trim() ??
    "";

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
        OR merchant_name LIKE ?
        OR description LIKE ?
        OR category LIKE ?
      )
      `,
    );

    const query =
      `%${search}%`;

    binds.push(
      query,
      query,
      query,
      query,
      query,
    );
  }

  if (goal) {
    conditions.push(
      "goals LIKE ?",
    );

    binds.push(
      `%\"${goal}\"%`,
    );
  }

  /*
   * Category filtering is deliberately broader than
   * "category = exact value".
   *
   * This lets the API find:
   * Whey Protein
   * Whey Isolate
   * Creatine Monohydrate
   * 5150 Pre Workout
   * etc.
   *
   * We first use broad SQL matching and then apply the
   * complete category matcher in JavaScript.
   */
  if (category) {
    const terms =
      categoryTerms(
        category,
      );

    if (
      terms.length
    ) {
      const categoryConditions =
        terms.map(
          () =>
            `
            (
              category LIKE ?
              OR name LIKE ?
              OR brand LIKE ?
              OR description LIKE ?
            )
            `,
        );

      for (
        const term of
          terms
      ) {
        const query =
          `%${term}%`;

        binds.push(
          query,
          query,
          query,
          query,
        );
      }

      conditions.push(
        `(${categoryConditions.join(
          " OR ",
        )})`,
      );
    }
  }

  /*
   * Fetch a larger candidate set when category filtering
   * is active because the final category matcher is more
   * precise than SQL LIKE alone.
   */
  const sqlLimit =
    category
      ? Math.min(
          MAX_PRODUCTS_API,
          Math.max(
            limit * 3,
            300,
          ),
        )
      : limit;

  binds.push(
    sqlLimit,
  );

  const result =
    await env.DB.prepare(
      `
      SELECT *
      FROM products
      WHERE ${conditions.join(
        " AND ",
      )}
      ORDER BY
        in_stock DESC,
        deal_score DESC,
        updated_at DESC
      LIMIT ?
      `,
    )
      .bind(
        ...binds,
      )
      .all();

  let products =
    result.results;

  if (
    category
  ) {
    products =
      products.filter(
        (product) =>
          productMatchesCategory(
            asRecord(product),
            category,
          ),
      );
  }

  const totalResult =
    await env.DB.prepare(
      `
      SELECT COUNT(*) AS count
      FROM products
      WHERE active=1
      `,
    ).first<{
      count: number;
    }>();

  const total =
    Number(
      totalResult?.count ??
        0,
    );

  const paginated =
    products.slice(
      offset,
      offset + limit,
    );

  return json({
    products:
      paginated,

    count:
      paginated.length,

    total,

    limit,

    offset,

    has_more:
      offset +
        paginated.length <
      total,
  });
}

async function handleProduct(
  env: Env,
  id: string,
): Promise<Response> {
  if (!id) {
    return errorResponse(
      "Product-ID ontbreekt.",
      400,
    );
  }

  const row =
    await env.DB.prepare(
      `
      SELECT *
      FROM products
      WHERE id=?
        AND active=1
      LIMIT 1
      `,
    )
      .bind(id)
      .first();

  if (!row) {
    return errorResponse(
      "Product niet gevonden.",
      404,
    );
  }

  return json({
    product: row,
  });
}

async function handleRedirect(
  env: Env,
  id: string,
): Promise<Response> {
  if (!id) {
    return errorResponse(
      "Product-ID ontbreekt.",
      400,
    );
  }

  const row =
    await env.DB.prepare(
      `
      SELECT
        id,
        product_url,
        affiliate_url,
        active
      FROM products
      WHERE id=?
      LIMIT 1
      `,
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
    !row.active
  ) {
    return errorResponse(
      "Product niet gevonden.",
      404,
    );
  }

  const destination =
    safeUrl(
      row.affiliate_url,
    ) ??
    safeUrl(
      row.product_url,
    );

  if (!destination) {
    return errorResponse(
      "Ongeldige productlink.",
      500,
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
    .bind(id)
    .run();

  return Response.redirect(
    destination,
    302,
  );
}

async function handleHealth(
  env: Env,
): Promise<Response> {
  const row =
    await env.DB.prepare(
      `
      SELECT COUNT(*) AS count
      FROM products
      WHERE active=1
      `,
    )
      .first<{
        count: number;
      }>();

  return json({
    ok: true,

    products:
      Number(
        row?.count ?? 0,
      ),

    timestamp:
      new Date().toISOString(),
  });
}

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
    const direct =
      env.DIRECT_CATALOG_URLS?.trim()
        ? await syncDirectCatalogs(
            env,
          )
        : {
            stores: [],
          };

    let imported = 0;
    let updated = 0;
    let failed = 0;

    for (
      const store of
        direct.stores
    ) {
      imported +=
        Number(
          store.imported ??
            0,
        );

      updated +=
        Number(
          store.updated ??
            0,
        );

      failed +=
        Number(
          store.skipped ??
            0,
        );
    }

    let awin:
      | {
          imported?: number;
          updated?: number;
          failed?: number;
          received?: number;
          normalized?: number;
          error?: string;
        }
      | null = null;

    if (
      env.AWIN_FEED_URL?.trim()
    ) {
      try {
        const result =
          await syncAwin(
            env,
          );

        awin =
          result;

        imported +=
          result.imported;

        updated +=
          result.updated;

        failed +=
          result.failed;
      } catch (
        error
      ) {
        awin = {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        };

        failed++;
      }
    }

    return json({
      ok: true,

      sync: {
        imported,
        updated,
        failed,
        direct,
        awin,
      },
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

    let imported = 0;
    let updated = 0;
    let failed = 0;

    for (
      const store of
        result.stores
    ) {
      imported +=
        store.imported;

      updated +=
        store.updated;

      failed +=
        store.skipped;
    }

    return json({
      ok: true,

      sync: {
        imported,
        updated,
        failed,
        direct: result,
        awin: null,
      },
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
    await env.DB.prepare(
      `
      SELECT *
      FROM sync_logs
      ORDER BY started_at DESC
      LIMIT 50
      `,
    ).all();

  return json({
    logs:
      result.results,
  });
}

async function handleAi(
  request: Request,
  env: Env,
): Promise<Response> {
  if (
    request.method !==
    "POST"
  ) {
    return errorResponse(
      "Methode niet toegestaan.",
      405,
    );
  }

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

  const message =
    String(
      asRecord(body).message ??
        "",
    ).trim();

  if (!message) {
    return errorResponse(
      "Vul een vraag in.",
      400,
    );
  }

  if (
    message.length >
    4000
  ) {
    return errorResponse(
      "Vraag is te lang.",
      400,
    );
  }

  const model =
    env.AI_MODEL?.trim() ||
    DEFAULT_AI_MODEL;

  try {
    const result =
      await env.AI.run(
        model,
        {
          messages: [
            {
              role:
                "system",

              content:
                [
                  "Je bent de FitDealFinder Supplement Coach.",
                  "Geef nuchtere, algemene informatie over supplementen, eiwitten, creatine, pre-workout, cut, bulk, lean bulk, herstel en voeding rondom training.",
                  "Doe geen medische diagnose en geef geen medische behandeling.",
                  "Beloof geen resultaten.",
                  "Verzin nooit prijzen, kortingen, voorraad, producteigenschappen, winkels of links.",
                  "Als informatie ontbreekt, zeg dat eerlijk.",
                  "Bij medische vragen: adviseer contact op te nemen met een arts of apotheker.",
                ].join(
                  "\n",
                ),
            },

            {
              role:
                "user",

              content:
                message,
            },
          ],
        },
      );

    const record =
      asRecord(result);

    const answer =
      typeof result ===
      "string"
        ? result
        : record.response ??
          result;

    return json({
      ok: true,
      answer,
    });
  } catch (
    error
  ) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "AI-service niet beschikbaar.",
      502,
    );
  }
}

async function serveAsset(
  request: Request,
  env: Env,
): Promise<Response> {
  const response =
    await env.ASSETS.fetch(
      request,
    );

  if (
    response.status !==
    404
  ) {
    return response;
  }

  return env.ASSETS.fetch(
    new Request(
      new URL(
        "/index.html",
        request.url,
      ),
      request,
    ),
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url =
      new URL(request.url);

    try {
      if (
        url.pathname ===
          "/api/health" &&
        request.method ===
          "GET"
      ) {
        return handleHealth(
          env,
        );
      }

      if (
        url.pathname ===
          "/api/products" &&
        request.method ===
          "GET"
      ) {
        return handleProducts(
          request,
          env,
        );
      }

      if (
        url.pathname.startsWith(
          "/api/products/",
        ) &&
        request.method ===
          "GET"
      ) {
        const id =
          url.pathname
            .slice(
              "/api/products/"
                .length,
            )
            .split("/")[0];

        return handleProduct(
          env,
          id,
        );
      }

      if (
        url.pathname ===
        "/api/ai/chat"
      ) {
        return handleAi(
          request,
          env,
        );
      }

      if (
        url.pathname ===
          "/api/admin/sync" &&
        request.method ===
          "POST"
      ) {
        return handleSync(
          request,
          env,
        );
      }

      if (
        url.pathname ===
          "/api/admin/sync-direct" &&
        request.method ===
          "POST"
      ) {
        return handleDirectSync(
          request,
          env,
        );
      }

      if (
        url.pathname ===
          "/api/admin/logs" &&
        request.method ===
          "GET"
      ) {
        return handleLogs(
          request,
          env,
        );
      }

      if (
        url.pathname.startsWith(
          "/go/",
        ) &&
        request.method ===
          "GET"
      ) {
        return handleRedirect(
          env,
          url.pathname.slice(
            4,
          ),
        );
      }

      return serveAsset(
        request,
        env,
      );
    } catch (
      error
    ) {
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Interne fout.",
        500,
      );
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (
      env.DIRECT_CATALOG_URLS?.trim()
    ) {
      ctx.waitUntil(
        syncDirectCatalogs(
          env,
        ).catch(
          () => undefined,
        ),
      );
    }

    if (
      env.AWIN_FEED_URL?.trim()
    ) {
      ctx.waitUntil(
        syncAwin(
          env,
        ).catch(
          () => undefined,
        ),
      );
    }
  },
};
