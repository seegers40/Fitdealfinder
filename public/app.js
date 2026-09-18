"use strict";

/*
 * FitDealFinder.nl
 * Frontend application
 *
 * FitDealFinder is GEEN webshop.
 * Alle productlinks gaan naar de betreffende winkel.
 */

const API_PRODUCTS = "/api/products";
const API_AI = "/api/ai/chat";

const PAGE_SIZE = 200;
const MAX_PRODUCTS = 2000;
const PRODUCTS_PER_VIEW = 8;

/*
 * Maximaal aantal seconden dat één API-request mag duren.
 * Zo kan de pagina nooit eindeloos op "Deals laden..." blijven staan.
 */
const API_TIMEOUT_MS = 15000;

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

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return [...document.querySelectorAll(selector)];
}

function first(...selectors) {
  for (const selector of selectors) {
    const element = $(selector);

    if (element) {
      return element;
    }
  }

  return null;
}

/* =========================================================
   GENERAL HELPERS
========================================================= */

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
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
  const value = Number(product?.price);

  return Number.isFinite(value) ? value : 0;
}

function money(value, currency = "EUR") {
  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: currency || "EUR",
    }).format(Number(value) || 0);
  } catch {
    return `€ ${Number(value || 0)
      .toFixed(2)
      .replace(".", ",")}`;
  }
}

function scrollToDeals() {
  const deals = $("#deals");

  if (deals) {
    deals.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
}

/* =========================================================
   SAFE AI TEXT
========================================================= */

function renderAIText(value) {
  let text = String(value ?? "");

  text = escapeHtml(text);

  const links = [];

  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi,
    (match, label, url) => {
      const safeUrl = safeHttpUrl(url);

      if (!safeUrl) {
        return label;
      }

      const index = links.length;

      links.push(`
        <a
          href="${escapeHtml(safeUrl)}"
          target="_blank"
          rel="noopener noreferrer nofollow"
          class="ai-inline-link"
        >${label}</a>
      `);

      return `___FITDEAL_LINK_${index}___`;
    }
  );

  text = text.replace(
    /\*\*([^*]+)\*\*/g,
    "<strong>$1</strong>"
  );

  text = text.replace(
    /(^|[\s>])(https?:\/\/[^\s<]+)/gi,
    (match, prefix, url) => {
      const cleanUrl = url.replace(
        /[.,!?;:]+$/,
        ""
      );

      const trailing =
        url.slice(cleanUrl.length);

      const safeUrl =
        safeHttpUrl(cleanUrl);

      if (!safeUrl) {
        return match;
      }

      const index = links.length;

      links.push(`
        <a
          href="${escapeHtml(safeUrl)}"
          target="_blank"
          rel="noopener noreferrer nofollow"
          class="ai-inline-link"
        >${escapeHtml(cleanUrl)}</a>
      `);

      return (
        `${prefix}` +
        `___FITDEAL_LINK_${index}___` +
        `${escapeHtml(trailing)}`
      );
    }
  );

  text = text.replace(
    /\n/g,
    "<br>"
  );

  links.forEach((html, index) => {
    text = text.replace(
      `___FITDEAL_LINK_${index}___`,
      html
    );
  });

  return text;
}

/* =========================================================
   WORD HELPERS
========================================================= */

function hasAny(text, words) {
  const normalizedText = normalize(text);

  return words.some((word) => {
    const normalizedWord =
      normalize(word);

    if (!normalizedWord) {
      return false;
    }

    if (normalizedWord.includes(" ")) {
      return normalizedText.includes(
        normalizedWord
      );
    }

    const escaped =
      normalizedWord.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const regex = new RegExp(
      `(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`,
      "i"
    );

    return regex.test(normalizedText);
  });
}

/* =========================================================
   PRODUCT TEXT
========================================================= */

function productText(product) {
  return normalize(
    [
      product?.name,
      product?.brand,
      product?.merchant_name,
      product?.category,
      product?.product_category,
      product?.product_type,
      product?.type,
      product?.description,
      Array.isArray(product?.goals)
        ? product.goals.join(" ")
        : product?.goals,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function productIdentityText(product) {
  return normalize(
    [
      product?.name,
      product?.brand,
      product?.category,
      product?.product_category,
      product?.product_type,
      product?.type,
      Array.isArray(product?.tags)
        ? product.tags.join(" ")
        : product?.tags,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function productClassificationText(product) {
  return normalize(
    [
      product?.name,
      product?.category,
      product?.product_category,
      product?.product_type,
      product?.type,
      Array.isArray(product?.tags)
        ? product.tags.join(" ")
        : product?.tags,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/* =========================================================
   PRODUCT VALIDATION
========================================================= */

const BAD_WORDS = [
  "drinkbeker",
  "shaker",
  "shaker cup",
  "waterfles",
  "water bottle",
  "bidon",
  "kleding",
  "shirt",
  "t-shirt",
  "broek",
  "shorts",
  "legging",
  "hoodie",
  "pet",
  "accessoire",
  "accessories",
  "voedingsschema",
  "voedingsplan",
  "meal plan",
  "dieetplan",
  "ebook",
  "e-book",
  "receptenboek",
];

function isUsableProduct(product) {
  if (!product) {
    return false;
  }

  if (!product.id) {
    return false;
  }

  if (!product.name) {
    return false;
  }

  if (
    !product.product_url &&
    !product.affiliate_url
  ) {
    return false;
  }

  const text =
    productIdentityText(product);

  return !BAD_WORDS.some((word) =>
    text.includes(normalize(word))
  );
}

/* =========================================================
   EXCLUSIVE PRODUCT CATEGORIES
========================================================= */

const PRE_WORKOUT_WORDS = [
  "pre workout",
  "pre-workout",
  "preworkout",
  "pre workout powder",
  "pre-workout powder",
  "preworkout powder",
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
  "whey protein",
  "whey-protein",
  "whey",
  "protein powder",
  "proteine poeder",
  "protein",
  "proteine",
  "casein protein",
  "caseine protein",
  "casein",
  "caseine",
  "whey isolate",
  "whey-isolate",
  "clear whey",
  "clear protein",
  "hydro whey",
  "hydrolyzed whey",
  "hydrolysate whey",
  "isolate",
  "isolaat",
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
  "elektrolyten",
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
];

const SUPPLEMENT_CATEGORY_WORDS = [
  "supplement",
  "supplements",
  "supplementen",
  "voedingssupplement",
  "voedingssupplementen",
  "food supplement",
  "food supplements",
  "nutrition supplement",
];

const GAINER_WORDS = [
  "mass gainer",
  "mass-gainer",
  "weight gainer",
  "weight-gainer",
  "mega gainer",
  "gainer",
];

const PROTEIN_BAR_WORDS = [
  "protein bar",
  "proteinbar",
  "protein reep",
  "proteine reep",
  "proteinebar",
];

function isPreWorkoutProduct(product) {
  return hasAny(
    productClassificationText(product),
    PRE_WORKOUT_WORDS
  );
}

function isCreatineProduct(product) {
  return hasAny(
    productClassificationText(product),
    CREATINE_WORDS
  );
}

function isGainerProduct(product) {
  return hasAny(
    productClassificationText(product),
    GAINER_WORDS
  );
}

function isProteinProduct(product) {
  const text =
    productClassificationText(product);

  if (isGainerProduct(product)) {
    return false;
  }

  return hasAny(
    text,
    PROTEIN_WORDS
  );
}

function isGeneralSupplementProduct(product) {
  const text =
    productClassificationText(product);

  const structuredCategory =
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
      structuredCategory,
      SUPPLEMENT_CATEGORY_WORDS
    )
  ) {
    return true;
  }

  return hasAny(
    text,
    GENERAL_SUPPLEMENT_WORDS
  );
}

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
  if (!category) {
    return true;
  }

  const selected =
    normalize(category);

  const categoryMap = {
    whey: "proteine",
    protein: "proteine",
    proteine: "proteine",

    creatine: "creatine",

    preworkout: "pre-workout",
    "pre-workout": "pre-workout",

    vitamins: "supplementen",
    supplement: "supplementen",
    supplements: "supplementen",
    supplementen: "supplementen",
  };

  const normalizedCategory =
    categoryMap[selected] ||
    selected;

  return (
    getProductCategory(product) ===
    normalizedCategory
  );
}

/* =========================================================
   GOALS
========================================================= */

const CUT_STRONG_WORDS = [
  "fat burner",
  "fatburner",
  "thermogenic",
  "weight loss",
  "weight-loss",
  "gewichtsverlies",
  "afvallen",
  "l-carnitine",
  "carnitine",
];

const CUT_MEDIUM_WORDS = [
  "caffeine",
  "cafeine",
  "cla",
  "cut",
  "cutting",
  "shred",
];

const BULK_STRONG_WORDS = [
  "mass gainer",
  "mass-gainer",
  "weight gainer",
  "weight-gainer",
  "gainer",
];

const BULK_MEDIUM_WORDS = [
  "mass",
  "bulk",
  "bulking",
  "carb",
  "carbs",
  "carbohydrate",
  "carbohydrates",
  "havermout",
  "oats",
];

const BULK_SUPPORT_WORDS = [
  "protein",
  "proteine",
  "whey",
  "creatine",
];

const LEAN_BULK_STRONG_WORDS = [
  "whey isolate",
  "whey-isolate",
  "isolate",
  "isolaat",
  "casein",
  "caseine",
];

const LEAN_BULK_MEDIUM_WORDS = [
  "protein",
  "proteine",
  "whey",
  "creatine",
  "amino",
  "bcaa",
  "lean bulk",
  "lean-bulk",
  "lean mass",
];

function goalScore(
  product,
  goal
) {
  if (!isUsableProduct(product)) {
    return 0;
  }

  const text =
    productClassificationText(product);

  const normalizedGoal =
    normalize(goal);

  if (
    normalizedGoal === "cut"
  ) {
    if (
      hasAny(
        text,
        GAINER_WORDS
      )
    ) {
      return 0;
    }

    if (
      hasAny(
        text,
        CUT_STRONG_WORDS
      )
    ) {
      return 100;
    }

    if (
      hasAny(
        text,
        CUT_MEDIUM_WORDS
      )
    ) {
      return 80;
    }

    if (
      isProteinProduct(product) ||
      isCreatineProduct(product)
    ) {
      return 50;
    }

    return 0;
  }

  if (
    normalizedGoal === "bulk"
  ) {
    if (
      hasAny(
        text,
        CUT_STRONG_WORDS
      )
    ) {
      return 0;
    }

    if (
      hasAny(
        text,
        BULK_STRONG_WORDS
      )
    ) {
      return 120;
    }

    if (
      hasAny(
        text,
        BULK_MEDIUM_WORDS
      )
    ) {
      return 90;
    }

    if (
      hasAny(
        text,
        BULK_SUPPORT_WORDS
      )
    ) {
      return 40;
    }

    return 0;
  }

  if (
    normalizedGoal === "lean-bulk"
  ) {
    if (
      hasAny(
        text,
        GAINER_WORDS
      )
    ) {
      return 0;
    }

    if (
      hasAny(
        text,
        CUT_STRONG_WORDS
      )
    ) {
      return 0;
    }

    if (
      hasAny(
        text,
        LEAN_BULK_STRONG_WORDS
      )
    ) {
      return 110;
    }

    if (
      hasAny(
        text,
        LEAN_BULK_MEDIUM_WORDS
      )
    ) {
      return 80;
    }

    return 0;
  }

  return 0;
}

function matchesGoal(
  product,
  goal
) {
  if (!goal) {
    return true;
  }

  return (
    goalScore(
      product,
      goal
    ) > 0
  );
}

/* =========================================================
   SEARCH
========================================================= */

function matchesSearch(
  product,
  query
) {
  if (!query) {
    return true;
  }

  const words =
    normalize(query)
      .split(/\s+/)
      .filter(Boolean);

  const text =
    productText(product);

  return words.every((word) =>
    text.includes(word)
  );
}

/* =========================================================
   PRODUCT FILTER
========================================================= */

function applyFilters() {
  const query =
    normalize(state.search);

  state.filtered =
    state.products
      .filter(isUsableProduct)
      .filter((product) =>
        matchesSearch(
          product,
          query
        )
      )
      .filter((product) =>
        matchesCategory(
          product,
          state.category
        )
      );

  state.filtered.sort(
    (a, b) => {
      const scoreA =
        Number(a.deal_score) || 0;

      const scoreB =
        Number(b.deal_score) || 0;

      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }

      const discountA =
        Number(a.discount_percent) || 0;

      const discountB =
        Number(b.discount_percent) || 0;

      if (discountA !== discountB) {
        return discountB - discountA;
      }

      return price(a) - price(b);
    }
  );

  state.visibleCount =
    state.category
      ? state.filtered.length
      : PRODUCTS_PER_VIEW;

  renderProducts();
}

/* =========================================================
   FETCH WITH TIMEOUT
========================================================= */

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = API_TIMEOUT_MS
) {
  const controller =
    new AbortController();

  const timeoutId =
    setTimeout(() => {
      controller.abort();
    }, timeoutMs);

  try {
    return await fetch(
      url,
      {
        ...options,
        signal:
          controller.signal,
      }
    );
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        `Request timeout na ${Math.round(
          timeoutMs / 1000
        )} seconden.`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* =========================================================
   LOAD PRODUCTS
========================================================= */

async function loadProducts() {
  if (state.loading) {
    return;
  }

  state.loading = true;

  const grid =
    $("#products-grid");

  if (
    grid &&
    !state.products.length
  ) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>Deals laden...</h3>
        <p>
          We halen de actuele producten op.
        </p>
      </div>
    `;
  }

  const products = [];

  try {
    for (
      let offset = 0;
      offset < MAX_PRODUCTS;
      offset += PAGE_SIZE
    ) {
      const url =
        `${API_PRODUCTS}?limit=${PAGE_SIZE}&offset=${offset}`;

      console.log(
        "FitDealFinder: producten ophalen:",
        url
      );

      const response =
        await fetchWithTimeout(
          url,
          {
            headers: {
              Accept:
                "application/json",
            },
            cache: "no-store",
          }
        );

      if (!response.ok) {
        throw new Error(
          `Product API gaf status ${response.status}`
        );
      }

      const contentType =
        response.headers.get(
          "content-type"
        ) || "";

      if (
        !contentType.includes(
          "application/json"
        )
      ) {
        throw new Error(
          `Product API gaf geen JSON terug. Content-Type: ${contentType || "onbekend"}`
        );
      }

      const data =
        await response.json();

      const batch =
        Array.isArray(data)
          ? data
          : Array.isArray(
              data?.products
            )
            ? data.products
            : Array.isArray(
                data?.data
              )
              ? data.data
              : [];

      products.push(
        ...batch
      );

      console.log(
        `FitDealFinder: batch ${offset} bevat ${batch.length} producten.`
      );

      if (
        batch.length <
        PAGE_SIZE
      ) {
        break;
      }

      if (
        products.length >=
        MAX_PRODUCTS
      ) {
        break;
      }
    }

    const unique =
      new Map();

    for (
      const product of products
    ) {
      if (!product?.id) {
        continue;
      }

      unique.set(
        String(product.id),
        product
      );
    }

    state.products =
      [...unique.values()];

    console.log(
      `FitDealFinder: ${state.products.length} producten geladen.`
    );

    if (
      !state.products.length
    ) {
      throw new Error(
        "De Product API gaf 0 producten terug."
      );
    }

    applyFilters();
  } catch (error) {
    console.error(
      "FitDealFinder product loading error:",
      error
    );

    if (grid) {
      const isTimeout =
        String(
          error?.message || ""
        ).toLowerCase()
          .includes("timeout");

      grid.innerHTML = `
        <div class="empty-state">
          <h3>
            Deals konden niet worden geladen
          </h3>

          <p>
            ${
              isTimeout
                ? "De productserver reageert te langzaam. Probeer de pagina opnieuw te laden."
                : "Er ging iets mis met het ophalen van de producten. Probeer de pagina opnieuw te laden."
            }
          </p>

          <button
            type="button"
            id="retry-products"
            style="
              margin-top:16px;
              min-height:46px;
              padding:0 18px;
              border:0;
              border-radius:10px;
              background:#00a83b;
              color:#fff;
              font-weight:900;
              cursor:pointer;
            "
          >
            Opnieuw proberen
          </button>
        </div>
      `;

      const retry =
        $("#retry-products");

      if (retry) {
        retry.addEventListener(
          "click",
          () => {
            loadProducts();
          }
        );
      }
    }

    updateProductCount(0);
  } finally {
    state.loading = false;
  }
}

/* =========================================================
   PRODUCT CARD
========================================================= */

function productCard(product) {
  const currentPrice =
    price(product);

  const oldPriceValue =
    Number(
      product.old_price
    ) || 0;

  const hasDiscount =
    oldPriceValue >
    currentPrice;

  const discount =
    Number(
      product.discount_percent
    ) > 0
      ? Math.round(
          Number(
            product.discount_percent
          )
        )
      : hasDiscount
        ? Math.round(
            (
              (
                oldPriceValue -
                currentPrice
              ) /
              oldPriceValue
            ) * 100
          )
        : 0;

  const image =
    product.image_url
      ? `
        <img
          src="${escapeHtml(
            product.image_url
          )}"
          alt="${escapeHtml(
            product.name
          )}"
          loading="lazy"
          onerror="this.style.display='none'"
        >
      `
      : `
        <div class="product-image-placeholder">
          FitDealFinder
        </div>
      `;

  const stock =
    Number(
      product.in_stock
    ) === 1
      ? `<span class="stock">Op voorraad</span>`
      : `<span class="stock out">Niet op voorraad</span>`;

  const brand =
    product.brand ||
    product.merchant_name ||
    "Fitness";

  const dealUrl =
    `/go/${encodeURIComponent(
      String(product.id)
    )}`;

  return `
    <article class="product-card">

      <div class="product-image">
        ${image}
      </div>

      <div class="product-content">

        <div class="product-brand">
          ${escapeHtml(brand)}
        </div>

        <h3>
          ${escapeHtml(
            product.name
          )}
        </h3>

        <div class="product-price">

          <strong>
            ${money(
              currentPrice,
              product.currency
            )}
          </strong>

          ${
            hasDiscount
              ? `
                <span class="old-price">
                  ${money(
                    oldPriceValue,
                    product.currency
                  )}
                </span>
              `
              : ""
          }

          ${
            discount > 0
              ? `
                <span class="discount">
                  -${discount}%
                </span>
              `
              : ""
          }

        </div>

        <div class="product-meta">

          ${stock}

          <span>
            ${escapeHtml(
              product.merchant_name ||
              ""
            )}
          </span>

        </div>

        <div
          class="product-actions"
          style="
            display:flex;
            width:100%;
            margin-top:16px;
          "
        >

          <a
            class="deal-button"
            href="${dealUrl}"
            style="
              display:flex;
              align-items:center;
              justify-content:center;
              width:100%;
              min-height:48px;
              border-radius:12px;
              background:#00a83b;
              color:#fff;
              font-weight:900;
              text-decoration:none;
            "
          >
            Bekijk deal →
          </a>

        </div>

      </div>

    </article>
  `;
}

/* =========================================================
   RENDER PRODUCTS
========================================================= */

function renderProducts() {
  const grid =
    $("#products-grid");

  if (!grid) {
    return;
  }

  const visible =
    state.filtered.slice(
      0,
      state.visibleCount
    );

  if (!visible.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>
          Geen passende producten
        </h3>

        <p>
          Pas je zoekopdracht of categorie aan.
        </p>
      </div>
    `;

    updateProductCount(0);
    updateLoadMore();

    return;
  }

  grid.innerHTML =
    visible
      .map(productCard)
      .join("");

  updateProductCount(
    state.filtered.length
  );

  updateLoadMore();
}

function updateProductCount(
  count
) {
  const element =
    $("#result-count");

  if (!element) {
    return;
  }

  element.textContent =
    `${count} producten`;
}

function updateLoadMore() {
  const button =
    $("#load-more");

  if (!button) {
    return;
  }

  if (
    state.category
  ) {
    button.hidden = true;
    return;
  }

  if (
    state.visibleCount <
    state.filtered.length
  ) {
    button.hidden = false;
    button.textContent =
      "Meer producten laden";
  } else {
    button.hidden = true;
  }
}

/* =========================================================
   SEARCH
========================================================= */

function setupSearch() {
  const form =
    $("#search-form");

  const input =
    $("#search-input");

  if (!form || !input) {
    return;
  }

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      state.search =
        input.value || "";

      state.goal = "";
      state.category = "";

      $all(
        "[data-goal]"
      ).forEach((button) => {
        button.classList.remove(
          "active"
        );
      });

      $all(
        "[data-category]"
      ).forEach((button) => {
        button.classList.remove(
          "active"
        );
      });

      applyFilters();
      scrollToDeals();
    }
  );

  input.addEventListener(
    "input",
    () => {
      state.search =
        input.value || "";

      state.category = "";

      $all(
        "[data-category]"
      ).forEach((button) => {
        button.classList.remove(
          "active"
        );
      });

      applyFilters();
    }
  );
}

/* =========================================================
   GOALS
========================================================= */

function setupGoals() {
  $all(
    "[data-goal]"
  ).forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        const goal =
          normalize(
            button.dataset.goal
          );

        state.goal =
          state.goal === goal
            ? ""
            : goal;

        $all(
          "[data-goal]"
        ).forEach((item) => {
          item.classList.toggle(
            "active",
            item === button &&
              state.goal === goal
          );
        });
      }
    );
  });
}

/* =========================================================
   CATEGORIES
========================================================= */

function setupCategories() {
  $all(
    "[data-category]"
  ).forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        const category =
          normalize(
            button.dataset.category
          );

        state.category =
          state.category ===
          category
            ? ""
            : category;

        state.goal = "";
        state.search = "";

        const searchInput =
          $("#search-input");

        if (searchInput) {
          searchInput.value = "";
        }

        $all(
          "[data-category]"
        ).forEach((item) => {
          item.classList.toggle(
            "active",
            item === button &&
              state.category ===
                category
          );
        });

        $all(
          "[data-goal]"
        ).forEach((item) => {
          item.classList.remove(
            "active"
          );
        });

        applyFilters();
        scrollToDeals();
      }
    );
  });
}

/* =========================================================
   SHOPPING PLANNER
========================================================= */

const PLANNER_EXCLUDED_WORDS = [
  "shaker",
  "shaker cup",
  "waterfles",
  "water bottle",
  "bidon",
  "drinkbeker",
  "kleding",
  "shirt",
  "t-shirt",
  "broek",
  "shorts",
  "legging",
  "hoodie",
  "ebook",
  "e-book",
  "voedingsplan",
  "voedingsschema",
];

const PLANNER_CARB_WORDS = [
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

const PLANNER_CUT_WORDS = [
  "fat burner",
  "fatburner",
  "thermogenic",
  "l-carnitine",
  "carnitine",
  "cla",
  "shred",
  "caffeine",
  "cafeine",
];

function plannerText(product) {
  return productClassificationText(
    product
  );
}

function isPlannerExcluded(product) {
  return hasAny(
    plannerText(product),
    PLANNER_EXCLUDED_WORDS
  );
}

function isCarbProduct(product) {
  const text =
    plannerText(product);

  /*
   * Gainers zijn alleen een carb-rol
   * binnen BULK.
   */
  if (
    isGainerProduct(product)
  ) {
    return true;
  }

  return hasAny(
    text,
    PLANNER_CARB_WORDS
  );
}

function isCutSupportProduct(product) {
  return hasAny(
    plannerText(product),
    PLANNER_CUT_WORDS
  );
}

function isPlannerProtein(product) {
  return (
    isProteinProduct(product) &&
    !isGainerProduct(product)
  );
}

function isPlannerCreatine(product) {
  return isCreatineProduct(product);
}

/*
 * =========================================================
 * SHOPPING PLANNER CLASSIFICATIE
 * =========================================================
 *
 * De planner werkt uitsluitend met:
 *
 * BULK
 *   protein
 *   carb
 *   creatine
 *
 * LEAN BULK
 *   protein
 *   carb
 *   creatine
 *
 * CUT
 *   protein
 *   cut-support
 *   creatine
 *
 * Belangrijk:
 *
 * - Gainers zijn uitsluitend "carb" voor BULK.
 * - Gainers worden NOOIT gebruikt voor LEAN BULK.
 * - Gainers worden NOOIT gebruikt voor CUT.
 * - Pre-workout krijgt geen plannerrol.
 * - Cut-support komt alleen bij CUT.
 * - Een product krijgt binnen één doel maar één rol.
 */
function packageRole(
  product,
  goal
) {
  const normalizedGoal =
    normalize(goal);

  if (
    !normalizedGoal ||
    !isUsableProduct(product)
  ) {
    return "";
  }

  if (
    isPlannerExcluded(product)
  ) {
    return "";
  }

  /*
   * Pre-workout hoort niet in een
   * Bulk/Cut/Lean Bulk pakketrol.
   */
  if (
    getProductCategory(product) ===
    "pre-workout"
  ) {
    return "";
  }

  const gainer =
    isGainerProduct(product);

  const carb =
    isCarbProduct(product);

  const protein =
    isPlannerProtein(product);

  const creatine =
    isPlannerCreatine(product);

  const cutSupport =
    isCutSupportProduct(product);

  /*
   * =====================================================
   * CUT
   * =====================================================
   */
  if (
    normalizedGoal === "cut"
  ) {
    /*
     * Een gainer hoort nooit bij Cut.
     */
    if (gainer) {
      return "";
    }

    /*
     * Cut-support heeft binnen Cut een
     * eigen rubriek.
     */
    if (cutSupport) {
      return "cut-support";
    }

    /*
     * Proteïne heeft een eigen rubriek.
     */
    if (protein) {
      return "protein";
    }

    /*
     * Creatine heeft een eigen rubriek.
     */
    if (creatine) {
      return "creatine";
    }

    return "";
  }

  /*
   * =====================================================
   * BULK
   * =====================================================
   */
  if (
    normalizedGoal === "bulk"
  ) {
    /*
     * Cut-producten horen niet bij Bulk.
     */
    if (cutSupport) {
      return "";
    }

    /*
     * Gainer en normale carb-producten
     * horen bij de koolhydraat/massa-rubriek.
     */
    if (
      gainer ||
      carb
    ) {
      return "carb";
    }

    /*
     * Daarna Proteïne.
     */
    if (protein) {
      return "protein";
    }

    /*
     * Daarna Creatine.
     */
    if (creatine) {
      return "creatine";
    }

    return "";
  }

  /*
   * =====================================================
   * LEAN BULK
   * =====================================================
   */
  if (
    normalizedGoal === "lean-bulk"
  ) {
    /*
     * Mass gainers zijn expliciet uitgesloten.
     */
    if (gainer) {
      return "";
    }

    /*
     * Cut-support hoort niet bij Lean Bulk.
     */
    if (cutSupport) {
      return "";
    }

    /*
     * Proteïne.
     */
    if (protein) {
      return "protein";
    }

    /*
     * Creatine.
     */
    if (creatine) {
      return "creatine";
    }

    /*
     * Alleen normale koolhydraatproducten.
     */
    if (
      carb &&
      !gainer
    ) {
      return "carb";
    }

    return "";
  }

  return "";
}

/*
 * Score blijft uitsluitend een voorkeur
 * binnen de juiste planner-rubriek.
 */
function plannerProductScore(
  product,
  goal
) {
  const role =
    packageRole(
      product,
      goal
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
    role === "carb"
  ) {
    score += 90;
  }

  if (
    role === "creatine"
  ) {
    score += 80;
  }

  if (
    role === "cut-support"
  ) {
    score += 90;
  }

  /*
   * Deal score is alleen secundaire voorkeur.
   */
  score += Math.min(
    30,
    Number(
      product.deal_score
    ) || 0
  );

  return score;
}

function plannerProductKey(product) {
  const name =
    normalize(
      product?.name || ""
    );

  return name
    .replace(
      /\b(tablets?|tabs?|capsules?|caps?)\b/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function getPlannerElements() {
  return {
    container:
      first(
        "#shopping-planner",
        "#planner"
      ),

    goal:
      $("#planner-goal"),

    budget:
      $("#planner-budget"),

    result:
      $("#planner-result"),
  };
}

function injectPlannerStyles() {
  if (
    $("#planner-styles")
  ) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.id =
    "planner-styles";

  style.textContent = `
    #planner-result {
      margin-top: 24px;
    }

    .planner-results {
      display: grid;
      gap: 16px;
    }

    .planner-role-section {
      display: grid;
      gap: 10px;
    }

    .planner-role-title {
      margin: 4px 0 0;
      color: #fff;
      font-size: 16px;
      font-weight: 900;
    }

    .planner-role-items {
      display: grid;
      gap: 12px;
    }

    .planner-result-item {
      display: grid;
      grid-template-columns: 65px 1fr;
      align-items: center;
      gap: 16px;
      padding: 22px;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 20px;
      background: rgba(3,7,18,.55);
    }

    .planner-product-image {
      width: 65px;
      height: 65px;
      min-width: 65px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-radius: 10px;
      text-decoration: none;
    }

    .planner-product-image img {
      width: 65px !important;
      height: 65px !important;
      max-width: 65px !important;
      max-height: 65px !important;
      min-width: 65px !important;
      min-height: 65px !important;
      object-fit: contain !important;
      object-position: center !important;
      display: block !important;
    }

    .planner-product-image-placeholder {
      width: 65px;
      height: 65px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      background: rgba(255,255,255,.05);
      color: #9eacbd;
      font-size: 10px;
      font-weight: 800;
      text-align: center;
    }

    .planner-product-info {
      min-width: 0;
    }

    .planner-product-link {
      display: block;
      color: #fff;
      text-decoration: none;
    }

    .planner-product-link:hover {
      color: #67e5a2;
    }

    .planner-product-link strong {
      color: #fff;
      font-size: 18px;
      line-height: 1.4;
    }

    .planner-product-price {
      display: block;
      margin-top: 6px;
      color: #36c978;
      font-weight: 800;
      font-size: 18px;
    }

    .planner-deal-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      margin-top: 12px;
      padding: 0 17px;
      border-radius: 10px;
      background: #00a83b;
      color: #fff !important;
      font-weight: 900;
      text-decoration: none;
    }

    .planner-deal-button:hover {
      background: #00bd43;
    }

    @media (max-width: 700px) {
      .planner-result-item {
        grid-template-columns: 65px 1fr;
        gap: 14px;
        padding: 18px;
      }

      .planner-deal-button {
        width: 100%;
        min-height: 44px;
      }
    }
  `;

  document.head.appendChild(
    style
  );
}

function plannerProductReason(
  product,
  goal
) {
  const role =
    packageRole(
      product,
      goal
    );

  if (
    role === "protein"
  ) {
    return "Proteïne voor je doel.";
  }

  if (
    role === "creatine"
  ) {
    return "Creatine als ondersteuning.";
  }

  if (
    role === "carb"
  ) {
    return "Koolhydraten voor energie en massa.";
  }

  if (
    role === "cut-support"
  ) {
    return "Product gericht op ondersteuning tijdens een cut.";
  }

  return "";
}

/*
 * Geeft de zichtbare rubrieknaam terug.
 */
function plannerRoleLabel(role) {
  if (
    role === "protein"
  ) {
    return "Proteïne";
  }

  if (
    role === "carb"
  ) {
    return "Koolhydraten";
  }

  if (
    role === "creatine"
  ) {
    return "Creatine";
  }

  if (
    role === "cut-support"
  ) {
    return "Cut ondersteuning";
  }

  return "";
}

function createPlanner() {
  const {
    container,
    goal,
    budget,
    result,
  } =
    getPlannerElements();

  if (
    !container ||
    !goal ||
    !budget ||
    !result
  ) {
    return;
  }

  injectPlannerStyles();

  const form =
    goal.closest("form") ||
    container.querySelector(
      "form"
    );

  if (!form) {
    return;
  }

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      const selectedGoal =
        normalize(
          goal.value
        );

      const maxBudget =
        Number(
          String(
            budget.value || ""
          ).replace(
            ",",
            "."
          )
        );

      if (
        !selectedGoal ||
        !Number.isFinite(
          maxBudget
        ) ||
        maxBudget <= 0
      ) {
        result.innerHTML = `
          <p>
            Kies een doel en vul
            een geldig budget in.
          </p>
        `;

        return;
      }

      /*
       * Alleen echte rollen voor dit doel.
       */
      const candidates =
        state.products
          .map((product) => ({
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
          }))
          .filter(
            (item) =>
              item.role &&
              item.score > 0
          )
          .filter(
            (item) =>
              price(
                item.product
              ) <=
              maxBudget
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
                price(
                  a.product
                ) -
                price(
                  b.product
                )
              );
            }
          );

      /*
       * Iedere doelkeuze heeft zijn eigen vaste
       * planner-rubrieken.
       *
       * De volgorde bepaalt ook de volgorde
       * waarin de rubrieken op de pagina verschijnen.
       */
      const requiredRoles =
        selectedGoal === "cut"
          ? [
              "protein",
              "cut-support",
              "creatine",
            ]
          : selectedGoal === "bulk"
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

      const roleCandidates =
        new Map();

      for (
        const role of requiredRoles
      ) {
        const roleItems =
          candidates
            .filter(
              (item) =>
                item.role ===
                role
            )
            .map(
              (item) =>
                item.product
            );

        roleCandidates.set(
          role,
          roleItems
        );
      }

      /*
       * Geen compleet pakket = geen verkeerd
       * samengesteld pakket.
       */
      for (
        const role of requiredRoles
      ) {
        if (
          !roleCandidates
            .get(role)
            ?.length
        ) {
          result.innerHTML = `
            <p>
              Binnen het huidige assortiment
              is er momenteel geen compleet
              ${escapeHtml(
                selectedGoal
              )}
              pakket binnen dit budget.
            </p>
          `;

          return;
        }
      }

      /*
       * Backtracking zoekt een combinatie waarbij
       * ieder product bij de juiste rol blijft.
       */
      const selected = [];
      const selectedRoles = [];
      const usedKeys =
        new Set();

      function findCombination(
        roleIndex,
        remainingBudget
      ) {
        if (
          roleIndex >=
          requiredRoles.length
        ) {
          return true;
        }

        const role =
          requiredRoles[
            roleIndex
          ];

        const roleProducts =
          roleCandidates.get(
            role
          ) || [];

        for (
          const product of roleProducts
        ) {
          const key =
            plannerProductKey(
              product
            );

          if (
            !key ||
            usedKeys.has(key)
          ) {
            continue;
          }

          const productPrice =
            price(product);

          if (
            productPrice >
            remainingBudget +
              0.001
          ) {
            continue;
          }

          usedKeys.add(key);
          selected.push(product);
          selectedRoles.push(role);

          if (
            findCombination(
              roleIndex + 1,
              remainingBudget -
                productPrice
            )
          ) {
            return true;
          }

          selected.pop();
          selectedRoles.pop();
          usedKeys.delete(key);
        }

        return false;
      }

      const success =
        findCombination(
          0,
          maxBudget
        );

      if (!success) {
        result.innerHTML = `
          <p>
            Ik kan met de huidige producten
            geen compleet ${escapeHtml(
              selectedGoal
            )}
            pakket binnen
            ${escapeHtml(
              money(maxBudget)
            )}
            samenstellen.
          </p>
        `;

        return;
      }

      /*
       * Bewust GEEN budgetoptimalisatie.
       */
      const total =
        selected.reduce(
          (sum, product) =>
            sum + price(product),
          0
        );

      if (
        total >
        maxBudget +
          0.001
      ) {
        result.innerHTML = `
          <p>
            Het samengestelde pakket
            overschrijdt het budget.
          </p>
        `;

        return;
      }

      const remaining =
        maxBudget - total;

      const goalLabel =
        selectedGoal === "bulk"
          ? "Bulk"
          : selectedGoal === "lean-bulk"
            ? "Lean Bulk"
            : "Cut";

      /*
       * Producten worden per planner-rol gegroepeerd.
       *
       * Dit is uitsluitend een Shopping Planner-weergave.
       */
      const roleGroups =
        requiredRoles.map(
          (role) => ({
            role,
            products:
              selected
                .map(
                  (
                    product,
                    index
                  ) => ({
                    product,
                    role:
                      selectedRoles[
                        index
                      ],
                  })
                )
                .filter(
                  (item) =>
                    item.role ===
                    role
                )
                .map(
                  (item) =>
                    item.product
                ),
          })
        );

      const roleSections =
        roleGroups
          .filter(
            (group) =>
              group.products.length
          )
          .map(
            (group) => {
              const roleLabel =
                plannerRoleLabel(
                  group.role
                );

              const productItems =
                group.products
                  .map((product) => {
                    const image =
                      product.image_url
                        ? `
                          <img
                            src="${escapeHtml(
                              product.image_url
                            )}"
                            alt="${escapeHtml(
                              product.name
                            )}"
                            loading="lazy"
                            width="65"
                            height="65"
                            onerror="this.style.display='none'"
                          >
                        `
                        : `
                          <div
                            class="planner-product-image-placeholder"
                          >
                            FitDealFinder
                          </div>
                        `;

                    const dealUrl =
                      `/go/${encodeURIComponent(
                        String(product.id)
                      )}`;

                    const reason =
                      plannerProductReason(
                        product,
                        selectedGoal
                      );

                    return `
                      <div
                        class="planner-result-item"
                      >

                        <a
                          href="${dealUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="planner-product-image"
                        >
                          ${image}
                        </a>

                        <div
                          class="planner-product-info"
                        >

                          <a
                            href="${dealUrl}"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="planner-product-link"
                          >
                            <strong>
                              ${escapeHtml(
                                product.name
                              )}
                            </strong>
                          </a>

                          <small>
                            ${escapeHtml(
                              product.merchant_name ||
                              "Winkel onbekend"
                            )}
                          </small>

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

                          <span
                            class="planner-product-price"
                          >
                            ${escapeHtml(
                              money(
                                price(product),
                                product.currency
                              )
                            )}
                          </span>

                          <a
                            href="${dealUrl}"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="planner-deal-button"
                          >
                            Bekijk deal →
                          </a>

                        </div>

                      </div>
                    `;
                  })
                  .join("");

              return `
                <section
                  class="planner-role-section"
                >

                  <h4
                    class="planner-role-title"
                  >
                    ${escapeHtml(
                      roleLabel
                    )}
                  </h4>

                  <div
                    class="planner-role-items"
                  >
                    ${productItems}
                  </div>

                </section>
              `;
            }
          )
          .join("");

      result.innerHTML = `
        <div class="planner-results">

          ${roleSections}

          <div
            style="
              margin-top:8px;
              padding:18px;
              border-radius:16px;
              background:rgba(255,255,255,.04);
            "
          >
            <strong>
              ${escapeHtml(
                goalLabel
              )} pakket
            </strong>

            <div style="margin-top:8px;">
              Totaal:
              <strong>
                ${escapeHtml(
                  money(total)
                )}
              </strong>
            </div>

            <div style="margin-top:4px;">
              Budget:
              ${escapeHtml(
                money(maxBudget)
              )}
              · over:
              ${escapeHtml(
                money(remaining)
              )}
            </div>

          </div>

        </div>
      `;
    }
  );
}

/* =========================================================
   AI PRODUCT SEARCH
========================================================= */

const AI_INFORMATION_PATTERNS = [
  "wat is ",
  "wat zijn ",
  "wat betekent ",
  "waarom ",
  "hoe werkt ",
  "hoe werken ",
  "wat doet ",
  "wat doen ",
  "verschil tussen ",
  "wat is het verschil",
  "waarvoor is ",
  "waarvoor dient ",
];

function containsSearchIntent(text) {
  const intents = [
    "zoek",
    "vind",
    "gevonden",
    "geef",
    "geeft",
    "laat",
    "beste",
    "goedkoopste",
    "goedkoop",
    "deal",
    "deals",
    "prijs",
    "prijzen",
    "producten",
    "product",
    "welke",
    "waar",
    "opties",
    "optie",
  ];

  return intents.some(
    (word) =>
      text.includes(word)
  );
}

function isAIInformationQuestion(
  text
) {
  const information =
    AI_INFORMATION_PATTERNS.some(
      (pattern) =>
        text.includes(
          normalize(pattern)
        )
    );

  if (!information) {
    return false;
  }

  if (
    containsSearchIntent(text)
  ) {
    return false;
  }

  return true;
}

function detectProductType(
  message
) {
  const text =
    normalize(message);

  const productType =
    hasAny(
      text,
      PROTEIN_BAR_WORDS
    )
      ? "protein-bar"
      : text.includes("whey")
        ? "whey"
        : text.includes("creatine")
          ? "creatine"
          : text.includes(
                "pre workout"
              ) ||
              text.includes(
                "pre-workout"
              ) ||
              text.includes(
                "preworkout"
              )
            ? "pre-workout"
            : text.includes(
                  "mass gainer"
                ) ||
                text.includes(
                  "gainer"
                )
              ? "gainer"
              : text.includes(
                    "casein"
                  ) ||
                  text.includes(
                    "caseine"
                  )
                ? "casein"
                : text.includes(
                      "protein"
                    ) ||
                    text.includes(
                      "proteine"
                    ) ||
                    text.includes(
                      "isolaat"
                    ) ||
                    text.includes(
                      "isolate"
                    )
                  ? "proteine"
                  : text.includes(
                        "carnitine"
                      ) ||
                      text.includes(
                        "caffeine"
                      ) ||
                      text.includes(
                        "cafeine"
                      ) ||
                      text.includes(
                        "fat burner"
                      ) ||
                      text.includes(
                        "fatburner"
                      )
                    ? "cut-support"
                    : "";

  return productType;
}

function detectAIProductQuery(
  message
) {
  const text =
    normalize(message);

  const productType =
    detectProductType(
      message
    );

  if (!productType) {
    return null;
  }

  if (
    isAIInformationQuestion(
      text
    )
  ) {
    return null;
  }

  const hasProductIntent =
    containsSearchIntent(text) ||
    text.includes("producten") ||
    text.includes("product") ||
    text.includes("opties") ||
    text.includes("optie") ||
    text.endsWith(productType);

  if (!hasProductIntent) {
    return null;
  }

  return {
    productType,

    cheapest:
      text.includes(
        "goedkoopste"
      ) ||
      text.includes(
        "goedkoop"
      ),

    best:
      text.includes(
        "beste"
      ) ||
      text.includes(
        "deal"
      ),
  };
}

/* =========================================================
   STRICT AI PRODUCT MATCHING
========================================================= */

const WHEY_EXCLUDED_WORDS = [
  "bar",
  "reep",
  "protein bar",
  "proteinbar",
  "proteine reep",
  "proteinebar",
  "snack",
  "cookie",
  "koek",
  "brownie",
  "chips",
  "pudding",
  "dessert",
];

function matchesExactProductType(
  product,
  productType
) {
  if (
    !isUsableProduct(product)
  ) {
    return false;
  }

  const text =
    productClassificationText(
      product
    );

  if (
    productType === "whey"
  ) {
    if (
      !text.includes("whey")
    ) {
      return false;
    }

    if (
      WHEY_EXCLUDED_WORDS.some(
        (word) =>
          text.includes(
            normalize(word)
          )
      )
    ) {
      return false;
    }

    if (
      isGainerProduct(product)
    ) {
      return false;
    }

    return true;
  }

  if (
    productType ===
    "protein-bar"
  ) {
    return hasAny(
      text,
      PROTEIN_BAR_WORDS
    );
  }

  if (
    productType === "creatine"
  ) {
    return isCreatineProduct(
      product
    );
  }

  if (
    productType === "pre-workout"
  ) {
    return isPreWorkoutProduct(
      product
    );
  }

  if (
    productType === "gainer"
  ) {
    return isGainerProduct(
      product
    );
  }

  if (
    productType === "casein"
  ) {
    return hasAny(
      text,
      [
        "casein",
        "caseine",
      ]
    );
  }

  if (
    productType === "proteine"
  ) {
    return (
      isProteinProduct(
        product
      ) &&
      !WHEY_EXCLUDED_WORDS.some(
        (word) =>
          text.includes(
            normalize(word)
          )
      )
    );
  }

  if (
    productType ===
    "cut-support"
  ) {
    return isCutSupportProduct(
      product
    );
  }

  return false;
}

/* =========================================================
   FIND AI PRODUCTS
========================================================= */

function findAIProducts(
  message
) {
  const request =
    detectAIProductQuery(
      message
    );

  if (!request) {
    return null;
  }

  const {
    productType,
    cheapest,
  } = request;

  let candidates =
    state.products
      .filter(
        isUsableProduct
      )
      .filter(
        (product) =>
          matchesExactProductType(
            product,
            productType
          )
      )
      .filter(
        (product) => {
          const value =
            Number(
              product.price
            );

          return (
            Number.isFinite(
              value
            ) &&
            value > 0
          );
        }
      );

  candidates.sort(
    (a, b) => {
      const stockA =
        Number(a.in_stock);

      const stockB =
        Number(b.in_stock);

      if (
        (stockA === 1) !==
        (stockB === 1)
      ) {
        return stockB === 1
          ? 1
          : -1;
      }

      if (cheapest) {
        const difference =
          price(a) -
          price(b);

        if (
          difference !== 0
        ) {
          return difference;
        }

        return (
          (Number(
            b.deal_score
          ) || 0) -
          (Number(
            a.deal_score
          ) || 0)
        );
      }

      const scoreA =
        Number(
          a.deal_score
        ) || 0;

      const scoreB =
        Number(
          b.deal_score
        ) || 0;

      if (
        scoreA !==
        scoreB
      ) {
        return (
          scoreB -
          scoreA
        );
      }

      const discountA =
        Number(
          a.discount_percent
        ) || 0;

      const discountB =
        Number(
          b.discount_percent
        ) || 0;

      if (
        discountA !==
        discountB
      ) {
        return (
          discountB -
          discountA
        );
      }

      return (
        price(a) -
        price(b)
      );
    }
  );

  return {
    productType,
    cheapest,
    best: !cheapest,
    products: candidates,
  };
}

/* =========================================================
   AI PRODUCT RESULT
========================================================= */

function renderAIProductResults(
  result
) {
  if (
    !result ||
    !Array.isArray(
      result.products
    ) ||
    !result.products.length
  ) {
    return false;
  }

  const product =
    result.products[0];

  const title =
    result.cheapest
      ? "Goedkoopste match"
      : "Beste deal";

  const intro =
    result.cheapest
      ? "Ik heb de actuele producten van FitDealFinder gecontroleerd en de goedkoopste passende deal gekozen."
      : "Ik heb de actuele producten van FitDealFinder gecontroleerd en de beste passende deal gekozen.";

  const productName =
    product.name ||
    "Product";

  const merchant =
    product.merchant_name ||
    "Winkel onbekend";

  const productPrice =
    money(
      price(product),
      product.currency
    );

  const dealUrl =
    `/go/${encodeURIComponent(
      String(product.id)
    )}`;

  const oldPrice =
    Number(
      product.old_price
    ) || 0;

  const discount =
    Number(
      product.discount_percent
    ) || 0;

  const image =
    product.image_url
      ? `
        <img
          src="${escapeHtml(
            product.image_url
          )}"
          alt="${escapeHtml(
            product.name
          )}"
          loading="lazy"
          width="65"
          height="65"
          onerror="this.style.display='none'"
        >
      `
      : `
        <div
          class="ai-product-placeholder"
        >
          FitDealFinder
        </div>
      `;

  const responseBox =
    $("#ai-response");

  if (!responseBox) {
    return false;
  }

  responseBox.innerHTML = `
    <h3>
      ${escapeHtml(title)}
    </h3>

    <p>
      ${escapeHtml(intro)}
    </p>

    <div
      class="ai-product-result-list"
    >

      <div
        class="ai-product-result-item"
      >

        <a
          href="${dealUrl}"
          target="_blank"
          rel="noopener noreferrer"
          class="ai-product-result-image"
        >
          ${image}
        </a>

        <div
          class="ai-product-result-info"
        >

          <span
            class="ai-product-result-badge"
          >
            ${
              result.cheapest
                ? "Goedkoopste"
                : "Top deal"
            }
          </span>

          <a
            href="${dealUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="ai-product-result-name"
          >
            ${escapeHtml(
              productName
            )}
          </a>

          <span
            class="ai-product-result-merchant"
          >
            ${escapeHtml(
              merchant
            )}
          </span>

          <div
            class="ai-product-result-price"
          >

            <strong>
              ${escapeHtml(
                productPrice
              )}
            </strong>

            ${
              oldPrice >
              price(product)
                ? `
                  <span
                    class="old-price"
                  >
                    ${escapeHtml(
                      money(
                        oldPrice,
                        product.currency
                      )
                    )}
                  </span>
                `
                : ""
            }

            ${
              discount > 0
                ? `
                  <span
                    class="discount"
                  >
                    -${discount}%
                  </span>
                `
                : ""
            }

          </div>

          <a
            href="${dealUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="ai-product-result-button"
          >
            Bekijk deal →
          </a>

        </div>

      </div>

    </div>

    <p
      class="ai-product-search-note"
    >
      Prijzen en voorraad kunnen door
      de betreffende winkel worden gewijzigd.
    </p>
  `;

  return true;
}

/* =========================================================
   AI PRODUCT STYLES
========================================================= */

function injectAIProductStyles() {
  if (
    $("#ai-product-styles")
  ) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.id =
    "ai-product-styles";

  style.textContent = `
    .ai-inline-link {
      color: #36c978;
      font-weight: 800;
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    .ai-inline-link:hover {
      color: #67e5a2;
    }

    .ai-product-result-list {
      display: grid;
      gap: 14px;
      margin-top: 4px;
    }

    .ai-product-result-item {
      display: grid;
      grid-template-columns: 65px 1fr;
      gap: 14px;
      align-items: center;
      padding: 16px;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 16px;
      background: rgba(3,7,18,.55);
    }

    .ai-product-result-image {
      width: 65px;
      height: 65px;
      min-width: 65px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-radius: 10px;
      text-decoration: none;
      background: rgba(255,255,255,.03);
    }

    .ai-product-result-image img {
      display: block !important;
      width: 65px !important;
      height: 65px !important;
      min-width: 65px !important;
      min-height: 65px !important;
      max-width: 65px !important;
      max-height: 65px !important;
      object-fit: contain !important;
      object-position: center !important;
    }

    .ai-product-placeholder {
      width: 65px;
      height: 65px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      background: rgba(255,255,255,.05);
      color: #9eacbd;
      font-size: 9px;
      font-weight: 800;
      text-align: center;
    }

    .ai-product-result-info {
      min-width: 0;
    }

    .ai-product-result-badge {
      display: inline-flex;
      margin-bottom: 5px;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(54,201,120,.14);
      color: #67e5a2;
      font-size: 11px;
      font-weight: 900;
    }

    .ai-product-result-name {
      display: block;
      color: #fff;
      font-size: 16px;
      font-weight: 900;
      line-height: 1.4;
      text-decoration: none;
    }

    .ai-product-result-name:hover {
      color: #67e5a2;
    }

    .ai-product-result-merchant {
      display: block;
      margin-top: 3px;
      color: #9eacbd;
      font-size: 13px;
    }

    .ai-product-result-price {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 7px;
    }

    .ai-product-result-price strong {
      color: #36c978;
      font-size: 18px;
      font-weight: 900;
    }

    .ai-product-result-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 46px;
      margin-top: 12px;
      padding: 0 14px;
      border-radius: 10px;
      background: #00a83b;
      color: #fff !important;
      font-weight: 900;
      text-decoration: none;
    }

    .ai-product-result-button:hover {
      background: #00bd43;
    }

    .ai-product-search-note {
      color: #8d99aa;
      font-size: 12px;
    }

    @media (max-width: 700px) {
      .ai-product-result-item {
        grid-template-columns: 65px 1fr;
        padding: 14px;
      }

      .ai-product-result-name {
        font-size: 15px;
      }

      .ai-product-result-button {
        min-height: 46px;
      }
    }
  `;

  document.head.appendChild(
    style
  );
}

/* =========================================================
   AI SUPPLEMENT COACH
========================================================= */

function setupAI() {
  const form =
    $("#ai-form");

  const input =
    $("#ai-input");

  const responseBox =
    $("#ai-response");

  if (
    !form ||
    !input ||
    !responseBox
  ) {
    return;
  }

  injectAIProductStyles();

  function extractBudget(
    message
  ) {
    const match =
      String(
        message || ""
      ).match(
        /(?:€|eur(?:o)?\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*(?:euro|eur|€))?/i
      );

    if (!match) {
      return null;
    }

    const value =
      Number(
        String(
          match[1]
        ).replace(
          ",",
          "."
        )
      );

    return (
      Number.isFinite(value) &&
      value > 0
    )
      ? value
      : null;
  }

  function detectGoal(
    message
  ) {
    const text =
      normalize(message);

    if (
      text.includes(
        "lean bulk"
      ) ||
      text.includes(
        "lean-bulk"
      ) ||
      text.includes(
        "leanbulk"
      )
    ) {
      return "lean-bulk";
    }

    if (
      text.includes("bulk") ||
      text.includes("bulken") ||
      text.includes("massa") ||
      text.includes("aankomen") ||
      text.includes("spiermassa")
    ) {
      return "bulk";
    }

    if (
      text.includes("cut") ||
      text.includes("afvallen") ||
      text.includes("droger") ||
      text.includes(
        "vet verliezen"
      )
    ) {
      return "cut";
    }

    return "";
  }

  function buildExactPackage(
    message
  ) {
    const budget =
      extractBudget(
        message
      );

    const goal =
      detectGoal(
        message
      );

    if (
      budget === null
    ) {
      return {
        ok: false,
        reason:
          "Geef een budget op, bijvoorbeeld €75.",
      };
    }

    if (!goal) {
      return {
        ok: false,
        reason:
          "Geef ook een doel op: cut, bulk of lean bulk.",
      };
    }

    const products =
      state.products
        .filter(
          isUsableProduct
        )
        .filter(
          (product) =>
            price(product) <=
            budget
        );

    if (
      !products.length
    ) {
      return {
        ok: false,
        reason:
          "Er zijn geen geschikte producten binnen dit budget gevonden.",
      };
    }

    const requiredRoles =
      goal === "bulk"
        ? [
            "protein",
            "carb",
            "creatine",
          ]
        : goal === "lean-bulk"
          ? [
              "protein",
              "creatine",
              "carb",
            ]
          : [
              "protein",
              "cut-support",
              "creatine",
            ];

    const roleCandidates =
      new Map();

    for (
      const role of requiredRoles
    ) {
      const roleProducts =
        products
          .filter(
            (product) =>
              packageRole(
                product,
                goal
              ) === role
          )
          .sort(
            (a, b) => {
              const scoreA =
                plannerProductScore(
                  a,
                  goal
                );

              const scoreB =
                plannerProductScore(
                  b,
                  goal
                );

              if (
                scoreB !==
                scoreA
              ) {
                return (
                  scoreB -
                  scoreA
                );
              }

              return (
                price(a) -
                price(b)
              );
            }
          );

      roleCandidates.set(
        role,
        roleProducts
      );
    }

    for (
      const role of requiredRoles
    ) {
      if (
        !roleCandidates
          .get(role)
          ?.length
      ) {
        return {
          ok: false,
          reason:
            `Er zijn momenteel onvoldoende geschikte producten om een compleet ${goal} pakket binnen dit budget samen te stellen.`,
        };
      }
    }

    const selected = [];
    const usedIds =
      new Set();

    function findCombination(
      roleIndex,
      remainingBudget
    ) {
      if (
        roleIndex >=
        requiredRoles.length
      ) {
        return true;
      }

      const role =
        requiredRoles[
          roleIndex
        ];

      const candidates =
        roleCandidates.get(
          role
        ) || [];

      for (
        const candidate of candidates
      ) {
        const key =
          plannerProductKey(
            candidate
          );

        if (
          !key ||
          usedIds.has(key)
        ) {
          continue;
        }

        const candidatePrice =
          price(candidate);

        if (
          candidatePrice >
          remainingBudget +
            0.001
        ) {
          continue;
        }

        usedIds.add(key);
        selected.push(
          candidate
        );

        if (
          findCombination(
            roleIndex + 1,
            remainingBudget -
              candidatePrice
          )
        ) {
          return true;
        }

        selected.pop();
        usedIds.delete(key);
      }

      return false;
    }

    const success =
      findCombination(
        0,
        budget
      );

    if (!success) {
      return {
        ok: false,
        reason:
          `Ik kan met de huidige producten geen compleet ${goal} pakket binnen €${budget
            .toFixed(2)
            .replace(".", ",")} samenstellen.`,
      };
    }

    const total =
      selected.reduce(
        (sum, product) =>
          sum + price(product),
        0
      );

    if (
      total >
      budget + 0.001
    ) {
      return {
        ok: false,
        reason:
          "Er is geen geldig pakket binnen het opgegeven budget gevonden.",
      };
    }

    return {
      ok: true,
      goal,
      budget,
      products: selected,
      total,
    };
  }

  function renderExactPackage(
    packageData
  ) {
    const {
      goal,
      budget,
      products,
      total,
    } =
      packageData;

    const remaining =
      budget - total;

    const goalLabel =
      goal === "bulk"
        ? "Bulk"
        : goal === "lean-bulk"
          ? "Lean Bulk"
          : "Cut";

    /*
     * Dezelfde planner-rubrieken als de
     * Shopping Planner hierboven.
     */
    const requiredRoles =
      goal === "bulk"
        ? [
            "protein",
            "carb",
            "creatine",
          ]
        : goal === "lean-bulk"
          ? [
              "protein",
              "creatine",
              "carb",
            ]
          : [
              "protein",
              "cut-support",
              "creatine",
            ];

    const roleGroups =
      requiredRoles.map(
        (role) => ({
          role,
          products:
            products.filter(
              (product) =>
                packageRole(
                  product,
                  goal
                ) === role
            ),
        })
      );

    const roleSections =
      roleGroups
        .filter(
          (group) =>
            group.products.length
        )
        .map(
          (group) => {
            const roleLabel =
              plannerRoleLabel(
                group.role
              );

            const items =
              group.products
                .map((product) => {
                  const productPrice =
                    price(product);

                  const image =
                    product.image_url
                      ? `
                        <img
                          src="${escapeHtml(
                            product.image_url
                          )}"
                          alt="${escapeHtml(
                            product.name
                          )}"
                          loading="lazy"
                          width="65"
                          height="65"
                          onerror="this.style.display='none'"
                        >
                      `
                      : `
                        <div class="product-image-placeholder">
                          FitDealFinder
                        </div>
                      `;

                  const dealUrl =
                    `/go/${encodeURIComponent(
                      String(product.id)
                    )}`;

                  const reason =
                    plannerProductReason(
                      product,
                      goal
                    );

                  return `
                    <div
                      class="ai-package-item"
                    >

                      <a
                        href="${dealUrl}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="ai-package-product-image"
                      >
                        ${image}
                      </a>

                      <div
                        class="ai-package-product-info"
                      >

                        <a
                          href="${dealUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="ai-package-product-link"
                        >
                          <strong>
                            ${escapeHtml(
                              product.name
                            )}
                          </strong>
                        </a>

                        <small>
                          ${escapeHtml(
                            product.merchant_name ||
                            "Winkel onbekend"
                          )}
                        </small>

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

                        <strong
                          class="ai-package-price"
                        >
                          ${escapeHtml(
                            money(
                              productPrice,
                              product.currency
                            )
                          )}
                        </strong>

                        <a
                          href="${dealUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="ai-package-deal-button"
                        >
                          Bekijk deal →
                        </a>

                      </div>

                    </div>
                  `;
                })
                .join("");

            return `
              <section
                class="planner-role-section"
              >

                <h4
                  class="planner-role-title"
                >
                  ${escapeHtml(
                    roleLabel
                  )}
                </h4>

                <div
                  class="planner-role-items"
                >
                  ${items}
                </div>

              </section>
            `;
          }
        )
        .join("");

    responseBox.innerHTML = `
      <div class="ai-package">

        <h3>
          ${escapeHtml(
            goalLabel
          )} pakket
        </h3>

        <p>
          Ik heb het pakket samengesteld
          uit echte FitDealFinder-producten.
        </p>

        <div class="ai-package-list">
          ${roleSections}
        </div>

        <div class="ai-package-total">
          <span>
            Totaal
          </span>

          <strong>
            ${escapeHtml(
              money(total)
            )}
          </strong>
        </div>

        <div class="ai-package-budget">
          Budget:
          ${escapeHtml(
            money(budget)
          )}
          · over:
          ${escapeHtml(
            money(remaining)
          )}
        </div>

        <p class="ai-package-note">
          De selectie blijft binnen je opgegeven budget.
        </p>

      </div>
    `;
  }

  function injectAIPackageStyles() {
    if (
      $("#ai-package-styles")
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "ai-package-styles";

    style.textContent = `
      .ai-package-product-image {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 65px;
        height: 65px;
        min-width: 65px;
        border-radius: 10px;
        overflow: hidden;
        text-decoration: none;
      }

      .ai-package-product-image img {
        display: block;
        width: 65px !important;
        height: 65px !important;
        min-width: 65px !important;
        min-height: 65px !important;
        max-width: 65px !important;
        max-height: 65px !important;
        object-fit: contain !important;
      }

      .ai-package-product-link {
        display: block;
        color: #fff;
        text-decoration: none;
      }

      .ai-package-product-link:hover {
        color: #67e5a2;
      }

      .ai-package-deal-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        margin-top: 10px;
        padding: 0 16px;
        border-radius: 10px;
        background: #00a83b;
        color: #fff !important;
        font-weight: 900;
        text-decoration: none;
      }

      .ai-package-deal-button:hover {
        background: #00bd43;
      }

      .ai-package-explanation {
        margin-top: 20px;
        padding: 18px;
        border-radius: 16px;
        background: rgba(255,255,255,.04);
        border: 1px solid rgba(255,255,255,.08);
        line-height: 1.7;
      }

      .ai-package-explanation > strong {
        display: block;
        margin-bottom: 8px;
      }

      .ai-package-explanation p {
        margin: 0;
      }

      @media (max-width: 700px) {
        .ai-package-deal-button {
          width: 100%;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }

  injectAIPackageStyles();

  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      const message =
        input.value.trim();

      if (!message) {
        return;
      }

      /*
       * =====================================================
       * 1. PRODUCT SEARCH
       * =====================================================
       */

      const productSearch =
        findAIProducts(
          message
        );

      if (
        productSearch
      ) {
        const rendered =
          renderAIProductResults(
            productSearch
          );

        if (rendered) {
          return;
        }

        responseBox.innerHTML = `
          <div class="ai-response-content">
            <p>
              Ik heb de actuele producten
              van FitDealFinder gecontroleerd,
              maar geen passende producten
              gevonden.
            </p>
          </div>
        `;

        return;
      }

      /*
       * =====================================================
       * 2. PACKAGE
       * =====================================================
       */

      const isPackageRequest =
        /pakket|pakketje|samenstellen|bundel|combinatie|set/i.test(
          message
        );

      if (
        isPackageRequest
      ) {
        responseBox.innerHTML = `
          <p>
            Ik stel je pakket samen met
            echte FitDealFinder-producten...
          </p>
        `;

        try {
          const packageData =
            buildExactPackage(
              message
            );

          if (
            !packageData.ok
          ) {
            responseBox.innerHTML = `
              <p>
                ${escapeHtml(
                  packageData.reason
                )}
              </p>
            `;

            return;
          }

          renderExactPackage(
            packageData
          );

          try {
            const productLines =
              packageData.products
                .map(
                  (product) =>
                    `- ${product.name} | ${money(
                      price(product),
                      product.currency
                    )} | ${
                      product.merchant_name ||
                      "onbekende winkel"
                    }`
                )
                .join("\n");

            const explanationRequest = `
Leg kort uit waarom dit exacte FitDealFinder-pakket logisch is voor ${packageData.goal}.

Gebruik uitsluitend deze al gekozen producten:

${productLines}

Budget: ${money(packageData.budget)}
Exact totaal: ${money(packageData.total)}

BELANGRIJK:

- verander geen productnamen;
- verander geen prijzen;
- voeg geen producten toe;
- verwijder geen producten;
- verander het totaal niet;
- geef alleen een korte uitleg.
            `.trim();

            const response =
              await fetchWithTimeout(
                API_AI,
                {
                  method: "POST",

                  headers: {
                    "Content-Type":
                      "application/json",
                    Accept:
                      "application/json",
                  },

                  body:
                    JSON.stringify({
                      message:
                        explanationRequest,
                    }),
                }
              );

            if (
              response.ok
            ) {
              const data =
                await response.json();

              const answer =
                data.answer ||
                data.response ||
                data.message ||
                "";

              if (answer) {
                responseBox.innerHTML += `
                  <div
                    class="ai-package-explanation"
                  >
                    <strong>
                      Waarom dit pakket?
                    </strong>

                    <p>
                      ${renderAIText(
                        answer
                      )}
                    </p>
                  </div>
                `;
              }
            }
          } catch (
            aiError
          ) {
            console.warn(
              "AI uitleg niet beschikbaar:",
              aiError
            );
          }

          return;
        } catch (
          error
        ) {
          console.error(
            "FitDealFinder pakket error:",
            error
          );

          responseBox.innerHTML = `
            <p>
              Het pakket kon momenteel niet
              worden samengesteld.
              Probeer het opnieuw.
            </p>
          `;

          return;
        }
      }

      /*
       * =====================================================
       * 3. GEWONE AI-VRAAG
       * =====================================================
       */

      responseBox.innerHTML = `
        <p>
          Even nadenken...
        </p>
      `;

      try {
        const response =
          await fetchWithTimeout(
            API_AI,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
                Accept:
                  "application/json",
              },

              body:
                JSON.stringify({
                  message,
                }),
            }
          );

        if (
          !response.ok
        ) {
          throw new Error(
            `AI API gaf status ${response.status}`
          );
        }

        const data =
          await response.json();

        const answer =
          data.answer ||
          data.response ||
          data.message ||
          "Ik kon hier nu geen antwoord op geven.";

        responseBox.innerHTML = `
          <div
            class="ai-response-content"
          >
            ${renderAIText(
              answer
            )}
          </div>
        `;
      } catch (
        error
      ) {
        console.error(
          "FitDealFinder AI error:",
          error
        );

        responseBox.innerHTML = `
          <p>
            De Supplement Coach is
            momenteel niet beschikbaar.
            Probeer het later opnieuw.
          </p>
        `;
      }
    }
  );
}

/* =========================================================
   DEAL TRACKING
========================================================= */

function setupDealTracking() {
  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target;

      if (
        !target ||
        !target.closest
      ) {
        return;
      }

      const link =
        target.closest(
          'a[href^="/go/"]'
        );

      if (!link) {
        return;
      }

      /*
       * Bewust niets blokkeren.
       */
    }
  );
}

/* =========================================================
   KEYBOARD
========================================================= */

function setupKeyboard() {
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "/" &&
        document.activeElement?.tagName !==
          "INPUT" &&
        document.activeElement?.tagName !==
          "TEXTAREA" &&
        document.activeElement?.tagName !==
          "SELECT"
      ) {
        event.preventDefault();

        const input =
          $("#search-input");

        if (input) {
          input.focus();
        }
      }
    }
  );

  const loadMore =
    $("#load-more");

  if (
    loadMore
  ) {
    loadMore.addEventListener(
      "click",
      () => {
        if (
          state.category
        ) {
          return;
        }

        state.visibleCount +=
          PRODUCTS_PER_VIEW;

        renderProducts();
      }
    );
  }
}

/* =========================================================
   DEBUG CATEGORY COUNTS
========================================================= */

function debugProductCategories() {
  if (
    !state.products.length
  ) {
    return;
  }

  const counts = {
    "pre-workout": 0,
    creatine: 0,
    proteine: 0,
    supplementen: 0,
    overig: 0,
  };

  for (
    const product of state.products
  ) {
    if (
      !isUsableProduct(product)
    ) {
      continue;
    }

    const category =
      getProductCategory(
        product
      );

    if (
      Object.prototype.hasOwnProperty.call(
        counts,
        category
      )
    ) {
      counts[category]++;
    }
  }

  console.table(
    counts
  );
}

/* =========================================================
   INIT
========================================================= */

function init() {
  setupSearch();

  setupGoals();

  setupCategories();

  createPlanner();

  setupAI();

  setupDealTracking();

  setupKeyboard();

  loadProducts().then(
    () => {
      debugProductCategories();
    }
  );
}

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    init
  );
} else {
  init();
    }
