export type DirectCatalogProduct = {
  external_id: string;
  name: string;
  slug?: string;
  description?: string;
  brand?: string;
  category?: string;
  goals?: string;
  price: number;
  old_price?: number | null;
  currency?: string;
  image_url?: string;
  product_url: string;
  affiliate_url?: string | null;
  merchant_name: string;
  merchant_id?: string | null;
  network?: string;
  commission?: number | null;
  commission_type?: string | null;
  in_stock?: boolean;
  active?: boolean;
  deal_score?: number;
  discount_percent?: number;
};

type Env = {
  DB: D1Database;
};

const MAX_BATCH = 50;

function text(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const raw = text(value)
    .replace(/[€$£]/g, "")
    .replace(/\s/g, "")
    .replace(",", ".");

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const raw = text(value).toLowerCase();

  return ![
    "0",
    "false",
    "no",
    "nee",
    "outofstock",
    "out of stock",
    "unavailable",
    "uitverkocht",
  ].includes(raw);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function calculateDiscount(
  price: number,
  oldPrice: number | null,
): number {
  if (
    !oldPrice ||
    oldPrice <= 0 ||
    price >= oldPrice
  ) {
    return 0;
  }

  return Math.round(
    ((oldPrice - price) / oldPrice) * 100,
  );
}

function calculateDealScore(
  price: number,
  oldPrice: number | null,
  inStock: boolean,
): number {
  if (!inStock) {
    return 0;
  }

  const discount = calculateDiscount(
    price,
    oldPrice,
  );

  let score = 40;

  if (discount >= 5) score += 10;
  if (discount >= 10) score += 10;
  if (discount >= 20) score += 10;
  if (discount >= 30) score += 10;
  if (discount >= 40) score += 5;

  if (price > 0) {
    score += 5;
  }

  return Math.min(100, score);
}

function cleanProduct(
  input: Partial<DirectCatalogProduct>,
  merchantName: string,
): DirectCatalogProduct | null {
  const name = text(input.name);
  const productUrl = text(input.product_url);
  const externalId =
    text(input.external_id) ||
    productUrl ||
    name;

  const price = numberValue(input.price);

  if (!name || !productUrl || price === null) {
    return null;
  }

  const oldPrice =
    numberValue(input.old_price);

  const inStock =
    input.in_stock === undefined
      ? true
      : booleanValue(input.in_stock);

  const discountPercent =
    input.discount_percent !== undefined
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              numberValue(
                input.discount_percent,
              ) ?? 0,
            ),
          ),
        )
      : calculateDiscount(
          price,
          oldPrice,
        );

  return {
    external_id:
      externalId.slice(0, 500),

    name: name.slice(0, 500),

    slug:
      text(input.slug) ||
      slugify(name),

    description:
      text(input.description).slice(
        0,
        5000,
      ),

    brand:
      text(input.brand).slice(
        0,
        255,
      ),

    category:
      text(input.category).slice(
        0,
        255,
      ),

    goals:
      text(input.goals).slice(
        0,
        500,
      ),

    price,

    old_price:
      oldPrice !== null
        ? oldPrice
        : null,

    currency:
      text(input.currency) ||
      "EUR",

    image_url:
      text(input.image_url) ||
      "",

    product_url:
      productUrl.slice(0, 2000),

    affiliate_url:
      input.affiliate_url ??
      null,

    merchant_name:
      merchantName.slice(
        0,
        255,
      ),

    merchant_id:
      input.merchant_id ??
      null,

    network:
      input.network ||
      "DIRECT",

    commission:
      input.commission ??
      null,

    commission_type:
      input.commission_type ??
      null,

    in_stock:
      inStock,

    active:
      input.active === undefined
        ? true
        : Boolean(input.active),

    deal_score:
      input.deal_score !== undefined
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(
                input.deal_score,
              ),
            ),
          )
        : calculateDealScore(
            price,
            oldPrice,
            inStock,
          ),

    discount_percent:
      discountPercent,
  };
}

/**
 * Parse a CSV feed.
 *
 * Supports quoted values and commas inside quoted fields.
 */
function parseCsv(
  input: string,
): Record<string, string>[] {
  const rows: string[][] = [];

  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (
    let i = 0;
    i < input.length;
    i++
  ) {
    const char = input[i];

    if (char === '"') {
      if (
        quoted &&
        input[i + 1] === '"'
      ) {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
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
      (char === "\n" ||
        char === "\r") &&
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

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(
    (header) =>
      header
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_"),
  );

  return rows
    .slice(1)
    .map((values) => {
      const record: Record<
        string,
        string
      > = {};

      headers.forEach(
        (header, index) => {
          record[header] =
            values[index] ??
            "";
        },
      );

      return record;
    });
}

function getField(
  row: Record<string, unknown>,
  names: string[],
): unknown {
  for (const name of names) {
    if (
      row[name] !== undefined &&
      row[name] !== null &&
      text(row[name]) !== ""
    ) {
      return row[name];
    }
  }

  return undefined;
}

function mapRawProduct(
  row: Record<string, unknown>,
  merchantName: string,
): DirectCatalogProduct | null {
  const mapped: Partial<DirectCatalogProduct> =
    {
      external_id: text(
        getField(row, [
          "external_id",
          "id",
          "product_id",
          "sku",
          "ean",
          "gtin",
          "item_id",
        ]),
      ),

      name: text(
        getField(row, [
          "name",
          "title",
          "product_name",
          "product",
        ]),
      ),

      slug: text(
        getField(row, [
          "slug",
          "handle",
        ]),
      ),

      description: text(
        getField(row, [
          "description",
          "product_description",
          "short_description",
        ]),
      ),

      brand: text(
        getField(row, [
          "brand",
          "manufacturer",
        ]),
      ),

      category: text(
        getField(row, [
          "category",
          "product_type",
          "google_product_category",
        ]),
      ),

      goals: text(
        getField(row, [
          "goals",
          "goal",
          "tags",
        ]),
      ),

      price: numberValue(
        getField(row, [
          "price",
          "sale_price",
          "current_price",
          "selling_price",
        ]),
      ) ?? 0,

      old_price: numberValue(
        getField(row, [
          "old_price",
          "original_price",
          "regular_price",
          "was_price",
          "price_old",
        ]),
      ),

      currency:
        text(
          getField(row, [
            "currency",
            "currency_code",
          ]),
        ) || "EUR",

      image_url: text(
        getField(row, [
          "image_url",
          "image",
          "image_link",
          "picture",
          "thumbnail",
        ]),
      ),

      product_url: text(
        getField(row, [
          "product_url",
          "url",
          "link",
          "product_link",
          "deeplink",
        ]),
      ),

      affiliate_url: null,

      merchant_name:
        merchantName,

      merchant_id:
        text(
          getField(row, [
            "merchant_id",
            "store_id",
          ]),
        ) || null,

      network: "DIRECT",

      in_stock:
        getField(row, [
          "in_stock",
          "availability",
          "stock",
          "available",
        ]) === undefined
          ? true
          : booleanValue(
              getField(row, [
                "in_stock",
                "availability",
                "stock",
                "available",
              ]),
            ),

      active: true,

      discount_percent:
        numberValue(
          getField(row, [
            "discount_percent",
            "discount",
          ]),
        ) ?? undefined,
    };

  return cleanProduct(
    mapped,
    merchantName,
  );
}

function parseJsonProducts(
  payload: unknown,
): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload as Record<
      string,
      unknown
    >[];
  }

  if (
    payload &&
    typeof payload === "object"
  ) {
    const object =
      payload as Record<
        string,
        unknown
      >;

    const possibleKeys = [
      "products",
      "items",
      "results",
      "data",
      "offers",
      "catalog",
    ];

    for (const key of possibleKeys) {
      if (
        Array.isArray(
          object[key],
        )
      ) {
        return object[key] as Record<
          string,
          unknown
        >[];
      }
    }
  }

  return [];
}

async function fetchSource(
  url: string,
): Promise<{
  contentType: string;
  body: string;
}> {
  const response =
    await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "FitDealFinder/1.0 catalog-importer",
        "Accept":
          "application/json,text/csv,application/xml,text/xml,*/*",
      },
    });

  if (!response.ok) {
    throw new Error(
      `Catalogusbron gaf HTTP ${response.status}: ${url}`,
    );
  }

  return {
    contentType:
      response.headers.get(
        "content-type",
      ) || "",
    body:
      await response.text(),
  };
}

function parseXmlProducts(
  xml: string,
): Record<string, string>[] {
  const products: Record<
    string,
    string
  >[] = [];

  const itemMatches =
    xml.match(
      /<(item|product|offer|entry)\b[\s\S]*?<\/\1>/gi,
    ) || [];

  for (const item of itemMatches) {
    const row: Record<
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

    for (const fieldName of fields) {
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
        item.match(regex);

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
      Object.keys(row).length
    ) {
      products.push(row);
    }
  }

  return products;
}

async function importProducts(
  env: Env,
  products: DirectCatalogProduct[],
): Promise<{
  imported: number;
  failed: number;
}> {
  let imported = 0;
  let failed = 0;

  const sql = `
    INSERT INTO products (
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
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
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
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at
  `;

  const now =
    new Date().toISOString();

  for (
    let start = 0;
    start < products.length;
    start += MAX_BATCH
  ) {
    const chunk =
      products.slice(
        start,
        start + MAX_BATCH,
      );

    const statements =
      chunk.map((product) =>
        env.DB
          .prepare(sql)
          .bind(
            product.external_id,
            product.name,
            product.slug ?? "",
            product.description ?? "",
            product.brand ?? "",
            product.category ?? "",
            product.goals ?? "",
            product.price,
            product.old_price ?? null,
            product.currency ?? "EUR",
            product.image_url ?? "",
            product.product_url,
            product.affiliate_url ?? null,
            product.merchant_name,
            product.merchant_id ?? null,
            product.network ?? "DIRECT",
            product.commission ?? null,
            product.commission_type ?? null,
            product.in_stock ? 1 : 0,
            product.active ? 1 : 0,
            product.deal_score ?? 0,
            product.discount_percent ?? 0,
            now,
            now,
            now,
          ),
      );

    try {
      await env.DB.batch(
        statements,
      );

      imported +=
        chunk.length;
    } catch (error) {
      console.error(
        "Batch import mislukt:",
        error,
      );

      failed +=
        chunk.length;
    }
  }

  return {
    imported,
    failed,
  };
}

export async function importDirectCatalog(
  env: Env,
  sourceUrl: string,
  merchantName: string,
): Promise<{
  merchant: string;
  source: string;
  imported: number;
  failed: number;
  received: number;
}> {
  const source =
    await fetchSource(
      sourceUrl,
    );

  const contentType =
    source.contentType.toLowerCase();

  const body =
    source.body.trim();

  let rawProducts:
    Record<string, unknown>[] =
    [];

  if (
    contentType.includes(
      "application/json",
    ) ||
    body.startsWith("{") ||
    body.startsWith("[")
  ) {
    const json =
      JSON.parse(body);

    rawProducts =
      parseJsonProducts(
        json,
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
      `Onbekend catalogusformaat: ${source.contentType}`,
    );
  }

  const products =
    rawProducts
      .map((row) =>
        mapRawProduct(
          row,
          merchantName,
        ),
      )
      .filter(
        (
          product,
        ): product is DirectCatalogProduct =>
          product !== null,
      );

  if (!products.length) {
    throw new Error(
      `Geen geldige producten gevonden in ${sourceUrl}`,
    );
  }

  const result =
    await importProducts(
      env,
      products,
    );

  return {
    merchant:
      merchantName,
    source:
      sourceUrl,
    received:
      rawProducts.length,
    imported:
      result.imported,
    failed:
      result.failed,
  };
      }
