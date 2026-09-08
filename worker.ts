interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  ADMIN_SECRET?: string;
  AI_MODEL?: string;
}

interface ProductSource {
  id: string;
  name: string;
  url: string;
  retailer: string;
  brand: string;
  category: string;
  goals: string[];
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

const DEFAULT_AI_MODEL =
  "@cf/meta/llama-3.1-8b-instruct-fast";

/*
 * Directe productbronnen.
 *
 * Dit zijn GEEN affiliate-links.
 * De bezoeker gaat rechtstreeks naar de aanbieder.
 *
 * Prijzen worden NIET hier opgeslagen.
 * De Worker leest de actuele prijs van de productpagina.
 */
const PRODUCT_SOURCES: ProductSource[] = [
  {
    id: "xxl-whey-delicious",
    name: "Whey Delicious",
    url:
      "https://xxlnutrition.com/nl/whey-delicious",
    retailer: "XXL Nutrition",
    brand: "XXL Nutrition",
    category: "protein",
    goals: ["bulk", "lean-bulk", "cut"],
  },

  {
    id: "xxl-creatine-monohydraat",
    name: "Creatine Monohydraat",
    url:
      "https://xxlnutrition.com/nl/xxl-creatine-monohydraat",
    retailer: "XXL Nutrition",
    brand: "XXL Nutrition",
    category: "creatine",
    goals: ["bulk", "lean-bulk", "cut"],
  },

  {
    id: "xxl-perfect-whey-protein",
    name: "Perfect Whey Protein",
    url:
      "https://xxlnutrition.com/nl/perfect-whey-protein",
    retailer: "XXL Nutrition",
    brand: "XXL Nutrition",
    category: "protein",
    goals: ["bulk", "lean-bulk", "cut"],
  },

  {
    id: "xxl-clear-whey-isolate",
    name: "Clear Whey Isolate",
    url:
      "https://xxlnutrition.com/nl/clear-whey-isolate",
    retailer: "XXL Nutrition",
    brand: "XXL Nutrition",
    category: "protein",
    goals: ["cut", "lean-bulk"],
  },

  {
    id: "xxl-creatine-capsules",
    name:
      "Creatine Monohydraat - 1200 mg - 240 capsules",
    url:
      "https://xxlnutrition.com/nl/creatine-monohydraat-1250-mg-240-capsules",
    retailer: "XXL Nutrition",
    brand: "XXL Nutrition",
    category: "creatine",
    goals: ["bulk", "lean-bulk", "cut"],
  },

  {
    id: "xxl-creatine-chewable",
    name:
      "Creatine Monohydraat - 1000 mg - 90 kauwtabletten",
    url:
      "https://xxlnutrition.com/nl/creatine-monohydraat-1000-mg-90-kauwtabletten",
    retailer: "XXL Nutrition",
    brand: "XXL Nutrition",
    category: "creatine",
    goals: ["bulk", "lean-bulk", "cut"],
  },

  {
    id: "xxl-whey-isolate",
    name: "Whey Isolaat",
    url:
      "https://xxlnutrition.com/nl/whey-isolaat",
    retailer: "XXL Nutrition",
    brand: "XXL Nutrition",
    category: "protein",
    goals: ["cut", "lean-bulk", "bulk"],
  },

  {
    id: "xxl-whey-isolate-zero",
    name: "Whey Isolate Zero",
    url:
      "https://xxlnutrition.com/nl/whey-isolate-zero",
    retailer: "XXL Nutrition",
    brand: "XXL Nutrition",
    category: "protein",
    goals: ["cut", "lean-bulk", "bulk"],
  },

  {
    id: "xxl-diet-shake",
    name: "Diet Shake",
    url:
      "https://xxlnutrition.com/nl/diet-shake",
    retailer: "XXL Nutrition",
    brand: "XXL Nutrition",
    category: "meal-replacement",
    goals: ["cut"],
  },

  {
    id: "xxl-perfect-milk-protein",
    name: "Perfect Milk Protein",
    url:
      "https://xxlnutrition.com/nl/perfect-milk-protein",
    retailer: "XXL Nutrition",
    brand: "XXL Nutrition",
    category: "protein",
    goals: ["bulk", "lean-bulk", "cut"],
  },
];

/* -------------------------------------------------------------------------- */
/* Algemene helpers                                                           */
/* -------------------------------------------------------------------------- */

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
        "cache-control": "no-store",
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
        "cache-control": "no-store",
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
      url.protocol !== "https:" &&
      url.protocol !== "http:"
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

  let valueString =
    String(value)
      .trim()
      .replace(/[^\d,.-]/g, "");

  if (!valueString) {
    return null;
  }

  const comma =
    valueString.lastIndexOf(",");

  const dot =
    valueString.lastIndexOf(".");

  if (
    comma >= 0 &&
    dot >= 0
  ) {
    if (comma > dot) {
      valueString =
        valueString
          .replace(/\./g, "")
          .replace(",", ".");
    } else {
      valueString =
        valueString.replace(
          /,/g,
          "",
        );
    }
  } else if (
    comma >= 0
  ) {
    valueString =
      valueString.replace(
        ",",
        ".",
      );
  }

  const parsed =
    Number(valueString);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function calculateDiscount(
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
    ((oldPrice - price) /
      oldPrice) *
      100,
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
    calculateDiscount(
      price,
      oldPrice,
    );

  if (discount === null) {
    return 20;
  }

  return Math.min(
    100,
    Math.max(
      20,
      20 + discount * 2,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* HTML / JSON-LD                                                             */
/* -------------------------------------------------------------------------- */

function extractJsonLdBlocks(
  html: string,
): unknown[] {
  const blocks =
    html.match(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
    ) ?? [];

  const result: unknown[] =
    [];

  for (
    const block of blocks
  ) {
    const content =
      block
        .replace(
          /<script[^>]*>/i,
          "",
        )
        .replace(
          /<\/script>\s*$/i,
          "",
        )
        .trim();

    if (!content) {
      continue;
    }

    try {
      result.push(
        JSON.parse(
          content,
        ),
      );
    } catch {
      /*
       * Sommige winkels zetten ongeldige
       * JSON-LD blokken op de pagina.
       * Die slaan we veilig over.
       */
    }
  }

  return result;
}

function collectProperty(
  value: unknown,
  property: string,
  result: unknown[],
): void {
  if (
    value === null ||
    value === undefined
  ) {
    return;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      collectProperty(
        item,
        property,
        result,
      );
    }

    return;
  }

  if (
    typeof value !==
    "object"
  ) {
    return;
  }

  const object =
    value as Record<
      string,
      unknown
    >;

  if (
    Object.prototype.hasOwnProperty.call(
      object,
      property,
    )
  ) {
    result.push(
      object[property],
    );
  }

  for (
    const nested of Object.values(
      object,
    )
  ) {
    collectProperty(
      nested,
      property,
      result,
    );
  }
}

function jsonLdValues(
  html: string,
  property: string,
): unknown[] {
  const result: unknown[] =
    [];

  for (
    const block of
      extractJsonLdBlocks(
        html,
      )
  ) {
    collectProperty(
      block,
      property,
      result,
    );
  }

  return result;
}

function firstString(
  values: unknown[],
): string | null {
  for (
    const value of values
  ) {
    if (
      typeof value ===
        "string" &&
      value.trim()
    ) {
      return value.trim();
    }

    if (
      Array.isArray(value)
    ) {
      const nested =
        firstString(
          value,
        );

      if (nested) {
        return nested;
      }
    }

    if (
      value &&
      typeof value ===
        "object"
    ) {
      const object =
        value as Record<
          string,
          unknown
        >;

      for (
        const key of [
          "@id",
          "url",
          "contentUrl",
        ]
      ) {
        if (
          typeof object[
            key
          ] === "string"
        ) {
          return String(
            object[key],
          );
        }
      }
    }
  }

  return null;
}

function extractMeta(
  html: string,
  property: string,
): string | null {
  const escaped =
    property.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
      "i",
    ),
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      html.match(pattern);

    if (
      match &&
      match[1]
    ) {
      return decodeHtml(
        match[1],
      ).trim();
    }
  }

  return null;
}

function decodeHtml(
  value: string,
): string {
  return value
    .replace(
      /&amp;/g,
      "&",
    )
    .replace(
      /&quot;/g,
      '"',
    )
    .replace(
      /&#39;/g,
      "'",
    )
    .replace(
      /&lt;/g,
      "<",
    )
    .replace(
      /&gt;/g,
      ">",
    )
    .replace(
      /&nbsp;/g,
      " ",
    );
}

/* -------------------------------------------------------------------------- */
/* Prijsdetectie                                                              */
/* -------------------------------------------------------------------------- */

function extractCurrentPrice(
  html: string,
): number | null {
  /*
   * 1. JSON-LD Offer price
   */
  const jsonPrices =
    jsonLdValues(
      html,
      "price",
    );

  for (
    const value of jsonPrices
  ) {
    const price =
      numberOrNull(
        value,
      );

    if (
      price !== null &&
      price > 0
    ) {
      return price;
    }
  }

  /*
   * 2. Meta product:price:amount
   */
  for (
    const property of [
      "product:price:amount",
      "og:price:amount",
    ]
  ) {
    const meta =
      extractMeta(
        html,
        property,
      );

    const price =
      numberOrNull(
        meta,
      );

    if (
      price !== null &&
      price > 0
    ) {
      return price;
    }
  }

  /*
   * 3. itemprop=price
   */
  const itemProp =
    html.match(
      /itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
    );

  if (
    itemProp &&
    itemProp[1]
  ) {
    const price =
      numberOrNull(
        itemProp[1],
      );

    if (
      price !== null &&
      price > 0
    ) {
      return price;
    }
  }

  /*
   * 4. Veel voorkomende ecommerce JSON.
   */
  const jsonPatterns = [
    /"price"\s*:\s*"([^"]+)"/i,
    /"price"\s*:\s*([0-9]+(?:[.,][0-9]{1,2})?)/i,
    /"currentPrice"\s*:\s*"([^"]+)"/i,
    /"salePrice"\s*:\s*"([^"]+)"/i,
  ];

  for (
    const pattern of
      jsonPatterns
  ) {
    const match =
      html.match(pattern);

    if (
      !match ||
      !match[1]
    ) {
      continue;
    }

    const price =
      numberOrNull(
        match[1],
      );

    if (
      price !== null &&
      price > 0
    ) {
      return price;
    }
  }

  /*
   * 5. Zichtbare euro-prijs.
   *
   * Dit is bewust de laatste fallback.
   */
  const euroMatches =
    html.matchAll(
      /€\s*([0-9]{1,5}(?:[.,][0-9]{2})?)/gi,
    );

  const candidates: number[] =
    [];

  for (
    const match of
      euroMatches
  ) {
    const price =
      numberOrNull(
        match[1],
      );

    if (
      price !== null &&
      price > 0 &&
      price < 10000
    ) {
      candidates.push(
        price,
      );
    }
  }

  /*
   * De kleinste redelijke eurowaarde
   * is bij veel productpagina's de
   * actuele vanafprijs.
   */
  if (
    candidates.length
  ) {
    return Math.min(
      ...candidates,
    );
  }

  return null;
}

function extractOldPrice(
  html: string,
  currentPrice: number,
): number | null {
  const highPrices =
    jsonLdValues(
      html,
      "highPrice",
    );

  for (
    const value of
      highPrices
  ) {
    const price =
      numberOrNull(
        value,
      );

    if (
      price !== null &&
      price > currentPrice
    ) {
      return price;
    }
  }

  const oldPricePatterns = [
    /"oldPrice"\s*:\s*"([^"]+)"/i,
    /"regularPrice"\s*:\s*"([^"]+)"/i,
    /"compareAtPrice"\s*:\s*"([^"]+)"/i,
  ];

  for (
    const pattern of
      oldPricePatterns
  ) {
    const match =
      html.match(pattern);

    if (
      !match ||
      !match[1]
    ) {
      continue;
    }

    const price =
      numberOrNull(
        match[1],
      );

    if (
      price !== null &&
      price > currentPrice
    ) {
      return price;
    }
  }

  return null;
}

function extractAvailability(
  html: string,
): boolean {
  const values =
    jsonLdValues(
      html,
      "availability",
    );

  for (
    const value of values
  ) {
    const text =
      String(value)
        .toLowerCase();

    if (
      text.includes(
        "outofstock",
      ) ||
      text.includes(
        "soldout",
      ) ||
      text.includes(
        "discontinued",
      )
    ) {
      return false;
    }

    if (
      text.includes(
        "instock",
      ) ||
      text.includes(
        "limitedavailability",
      ) ||
      text.includes(
        "preorder",
      )
    ) {
      return true;
    }
  }

  /*
   * Geen betrouwbare voorraadinfo:
   * product blijft zichtbaar.
   *
   * We claimen dus niet dat het
   * gegarandeerd op voorraad is.
   */
  return true;
}

function extractImage(
  html: string,
): string | null {
  const image =
    firstString(
      jsonLdValues(
        html,
        "image",
      ),
    );

  const jsonImage =
    safeUrl(image);

  if (jsonImage) {
    return jsonImage;
  }

  const ogImage =
    safeUrl(
      extractMeta(
        html,
        "og:image",
      ),
    );

  if (ogImage) {
    return ogImage;
  }

  return null;
}

function extractDescription(
  html: string,
): string | null {
  const description =
    firstString(
      jsonLdValues(
        html,
        "description",
      ),
    );

  if (
    description &&
    description.length >
      10
  ) {
    return description
      .replace(
        /\s+/g,
        " ",
      )
      .trim()
      .slice(0, 1000);
  }

  const meta =
    extractMeta(
      html,
      "description",
    );

  if (
    meta &&
    meta.length > 10
  ) {
    return meta
      .replace(
        /\s+/g,
        " ",
      )
      .trim()
      .slice(0, 1000);
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Product scraping                                                           */
/* -------------------------------------------------------------------------- */

async function fetchProductSource(
  source: ProductSource,
): Promise<
  Omit<
    ProductRow,
    | "created_at"
    | "updated_at"
  >
> {
  const response =
    await fetch(
      source.url,
      {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent":
            "FitDealFinder/1.0",
          Accept:
            "text/html,application/xhtml+xml",
          "Accept-Language":
            "nl-NL,nl;q=0.9,en;q=0.8",
        },
      },
    );

  if (!response.ok) {
    throw new Error(
      `${source.retailer}: productpagina gaf HTTP ${response.status}`,
    );
  }

  const html =
    await response.text();

  if (
    html.length < 500
  ) {
    throw new Error(
      `${source.retailer}: productpagina bevat onvoldoende inhoud`,
    );
  }

  const price =
    extractCurrentPrice(
      html,
    );

  /*
   * Geen actuele prijs =
   * niet publiceren.
   */
  if (
    price === null ||
    price <= 0
  ) {
    throw new Error(
      `${source.name}: actuele prijs niet betrouwbaar gevonden`,
    );
  }

  const oldPrice =
    extractOldPrice(
      html,
      price,
    );

  const inStock =
    extractAvailability(
      html,
    );

  const discount =
    calculateDiscount(
      price,
      oldPrice,
    );

  const now =
    new Date().toISOString();

  const slug =
    slugify(
      source.name,
    );

  return {
    id: source.id,
    external_id: source.id,
    name: source.name,
    slug,
    description:
      extractDescription(
        html,
      ),
    brand: source.brand,
    category:
      source.category,
    goals:
      JSON.stringify(
        source.goals,
      ),
    price,
    old_price:
      oldPrice,
    currency: "EUR",
    image_url:
      extractImage(
        html,
      ),
    product_url:
      source.url,
    affiliate_url:
      null,
    merchant_name:
      source.retailer,
    merchant_id:
      null,
    network:
      "DIRECT",
    commission:
      null,
    commission_type:
      null,
    in_stock:
      inStock ? 1 : 0,
    active: 1,
    deal_score:
      calculateDealScore(
        price,
        oldPrice,
        inStock ? 1 : 0,
      ),
    discount_percent:
      discount,
    last_synced_at:
      now,
  };
}

/* -------------------------------------------------------------------------- */
/* D1 synchronisatie                                                          */
/* -------------------------------------------------------------------------- */

async function upsertProduct(
  env: Env,
  product: Omit<
    ProductRow,
    | "created_at"
    | "updated_at"
  >,
): Promise<
  "imported" | "updated"
> {
  const existing =
    await env.DB.prepare(
      `SELECT id
       FROM products
       WHERE id = ?
       LIMIT 1`,
    )
      .bind(
        product.id,
      )
      .first<{
        id: string;
      }>();

  const now =
    new Date().toISOString();

  if (existing) {
    await env.DB.prepare(
      `UPDATE products
       SET
         external_id = ?,
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
         network = ?,
         commission = ?,
         commission_type = ?,
         in_stock = ?,
         active = ?,
         deal_score = ?,
         discount_percent = ?,
         last_synced_at = ?,
         updated_at = ?
       WHERE id = ?`,
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
        product.last_synced_at,
        now,
        product.id,
      )
      .run();

    return "updated";
  }

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
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?
    )`,
  )
    .bind(
      product.id,
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
      product.last_synced_at,
      now,
      now,
    )
    .run();

  return "imported";
}

async function syncDirectProducts(
  env: Env,
): Promise<{
  imported: number;
  updated: number;
  failed: number;
}> {
  const startedAt =
    new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO sync_logs (
      network,
      started_at
    )
    VALUES (?, ?)`,
  )
    .bind(
      "DIRECT",
      startedAt,
    )
    .run();

  let imported = 0;
  let updated = 0;
  let failed = 0;

  let errorMessage:
    | string
    | null = null;

  for (
    const source of PRODUCT_SOURCES
  ) {
    try {
      const product =
        await fetchProductSource(
          source,
        );

      const result =
        await upsertProduct(
          env,
          product,
        );

      if (
        result ===
        "imported"
      ) {
        imported++;
      } else {
        updated++;
      }
    } catch (error) {
      failed++;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      errorMessage =
        message;

      console.error(
        `FitDealFinder sync fout voor ${source.name}:`,
        message,
      );
    }
  }

  await env.DB.prepare(
    `UPDATE sync_logs
     SET
       finished_at = ?,
       imported = ?,
       updated = ?,
       failed = ?,
       error_message = ?
     WHERE network = ?
       AND started_at = ?`,
  )
    .bind(
      new Date().toISOString(),
      imported,
      updated,
      failed,
      errorMessage,
      "DIRECT",
      startedAt,
    )
    .run();

  /*
   * Oude DIRECT-producten die niet meer
   * in de configuratie staan worden
   * gedeactiveerd.
   *
   * Ze worden NIET verwijderd uit D1.
   */
  const activeIds =
    PRODUCT_SOURCES.map(
      (product) =>
        product.id,
    );

  if (
    activeIds.length
  ) {
    const placeholders =
      activeIds
        .map(() => "?")
        .join(",");

    await env.DB.prepare(
      `UPDATE products
       SET active = 0,
           updated_at = ?
       WHERE network = 'DIRECT'
         AND id NOT IN (${placeholders})`,
    )
      .bind(
        new Date().toISOString(),
        ...activeIds,
      )
      .run();
  }

  return {
    imported,
    updated,
    failed,
  };
}

/* -------------------------------------------------------------------------- */
/* Product API                                                                */
/* -------------------------------------------------------------------------- */

async function getProducts(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(
      request.url,
    );

  const search =
    (
      url.searchParams.get(
        "search",
      ) ?? ""
    )
      .trim()
      .toLowerCase();

  const goal =
    (
      url.searchParams.get(
        "goal",
      ) ?? ""
    )
      .trim()
      .toLowerCase();

  const category =
    (
      url.searchParams.get(
        "category",
      ) ?? ""
    )
      .trim()
      .toLowerCase();

  const rawLimit =
    Number(
      url.searchParams.get(
        "limit",
      ) ?? "100",
    );

  const limit =
    Math.min(
      100,
      Math.max(
        1,
        Number.isFinite(
          rawLimit,
        )
          ? Math.floor(
              rawLimit,
            )
          : 100,
      ),
    );

  const conditions: string[] =
    [
      "active = 1",
      "product_url IS NOT NULL",
      "product_url != ''",
      "price >= 0",
    ];

  const parameters: (
    | string
    | number
  )[] = [];

  if (search) {
    const term =
      `%${search}%`;

    conditions.push(
      `(
        LOWER(name) LIKE ?
        OR LOWER(COALESCE(brand, '')) LIKE ?
        OR LOWER(COALESCE(description, '')) LIKE ?
        OR LOWER(COALESCE(merchant_name, '')) LIKE ?
      )`,
    );

    parameters.push(
      term,
      term,
      term,
      term,
    );
  }

  if (goal) {
    if (
      [
        "cut",
        "bulk",
        "lean-bulk",
      ].includes(goal)
    ) {
      conditions.push(
        `LOWER(goals) LIKE ?`,
      );

      parameters.push(
        `%"${goal}"%`,
      );
    }
  }

  if (category) {
    conditions.push(
      `LOWER(COALESCE(category, '')) LIKE ?`,
    );

    parameters.push(
      `%${category}%`,
    );
  }

  const sql = `
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

  parameters.push(
    limit,
  );

  const result =
    await env.DB.prepare(
      sql,
    )
      .bind(
        ...parameters,
      )
      .all<ProductRow>();

  return json({
    products:
      result.results,
    count:
      result.results.length,
  });
}

async function getProduct(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  const product =
    await env.DB.prepare(
      `SELECT
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
       LIMIT 1`,
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

/* -------------------------------------------------------------------------- */
/* Kliktracking + directe winkelredirect                                      */
/* -------------------------------------------------------------------------- */

async function redirectToProduct(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const product =
    await env.DB.prepare(
      `SELECT
        id,
        product_url,
        affiliate_url,
        active
       FROM products
       WHERE id = ?
       LIMIT 1`,
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
    !product ||
    product.active !== 1
  ) {
    return text(
      "Product niet gevonden.",
      404,
    );
  }

  /*
   * Affiliate URL wordt pas gebruikt
   * zodra die later beschikbaar is.
   *
   * Voor nu gaat de bezoeker rechtstreeks
   * naar de aanbieder.
   */
  const destination =
    safeUrl(
      product.affiliate_url,
    ) ??
    safeUrl(
      product.product_url,
    );

  if (!destination) {
    return text(
      "Ongeldige productlink.",
      500,
    );
  }

  /*
   * affiliate_clicks bestaat al in jouw
   * huidige D1-schema.
   */
  await env.DB.prepare(
    `INSERT INTO affiliate_clicks (
      product_id,
      created_at
    )
    VALUES (?, ?)`,
  )
    .bind(
      product.id,
      new Date().toISOString(),
    )
    .run();

  return Response.redirect(
    destination,
    302,
  );
}

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

async function health(
  env: Env,
): Promise<Response> {
  const counts =
    await env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(
          CASE
            WHEN active = 1
            THEN 1
            ELSE 0
          END
        ) AS active,
        SUM(
          CASE
            WHEN active = 1
             AND in_stock = 1
            THEN 1
            ELSE 0
          END
        ) AS in_stock
       FROM products`,
    )
      .first<{
        total: number;
        active: number;
        in_stock: number;
      }>();

  const lastSync =
    await env.DB.prepare(
      `SELECT
        network,
        started_at,
        finished_at,
        imported,
        updated,
        failed,
        error_message
       FROM sync_logs
       WHERE network = 'DIRECT'
       ORDER BY id DESC
       LIMIT 1`,
    )
      .first<{
        network: string;
        started_at: string;
        finished_at:
          | string
          | null;
        imported: number;
        updated: number;
        failed: number;
        error_message:
          | string
          | null;
      }>();

  return json({
    ok: true,

    products: {
      total:
        Number(
          counts?.total ??
            0,
        ),
      active:
        Number(
          counts?.active ??
            0,
        ),
      in_stock:
        Number(
          counts?.in_stock ??
            0,
        ),
    },

    directRetailers:
      PRODUCT_SOURCES.length,

    lastSync,

    aiConfigured:
      Boolean(env.AI),

    time:
      new Date().toISOString(),
  });
}

/* -------------------------------------------------------------------------- */
/* AI                                                                         */
/* -------------------------------------------------------------------------- */

async function aiChat(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.AI) {
    return errorResponse(
      "AI is niet beschikbaar.",
      503,
    );
  }

  let body: {
    message?: string;
  };

  try {
    body =
      await request.json<{
        message?: string;
      }>();
  } catch {
    return errorResponse(
      "Ongeldige JSON.",
      400,
    );
  }

  const message =
    String(
      body.message ?? "",
    ).trim();

  if (!message) {
    return errorResponse(
      "Bericht ontbreekt.",
      400,
    );
  }

  const result =
    await env.AI.run(
      env.AI_MODEL ??
        DEFAULT_AI_MODEL,
      {
        messages: [
          {
            role: "system",
            content:
              `Je bent de FitDealFinder Supplement Coach.

Je geeft algemene, voorzichtige informatie over fitness en voedingssupplementen.

Belangrijke regels:

1. Verzin nooit actuele prijzen.
2. Verzin nooit actuele aanbiedingen.
3. Verzin nooit voorraad.
4. Verzin nooit een winkel of product dat je niet kent.
5. Verwijs voor actuele prijzen naar de productpagina.
6. Doe geen medische diagnose.
7. Geef geen gevaarlijke of extreme doseringen.
8. Maak duidelijk dat supplementen geen vervanging zijn voor normale voeding.
9. Houd antwoorden praktisch en beknopt.`,
          },
          {
            role: "user",
            content:
              message,
          },
        ],
      },
    );

  let reply: unknown =
    result;

  if (
    result &&
    typeof result ===
      "object" &&
    "response" in result
  ) {
    reply =
      (
        result as {
          response: unknown;
        }
      ).response;
  }

  return json({
    reply,
  });
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

function isAuthorized(
  request: Request,
  env: Env,
): boolean {
  if (
    !env.ADMIN_SECRET
  ) {
    return false;
  }

  const header =
    request.headers.get(
      "authorization",
    );

  return (
    header ===
    `Bearer ${env.ADMIN_SECRET}`
  );
}

async function adminSync(
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
    await syncDirectProducts(
      env,
    );

  return json({
    ok: true,
    sync: result,
    syncedAt:
      new Date().toISOString(),
  });
}

/* -------------------------------------------------------------------------- */
/* Worker                                                                     */
/* -------------------------------------------------------------------------- */

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url =
      new URL(
        request.url,
      );

    try {
      /*
       * Health
       */
      if (
        url.pathname ===
          "/api/health" &&
        request.method ===
          "GET"
      ) {
        return health(
          env,
        );
      }

      /*
       * Productlijst
       */
      if (
        url.pathname ===
          "/api/products" &&
        request.method ===
          "GET"
      ) {
        return getProducts(
          request,
          env,
        );
      }

      /*
       * Product detail
       */
      if (
        url.pathname.startsWith(
          "/api/products/",
        ) &&
        request.method ===
          "GET"
      ) {
        const slug =
          decodeURIComponent(
            url.pathname.slice(
              "/api/products/"
                .length,
            ),
          );

        if (!slug) {
          return errorResponse(
            "Product ontbreekt.",
            400,
          );
        }

        return getProduct(
          request,
          env,
          slug,
        );
      }

      /*
       * AI
       */
      if (
        url.pathname ===
          "/api/ai/chat" &&
        request.method ===
          "POST"
      ) {
        return aiChat(
          request,
          env,
        );
      }

      /*
       * Handmatige sync
       */
      if (
        url.pathname ===
          "/api/admin/sync" &&
        request.method ===
          "POST"
      ) {
        return adminSync(
          request,
          env,
        );
      }

      /*
       * Product redirect
       */
      if (
        url.pathname.startsWith(
          "/go/",
        )
      ) {
        const id =
          decodeURIComponent(
            url.pathname.slice(
              4,
            ),
          );

        if (!id) {
          return text(
            "Product ontbreekt.",
            400,
          );
        }

        return redirectToProduct(
          request,
          env,
          id,
        );
      }

      /*
       * Alle andere requests
       * gaan naar public/.
       */
      const response =
        await env.ASSETS.fetch(
          request,
        );

      /*
       * Basis security headers.
       */
      const headers =
        new Headers(
          response.headers,
        );

      headers.set(
        "X-Content-Type-Options",
        "nosniff",
      );

      headers.set(
        "Referrer-Policy",
        "strict-origin-when-cross-origin",
      );

      headers.set(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
      );

      return new Response(
        response.body,
        {
          status:
            response.status,
          statusText:
            response.statusText,
          headers,
        },
      );
    } catch (error) {
      console.error(
        "FitDealFinder worker error:",
        error,
      );

      return errorResponse(
        error instanceof Error
          ? error.message
          : "Interne serverfout.",
        500,
      );
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      syncDirectProducts(
        env,
      ).then(
        (result) => {
          console.log(
            "FitDealFinder automatische productsync:",
            JSON.stringify(
              result,
            ),
          );
        },
      ).catch(
        (error) => {
          console.error(
            "FitDealFinder automatische productsync mislukt:",
            error,
          );
        },
      ),
    );
  },
};
      
