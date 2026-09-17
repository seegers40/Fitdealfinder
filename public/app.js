"use strict";

/* =========================================================
   FitDealFinder - frontend application
   ========================================================= */

const API_PRODUCTS = "/api/products";
const API_AI = "/api/ai/chat";

const PAGE_SIZE = 200;
const MAX_PRODUCTS = 2000;
const PRODUCTS_PER_VIEW = 8;

const state = {
  products: [],
  filtered: [],
  search: "",
  goal: "",
  category: "",
  visibleCount: PRODUCTS_PER_VIEW,
  loading: false,
};

/* =========================================================
   DOM HELPERS
   ========================================================= */

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function first(...selectors) {
  for (const selector of selectors) {
    const element = $(selector);
    if (element) return element;
  }
  return null;
}

/* =========================================================
   TEXT / VALUE HELPERS
   ========================================================= */

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCategory(value) {
  const v = normalize(value)
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");

  if (
    [
      "protein",
      "proteine",
      "proteins",
      "whey",
      "whey-protein",
    ].includes(v)
  ) {
    return "proteine";
  }

  if (
    [
      "creatine",
      "creatine-monohydraat",
      "creatine-monohydrate",
    ].includes(v)
  ) {
    return "creatine";
  }

  if (
    [
      "pre-workout",
      "preworkout",
      "pre-work-out",
      "pre",
    ].includes(v)
  ) {
    return "pre-workout";
  }

  if (
    [
      "supplement",
      "supplements",
      "supplementen",
    ].includes(v)
  ) {
    return "supplementen";
  }

  return v;
}

function normalizeGoal(value) {
  const v = normalize(value)
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");

  if (
    [
      "cut",
      "cutten",
      "afvallen",
      "droogtrainen",
      "droog-trainen",
      "fat-loss",
      "weight-loss",
    ].includes(v)
  ) {
    return "cut";
  }

  if (
    [
      "bulk",
      "bulken",
      "spiermassa",
      "massa",
      "mass",
    ].includes(v)
  ) {
    return "bulk";
  }

  if (
    [
      "lean-bulk",
      "leanbulk",
      "lean-bulken",
      "lean-mass",
      "lean-massa",
    ].includes(v)
  ) {
    return "lean-bulk";
  }

  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeHttpUrl(value) {
  try {
    const url = new URL(
      String(value || ""),
      window.location.origin
    );

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function price(product) {
  const candidates = [
    product?.price,
    product?.sale_price,
    product?.current_price,
    product?.amount,
    product?.price_value,
  ];

  for (const value of candidates) {
    const number = Number(
      String(value ?? "")
        .replace(",", ".")
        .replace(/[^\d.-]/g, "")
    );

    if (
      Number.isFinite(number) &&
      number >= 0
    ) {
      return number;
    }
  }

  return 0;
}

function money(value) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value) || 0);
}

function productName(product) {
  return String(
    product?.name ||
      product?.title ||
      product?.product_name ||
      "Product"
  ).trim();
}

function productBrand(product) {
  return String(
    product?.brand ||
      product?.brand_name ||
      ""
  ).trim();
}

function productMerchant(product) {
  return String(
    product?.merchant_name ||
      product?.merchant ||
      product?.store ||
      product?.shop ||
      ""
  ).trim();
}

function productUrl(product) {
  return safeHttpUrl(
    product?.url ||
      product?.product_url ||
      product?.link ||
      product?.affiliate_url ||
      product?.merchant_url ||
      ""
  );
}

function productImage(product) {
  return safeHttpUrl(
    product?.image_url ||
      product?.image ||
      product?.thumbnail ||
      product?.imageUrl ||
      ""
  );
}

/* =========================================================
   PRODUCT TEXT
   ========================================================= */

function productSearchText(product) {
  return normalize(
    [
      productName(product),
      productBrand(product),
      productMerchant(product),
      product?.category,
      product?.product_category,
      product?.product_type,
      product?.type,
      product?.tags,
      product?.description,
      product?.short_description,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/*
 * Core text wordt gebruikt voor categorieën en planner.
 *
 * De omschrijving wordt hier bewust niet meegenomen.
 * Zo zorgt een beschrijving waarin bijvoorbeeld "creatine"
 * staat er niet voor dat een whey-product automatisch
 * als creatine wordt ingedeeld.
 */

function productCoreText(product) {
  return normalize(
    [
      productName(product),
      productBrand(product),
      productMerchant(product),
      product?.category,
      product?.product_category,
      product?.product_type,
      product?.type,
      product?.tags,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function hasAny(text, words) {
  const value = normalize(text);

  return words.some((word) => {
    const needle = normalize(word);

    if (!needle) {
      return false;
    }

    if (needle.includes(" ")) {
      return value.includes(needle);
    }

    const escaped = needle.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    return new RegExp(
      `(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`,
      "i"
    ).test(value);
  });
}

/* =========================================================
   PRODUCT VALIDATION
   ========================================================= */

const BAD_WORDS = [
  "legging",
  "leggings",
  "t-shirt",
  "shirt",
  "hoodie",
  "shorts",
  "sokken",
  "socks",
  "schoenen",
  "shoes",
  "sportschoen",
  "sporttas",
  "tas",
  "gym bag",
  "waterfles",
  "bidon",
  "shaker",
  "beker",
  "handschoen",
  "handschoenen",
  "wrist wrap",
  "wrist wraps",
  "knee sleeve",
  "knee sleeves",
  "riem",
  "belt",
  "accessoire",
  "accessoires",
  "accessory",
  "accessories",
  "mat",
  "yogamat",
  "fitnessmat",
];

function isUsableProduct(product) {
  if (
    !product ||
    typeof product !== "object"
  ) {
    return false;
  }

  const name =
    productName(product);

  if (
    !name ||
    name.length < 2
  ) {
    return false;
  }

  const url =
    productUrl(product);

  if (!url) {
    return false;
  }

  const p =
    price(product);

  if (
    !Number.isFinite(p) ||
    p <= 0
  ) {
    return false;
  }

  const text =
    productSearchText(product);

  if (
    BAD_WORDS.some((word) =>
      text.includes(
        normalize(word)
      )
    )
  ) {
    return false;
  }

  return true;
}

/* =========================================================
   EXCLUSIVE CATEGORY CLASSIFICATION
   ========================================================= */

const PRE_WORKOUT_WORDS = [
  "pre workout",
  "pre-workout",
  "preworkout",
  "pre workout powder",
  "pre-workout powder",
  "preworkout powder",
  "pre workout drink",
  "pre-workout drink",
];

const CREATINE_WORDS = [
  "creatine",
  "creatine monohydraat",
  "creatine monohydrate",
  "creatine hcl",
  "creatine hydrochloride",
  "creatine kre-alkalyn",
];

const PROTEIN_WORDS = [
  "whey",
  "whey protein",
  "whey-protein",
  "protein powder",
  "proteine poeder",
  "protein",
  "proteine",
  "casein",
  "caseine",
  "casein protein",
  "caseine protein",
  "isolate",
  "isolaat",
  "whey isolate",
  "whey isolaat",
  "clear whey",
  "clear protein",
  "hydro whey",
  "hydrolyzed whey",
  "hydrolysate whey",
];

const PROTEIN_EXCLUSIONS = [
  "protein bar",
  "proteinbar",
  "proteine reep",
  "protein reep",
  "protein cookie",
  "protein koek",
  "protein snack",
  "protein brownie",
  "protein chips",
  "protein chips",
  "mass gainer",
  "mass-gainer",
  "weight gainer",
  "weight-gainer",
  "mega gainer",
  "gainer",
];

const GENERAL_SUPPLEMENT_WORDS = [
  "vitamin",
  "vitamine",
  "multivitamin",
  "multivitamine",
  "mineral",
  "mineralen",
  "magnesium",
  "zinc",
  "zink",
  "omega",
  "omega 3",
  "omega-3",
  "fish oil",
  "visolie",
  "ashwagandha",
  "ashwaganda",
  "rhodiola",
  "adaptogen",
  "electrolyte",
  "electrolytes",
  "electrolyten",
  "collagen",
  "collageen",
  "collagen peptides",
  "glucosamine",
  "chondroitin",
  "joint support",
  "gewricht",
  "gewrichten",
  "probiotic",
  "probiotics",
  "probioticum",
  "digestive enzyme",
  "digestive enzymes",
  "spijsvertering",
  "enzym",
  "enzymes",
  "fiber",
  "vezel",
  "melatonin",
  "melatonine",
  "sleep support",
  "slaap",
  "zma",
  "b12",
  "vitamin b12",
  "d3",
  "vitamin d3",
  "vitamine d3",
  "iron",
  "ijzer",
  "calcium",
  "potassium",
  "kalium",
  "sodium",
  "natrium",
  "beta alanine",
  "beta-alanine",
  "citrulline",
  "citrulline malate",
  "arginine",
  "bcaa",
  "eaa",
  "amino acid",
  "amino acids",
  "aminozuur",
  "aminozuren",
  "carnitine",
  "l-carnitine",
  "cla",
  "caffeine",
  "cafeine",
  "fat burner",
  "fatburner",
  "thermogenic",
  "thermogenic fat burner",
];

function isPreWorkoutProduct(productOrText) {
  const text =
    typeof productOrText === "string"
      ? normalize(productOrText)
      : productCoreText(productOrText);

  return hasAny(
    text,
    PRE_WORKOUT_WORDS
  );
}

function isCreatineProduct(productOrText) {
  const text =
    typeof productOrText === "string"
      ? normalize(productOrText)
      : productCoreText(productOrText);

  return hasAny(
    text,
    CREATINE_WORDS
  );
}

function isProteinProduct(productOrText) {
  const text =
    typeof productOrText === "string"
      ? normalize(productOrText)
      : productCoreText(productOrText);

  if (
    hasAny(
      text,
      PROTEIN_EXCLUSIONS
    )
  ) {
    return false;
  }

  return hasAny(
    text,
    PROTEIN_WORDS
  );
}

function isGeneralSupplementProduct(product) {
  const core =
    productCoreText(product);

  const feedCategory =
    normalize(
      [
        product?.category,
        product?.product_category,
        product?.product_type,
        product?.type,
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (
    hasAny(
      feedCategory,
      [
        "supplement",
        "supplements",
        "supplementen",
        "voedingssupplement",
        "voedingssupplementen",
        "nutrition supplement",
      ]
    )
  ) {
    return true;
  }

  return hasAny(
    core,
    GENERAL_SUPPLEMENT_WORDS
  );
}

/*
 * BELANGRIJK:
 *
 * Een product krijgt exact één categorie.
 *
 * 1. Pre-workout
 * 2. Creatine
 * 3. Proteïne
 * 4. Supplementen
 * 5. Overig
 */

function getProductCategory(product) {
  if (
    isPreWorkoutProduct(product)
  ) {
    return "pre-workout";
  }

  if (
    isCreatineProduct(product)
  ) {
    return "creatine";
  }

  if (
    isProteinProduct(product)
  ) {
    return "proteine";
  }

  if (
    isGeneralSupplementProduct(product)
  ) {
    return "supplementen";
  }

  return "overig";
}

function matchesCategory(
  product,
  category
) {
  const wanted =
    normalizeCategory(category);

  if (!wanted) {
    return true;
  }

  return (
    getProductCategory(product) ===
    wanted
  );
}

/* =========================================================
   SEARCH
   ========================================================= */

function matchesSearch(
  product,
  query
) {
  const q =
    normalize(query);

  if (!q) {
    return true;
  }

  const text =
    productSearchText(product);

  return q
    .split(" ")
    .filter(Boolean)
    .every((part) =>
      text.includes(part)
    );
}

/* =========================================================
   GOAL SCORING
   ========================================================= */

const CUT_WORDS = [
  "cut",
  "cutting",
  "fat loss",
  "fat-loss",
  "weight loss",
  "weight-loss",
  "shred",
  "shredding",
  "burn",
  "fat burner",
  "fatburner",
  "thermogenic",
  "carnitine",
  "l-carnitine",
  "cla",
];

const BULK_WORDS = [
  "bulk",
  "bulking",
  "mass",
  "mass gainer",
  "mass-gainer",
  "weight gainer",
  "weight-gainer",
  "gainer",
  "carb",
  "carbs",
  "carbohydrate",
  "carbohydrates",
  "maltodextrin",
  "dextrose",
  "oats",
  "oat",
  "havermout",
];

const LEAN_BULK_WORDS = [
  "lean bulk",
  "lean-bulk",
  "lean mass",
  "lean-mass",
  "muscle",
  "muscle growth",
  "spiergroei",
  "spiermassa",
];

function goalScore(
  product,
  goal
) {
  const normalizedGoal =
    normalizeGoal(goal);

  if (!normalizedGoal) {
    return 0;
  }

  const text =
    productSearchText(product);

  if (
    normalizedGoal === "cut"
  ) {
    if (
      hasAny(
        text,
        [
          "mass gainer",
          "mass-gainer",
          "weight gainer",
          "weight-gainer",
          "gainer",
        ]
      )
    ) {
      return 0;
    }

    if (
      hasAny(
        text,
        [
          "maltodextrin",
          "dextrose",
          "carbohydrate",
          "carbohydrates",
        ]
      )
    ) {
      return 0;
    }

    if (
      hasAny(
        text,
        CUT_WORDS
      )
    ) {
      return 10;
    }

    return 0;
  }

  if (
    normalizedGoal === "bulk"
  ) {
    if (
      hasAny(
        text,
        [
          "fat burner",
          "fatburner",
          "thermogenic",
          "shred",
        ]
      )
    ) {
      return 0;
    }

    if (
      hasAny(
        text,
        BULK_WORDS
      )
    ) {
      return 10;
    }

    return 0;
  }

  if (
    normalizedGoal === "lean-bulk"
  ) {
    if (
      hasAny(
        text,
        [
          "mass gainer",
          "mass-gainer",
          "weight gainer",
          "weight-gainer",
          "fat burner",
          "fatburner",
          "thermogenic",
        ]
      )
    ) {
      return 0;
    }

    if (
      hasAny(
        text,
        LEAN_BULK_WORDS
      )
    ) {
      return 10;
    }

    return 0;
  }

  return 0;
}

/* =========================================================
   STRICT PLANNER CLASSIFICATION
   ========================================================= */

const GAINER_WORDS = [
  "mass gainer",
  "mass-gainer",
  "weight gainer",
  "weight-gainer",
  "mega gainer",
  "gainer",
];

const CARB_WORDS = [
  "carb",
  "carbs",
  "carbohydrate",
  "carbohydrates",
  "maltodextrin",
  "dextrose",
  "oats",
  "oat",
  "havermout",
];

const CUT_SUPPORT_WORDS = [
  "fat burner",
  "fatburner",
  "thermogenic",
  "carnitine",
  "l-carnitine",
  "cla",
  "shred",
  "burn",
];

const PLANNER_EXCLUDED_WORDS = [
  "collagen",
  "collageen",
  "vitamin",
  "vitamine",
  "multivitamin",
  "multivitamine",
  "omega",
  "fish oil",
  "visolie",
  "joint support",
  "probiotic",
  "melatonin",
  "melatonine",
];

function plannerCoreText(product) {
  return productCoreText(product);
}

function isGainerProduct(product) {
  return hasAny(
    plannerCoreText(product),
    GAINER_WORDS
  );
}

function isCarbProduct(product) {
  const text =
    plannerCoreText(product);

  if (
    isGainerProduct(product)
  ) {
    return true;
  }

  return hasAny(
    text,
    CARB_WORDS
  );
}

function isCutSupportProduct(product) {
  return hasAny(
    plannerCoreText(product),
    CUT_SUPPORT_WORDS
  );
}

function isPlannerProtein(product) {
  return isProteinProduct(product);
}

function isPlannerCreatine(product) {
  return isCreatineProduct(product);
}

function isPlannerExcluded(product) {
  return hasAny(
    plannerCoreText(product),
    PLANNER_EXCLUDED_WORDS
  );
}

/*
 * Bepaalt welke rol een product binnen het
 * geselecteerde doel mag hebben.
 *
 * CUT:
 *   protein
 *   cut-support
 *   creatine
 *
 * BULK:
 *   protein
 *   carb
 *   creatine
 *
 * LEAN BULK:
 *   protein
 *   carb
 *   creatine
 */

function packageRole(
  product,
  goal
) {
  const normalizedGoal =
    normalizeGoal(goal);

  if (
    !normalizedGoal ||
    !product
  ) {
    return "";
  }

  if (
    isPlannerExcluded(product)
  ) {
    return "";
  }

  /*
   * Pre-workout krijgt geen plannerrol.
   */
  if (
    isPreWorkoutProduct(product)
  ) {
    return "";
  }

  /*
   * Een gainer wordt ALTIJD als gainer
   * behandeld, ook wanneer het woord protein
   * in de productnaam staat.
   */

  if (
    isGainerProduct(product)
  ) {
    if (
      normalizedGoal === "bulk"
    ) {
      return "carb";
    }

    return "";
  }

  /* =========================
     CUT
     ========================= */

  if (
    normalizedGoal === "cut"
  ) {
    if (
      isCutSupportProduct(product)
    ) {
      return "cut-support";
    }

    if (
      isPlannerProtein(product)
    ) {
      return "protein";
    }

    if (
      isPlannerCreatine(product)
    ) {
      return "creatine";
    }

    return "";
  }

  /* =========================
     BULK
     ========================= */

  if (
    normalizedGoal === "bulk"
  ) {
    if (
      isPlannerProtein(product)
    ) {
      return "protein";
    }

    if (
      isCarbProduct(product)
    ) {
      return "carb";
    }

    if (
      isPlannerCreatine(product)
    ) {
      return "creatine";
    }

    return "";
  }

  /* =========================
     LEAN BULK
     ========================= */

  if (
    normalizedGoal === "lean-bulk"
  ) {
    if (
      isPlannerProtein(product)
    ) {
      return "protein";
    }

    if (
      isCarbProduct(product) &&
      !isGainerProduct(product)
    ) {
      return "carb";
    }

    if (
      isPlannerCreatine(product)
    ) {
      return "creatine";
    }

    return "";
  }

  return "";
}

/*
 * Strikte planner-score.
 *
 * Een product zonder geldige rol krijgt ALTIJD 0.
 */

function plannerProductScore(
  product,
  goal
) {
  const normalizedGoal =
    normalizeGoal(goal);

  if (
    !normalizedGoal ||
    !isUsableProduct(product)
  ) {
    return 0;
  }

  const role =
    packageRole(
      product,
      normalizedGoal
    );

  if (!role) {
    return 0;
  }

  let score = 0;

  if (
    role === "protein"
  ) {
    score += 100;
  }

  if (
    role === "creatine"
  ) {
    score += 80;
  }

  if (
    role === "carb"
  ) {
    score += 90;
  }

  if (
    role === "cut-support"
  ) {
    score += 90;
  }

  const p =
    price(product);

  /*
   * Kleine prijsvoorkeur.
   * Dit is GEEN budgetoptimalisatie.
   */

  if (
    p > 0 &&
    p <= 15
  ) {
    score += 8;
  } else if (
    p <= 25
  ) {
    score += 5;
  } else if (
    p <= 40
  ) {
    score += 2;
  }

  return score;
}

function plannerProductKey(
  product
) {
  const id =
    product?.id ??
    product?.product_id ??
    product?.sku ??
    "";

  if (
    String(id).trim()
  ) {
    return `id:${String(id).trim()}`;
  }

  return [
    productMerchant(product),
    productBrand(product),
    productName(product),
  ]
    .map(normalize)
    .join("|");
}

/* =========================================================
   FILTERING
   ========================================================= */

function applyFilters() {
  const query =
    state.search;

  state.filtered =
    state.products
      .filter(
        isUsableProduct
      )
      .filter(
        product =>
          matchesSearch(
            product,
            query
          )
      )
      .filter(
        product =>
          matchesCategory(
            product,
            state.category
          )
      );

  state.visibleCount =
    PRODUCTS_PER_VIEW;

  renderProducts();
  updateProductCount();
  updateLoadMore();
}

/* =========================================================
   PRODUCT LOADING
   ========================================================= */

async function fetchProductPage(
  offset = 0
) {
  const url =
    `${API_PRODUCTS}?limit=${PAGE_SIZE}` +
    `&offset=${offset}`;

  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers: {
          Accept:
            "application/json",
        },
        credentials:
          "same-origin",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Product API returned ${response.status}`
    );
  }

  const data =
    await response.json();

  if (
    Array.isArray(data)
  ) {
    return data;
  }

  if (
    Array.isArray(
      data.products
    )
  ) {
    return data.products;
  }

  if (
    Array.isArray(
      data.items
    )
  ) {
    return data.items;
  }

  return [];
}

async function loadProducts() {
  if (state.loading) {
    return;
  }

  state.loading = true;

  try {
    const allProducts = [];
    const seen = new Set();

    for (
      let offset = 0;
      offset < MAX_PRODUCTS;
      offset += PAGE_SIZE
    ) {
      const page =
        await fetchProductPage(
          offset
        );

      if (
        !page.length
      ) {
        break;
      }

      for (
        const product of page
      ) {
        if (!product) {
          continue;
        }

        const key =
          plannerProductKey(
            product
          );

        if (
          key &&
          seen.has(key)
        ) {
          continue;
        }

        if (key) {
          seen.add(key);
        }

        allProducts.push(
          product
        );
      }

      if (
        page.length <
        PAGE_SIZE
      ) {
        break;
      }
    }

    state.products =
      allProducts;

    applyFilters();
  } catch (error) {
    console.error(
      "FitDealFinder product loading failed:",
      error
    );

    state.products = [];
    state.filtered = [];

    renderProducts();

    const container =
      first(
        "#products",
        "#product-grid",
        ".product-grid",
        "[data-products]"
      );

    if (container) {
      container.innerHTML = `
        <div class="error-message">
          Producten konden niet worden geladen.
          Probeer de pagina opnieuw te openen.
        </div>
      `;
    }
  } finally {
    state.loading =
      false;
  }
}

/* =========================================================
   PRODUCT CARD
   ========================================================= */

function productCard(product) {
  const name =
    escapeHtml(
      productName(product)
    );

  const brand =
    escapeHtml(
      productBrand(product)
    );

  const merchant =
    escapeHtml(
      productMerchant(product)
    );

  const url =
    productUrl(product);

  const image =
    productImage(product);

  const productPrice =
    price(product);

  const category =
    getProductCategory(
      product
    );

  const categoryLabel =
    category === "proteine"
      ? "Proteïne"
      : category === "creatine"
      ? "Creatine"
      : category === "pre-workout"
      ? "Pre-workout"
      : category === "supplementen"
      ? "Supplementen"
      : "";

  const imageHtml =
    image
      ? `
        <div class="product-card__image-wrap">
          <img
            class="product-card__image"
            src="${escapeHtml(image)}"
            alt="${name}"
            loading="lazy"
            decoding="async"
          >
        </div>
      `
      : `
        <div class="product-card__image-wrap product-card__image-wrap--empty">
          <span>Geen afbeelding</span>
        </div>
      `;

  const brandHtml =
    brand
      ? `
        <div class="product-card__brand">
          ${brand}
        </div>
      `
      : "";

  const merchantHtml =
    merchant
      ? `
        <div class="product-card__merchant">
          ${merchant}
        </div>
      `
      : "";

  const categoryHtml =
    categoryLabel
      ? `
        <span class="product-card__category">
          ${categoryLabel}
        </span>
      `
      : "";

  const buttonHtml =
    url
      ? `
        <a
          class="product-card__button"
          href="${escapeHtml(url)}"
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          Bekijk bij winkel
        </a>
      `
      : "";

  return `
    <article
      class="product-card"
      data-product-id="${escapeHtml(
        product?.id ??
          product?.product_id ??
          product?.sku ??
          ""
      )}"
    >
      ${imageHtml}

      <div class="product-card__body">
        ${categoryHtml}

        ${brandHtml}

        <h3 class="product-card__title">
          ${name}
        </h3>

        ${merchantHtml}

        <div class="product-card__bottom">
          <strong class="product-card__price">
            ${money(productPrice)}
          </strong>

          ${buttonHtml}
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  const container =
    first(
      "#products",
      "#product-grid",
      ".product-grid",
      "[data-products]"
    );

  if (!container) {
    return;
  }

  const products =
    state.filtered.slice(
      0,
      state.visibleCount
    );

  if (
    !products.length
  ) {
    container.innerHTML = `
      <div class="empty-message">
        Geen producten gevonden.
      </div>
    `;

    return;
  }

  container.innerHTML =
    products
      .map(productCard)
      .join("");
}

function updateProductCount() {
  const elements =
    $all(
      "[data-product-count], #product-count, .product-count"
    );

  for (
    const element of elements
  ) {
    element.textContent =
      String(
        state.filtered.length
      );
  }
}

function updateLoadMore() {
  const button =
    first(
      "#load-more",
      "[data-load-more]",
      ".load-more"
    );

  if (!button) {
    return;
  }

  if (
    state.visibleCount >=
    state.filtered.length
  ) {
    button.hidden = true;
    return;
  }

  button.hidden = false;
}

function loadMoreProducts() {
  state.visibleCount +=
    PRODUCTS_PER_VIEW;

  renderProducts();
  updateLoadMore();
}

/* =========================================================
   SEARCH SETUP
   ========================================================= */

function setupSearch() {
  const form =
    first(
      "#search-form",
      "[data-search-form]",
      "form.search-form"
    );

  const input =
    first(
      "#search",
      "#search-input",
      "[data-search-input]",
      'input[type="search"]'
    );

  if (!input) {
    return;
  }

  const runSearch = () => {
    state.search =
      input.value.trim();

    /*
     * Een zoekopdracht zoekt altijd
     * door de volledige catalogus.
     */

    state.category = "";

    $all(
      "[data-category]"
    ).forEach(
      button => {
        button.classList.remove(
          "active"
        );

        button.setAttribute(
          "aria-pressed",
          "false"
        );
      }
    );

    applyFilters();

    scrollToDeals();
  };

  if (form) {
    form.addEventListener(
      "submit",
      event => {
        event.preventDefault();
        runSearch();
      }
    );
  }

  input.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter"
      ) {
        event.preventDefault();
        runSearch();
      }
    }
  );

  input.addEventListener(
    "input",
    () => {
      state.search =
        input.value.trim();

      if (
        state.search
      ) {
        state.category = "";

        $all(
          "[data-category]"
        ).forEach(
          button => {
            button.classList.remove(
              "active"
            );

            button.setAttribute(
              "aria-pressed",
              "false"
            );
          }
        );
      }

      applyFilters();
    }
  );
}

/* =========================================================
   CATEGORY SETUP
   ========================================================= */

function setupCategories() {
  const buttons =
    $all(
      "[data-category]"
    );

  for (
    const button of buttons
  ) {
    button.addEventListener(
      "click",
      () => {
        const category =
          normalizeCategory(
            button.dataset.category
          );

        state.search = "";
        state.category =
          category;

        const input =
          first(
            "#search",
            "#search-input",
            "[data-search-input]",
            'input[type="search"]'
          );

        if (input) {
          input.value = "";
        }

        buttons.forEach(
          item => {
            const active =
              normalizeCategory(
                item.dataset.category
              ) === category;

            item.classList.toggle(
              "active",
              active
            );

            item.setAttribute(
              "aria-pressed",
              active
                ? "true"
                : "false"
            );
          }
        );

        applyFilters();

        scrollToDeals();
      }
    );
  }
}

/* =========================================================
   GOAL BUTTONS
   ========================================================= */

function setupGoals() {
  const buttons =
    $all(
      "[data-goal]"
    );

  for (
    const button of buttons
  ) {
    button.addEventListener(
      "click",
      () => {
        const goal =
          normalizeGoal(
            button.dataset.goal
          );

        state.goal =
          goal;

        buttons.forEach(
          item => {
            const active =
              normalizeGoal(
                item.dataset.goal
              ) === goal;

            item.classList.toggle(
              "active",
              active
            );

            item.setAttribute(
              "aria-pressed",
              active
                ? "true"
                : "false"
            );
          }
        );

        /*
         * Doel verandert NIET de normale
         * productcategorieën.
         *
         * Het doel wordt alleen gebruikt
         * door de planner.
         */
      }
    );
  }
}

/* =========================================================
   SCROLL
   ========================================================= */

function scrollToDeals() {
  const target =
    first(
      "#deals",
      "#products",
      "#product-grid",
      ".products",
      "[data-products]"
    );

  if (!target) {
    return;
  }

  target.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

/* =========================================================
   SHOPPING PLANNER
   ========================================================= */

function createPlanner() {
  const form =
    first(
      "#shopping-planner",
      "#planner",
      "[data-shopping-planner]",
      "[data-planner]"
    );

  if (!form) {
    return;
  }

  const goalInput =
    first(
      "#planner-goal",
      "[name='goal']",
      "[data-planner-goal]",
      "select"
    );

  const budgetInput =
    first(
      "#planner-budget",
      "[name='budget']",
      "[data-planner-budget]"
    );

  const result =
    first(
      "#planner-results",
      "[data-planner-results]"
    );

  if (!result) {
    return;
  }

  const submit =
    first(
      "#planner-submit",
      "[data-planner-submit]"
    ) ||
    (
      form.tagName === "FORM"
        ? $(
            "button[type='submit']",
            form
          )
        : null
    );

  const run = () => {
    const selectedGoal =
      normalizeGoal(
        goalInput?.value ||
          state.goal ||
          ""
      );

    const maxBudget =
      Number(
        String(
          budgetInput?.value ??
            ""
        ).replace(",", ".")
      );

    if (
      !selectedGoal
    ) {
      result.innerHTML = `
        <div class="planner-message">
          Kies eerst een doel.
        </div>
      `;
      return;
    }

    if (
      !Number.isFinite(
        maxBudget
      ) ||
      maxBudget <= 0
    ) {
      result.innerHTML = `
        <div class="planner-message">
          Vul een geldig budget in.
        </div>
      `;
      return;
    }

    /*
     * Alleen producten met een rol voor
     * het gekozen doel worden kandidaten.
     *
     * Dit is de belangrijkste bescherming
     * tegen bulkproducten in een Cut-lijst.
     */

    const candidates =
      state.products
        .filter(
          isUsableProduct
        )
        .map(
          product => ({
            product,
            role:
              packageRole(
                product,
                selectedGoal
              ),
            score:
              plannerProductScore(
                product,
                selectedGoal
              ),
          })
        )
        .filter(
          item =>
            item.role &&
            item.score > 0
        )
        .sort(
          (a, b) => {
            if (
              b.score !==
              a.score
            ) {
              return (
                b.score -
                a.score
              );
            }

            return (
              price(a.product) -
              price(b.product)
            );
          }
        );

    /*
     * Geen knapzak-/combinatie-optimalisatie.
     *
     * We nemen gewoon de hoogst scorende
     * passende producten die nog binnen
     * het budget passen.
     */

    const seen =
      new Set();

    let shortlistTotal =
      0;

    const shortlist =
      [];

    for (
      const candidate of candidates
    ) {
      const product =
        candidate.product;

      const key =
        plannerProductKey(
          product
        );

      if (
        !key ||
        seen.has(key)
      ) {
        continue;
      }

      const productPrice =
        price(product);

      if (
        shortlistTotal +
          productPrice >
        maxBudget +
          0.001
      ) {
        continue;
      }

      seen.add(key);

      shortlistTotal +=
        productPrice;

      shortlist.push(
        candidate
      );

      if (
        shortlist.length >=
        5
      ) {
        break;
      }
    }

    if (
      !shortlist.length
    ) {
      result.innerHTML = `
        <div class="planner-message">
          Geen passende producten gevonden
          binnen dit budget voor
          <strong>${escapeHtml(
            selectedGoal
          )}</strong>.
        </div>
      `;

      return;
    }

    const cards =
      shortlist
        .map(
          candidate => {
            const product =
              candidate.product;

            const name =
              escapeHtml(
                productName(
                  product
                )
              );

            const merchant =
              escapeHtml(
                productMerchant(
                  product
                )
              );

            const productUrlValue =
              productUrl(
                product
              );

            const productPrice =
              price(product);

            const reason =
              plannerProductReason(
                product,
                selectedGoal
              );

            return `
              <article class="planner-product">

                <div class="planner-product__info">
                  <strong>
                    ${name}
                  </strong>

                  ${
                    merchant
                      ? `
                        <span>
                          ${merchant}
                        </span>
                      `
                      : ""
                  }

                  ${
                    reason
                      ? `
                        <small>
                          ${escapeHtml(
                            reason
                          )}
                        </small>
                      `
                      : ""
                  }
                </div>

                <div class="planner-product__price">
                  ${money(
                    productPrice
                  )}
                </div>

                ${
                  productUrlValue
                    ? `
                      <a
                        href="${escapeHtml(
                          productUrlValue
                        )}"
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                      >
                        Bekijk
                      </a>
                    `
                    : ""
                }

              </article>
            `;
          }
        )
        .join("");

    result.innerHTML = `
      <div class="planner-summary">

        <strong>
          ${escapeHtml(
            selectedGoal
          )}
        </strong>

        <span>
          ${money(
            shortlistTotal
          )}
          van
          ${money(
            maxBudget
          )}
        </span>

      </div>

      <div class="planner-products">
        ${cards}
      </div>
    `;
  };

  if (submit) {
    submit.addEventListener(
      "click",
      event => {
        if (
          form.tagName ===
          "FORM"
        ) {
          return;
        }

        event.preventDefault();
        run();
      }
    );
  }

  if (
    form.tagName ===
    "FORM"
  ) {
    form.addEventListener(
      "submit",
      event => {
        event.preventDefault();
        run();
      }
    );
  }
}

/* =========================================================
   AI HELPERS
   ========================================================= */

function renderAIText(
  value
) {
  const text =
    String(value ?? "");

  return escapeHtml(text)
    .replace(
      /\*\*(.+?)\*\*/g,
      "<strong>$1</strong>"
    )
    .replace(
      /\n/g,
      "<br>"
    );
}

function detectProductType(
  query
) {
  const text =
    normalize(query);

  if (
    hasAny(
      text,
      [
        "pre workout",
        "pre-workout",
        "preworkout",
      ]
    )
  ) {
    return "pre-workout";
  }

  if (
    hasAny(
      text,
      [
        "creatine",
        "creatine monohydraat",
        "creatine monohydrate",
      ]
    )
  ) {
    return "creatine";
  }

  if (
    hasAny(
      text,
      [
        "whey",
        "protein",
        "proteine",
        "casein",
        "caseine",
        "isolate",
        "isolaat",
      ]
    )
  ) {
    return "proteine";
  }

  if (
    hasAny(
      text,
      [
        "vitamine",
        "vitamin",
        "magnesium",
        "zink",
        "zinc",
        "omega",
        "electrolytes",
        "electrolyten",
        "carnitine",
        "caffeine",
        "cafeine",
        "collagen",
        "collageen",
      ]
    )
  ) {
    return "supplementen";
  }

  return "";
}

function findAIProducts(
  query,
  limit = 8
) {
  const text =
    normalize(query);

  if (!text) {
    return [];
  }

  const productType =
    detectProductType(
      text
    );

  const words =
    text
      .split(/\s+/)
      .filter(
        word =>
          word.length >= 3
      );

  const scored =
    [];

  for (
    const product of state.products
  ) {
    if (
      !isUsableProduct(
        product
      )
    ) {
      continue;
    }

    const searchable =
      productSearchText(
        product
      );

    const category =
      getProductCategory(
        product
      );

    let score = 0;

    /*
     * Als de gebruiker expliciet om een
     * producttype vraagt, krijgt exact die
     * categorie voorrang.
     */

    if (
      productType &&
      category ===
        productType
    ) {
      score += 100;
    }

    /*
     * Exacte zoekterm krijgt extra punten.
     */

    if (
      searchable.includes(
        text
      )
    ) {
      score += 50;
    }

    for (
      const word of words
    ) {
      if (
        searchable.includes(
          word
        )
      ) {
        score += 10;
      }
    }

    if (
      score > 0
    ) {
      scored.push({
        product,
        score,
      });
    }
  }

  return scored
    .sort(
      (a, b) => {
        if (
          b.score !==
          a.score
        ) {
          return (
            b.score -
            a.score
          );
        }

        return (
          price(a.product) -
          price(b.product)
        );
      }
    )
    .slice(
      0,
      limit
    )
    .map(
      item =>
        item.product
    );
}

function renderAIProductResults(
  products,
  container
) {
  if (!container) {
    return;
  }

  if (
    !products.length
  ) {
    container.innerHTML = `
      <div class="ai-message">
        Geen passende producten gevonden.
      </div>
    `;

    return;
  }

  container.innerHTML =
    products
      .map(
        product => {
          const name =
            escapeHtml(
              productName(
                product
              )
            );

          const merchant =
            escapeHtml(
              productMerchant(
                product
              )
            );

          const url =
            productUrl(
              product
            );

          const productPrice =
            price(product);

          return `
            <article class="ai-product">

              <div>
                <strong>
                  ${name}
                </strong>

                ${
                  merchant
                    ? `
                      <small>
                        ${merchant}
                      </small>
                    `
                    : ""
                }
              </div>

              <strong>
                ${money(
                  productPrice
                )}
              </strong>

              ${
                url
                  ? `
                    <a
                      href="${escapeHtml(
                        url
                      )}"
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      Bekijk
                    </a>
                  `
                  : ""
              }

            </article>
          `;
        }
      )
      .join("");
}

/* =========================================================
   AI REQUEST
   ========================================================= */

async function askAI(
  message
) {
  const response =
    await fetch(
      API_AI,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Accept:
            "application/json",
        },
        credentials:
          "same-origin",
        body:
          JSON.stringify({
            message:
              String(
                message || ""
              ).slice(
                0,
                4000
              ),
          }),
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (
    !response.ok
  ) {
    throw new Error(
      data?.error ||
        `AI request failed: ${response.status}`
    );
  }

  return (
    data?.answer ||
    data?.message ||
    data?.text ||
    ""
  );
}

/* =========================================================
   AI SETUP
   ========================================================= */

function setupAI() {
  const form =
    first(
      "#ai-form",
      "[data-ai-form]"
    );

  const input =
    first(
      "#ai-input",
      "#ai-message",
      "[data-ai-input]",
      "textarea"
    );

  const output =
    first(
      "#ai-output",
      "[data-ai-output]"
    );

  const productResults =
    first(
      "#ai-product-results",
      "[data-ai-product-results]"
    );

  if (!input) {
    return;
  }

  const submit =
    first(
      "#ai-submit",
      "[data-ai-submit]"
    ) ||
    (
      form
        ? $(
            "button[type='submit']",
            form
          )
        : null
    );

  const run =
    async () => {
      const message =
        input.value.trim();

      if (!message) {
        return;
      }

      /*
       * Eerst zoeken in de eigen catalogus.
       */

      const localProducts =
        findAIProducts(
          message,
          8
        );

      if (
        localProducts.length &&
        productResults
      ) {
        renderAIProductResults(
          localProducts,
          productResults
        );
      }

      if (output) {
        output.innerHTML = `
          <div class="ai-loading">
            Even zoeken...
          </div>
        `;
      }

      if (submit) {
        submit.disabled =
          true;
      }

      try {
        const normalized =
          normalize(message);

        const detectedGoal =
          normalizeGoal(
            normalized
          );

        const budgetMatch =
          normalized.match(
            /(?:€|eur|euro)\s*(\d+(?:[.,]\d+)?)/
          );

        const budget =
          budgetMatch
            ? Number(
                budgetMatch[1]
                  .replace(
                    ",",
                    "."
                  )
              )
            : 0;

        /*
         * Exacte boodschappenlijst-aanvragen
         * worden lokaal afgehandeld.
         */

        if (
          detectedGoal &&
          budget > 0 &&
          hasAny(
            normalized,
            [
              "boodschappenlijst",
              "shopping list",
              "lijst",
              "pakket",
              "pakketje",
              "producten voor",
              "producten onder",
              "budget",
            ]
          )
        ) {
          const packageItems =
            buildGoalPackage(
              detectedGoal,
              budget
            );

          if (
            packageItems.length &&
            output
          ) {
            renderGoalPackage(
              packageItems,
              detectedGoal,
              budget,
              output
            );

            return;
          }
        }

        const answer =
          await askAI(
            message
          );

        if (output) {
          output.innerHTML =
            renderAIText(
              answer
            );
        }
      } catch (
        error
      ) {
        console.error(
          "AI request failed:",
          error
        );

        if (output) {
          output.innerHTML = `
            <div class="ai-error">
              Er ging iets mis.
              Probeer het opnieuw.
            </div>
          `;
        }
      } finally {
        if (submit) {
          submit.disabled =
            false;
        }
      }
    };

  if (form) {
    form.addEventListener(
      "submit",
      event => {
        event.preventDefault();
        run();
      }
    );
  } else if (submit) {
    submit.addEventListener(
      "click",
      event => {
        event.preventDefault();
        run();
      }
    );
  }
}

/* =========================================================
   AI GOAL PACKAGE
   ========================================================= */

function buildGoalPackage(
  goal,
  budget
) {
  const selectedGoal =
    normalizeGoal(
      goal
    );

  if (
    !selectedGoal ||
    !Number.isFinite(
      budget
    ) ||
    budget <= 0
  ) {
    return [];
  }

  /*
   * Alleen kandidaten met een rol binnen
   * het gekozen doel.
   */

  const candidates =
    state.products
      .filter(
        isUsableProduct
      )
      .map(
        product => ({
          product,
          role:
            packageRole(
              product,
              selectedGoal
            ),
          score:
            plannerProductScore(
              product,
              selectedGoal
            ),
        })
      )
      .filter(
        item =>
          item.role &&
          item.score > 0
      )
      .sort(
        (a, b) => {
          if (
            b.score !==
            a.score
          ) {
            return (
              b.score -
              a.score
            );
          }

          return (
            price(a.product) -
            price(b.product)
          );
        }
      );

  /*
   * Rollen per doel.
   */

  const roleOrder =
    selectedGoal ===
    "cut"
      ? [
          "protein",
          "cut-support",
          "creatine",
        ]
      : selectedGoal ===
        "bulk"
      ? [
          "protein",
          "carb",
          "creatine",
        ]
      : [
          "protein",
          "creatine",
          "carb",
        ];

  const selected =
    [];

  const used =
    new Set();

  let total = 0;

  /*
   * Eerst proberen we één product
   * per relevante rol te pakken.
   */

  for (
    const role of roleOrder
  ) {
    const candidate =
      candidates.find(
        item => {
          if (
            item.role !==
            role
          ) {
            return false;
          }

          const key =
            plannerProductKey(
              item.product
            );

          if (
            !key ||
            used.has(key)
          ) {
            return false;
          }

          return (
            total +
              price(
                item.product
              ) <=
            budget +
              0.001
          );
        }
      );

    if (
      !candidate
    ) {
      continue;
    }

    const key =
      plannerProductKey(
        candidate.product
      );

    if (!key) {
      continue;
    }

    used.add(key);

    total +=
      price(
        candidate.product
      );

    selected.push(
      candidate
    );

    if (
      selected.length >=
      3
    ) {
      break;
    }
  }

  /*
   * Daarna eventueel extra producten.
   *
   * Nog steeds uitsluitend uit het
   * geselecteerde doel.
   */

  if (
    selected.length < 5
  ) {
    for (
      const candidate of candidates
    ) {
      const key =
        plannerProductKey(
          candidate.product
        );

      if (
        !key ||
        used.has(key)
      ) {
        continue;
      }

      const p =
        price(
          candidate.product
        );

      if (
        total + p >
        budget +
          0.001
      ) {
        continue;
      }

      used.add(key);

      total += p;

      selected.push(
        candidate
      );

      if (
        selected.length >=
        5
      ) {
        break;
      }
    }
  }

  return selected;
}

function renderGoalPackage(
  items,
  goal,
  budget,
  output
) {
  let total = 0;

  const html =
    items
      .map(
        item => {
          const product =
            item.product;

          const p =
            price(product);

          total += p;

          const name =
            escapeHtml(
              productName(
                product
              )
            );

          const merchant =
            escapeHtml(
              productMerchant(
                product
              )
            );

          const reason =
            escapeHtml(
              plannerProductReason(
                product,
                goal
              )
            );

          const url =
            productUrl(
              product
            );

          return `
            <article class="ai-product">

              <div>
                <strong>
                  ${name}
                </strong>

                ${
                  merchant
                    ? `
                      <small>
                        ${merchant}
                      </small>
                    `
                    : ""
                }

                ${
                  reason
                    ? `
                      <small>
                        ${reason}
                      </small>
                    `
                    : ""
                }
              </div>

              <strong>
                ${money(p)}
              </strong>

              ${
                url
                  ? `
                    <a
                      href="${escapeHtml(
                        url
                      )}"
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      Bekijk
                    </a>
                  `
                  : ""
              }

            </article>
          `;
        }
      )
      .join("");

  output.innerHTML = `
    <div class="ai-package">

      <div class="ai-package__summary">

        <strong>
          ${escapeHtml(
            goal
          )}
        </strong>

        <span>
          ${money(total)}
          van
          ${money(budget)}
        </span>

      </div>

      <div class="ai-package__products">
        ${html}
      </div>

    </div>
  `;
}

/* =========================================================
   DEAL TRACKING
   ========================================================= */

function setupDealTracking() {
  document.addEventListener(
    "click",
    event => {
      const link =
        event.target.closest(
          "a[href]"
        );

      if (!link) {
        return;
      }

      const href =
        link.getAttribute(
          "href"
        );

      if (!href) {
        return;
      }

      /*
       * Client-side event.
       * Er wordt hier niets naar de server geschreven.
       */

      if (
        link.closest(
          ".product-card, .planner-product, .ai-product"
        )
      ) {
        try {
          window.dispatchEvent(
            new CustomEvent(
              "fitdealfinder:deal-click",
              {
                detail: {
                  url: href,
                },
              }
            )
          );
        } catch {
          /* no-op */
        }
      }
    }
  );
}

/* =========================================================
   KEYBOARD
   ========================================================= */

function setupKeyboard() {
  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      const target =
        event.target;

      if (
        target &&
        (
          target.matches?.(
            "input, textarea, select"
          ) ||
          target.isContentEditable
        )
      ) {
        return;
      }

      const input =
        first(
          "#search",
          "#search-input",
          "[data-search-input]",
          'input[type="search"]'
        );

      if (!input) {
        return;
      }

      event.preventDefault();
      input.focus();
    }
  );
}

/* =========================================================
   LOAD MORE SETUP
   ========================================================= */

function setupLoadMore() {
  const button =
    first(
      "#load-more",
      "[data-load-more]",
      ".load-more"
    );

  if (!button) {
    return;
  }

  button.addEventListener(
    "click",
    event => {
      event.preventDefault();
      loadMoreProducts();
    }
  );
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

function init() {
  setupSearch();
  setupCategories();
  setupGoals();
  setupLoadMore();
  setupAI();
  setupDealTracking();
  setupKeyboard();
  createPlanner();

  loadProducts();
}

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    init,
    { once: true }
  );
} else {
  init();
         }
