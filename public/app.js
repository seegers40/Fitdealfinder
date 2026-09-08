const API_PRODUCTS = "/api/products";
const API_AI = "/api/ai/chat";

const PAGE_SIZE = 24;
const API_PAGE_SIZE = 200;
const MAX_PRODUCTS = 2000;

const state = {
  products: [],
  filtered: [],
  search: "",
  goal: "",
  category: "",
  visibleCount: PAGE_SIZE,
  loading: false
};

/* =========================================================
   HELPERS
========================================================= */

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_/]+/g, " ")
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

function formatPrice(price, currency = "EUR") {
  const value = Number(price);

  if (!Number.isFinite(value)) {
    return "";
  }

  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: currency || "EUR"
    }).format(value);
  } catch {
    return `€ ${value.toFixed(2).replace(".", ",")}`;
  }
}

function getGoals(product) {
  const raw = product?.goals;

  if (Array.isArray(raw)) {
    return raw.map(normalizeText).filter(Boolean);
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizeText)
          .filter(Boolean);
      }
    } catch {
      return raw
        .split(",")
        .map(normalizeText)
        .filter(Boolean);
    }
  }

  return [];
}

function productIsUsable(product) {
  return Boolean(
    product &&
    product.id &&
    product.name &&
    product.product_url
  );
}

/* =========================================================
   PRODUCT TEXT
========================================================= */

function productText(product) {
  return normalizeText([
    product?.name,
    product?.brand,
    product?.merchant_name,
    product?.category,
    product?.description
  ].join(" "));
}

/* =========================================================
   CATEGORY MATCHING
========================================================= */

const CATEGORY_RULES = {
  proteine: [
    "proteine",
    "protein",
    "whey",
    "whey protein",
    "clear whey",
    "clear protein",
    "whey isolate",
    "whey isolaat",
    "isolate",
    "isolaat",
    "casein",
    "caseine",
    "caseïne",
    "eiwit",
    "eiwitpoeder",
    "egg protein",
    "beef protein",
    "vegan protein",
    "plant protein",
    "rice protein",
    "pea protein",
    "soy protein",
    "soya protein",
    "mass gainer",
    "massgainer",
    "gainer"
  ],

  creatine: [
    "creatine",
    "creatine monohydraat",
    "creatine monohydrate",
    "creatine powder",
    "creatine poeder",
    "creatine capsule",
    "creatine capsules",
    "creatine caps",
    "creatine tab",
    "creatine tabs",
    "creatine tablet",
    "creatine tablets"
  ],

  "pre-workout": [
    "pre workout",
    "pre-workout",
    "preworkout",
    "pre training",
    "pre-training",
    "nox",
    "pump",
    "5150"
  ],

  supplementen: [
    "supplement",
    "supplementen",
    "vitamine",
    "vitamin",
    "multivitamine",
    "multivitamin",
    "mineral",
    "minerals",
    "omega",
    "amino",
    "amino acid",
    "bcaa",
    "eaa",
    "collageen",
    "collagen",
    "electrolyte",
    "electrolytes",
    "magnesium",
    "zink",
    "zinc",
    "cafeine",
    "caffeine",
    "fat burner",
    "fatburner",
    "thermogenic",
    "carnitine",
    "glutamine",
    "beta alanine",
    "arginine",
    "citrulline",
    "ashwagandha",
    "energy",
    "recovery",
    "hydration",
    "nutrition"
  ]
};

function matchesCategory(product, category) {
  const wanted = normalizeText(category);

  if (!wanted) {
    return true;
  }

  const text = productText(product);
  const rules = CATEGORY_RULES[wanted];

  if (!rules) {
    return normalizeText(product?.category) === wanted;
  }

  return rules.some((term) =>
    text.includes(normalizeText(term))
  );
}

/* =========================================================
   GOAL MATCHING
========================================================= */

function matchesGoal(product, goal) {
  const wanted = normalizeText(goal);

  if (!wanted) {
    return true;
  }

  const goals = getGoals(product);

  /*
   * Eerst de echte goals uit de database gebruiken.
   */
  if (goals.includes(wanted)) {
    return true;
  }

  /*
   * Sommige feeds kunnen goals als bijvoorbeeld
   * "lean bulk" of "lean-bulk" aanleveren.
   */
  if (
    wanted === "lean bulk" ||
    wanted === "lean-bulk"
  ) {
    if (
      goals.includes("lean bulk") ||
      goals.includes("lean-bulk")
    ) {
      return true;
    }
  }

  /*
   * Als een product geen bruikbare goals heeft,
   * kijken we naar productinformatie.
   */
  const text = productText(product);

  if (wanted === "cut") {
    return [
      "cut",
      "cutting",
      "afvallen",
      "fat loss",
      "fatloss",
      "weight loss",
      "fat burner",
      "fatburner"
    ].some((term) =>
      text.includes(normalizeText(term))
    );
  }

  if (wanted === "bulk") {
    return [
      "bulk",
      "bulking",
      "gainer",
      "mass gainer",
      "massgainer",
      "weight gainer",
      "spiermassa"
    ].some((term) =>
      text.includes(normalizeText(term))
    );
  }

  if (
    wanted === "lean bulk" ||
    wanted === "lean-bulk"
  ) {
    return [
      "lean bulk",
      "lean-bulk",
      "leanbulking",
      "spiermassa"
    ].some((term) =>
      text.includes(normalizeText(term))
    );
  }

  return false;
}

/* =========================================================
   SEARCH
========================================================= */

function matchesSearch(product, search) {
  const query = normalizeText(search);

  if (!query) {
    return true;
  }

  const text = productText(product);

  return text.includes(query);
}

/* =========================================================
   PRODUCT CARD
========================================================= */

function productCard(product) {
  const name = escapeHtml(product.name);
  const brand = escapeHtml(product.brand || "");
  const merchant = escapeHtml(
    product.merchant_name || ""
  );

  const image = escapeHtml(
    product.image_url || ""
  );

  const id = encodeURIComponent(product.id);

  const price = formatPrice(
    product.price,
    product.currency || "EUR"
  );

  const oldPrice =
    product.old_price != null &&
    Number(product.old_price) > Number(product.price)
      ? formatPrice(
          product.old_price,
          product.currency || "EUR"
        )
      : "";

  const discount =
    Number.isFinite(
      Number(product.discount_percent)
    ) &&
    Number(product.discount_percent) > 0
      ? `-${Math.round(
          Number(product.discount_percent)
        )}%`
      : "";

  const stock =
    Number(product.in_stock) === 1
      ? "Op voorraad"
      : "Controleer voorraad";

  const stockClass =
    Number(product.in_stock) === 1
      ? "in"
      : "out";

  const goals = getGoals(product);

  const goalBadges = goals
    .filter(Boolean)
    .slice(0, 3)
    .map(
      (goal) =>
        `<span class="product-goal">${escapeHtml(goal)}</span>`
    )
    .join("");

  const imageHtml = image
    ? `
      <img
        class="product-image"
        src="${image}"
        alt="${name}"
        loading="lazy"
        onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='grid';"
      >
      <div
        class="product-image-placeholder"
        style="display:none"
      >
        FIT
      </div>
    `
    : `
      <div class="product-image-placeholder">
        FIT
      </div>
    `;

  return `
    <article class="product-card">

      <a
        href="/go/${id}"
        aria-label="Bekijk ${name}"
      >
        ${imageHtml}
      </a>

      <div class="product-card-body">

        ${
          brand
            ? `<div class="product-brand">${brand}</div>`
            : ""
        }

        <h3 class="product-title">
          <a href="/go/${id}">
            ${name}
          </a>
        </h3>

        <div class="product-store">
          ${merchant}
        </div>

        <div class="product-price-row">

          <strong class="product-price">
            ${price}
          </strong>

          ${
            oldPrice
              ? `
                <span class="product-old-price">
                  ${oldPrice}
                </span>
              `
              : ""
          }

          ${
            discount
              ? `
                <span class="product-discount">
                  ${discount}
                </span>
              `
              : ""
          }

        </div>

        <div class="product-meta">
          <span class="stock ${stockClass}">
            ${escapeHtml(stock)}
          </span>
        </div>

        ${
          goalBadges
            ? `
              <div class="product-goals">
                ${goalBadges}
              </div>
            `
            : ""
        }

        <a
          class="product-button"
          href="/go/${id}"
        >
          Bekijk deal
        </a>

      </div>

    </article>
  `;
}

/* =========================================================
   DOM
========================================================= */

function getGrid() {
  return document.querySelector(
    "#products-grid"
  );
}

function getResultCount() {
  return document.querySelector(
    "#result-count"
  );
}

function getLoadMore() {
  return document.querySelector(
    "#load-more"
  );
}

/* =========================================================
   RENDER
========================================================= */

function renderProducts() {
  const grid = getGrid();

  if (!grid) {
    return;
  }

  const products = state.filtered.slice(
    0,
    state.visibleCount
  );

  if (
    state.loading &&
    state.products.length === 0
  ) {
    grid.innerHTML = `
      <div class="products-message">
        <strong>Producten laden...</strong>
      </div>
    `;

    return;
  }

  if (products.length === 0) {
    grid.innerHTML = `
      <div class="products-message">

        <strong>
          Geen producten gevonden.
        </strong>

        <br>

        Probeer een andere zoekterm,
        categorie of doel.

      </div>
    `;

    const loadMore = getLoadMore();

    if (loadMore) {
      loadMore.style.display = "none";
    }

    return;
  }

  grid.innerHTML = products
    .map(productCard)
    .join("");

  const loadMore = getLoadMore();

  if (loadMore) {
    const remaining =
      state.filtered.length -
      products.length;

    if (remaining > 0) {
      loadMore.style.display = "block";
      loadMore.textContent =
        `Toon meer producten (${remaining})`;
    } else {
      loadMore.style.display = "none";
    }
  }
}

function updateResultCount() {
  const element = getResultCount();

  if (!element) {
    return;
  }

  const count =
    state.filtered.length;

  element.textContent =
    `${count} ${
      count === 1
        ? "product"
        : "producten"
    }`;
}

/* =========================================================
   FILTERS
========================================================= */

function applyFilters() {
  state.filtered =
    state.products.filter((product) => {

      if (!productIsUsable(product)) {
        return false;
      }

      if (
        !matchesSearch(
          product,
          state.search
        )
      ) {
        return false;
      }

      if (
        state.category &&
        !matchesCategory(
          product,
          state.category
        )
      ) {
        return false;
      }

      if (
        state.goal &&
        !matchesGoal(
          product,
          state.goal
        )
      ) {
        return false;
      }

      return true;
    });

  state.visibleCount = PAGE_SIZE;

  renderProducts();
  updateResultCount();
  updateButtons();
}

/* =========================================================
   BUTTON STATES
========================================================= */

function updateButtons() {
  document
    .querySelectorAll("[data-goal]")
    .forEach((button) => {

      const value =
        normalizeText(
          button.dataset.goal || ""
        );

      button.classList.toggle(
        "active",
        value ===
          normalizeText(
            state.goal
          )
      );
    });

  document
    .querySelectorAll("[data-category]")
    .forEach((button) => {

      const value =
        normalizeText(
          button.dataset.category || ""
        );

      button.classList.toggle(
        "active",
        value ===
          normalizeText(
            state.category
          )
      );
    });
}

/* =========================================================
   SEARCH INPUT
========================================================= */

function syncSearchInputs() {
  document
    .querySelectorAll(
      "#search-input, #search, [data-product-search]"
    )
    .forEach((input) => {
      input.value = state.search;
    });
}

function bindSearch() {
  const inputs =
    document.querySelectorAll(
      "#search-input, #search, [data-product-search]"
    );

  inputs.forEach((input) => {

    input.addEventListener(
      "input",
      () => {
        state.search =
          input.value || "";

        applyFilters();
      }
    );

  });

  const form =
    document.querySelector(
      "#search-form"
    );

  if (form) {

    form.addEventListener(
      "submit",
      (event) => {

        event.preventDefault();

        const input =
          form.querySelector(
            "input"
          );

        state.search =
          input?.value || "";

        applyFilters();

        const deals =
          document.querySelector(
            "#deals"
          );

        if (deals) {
          deals.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }

      }
    );

  }
}

/* =========================================================
   GOAL BUTTONS
========================================================= */

function bindGoalFilters() {
  document
    .querySelectorAll("[data-goal]")
    .forEach((button) => {

      button.addEventListener(
        "click",
        () => {

          const value =
            button.dataset.goal || "";

          if (
            normalizeText(
              state.goal
            ) ===
            normalizeText(value)
          ) {
            state.goal = "";
          } else {
            state.goal = value;
          }

          applyFilters();

          const deals =
            document.querySelector(
              "#deals"
            );

          if (deals) {
            deals.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
          }

        }
      );

    });
}

/* =========================================================
   CATEGORY BUTTONS
========================================================= */

function bindCategoryFilters() {
  document
    .querySelectorAll("[data-category]")
    .forEach((button) => {

      button.addEventListener(
        "click",
        () => {

          const value =
            button.dataset.category || "";

          if (
            normalizeText(
              state.category
            ) ===
            normalizeText(value)
          ) {
            state.category = "";
          } else {
            state.category = value;
          }

          applyFilters();

          const deals =
            document.querySelector(
              "#deals"
            );

          if (deals) {
            deals.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
          }

        }
      );

    });
}

/* =========================================================
   LOAD MORE
========================================================= */

function bindLoadMore() {
  const button =
    getLoadMore();

  if (!button) {
    return;
  }

  button.addEventListener(
    "click",
    () => {

      state.visibleCount +=
        PAGE_SIZE;

      renderProducts();

    }
  );
}

/* =========================================================
   PRODUCT API
========================================================= */

async function fetchProductsPage(
  offset = 0
) {

  const params =
    new URLSearchParams();

  params.set(
    "limit",
    String(API_PAGE_SIZE)
  );

  params.set(
    "offset",
    String(offset)
  );

  const response =
    await fetch(
      `${API_PRODUCTS}?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept:
            "application/json"
        },
        cache: "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      `Product API fout: HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  return {
    products:
      Array.isArray(
        data.products
      )
        ? data.products
        : [],

    total:
      Number.isFinite(
        Number(data.total)
      )
        ? Number(data.total)
        : 0,

    hasMore:
      Boolean(data.has_more)
  };
}

/* =========================================================
   LOAD PRODUCTS
========================================================= */

async function loadProducts() {
  if (state.loading) {
    return;
  }

  state.loading = true;

  renderProducts();

  try {

    const allProducts = [];
    const seen = new Set();

    let offset = 0;
    let total = 0;
    let hasMore = true;

    while (
      hasMore &&
      allProducts.length <
        MAX_PRODUCTS
    ) {

      const page =
        await fetchProductsPage(
          offset
        );

      total = page.total;

      for (
        const product of page.products
      ) {

        if (
          !productIsUsable(
            product
          )
        ) {
          continue;
        }

        const key =
          String(product.id);

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        allProducts.push(product);

      }

      if (
        page.products.length === 0
      ) {
        hasMore = false;
        break;
      }

      offset +=
        page.products.length;

      if (!page.hasMore) {
        hasMore = false;
      }

      if (
        total > 0 &&
        allProducts.length >=
          Math.min(
            total,
            MAX_PRODUCTS
          )
      ) {
        hasMore = false;
      }

      if (
        page.products.length <
        API_PAGE_SIZE
      ) {
        hasMore = false;
      }
    }

    state.products =
      allProducts.slice(
        0,
        MAX_PRODUCTS
      );

    state.loading = false;

    /*
     * Filters opnieuw toepassen nadat
     * alle producten geladen zijn.
     */
    applyFilters();

  } catch (error) {

    console.error(
      "FitDealFinder product error:",
      error
    );

    state.loading = false;

    const grid =
      getGrid();

    if (grid) {
      grid.innerHTML = `
        <div class="products-message">

          <strong>
            Producten konden niet worden geladen.
          </strong>

          <br>

          Probeer de pagina opnieuw te laden.

        </div>
      `;
    }

  }
}

/* =========================================================
   AI COACH
========================================================= */

async function askAi(message) {

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

  if (!response.ok) {
    throw new Error(
      `AI fout: HTTP ${response.status}`
    );
  }

  return response.json();
}

function bindAiCoach() {

  const form =
    document.querySelector(
      "#ai-form"
    );

  const input =
    document.querySelector(
      "#ai-input"
    );

  const output =
    document.querySelector(
      "#ai-response"
    ) ||
    document.querySelector(
      "#ai-output"
    );

  if (
    !form ||
    !input ||
    !output
  ) {
    return;
  }

  form.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      const message =
        input.value.trim();

      if (!message) {
        return;
      }

      output.textContent =
        "Even nadenken...";

      try {

        const data =
          await askAi(
            message
          );

        output.textContent =
          data?.answer ||
          data?.message ||
          data?.response ||
          "Ik kon geen antwoord geven.";

      } catch (error) {

        console.error(error);

        output.textContent =
          "De Supplement Coach is tijdelijk niet beschikbaar.";

      }

    }
  );
}

/* =========================================================
   SHOPPING PLANNER
========================================================= */

function bindPlanner() {

  const form =
    document.querySelector(
      "#shopping-planner"
    ) ||
    document.querySelector(
      "#planner-form"
    );

  if (!form) {
    return;
  }

  form.addEventListener(
    "submit",
    (event) => {

      event.preventDefault();

      const goal =
        form.querySelector(
          "[name='goal']"
        )?.value || "";

      const budget =
        form.querySelector(
          "[name='budget']"
        )?.value || "";

      state.goal = goal;

      /*
       * Planner mag de categorie niet
       * onbedoeld veranderen.
       */
      applyFilters();

      const result =
        document.querySelector(
          "#planner-result"
        );

      if (result) {

        const count =
          state.filtered.length;

        if (budget) {

          result.textContent =
            `${count} producten gevonden voor ${goal || "alle doelen"} binnen een budget van €${budget}.`;

        } else {

          result.textContent =
            `${count} producten gevonden voor ${goal || "alle doelen"}.`;

        }

      }

      const deals =
        document.querySelector(
          "#deals"
        );

      if (deals) {

        deals.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });

      }

    }
  );
}

/* =========================================================
   NAVIGATION
========================================================= */

function bindNavigation() {

  document
    .querySelectorAll(
      "a[href^='#']"
    )
    .forEach((link) => {

      link.addEventListener(
        "click",
        (event) => {

          const href =
            link.getAttribute(
              "href"
            );

          if (
            !href ||
            href === "#"
          ) {
            return;
          }

          const target =
            document.querySelector(
              href
            );

          if (!target) {
            return;
          }

          event.preventDefault();

          target.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });

        }
      );

    });
}

/* =========================================================
   MOBILE MENU
========================================================= */

function bindMobileMenu() {

  const button =
    document.querySelector(
      "[data-mobile-menu]"
    ) ||
    document.querySelector(
      "#mobile-menu-button"
    );

  const menu =
    document.querySelector(
      "[data-mobile-menu-panel]"
    ) ||
    document.querySelector(
      "#mobile-menu"
    );

  if (
    !button ||
    !menu
  ) {
    return;
  }

  button.addEventListener(
    "click",
    () => {

      const open =
        menu.classList.toggle(
          "open"
        );

      button.setAttribute(
        "aria-expanded",
        String(open)
      );

    }
  );
}

/* =========================================================
   START
========================================================= */

async function init() {

  bindSearch();
  bindGoalFilters();
  bindCategoryFilters();
  bindLoadMore();
  bindAiCoach();
  bindPlanner();
  bindNavigation();
  bindMobileMenu();

  updateButtons();

  await loadProducts();

  syncSearchInputs();
  updateButtons();
  applyFilters();
}

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    init,
    {
      once: true
    }
  );

} else {

  init();

    }
