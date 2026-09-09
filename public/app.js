"use strict";

/*
 * FitDealFinder.nl
 * Frontend application
 *
 * Aansluiting op:
 * - public/index.html
 * - public/styles.css
 * - worker.ts
 * - D1 products API
 *
 * Geen externe libraries nodig.
 *
 * BELANGRIJK:
 * FitDealFinder is GEEN webshop.
 * Er is daarom geen winkelmandfunctionaliteit.
 * Alle acties leiden naar de betreffende winkel.
 */

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
  loading: false
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

function renderAIText(value) {
  let text = String(value ?? "");

  /*
   * Eerst volledig escapen.
   * AI-output mag nooit rechtstreeks
   * als HTML worden geïnjecteerd.
   */
  text = escapeHtml(text);

  /*
   * Markdown-links:
   * [Bekijk deal](https://...)
   */
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi,
    (match, label, url) => {
      const safeUrl =
        safeHttpUrl(url);

      if (!safeUrl) {
        return label;
      }

      return `
        <a
          href="${escapeHtml(safeUrl)}"
          target="_blank"
          rel="noopener noreferrer nofollow"
          class="ai-inline-link"
        >
          ${label}
        </a>
      `;
    }
  );

  /*
   * Vet:
   * **tekst**
   */
  text = text.replace(
    /\*\*([^*]+)\*\*/g,
    "<strong>$1</strong>"
  );

  /*
   * Kale HTTPS/HTTP-links klikbaar maken.
   */
  text = text.replace(
    /(^|[\s>])(https?:\/\/[^\s<]+)/gi,
    (match, prefix, url) => {
      const cleanUrl =
        url.replace(
          /[.,!?;:]+$/,
          ""
        );

      const trailing =
        url.slice(
          cleanUrl.length
        );

      const safeUrl =
        safeHttpUrl(cleanUrl);

      if (!safeUrl) {
        return match;
      }

      return `
        ${prefix}
        <a
          href="${escapeHtml(safeUrl)}"
          target="_blank"
          rel="noopener noreferrer nofollow"
          class="ai-inline-link"
        >
          ${escapeHtml(cleanUrl)}
        </a>${escapeHtml(trailing)}
      `;
    }
  );

  /*
   * Nieuwe regels behouden.
   */
  text = text.replace(
    /\n/g,
    "<br>"
  );

  return text;
}

function price(product) {
  const value = Number(product?.price);

  return Number.isFinite(value)
    ? value
    : 0;
}

function money(value, currency = "EUR") {
  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: currency || "EUR"
    }).format(Number(value) || 0);
  } catch {
    return `€ ${Number(value || 0)
      .toFixed(2)
      .replace(".", ",")}`;
  }
}

function productText(product) {
  return normalize([
    product?.name,
    product?.brand,
    product?.merchant_name,
    product?.category,
    product?.description,
    Array.isArray(product?.goals)
      ? product.goals.join(" ")
      : product?.goals
  ].join(" "));
}

function scrollToDeals() {
  const deals = $("#deals");

  if (deals) {
    deals.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}


/* =========================================================
   PRODUCT VALIDATION
========================================================= */

const BAD_WORDS = [
  "drinkbeker",
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
  "receptenboek"
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
    productText(product);

  return !BAD_WORDS.some(word =>
    text.includes(normalize(word))
  );
}


/* =========================================================
   GOAL DEFINITIONS
========================================================= */

const CUT_STRONG_WORDS = [
  "fat burner",
  "fatburner",
  "thermogenic",
  "weight loss",
  "gewichtsverlies",
  "afvallen",
  "l-carnitine",
  "carnitine"
];

const CUT_MEDIUM_WORDS = [
  "caffeine",
  "cafeine",
  "cla",
  "cut",
  "cutting",
  "shred",
  "burn"
];

const BULK_STRONG_WORDS = [
  "mass gainer",
  "mass-gainer",
  "weight gainer",
  "weight-gainer",
  "gainer"
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
  "oats"
];

const BULK_SUPPORT_WORDS = [
  "protein",
  "proteine",
  "whey",
  "creatine"
];

const LEAN_BULK_STRONG_WORDS = [
  "whey isolate",
  "whey-isolate",
  "isolate",
  "isolaat",
  "casein",
  "caseine"
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
  "lean mass"
];

const GENERAL_SUPPLEMENT_WORDS = [
  "protein",
  "proteine",
  "whey",
  "casein",
  "caseine",
  "creatine",
  "pre workout",
  "pre-workout",
  "preworkout",
  "bcaa",
  "amino",
  "amino acid",
  "vitamin",
  "mineral",
  "magnesium",
  "zinc",
  "omega",
  "collagen",
  "collageen",
  "electrolyte",
  "electrolytes",
  "supplement",
  "supplementen",
  "nutrition",
  "mass",
  "gainer",
  "caffeine",
  "cafeine",
  "carnitine",
  "l-carnitine",
  "beta alanine",
  "citrulline",
  "pump"
];


/* =========================================================
   GOAL MATCHING
========================================================= */

function hasAny(text, words) {
  return words.some(word =>
    text.includes(normalize(word))
  );
}

function goalScore(product, goal) {
  if (!isUsableProduct(product)) {
    return 0;
  }

  const text =
    normalize([
      product?.name,
      product?.brand,
      product?.category
    ].join(" "));

  const normalizedGoal =
    normalize(goal);

  if (normalizedGoal === "cut") {
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

    return 0;
  }

  if (normalizedGoal === "bulk") {
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

function matchesGoal(product, goal) {
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
   CATEGORIES
========================================================= */

function matchesCategory(product, category) {
  if (!category) {
    return true;
  }

  const normalizedCategory =
    normalize(category);

  const categoryText =
    normalize([
      product?.name,
      product?.brand,
      product?.category
    ].join(" "));

  if (
    normalizedCategory ===
    "proteine"
  ) {
    return hasAny(categoryText, [
      "protein",
      "proteine",
      "whey",
      "whey protein",
      "casein",
      "caseine",
      "isolate",
      "isolaat"
    ]);
  }

  if (
    normalizedCategory ===
    "creatine"
  ) {
    return hasAny(categoryText, [
      "creatine",
      "creatine monohydrate",
      "creatine hcl"
    ]);
  }

  if (
    normalizedCategory ===
    "pre-workout"
  ) {
    return hasAny(categoryText, [
      "pre workout",
      "pre-workout",
      "preworkout"
    ]);
  }

  if (
    normalizedCategory ===
    "supplementen"
  ) {
    return hasAny(
      categoryText,
      GENERAL_SUPPLEMENT_WORDS
    );
  }

  return false;
}


/* =========================================================
   SEARCH
========================================================= */

function matchesSearch(product, query) {
  if (!query) {
    return true;
  }

  const words =
    normalize(query)
      .split(/\s+/)
      .filter(Boolean);

  const text =
    productText(product);

  return words.every(word =>
    text.includes(word)
  );
}


/* =========================================================
   FILTER PIPELINE
========================================================= */

function applyFilters() {
  const query =
    normalize(state.search);

  state.filtered =
    state.products
      .filter(isUsableProduct)
      .filter(product =>
        matchesSearch(
          product,
          query
        )
      )
      .filter(product =>
        matchesGoal(
          product,
          state.goal
        )
      )
      .filter(product =>
        matchesCategory(
          product,
          state.category
        )
      );

  state.filtered.sort((a, b) => {
    if (state.goal) {
      const goalA =
        goalScore(
          a,
          state.goal
        );

      const goalB =
        goalScore(
          b,
          state.goal
        );

      if (
        goalA !== goalB
      ) {
        return goalB - goalA;
      }
    }

    const scoreA =
      Number(a.deal_score) || 0;

    const scoreB =
      Number(b.deal_score) || 0;

    if (
      scoreA !== scoreB
    ) {
      return scoreB - scoreA;
    }

    const discountA =
      Number(a.discount_percent) || 0;

    const discountB =
      Number(b.discount_percent) || 0;

    if (
      discountA !== discountB
    ) {
      return discountB - discountA;
    }

    return price(a) - price(b);
  });

  state.visibleCount =
    PRODUCTS_PER_VIEW;

  renderProducts();
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

      const response =
        await fetch(url, {
          headers: {
            Accept:
              "application/json"
          }
        });

      if (!response.ok) {
        throw new Error(
          `Product API gaf status ${response.status}`
        );
      }

      const data =
        await response.json();

      const batch =
        Array.isArray(data)
          ? data
          : Array.isArray(
              data.products
            )
            ? data.products
            : Array.isArray(
                data.data
              )
              ? data.data
              : [];

      products.push(...batch);

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

    applyFilters();

  } catch (error) {
    console.error(
      "FitDealFinder product loading error:",
      error
    );

    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>
            Deals konden niet worden geladen
          </h3>

          <p>
            Er ging iets mis met het
            ophalen van de producten.
            Probeer de pagina opnieuw
            te laden.
          </p>
        </div>
      `;
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
    Number(product.old_price) || 0;

  const hasDiscount =
    oldPriceValue >
    currentPrice;

  const discount =
    Number(product.discount_percent) > 0
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
          src="${escapeHtml(product.image_url)}"
          alt="${escapeHtml(product.name)}"
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
    Number(product.in_stock) === 1
      ? `<span class="stock">Op voorraad</span>`
      : `<span class="stock out">Niet op voorraad</span>`;

  const brand =
    product.brand ||
    product.merchant_name ||
    "Fitness";

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
            href="/go/${encodeURIComponent(
              String(product.id)
            )}"
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
          Pas je zoekopdracht,
          doel of categorie aan.
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

function updateProductCount(count) {
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
    event => {
      event.preventDefault();

      state.search =
        input.value || "";

      state.goal = "";
      state.category = "";

      $all(
        "[data-goal]"
      ).forEach(button =>
        button.classList.remove(
          "active"
        )
      );

      $all(
        "[data-category]"
      ).forEach(button =>
        button.classList.remove(
          "active"
        )
      );

      applyFilters();
      scrollToDeals();
    }
  );

  input.addEventListener(
    "input",
    () => {
      state.search =
        input.value || "";

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
  ).forEach(button => {
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

        state.category = "";

        $all(
          "[data-goal]"
        ).forEach(item => {
          item.classList.toggle(
            "active",
            item === button &&
              state.goal === goal
          );
        });

        $all(
          "[data-category]"
        ).forEach(item =>
          item.classList.remove(
            "active"
          )
        );

        applyFilters();
        scrollToDeals();
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
  ).forEach(button => {
    button.addEventListener(
      "click",
      () => {
        const category =
          normalize(
            button.dataset.category
          );

        state.category =
          state.category === category
            ? ""
            : category;

        state.goal = "";

        $all(
          "[data-category]"
        ).forEach(item => {
          item.classList.toggle(
            "active",
            item === button &&
              state.category ===
                category
          );
        });

        $all(
          "[data-goal]"
        ).forEach(item =>
          item.classList.remove(
            "active"
          )
        );

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
  "kokoswater",
  "water",
  "drink",
  "drank",
  "juice",
  "sap",
  "soda",
  "limonade",
  "thee",
  "koffie",
  "collageen",
  "collagen",
  "citrulline",
  "beta alanine",
  "pump",
  "vitamin",
  "vitamine",
  "mineral",
  "magnesium",
  "zinc",
  "omega"
];

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
      $("#planner-result")
  };
}

function plannerText(product) {
  return normalize([
    product?.name,
    product?.brand,
    product?.category
  ].join(" "));
}

function plannerProductScore(
  product,
  goal
) {
  if (
    !isUsableProduct(product)
  ) {
    return 0;
  }

  const text =
    plannerText(product);

  if (
    PLANNER_EXCLUDED_WORDS.some(
      word =>
        text.includes(
          normalize(word)
        )
    )
  ) {
    return 0;
  }

  return goalScore(
    product,
    goal
  );
}

function plannerProductKey(
  product
) {
  let name =
    normalize(
      product?.name || ""
    );

  name = name
    .replace(
      /\btablets?\b/g,
      ""
    )
    .replace(
      /\btabs?\b/g,
      ""
    )
    .replace(
      /\bcapsules?\b/g,
      ""
    )
    .replace(
      /\bcaps?\b/g,
      ""
    )
    .replace(
      /\bsoftgels?\b/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

  return name;
}


/* =========================================================
   SHOPPING PLANNER STYLES
========================================================= */

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

    .planner-result-item {
      display: grid;
      grid-template-columns:
        65px 1fr;
      align-items: center;
      gap: 16px;
      padding: 22px;
      border:
        1px solid
        rgba(255,255,255,.08);
      border-radius: 20px;
      background:
        rgba(3,7,18,.55);
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
      transition: .2s ease;
    }

    .planner-deal-button:hover {
      background: #00bd43;
      transform: translateY(-1px);
    }

    @media (max-width: 700px) {
      .planner-result-item {
        grid-template-columns:
          65px 1fr;
        gap: 14px;
        padding: 18px;
      }

      .planner-product-image {
        grid-column: 1;
        grid-row: 1;
      }

      .planner-product-info {
        grid-column: 2;
        grid-row: 1;
      }

      .planner-product-link strong {
        font-size: 17px;
      }

      .planner-product-price {
        font-size: 17px;
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


/* =========================================================
   CREATE SHOPPING PLANNER
========================================================= */

function createPlanner() {
  const {
    container,
    goal,
    budget,
    result
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
    event => {
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

      const candidates =
        state.products
          .map(product => ({
            product,
            score:
              plannerProductScore(
                product,
                selectedGoal
              )
          }))
          .filter(item =>
            item.score > 0
          )
          .filter(item =>
            price(item.product) <=
            maxBudget
          )
          .sort((a, b) => {
            if (
              b.score !==
              a.score
            ) {
              return (
                b.score -
                a.score
              );
            }

            const dealA =
              Number(
                a.product.deal_score
              ) || 0;

            const dealB =
              Number(
                b.product.deal_score
              ) || 0;

            if (
              dealB !==
              dealA
            ) {
              return (
                dealB -
                dealA
              );
            }

            const discountA =
              Number(
                a.product
                  .discount_percent
              ) || 0;

            const discountB =
              Number(
                b.product
                  .discount_percent
              ) || 0;

            if (
              discountB !==
              discountA
            ) {
              return (
                discountB -
                discountA
              );
            }

            return (
              price(a.product) -
              price(b.product)
            );
          })
          .map(item =>
            item.product
          );

      const seen =
        new Set();

      let shortlistTotal = 0;

      const shortlist =
        candidates
          .filter(product => {
            const key =
              plannerProductKey(
                product
              );

            if (
              !key ||
              seen.has(key)
            ) {
              return false;
            }

            const productPrice =
              price(product);

            if (
              shortlistTotal +
                productPrice >
              maxBudget + 0.001
            ) {
              return false;
            }

            seen.add(key);

            shortlistTotal +=
              productPrice;

            return true;
          })
          .slice(0, 5);

      if (
        !shortlist.length
      ) {
        result.innerHTML = `
          <p>
            Binnen dit budget vonden
            we nu geen passende
            producten voor
            ${escapeHtml(
              selectedGoal
            )}.
          </p>
        `;

        return;
      }

      result.innerHTML = `
        <div class="planner-results">

          ${shortlist
            .map(
              product => {
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

                return `
                  <div
                    class="planner-result-item"
                  >

                    <a
                      href="${dealUrl}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="planner-product-image"
                      aria-label="Bekijk deal van ${escapeHtml(
                        product.name
                      )}"
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

                      <span
                        class="planner-product-price"
                      >
                        ${money(
                          price(product),
                          product.currency
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
              }
            )
            .join("")}

        </div>
      `;
    }
  );
}


/* =========================================================
   AI PRODUCT SEARCH
========================================================= */

const AI_PRODUCT_STOP_WORDS = [
  "zoek",
  "vind",
  "vinden",
  "geef",
  "geeft",
  "laat",
  "zien",
  "mij",
  "me",
  "de",
  "het",
  "een",
  "voor",
  "van",
  "op",
  "in",
  "bij",
  "met",
  "goedkoopste",
  "goedkoop",
  "beste",
  "deal",
  "deals",
  "prijs",
  "prijzen",
  "product",
  "producten",
  "hebben",
  "kan",
  "je",
  "kun",
  "jij",
  "wil",
  "ik",
  "wat",
  "welke",
  "waar",
  "is",
  "zijn",
  "momenteel",
  "nu",
  "site",
  "website"
];

function detectAIProductQuery(message) {
  const text =
    normalize(message);

  const productTerms = [
    "creatine",
    "creatine monohydraat",
    "creatine monohydrate",
    "protein",
    "proteine",
    "whey",
    "whey protein",
    "whey isolate",
    "isolaat",
    "isolate",
    "casein",
    "caseine",
    "pre workout",
    "pre-workout",
    "preworkout",
    "mass gainer",
    "gainer",
    "bcaa",
    "amino",
    "carnitine",
    "fat burner",
    "fatburner",
    "cafeine",
    "caffeine",
    "magnesium",
    "omega",
    "electrolyte",
    "electrolytes"
  ];

  const hasProductTerm =
    productTerms.some(term =>
      text.includes(
        normalize(term)
      )
    );

  const hasSearchIntent =
    [
      "zoek",
      "vind",
      "goedkoopste",
      "goedkoop",
      "beste",
      "deal",
      "deals",
      "prijs",
      "prijzen",
      "welke",
      "waar"
    ].some(term =>
      text.includes(term)
    );

  if (
    !hasProductTerm ||
    !hasSearchIntent
  ) {
    return null;
  }

  let query =
    text;

  for (
    const word of AI_PRODUCT_STOP_WORDS
  ) {
    query =
      query.replace(
        new RegExp(
          `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "gi"
        ),
        " "
      );
  }

  query =
    query
      .replace(
        /[€$£]\s*\d+(?:[.,]\d+)?/g,
        " "
      )
      .replace(
        /\d+(?:[.,]\d+)?\s*(?:euro|eur)/gi,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  /*
   * Specifieke termen behouden wanneer
   * de algemene schoonmaak ze heeft
   * aangeraakt.
   */
  for (
    const term of productTerms
  ) {
    if (
      text.includes(
        normalize(term)
      )
    ) {
      query =
        `${query} ${normalize(term)}`
          .replace(
            /\s+/g,
            " "
          )
          .trim();
    }
  }

  return {
    query,
    cheapest:
      text.includes("goedkoopste") ||
      text.includes("goedkoop"),

    best:
      text.includes("beste") ||
      text.includes("deal")
  };
}

function findAIProducts(message) {
  const queryData =
    detectAIProductQuery(
      message
    );

  if (!queryData) {
    return null;
  }

  const {
    query,
    cheapest,
    best
  } =
    queryData;

  let candidates =
    state.products
      .filter(isUsableProduct)
      .filter(product =>
        matchesSearch(
          product,
          query
        )
      );

  /*
   * Wanneer de zoekterm door
   * Nederlandse woorden moeilijk
   * wordt, proberen we specifiek
   * de productsoort te herkennen.
   */
  if (!candidates.length) {
    const text =
      normalize(message);

    if (
      text.includes("creatine")
    ) {
      candidates =
        state.products
          .filter(isUsableProduct)
          .filter(product =>
            hasAny(
              productText(product),
              [
                "creatine"
              ]
            )
          );
    } else if (
      text.includes("whey") ||
      text.includes("protein") ||
      text.includes("proteine")
    ) {
      candidates =
        state.products
          .filter(isUsableProduct)
          .filter(product =>
            hasAny(
              productText(product),
              [
                "whey",
                "protein",
                "proteine"
              ]
            )
          );
    } else if (
      text.includes("pre workout") ||
      text.includes("pre-workout") ||
      text.includes("preworkout")
    ) {
      candidates =
        state.products
          .filter(isUsableProduct)
          .filter(product =>
            hasAny(
              productText(product),
              [
                "pre workout",
                "pre-workout",
                "preworkout"
              ]
            )
          );
    }
  }

  if (!candidates.length) {
    return {
      query,
      products: [],
      cheapest,
      best
    };
  }

  candidates =
    candidates
      .slice()
      .sort((a, b) => {
        if (
          cheapest
        ) {
          return (
            price(a) -
            price(b)
          );
        }

        const dealA =
          Number(
            a.deal_score
          ) || 0;

        const dealB =
          Number(
            b.deal_score
          ) || 0;

        if (
          dealA !==
          dealB
        ) {
          return (
            dealB -
            dealA
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
      })
      .slice(0, 5);

  return {
    query,
    products: candidates,
    cheapest,
    best
  };
}

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

  const firstProduct =
    result.products[0];

  const title =
    result.cheapest
      ? "Goedkoopste passende deal"
      : result.best
        ? "Beste passende deals"
        : "Passende deals";

  const intro =
    result.cheapest
      ? "Ik heb de actuele producten in FitDealFinder doorzocht en gesorteerd op prijs."
      : "Ik heb de actuele producten in FitDealFinder gevonden.";

  const items =
    result.products
      .map(
        (product, index) => {
          const dealUrl =
            `/go/${encodeURIComponent(
              String(product.id)
            )}`;

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
                <div class="ai-product-placeholder">
                  FitDealFinder
                </div>
              `;

          const oldPrice =
            Number(
              product.old_price
            ) || 0;

          const discount =
            Number(
              product.discount_percent
            ) || 0;

          return `
            <div
              class="ai-product-result-item"
            >

              <a
                href="${dealUrl}"
                target="_blank"
                rel="noopener noreferrer"
                class="ai-product-result-image"
                aria-label="Bekijk deal van ${escapeHtml(
                  product.name
                )}"
              >
                ${image}
              </a>

              <div
                class="ai-product-result-info"
              >

                ${
                  index === 0
                    ? `
                      <span
                        class="ai-product-result-badge"
                      >
                        ${result.cheapest ? "Goedkoopste" : "Top deal"}
                      </span>
                    `
                    : ""
                }

                <a
                  href="${dealUrl}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="ai-product-result-name"
                >
                  ${escapeHtml(
                    product.name
                  )}
                </a>

                <span
                  class="ai-product-result-merchant"
                >
                  ${escapeHtml(
                    product.merchant_name ||
                    "Winkel onbekend"
                  )}
                </span>

                <div
                  class="ai-product-result-price"
                >
                  <strong>
                    ${escapeHtml(
                      money(
                        price(product),
                        product.currency
                      )
                    )}
                  </strong>

                  ${
                    oldPrice >
                    price(product)
                      ? `
                        <span class="old-price">
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
                        <span class="discount">
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
          `;
        }
      )
      .join("");

  const firstName =
    firstProduct?.name ||
    "";

  const firstPrice =
    money(
      price(firstProduct),
      firstProduct.currency
    );

  const firstMerchant =
    firstProduct.merchant_name ||
    "onbekende winkel";

  const summary =
    result.cheapest
      ? `
        De goedkoopste passende optie
        die ik nu in FitDealFinder vind is
        <strong>${escapeHtml(
          firstName
        )}</strong>
        van
        <strong>${escapeHtml(
          firstMerchant
        )}</strong>
        voor
        <strong>${escapeHtml(
          firstPrice
        )}</strong>.
      `
      : `
        Ik heb ${result.products.length}
        passende deals gevonden in
        FitDealFinder.
      `;

  const responseBox =
    $("#ai-response");

  if (!responseBox) {
    return false;
  }

  responseBox.innerHTML = `
    <div class="ai-product-search">

      <h3>
        ${escapeHtml(title)}
      </h3>

      <p>
        ${escapeHtml(intro)}
      </p>

      <p class="ai-product-search-summary">
        ${summary}
      </p>

      <div class="ai-product-result-list">
        ${items}
      </div>

      <p class="ai-product-search-note">
        Prijzen en voorraad kunnen door de
        betreffende winkel worden gewijzigd.
      </p>

    </div>
  `;

  return true;
}


/* =========================================================
   AI SEARCH STYLES
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

    .ai-product-search {
      display: grid;
      gap: 14px;
    }

    .ai-product-search h3 {
      margin: 0;
    }

    .ai-product-search p {
      margin: 0;
      line-height: 1.65;
    }

    .ai-product-search-summary {
      line-height: 1.7;
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
      border:
        1px solid
        rgba(255,255,255,.08);
      border-radius: 16px;
      background:
        rgba(3,7,18,.55);
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

    .ai-product-result-price .old-price {
      color: #8d99aa;
      font-size: 13px;
      text-decoration: line-through;
    }

    .ai-product-result-price .discount {
      color: #67e5a2;
      font-size: 12px;
      font-weight: 900;
    }

    .ai-product-result-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 42px;
      margin-top: 10px;
      padding: 0 14px;
      border-radius: 10px;
      background: #00a83b;
      color: #fff !important;
      font-weight: 900;
      text-decoration: none;
      transition: .2s ease;
    }

    .ai-product-result-button:hover {
      background: #00bd43;
      transform: translateY(-1px);
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

      .ai-product-result-price strong {
        font-size: 17px;
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

  function extractBudget(message) {
    const match =
      String(message || "").match(
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

    return Number.isFinite(value) &&
      value > 0
      ? value
      : null;
  }

  function detectGoal(message) {
    const text =
      normalize(message);

    if (
      text.includes("lean bulk") ||
      text.includes("lean-bulk") ||
      text.includes("leanbulk")
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
      text.includes("vet verliezen")
    ) {
      return "cut";
    }

    return "";
  }

  function productTextForPackage(product) {
    return normalize(
      [
        product.name,
        product.brand,
        product.category
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  function hasWord(
    product,
    words
  ) {
    const text =
      productTextForPackage(
        product
      );

    return words.some(word =>
      text.includes(
        normalize(word)
      )
    );
  }

  function packageRole(
    product,
    goal
  ) {
    const text =
      productTextForPackage(
        product
      );

    const excluded = [
      "water",
      "kokoswater",
      "drink",
      "drank",
      "juice",
      "sap",
      "soda",
      "limonade",
      "thee",
      "koffie",
      "collageen",
      "collagen",
      "vitamine",
      "vitamin",
      "mineral",
      "magnesium",
      "zinc",
      "omega"
    ];

    if (
      excluded.some(
        word =>
          text.includes(word)
      )
    ) {
      return "";
    }

    const isProtein =
      hasWord(
        product,
        [
          "protein",
          "proteine",
          "whey",
          "casein",
          "caseine",
          "isolaat",
          "isolate"
        ]
      );

    const isCreatine =
      hasWord(
        product,
        [
          "creatine"
        ]
      );

    const isCarb =
      hasWord(
        product,
        [
          "gainer",
          "mass",
          "carb",
          "carbs",
          "carbohydrate",
          "havermout",
          "oats",
          "oat"
        ]
      );

    const isCutSupport =
      hasWord(
        product,
        [
          "fat burner",
          "fatburner",
          "thermogenic",
          "caffeine",
          "cafeine",
          "carnitine",
          "l-carnitine",
          "cla",
          "shred",
          "burn"
        ]
      );

    if (
      goal === "bulk"
    ) {
      if (isProtein) {
        return "protein";
      }

      if (isCarb) {
        return "carb";
      }

      if (isCreatine) {
        return "creatine";
      }

      return "";
    }

    if (
      goal === "lean-bulk"
    ) {
      if (isProtein) {
        return "protein";
      }

      if (isCarb) {
        return "carb";
      }

      if (isCreatine) {
        return "creatine";
      }

      return "";
    }

    if (
      goal === "cut"
    ) {
      if (isProtein) {
        return "protein";
      }

      if (isCutSupport) {
        return "cut-support";
      }

      if (isCreatine) {
        return "creatine";
      }

      return "";
    }

    if (isProtein) {
      return "protein";
    }

    if (isCreatine) {
      return "creatine";
    }

    return "";
  }

  function sortPackageCandidates(
    products
  ) {
    return products
      .slice()
      .sort((a, b) => {
        const priceA =
          price(a);

        const priceB =
          price(b);

        if (
          priceA !==
          priceB
        ) {
          return (
            priceA -
            priceB
          );
        }

        const dealA =
          Number(
            a.deal_score
          ) || 0;

        const dealB =
          Number(
            b.deal_score
          ) || 0;

        return (
          dealB -
          dealA
        );
      });
  }

  let currentGoal = "";

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

    currentGoal =
      goal;

    if (
      budget === null
    ) {
      return {
        ok: false,
        reason:
          "Geef een budget op, bijvoorbeeld €75."
      };
    }

    if (!goal) {
      return {
        ok: false,
        reason:
          "Geef ook een doel op: cut, bulk of lean bulk."
      };
    }

    const products =
      state.products
        .filter(
          isUsableProduct
        )
        .filter(
          product =>
            price(product) <=
            budget
        );

    if (
      !products.length
    ) {
      return {
        ok: false,
        reason:
          "Er zijn geen geschikte producten binnen dit budget gevonden."
      };
    }

    let requiredRoles =
      [];

    if (
      goal === "bulk"
    ) {
      requiredRoles = [
        "protein",
        "carb",
        "creatine"
      ];
    }

    if (
      goal === "lean-bulk"
    ) {
      requiredRoles = [
        "protein",
        "carb",
        "creatine"
      ];
    }

    if (
      goal === "cut"
    ) {
      requiredRoles = [
        "protein",
        "cut-support",
        "creatine"
      ];
    }

    const selected = [];
    const usedIds =
      new Set();

    function tryBuildPackage(
      roles,
      index,
      remaining
    ) {
      if (
        index >=
        roles.length
      ) {
        return selected.slice();
      }

      const role =
        roles[index];

      const candidates =
        sortPackageCandidates(
          products.filter(
            product => {
              if (
                !isUsableProduct(
                  product
                )
              ) {
                return false;
              }

              const id =
                product.id ||
                product.external_id ||
                product.slug ||
                product.name;

              if (
                usedIds.has(
                  String(id)
                )
              ) {
                return false;
              }

              if (
                packageRole(
                  product,
                  goal
                ) !== role
              ) {
                return false;
              }

              return (
                price(product) <=
                remaining
              );
            }
          )
        );

      for (
        const candidate of candidates
      ) {
        const id =
          candidate.id ||
          candidate.external_id ||
          candidate.slug ||
          candidate.name;

        usedIds.add(
          String(id)
        );

        selected.push(
          candidate
        );

        const result =
          tryBuildPackage(
            roles,
            index + 1,
            remaining -
              price(candidate)
          );

        if (result) {
          return result;
        }

        selected.pop();

        usedIds.delete(
          String(id)
        );
      }

      return null;
    }

    const completePackage =
      tryBuildPackage(
        requiredRoles,
        0,
        budget
      );

    if (
      !completePackage
    ) {
      return {
        ok: false,
        reason:
          `Ik kan met de huidige producten geen compleet ${goal} pakket binnen €${budget.toFixed(2).replace(".", ",")} samenstellen.`
      };
    }

    const total =
      completePackage.reduce(
        (
          sum,
          product
        ) =>
          sum +
          price(product),
        0
      );

    if (
      total >
      budget + 0.001
    ) {
      return {
        ok: false,
        reason:
          "Er is geen geldig pakket binnen het opgegeven budget gevonden."
      };
    }

    return {
      ok: true,
      goal,
      budget,
      products:
        completePackage,
      total
    };
  }

  function renderExactPackage(
    packageData
  ) {
    const {
      goal,
      budget,
      products,
      total
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

    const items =
      products
        .map(
          product => {
            const productPrice =
              price(product);

            const image =
              product.image_url
                ? `
                  <img
                    src="${escapeHtml(product.image_url)}"
                    alt="${escapeHtml(product.name)}"
                    loading="lazy"
                    width="65"
                    height="65"
                    onerror="this.style.display='none'"
                  >
                `
                : `
                  <div
                    class="product-image-placeholder"
                  >
                    FitDealFinder
                  </div>
                `;

            const dealUrl =
              `/go/${encodeURIComponent(
                String(product.id)
              )}`;

            return `
              <div
                class="ai-package-item"
              >

                <a
                  href="${dealUrl}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="ai-package-product-image"
                  aria-label="Bekijk deal van ${escapeHtml(
                    product.name
                  )}"
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
          }
        )
        .join("");

    responseBox.innerHTML = `
      <div class="ai-package">

        <h3>
          ${goalLabel} pakket
        </h3>

        <p>
          Ik heb het pakket samengesteld
          uit echte producten die momenteel
          in FitDealFinder staan.
        </p>

        <div class="ai-package-list">
          ${items}
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


  /* =======================================================
     AI PACKAGE STYLES
  ======================================================= */

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
        object-position: center !important;
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
        transition: .2s ease;
      }

      .ai-package-deal-button:hover {
        background: #00bd43;
        transform: translateY(-1px);
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


  /* =======================================================
     AI FORM
  ======================================================= */

  injectAIPackageStyles();

  form.addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const message =
        input.value.trim();

      if (!message) {
        return;
      }

      /*
       * -----------------------------------------------------
       * ECHTE PRODUCTZOEKOPDRACHT
       * -----------------------------------------------------
       *
       * Bijvoorbeeld:
       *
       * "zoek de goedkoopste creatine"
       * "wat is de goedkoopste whey?"
       * "zoek een goede pre workout"
       *
       * Deze vragen worden eerst tegen de echte
       * FitDealFinder-productdatabase gehouden.
       *
       * De AI krijgt dus niet de kans om zelf
       * een product, prijs of link te verzinnen.
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

        /*
         * Als er geen producten zijn,
         * mag de gewone AI uitleggen dat
         * er momenteel niets gevonden is.
         */
        responseBox.innerHTML = `
          <div class="ai-response-content">
            <p>
              Ik heb de actuele producten van
              FitDealFinder gecontroleerd,
              maar kon op dit moment geen
              passende producten vinden.
            </p>
          </div>
        `;

        return;
      }

      const isPackageRequest =
        /pakket|pakketje|samenstellen|bundel|combinatie|set/i.test(
          message
        );

      /*
       * Pakketverzoeken worden niet
       * door AI bepaald.
       *
       * Eerst wordt het pakket
       * wiskundig correct opgebouwd.
       */

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

          /*
           * AI geeft alleen uitleg.
           *
           * AI mag geen producten,
           * prijzen of totaal aanpassen.
           */

          try {
            const productLines =
              packageData.products
                .map(
                  product =>
                    `- ${product.name} | ${money(price(product), product.currency)} | ${product.merchant_name || "onbekende winkel"}`
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
              await fetch(
                API_AI,
                {
                  method: "POST",
                  headers: {
                    "Content-Type":
                      "application/json",
                    Accept:
                      "application/json"
                  },
                  body:
                    JSON.stringify({
                      message:
                        explanationRequest
                    })
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

              if (
                answer
              ) {
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
              worden samengesteld. Probeer het
              opnieuw.
            </p>
          `;

          return;
        }
      }


      /*
       * -----------------------------------------------------
       * GEWONE AI-VRAGEN
       * -----------------------------------------------------
       */

      responseBox.innerHTML = `
        <p>
          Even nadenken...
        </p>
      `;

      try {
        const response =
          await fetch(
            API_AI,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                Accept:
                  "application/json"
              },
              body:
                JSON.stringify({
                  message
                })
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
          <div class="ai-response-content">
            ${renderAIText(answer)}
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
  /*
   * Tracking gebeurt server-side via
   * /go/:id.
   *
   * Er wordt hier geen extra
   * /api/click endpoint aangeroepen.
   *
   * Daardoor kan tracking nooit
   * de daadwerkelijke dealklik
   * blokkeren.
   */
  document.addEventListener(
    "click",
    event => {
      const link =
        event.target.closest(
          'a[href^="/go/"]'
        );

      if (!link) {
        return;
      }

      /*
       * Geen preventDefault.
       *
       * De browser volgt gewoon
       * de /go/:id redirect.
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
    event => {
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
        state.visibleCount +=
          PRODUCTS_PER_VIEW;

        renderProducts();
      }
    );
  }
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

  loadProducts();
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
