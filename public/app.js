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
  if (Array.isArray(product?.goals)) {
    return product.goals.map(normalizeText);
  }

  if (typeof product?.goals === "string") {
    try {
      const parsed = JSON.parse(product.goals);

      if (Array.isArray(parsed)) {
        return parsed.map(normalizeText);
      }
    } catch {
      return product.goals
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
    "soy isolate",
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
    "creatine tablets",
    "crea "
  ],

  "pre-workout": [
    "pre workout",
    "pre-workout",
    "preworkout",
    "pre workout supplement",
    "pre workout poeder",
    "nox",
    "pump",
    "pre training",
    "pre training supplement",
    "5150"
  ],

  supplementen: [
    "supplement",
    "supplementen",
    "vitamine",
    "vitamin",
    "vitamins",
    "multivitamine",
    "multivitamin",
    "mineral",
    "minerals",
    "omega",
    "omega 3",
    "amino",
    "amino acid",
    "amino acids",
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
    "l carnitine",
    "carnitine",
    "glutamine",
    "beta alanine",
    "arginine",
    "citrulline",
    "ashwagandha",
    "energy",
    "recovery",
    "hydration",
    "voeding",
    "nutrition"
  ]
};

function getProductSearchText(product) {
  return normalizeText([
    product?.category,
    product?.name,
    product?.brand,
    product?.description,
    product?.merchant_name
  ].join(" "));
}

function matchesCategory(product, category) {
  const wanted = normalizeText(category);

  if (!wanted) {
    return true;
  }

  const text = getProductSearchText(product);

  const terms = CATEGORY_RULES[wanted];

  if (!terms) {
    return normalizeText(product?.category) === wanted;
  }

  return terms.some((term) => {
    return text.includes(normalizeText(term));
  });
}

/* =========================================================
   SEARCH / GOAL MATCHING
========================================================= */

function matchesSearch(product, search) {
  const query = normalizeText(search);

  if (!query) {
    return true;
  }

  const text = getProductSearchText(product);

  return text.includes(query);
}

function matchesGoal(product, goal) {
  const wanted = normalizeText(goal);

  if (!wanted) {
    return true;
  }

  const goals = getGoals(product);

  if (goals.includes(wanted)) {
    return true;
  }

  const text = getProductSearchText(product);

  if (wanted === "cut") {
    return (
      text.includes("cut") ||
      text.includes("afvallen") ||
      text.includes("fat loss") ||
      text.includes("fatburn")
    );
  }

  if (wanted === "bulk") {
    return (
      text.includes("bulk") ||
      text.includes("gainer") ||
      text.includes("mass")
    );
  }

  if (wanted === "lean-bulk") {
    return (
      text.includes("lean bulk") ||
      text.includes("lean-bulk") ||
      text.includes("spiermassa")
    );
  }

  return false;
}

/* =========================================================
   PRODUCT CARD
========================================================= */

function productCard(product) {
  const name = escapeHtml(product.name);
  const brand = escapeHtml(product.brand || "");
  const merchant = escapeHtml(product.merchant_name || "");
  const image = escapeHtml(product.image_url || "");
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
    Number.isFinite(Number(product.discount_percent)) &&
    Number(product.discount_percent) > 0
      ? `-${Math.round(Number(product.discount_percent))}%`
      : "";

  const stock =
    Number(product.in_stock) === 1
      ? "Op voorraad"
      : "Controleer voorraad";

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
        onerror="this.style.display='none'"
      >
    `
    : `
      <div class="product-image product-image-placeholder">
        <span>FIT</span>
      </div>
    `;

  return `
    <article class="product-card">
      <a
        class="product-image-link"
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
              ? `<span class="product-old-price">${oldPrice}</span>`
              : ""
          }

          ${
            discount
              ? `<span class="product-discount">${discount}</span>`
              : ""
          }
        </div>

        <div class="product-meta">
          <span>${escapeHtml(stock)}</span>
        </div>

        ${
          goalBadges
            ? `<div class="product-goals">${goalBadges}</div>`
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
   DOM HELPERS
========================================================= */

function getProductsGrid() {
  return document.querySelector("#products-grid");
}

function getResultCountElement() {
  return (
    document.querySelector("#result-count") ||
    document.querySelector("[data-result-count]")
  );
}

function getLoadMoreButton() {
  return (
    document.querySelector("#load-more") ||
    document.querySelector("[data-load-more]")
  );
}

function getEmptyState() {
  return (
    document.querySelector("#products-empty") ||
    document.querySelector("[data-products-empty]")
  );
}

function getLoadingState() {
  return (
    document.querySelector("#products-loading") ||
    document.querySelector("[data-products-loading]")
  );
}

/* =========================================================
   RENDER PRODUCTS
========================================================= */

function renderProducts() {
  const grid = getProductsGrid();

  if (!grid) {
    return;
  }

  const productsToShow = state.filtered.slice(
    0,
    state.visibleCount
  );

  if (state.loading && state.products.length === 0) {
    grid.innerHTML = `
      <div class="products-message">
        Producten laden...
      </div>
    `;

    return;
  }

  if (productsToShow.length === 0) {
    grid.innerHTML = `
      <div class="products-message">
        <strong>Geen producten gevonden.</strong>
        <br>
        Probeer een andere categorie of zoekterm.
      </div>
    `;

    return;
  }

  grid.innerHTML = productsToShow
    .map(productCard)
    .join("");

  const loadMore = getLoadMoreButton();

  if (loadMore) {
    const remaining =
      state.filtered.length - productsToShow.length;

    loadMore.style.display =
      remaining > 0 ? "" : "none";

    if (remaining > 0) {
      loadMore.textContent =
        `Toon meer producten (${remaining})`;
    }
  }
}

function updateResultCount() {
  const element = getResultCountElement();

  if (!element) {
    return;
  }

  const count = state.filtered.length;

  element.textContent =
    `${count} ${count === 1 ? "product" : "producten"}`;
}

/* =========================================================
   FILTERS
========================================================= */

function applyFilters() {
  const search = state.search.trim();
  const goal = state.goal.trim();
  const category = state.category.trim();

  state.filtered = state.products.filter((product) => {
    if (!productIsUsable(product)) {
      return false;
    }

    if (!matchesSearch(product, search)) {
      return false;
    }

    if (category && !matchesCategory(product, category)) {
      return false;
    }

    if (goal && !matchesGoal(product, goal)) {
      return false;
    }

    return true;
  });

  state.visibleCount = PAGE_SIZE;

  renderProducts();
  updateResultCount();
  updateFilterButtons();
}

/* =========================================================
   FILTER BUTTONS
========================================================= */

function updateFilterButtons() {
  document
    .querySelectorAll("[data-category]")
    .forEach((button) => {
      const value = normalizeText(
        button.dataset.category || ""
      );

      button.classList.toggle(
        "active",
        value === normalizeText(state.category)
      );
    });

  document
    .querySelectorAll("[data-goal]")
    .forEach((button) => {
      const value = normalizeText(
        button.dataset.goal || ""
      );

      button.classList.toggle(
        "active",
        value === normalizeText(state.goal)
      );
    });
}

/* =========================================================
   API
========================================================= */

async function fetchProductsPage(offset = 0) {
  const params = new URLSearchParams();

  params.set("limit", String(API_PAGE_SIZE));
  params.set("offset", String(offset));

  const response = await fetch(
    `${API_PRODUCTS}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(
      `Product API fout: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  return {
    products: Array.isArray(data.products)
      ? data.products
      : [],
    total: Number.isFinite(Number(data.total))
      ? Number(data.total)
      : 0,
    hasMore: Boolean(data.has_more)
  };
}

/* =========================================================
   LOAD ALL PRODUCTS
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
    let expectedTotal = 0;
    let hasMore = true;

    while (
      hasMore &&
      allProducts.length < MAX_PRODUCTS
    ) {
      const page = await fetchProductsPage(offset);

      expectedTotal = page.total;

      for (const product of page.products) {
        if (!productIsUsable(product)) {
          continue;
        }

        const key = String(product.id);

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        allProducts.push(product);
      }

      if (
        page.products.length === 0 ||
        !page.hasMore
      ) {
        hasMore = false;
      } else {
        offset += page.products.length;
      }

      if (
        expectedTotal > 0 &&
        allProducts.length >=
          Math.min(expectedTotal, MAX_PRODUCTS)
      ) {
        hasMore = false;
      }

      if (page.products.length < API_PAGE_SIZE) {
        hasMore = false;
      }
    }

    state.products = allProducts.slice(
      0,
      MAX_PRODUCTS
    );

    applyFilters();
  } catch (error) {
    console.error(error);

    const grid = getProductsGrid();

    if (grid) {
      grid.innerHTML = `
        <div class="products-message">
          <strong>Producten konden niet worden geladen.</strong>
          <br>
          Probeer de pagina opnieuw te laden.
        </div>
      `;
    }
  } finally {
    state.loading = false;

    const loading = getLoadingState();

    if (loading) {
      loading.style.display = "none";
    }
  }
}

/* =========================================================
   SEARCH
========================================================= */

function bindSearch() {
  const inputs = document.querySelectorAll(
    'input[type="search"], [data-product-search], #search-input'
  );

  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      state.search = input.value || "";
      applyFilters();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        state.search = input.value || "";
        applyFilters();
      }
    });
  });
}

/* =========================================================
   CATEGORY FILTERS
========================================================= */

function bindCategoryFilters() {
  document
    .querySelectorAll("[data-category]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const value =
          button.dataset.category || "";

        if (
          normalizeText(state.category) ===
          normalizeText(value)
        ) {
          state.category = "";
        } else {
          state.category = value;
        }

        applyFilters();

        const productsSection =
          document.querySelector("#producten") ||
          document.querySelector("#products") ||
          document.querySelector("#deals");

        if (productsSection) {
          productsSection.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      });
    });
}

/* =========================================================
   GOAL FILTERS
========================================================= */

function bindGoalFilters() {
  document
    .querySelectorAll("[data-goal]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const value =
          button.dataset.goal || "";

        if (
          normalizeText(state.goal) ===
          normalizeText(value)
        ) {
          state.goal = "";
        } else {
          state.goal = value;
        }

        applyFilters();
      });
    });
}

/* =========================================================
   LOAD MORE
========================================================= */

function bindLoadMore() {
  const button = getLoadMoreButton();

  if (!button) {
    return;
  }

  button.addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderProducts();
  });
}

/* =========================================================
   CLEAR FILTERS
========================================================= */

function clearFilters() {
  state.search = "";
  state.goal = "";
  state.category = "";

  document
    .querySelectorAll(
      'input[type="search"], [data-product-search], #search-input'
    )
    .forEach((input) => {
      input.value = "";
    });

  applyFilters();
}

function bindClearFilters() {
  document
    .querySelectorAll(
      "[data-clear-filters], #clear-filters"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        clearFilters
      );
    });
}

/* =========================================================
   SHOPPING PLANNER
========================================================= */

function bindPlanner() {
  const form =
    document.querySelector("#shopping-planner") ||
    document.querySelector("[data-shopping-planner]");

  if (!form) {
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const goal =
      form.querySelector("[name='goal']")?.value ||
      state.goal ||
      "";

    const category =
      form.querySelector("[name='category']")?.value ||
      state.category ||
      "";

    const budget =
      form.querySelector("[name='budget']")?.value ||
      "";

    if (goal) {
      state.goal = goal;
    }

    if (category) {
      state.category = category;
    }

    applyFilters();

    const result =
      form.querySelector(
        "[data-planner-result]"
      ) ||
      document.querySelector(
        "[data-planner-result]"
      );

    if (result) {
      result.textContent =
        budget
          ? `We tonen de beste beschikbare producten binnen je selectie en budget van €${budget}.`
          : "We tonen de beste beschikbare producten binnen je selectie.";
    }

    const products =
      document.querySelector("#producten") ||
      document.querySelector("#products");

    if (products) {
      products.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });
}

/* =========================================================
   AI COACH
========================================================= */

async function askAi(message) {
  const response = await fetch(API_AI, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      message
    })
  });

  if (!response.ok) {
    throw new Error(
      `AI fout: HTTP ${response.status}`
    );
  }

  return response.json();
}

function bindAiCoach() {
  const form =
    document.querySelector("#ai-form") ||
    document.querySelector("[data-ai-form]");

  const input =
    document.querySelector("#ai-input") ||
    document.querySelector("[data-ai-input]");

  const output =
    document.querySelector("#ai-response") ||
    document.querySelector("[data-ai-response]");

  if (!form || !input || !output) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = input.value.trim();

    if (!message) {
      return;
    }

    output.textContent = "Even nadenken...";

    try {
      const data = await askAi(message);

      const answer =
        data?.answer ||
        data?.message ||
        data?.response ||
        "Ik kon geen antwoord geven.";

      output.textContent = answer;
    } catch (error) {
      console.error(error);

      output.textContent =
        "De Supplement Coach is tijdelijk niet beschikbaar.";
    }
  });
}

/* =========================================================
   NAVIGATION
========================================================= */

function bindNavigation() {
  document
    .querySelectorAll("a[href^='#']")
    .forEach((link) => {
      link.addEventListener("click", (event) => {
        const href =
          link.getAttribute("href");

        if (!href || href === "#") {
          return;
        }

        const target =
          document.querySelector(href);

        if (!target) {
          return;
        }

        event.preventDefault();

        target.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
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

  if (!button || !menu) {
    return;
  }

  button.addEventListener("click", () => {
    const open =
      menu.classList.toggle("open");

    button.setAttribute(
      "aria-expanded",
      String(open)
    );
  });
}

/* =========================================================
   URL STATE
========================================================= */

function readUrlState() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  const search =
    params.get("search");

  const goal =
    params.get("goal");

  const category =
    params.get("category");

  if (search) {
    state.search = search;
  }

  if (goal) {
    state.goal = goal;
  }

  if (category) {
    state.category = category;
  }

  document
    .querySelectorAll(
      'input[type="search"], [data-product-search], #search-input'
    )
    .forEach((input) => {
      input.value = state.search;
    });
}

function updateUrlState() {
  const params =
    new URLSearchParams();

  if (state.search) {
    params.set(
      "search",
      state.search
    );
  }

  if (state.goal) {
    params.set(
      "goal",
      state.goal
    );
  }

  if (state.category) {
    params.set(
      "category",
      state.category
    );
  }

  const query =
    params.toString();

  const url =
    query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;

  window.history.replaceState(
    {},
    "",
    url
  );
}

/* =========================================================
   URL STATE SYNC
========================================================= */

function bindUrlStateSync() {
  const originalApplyFilters =
    applyFilters;

  /*
   * Filters are already handled through
   * the normal application flow.
   * Keep URL updates lightweight.
   */
  document.addEventListener(
    "fitdeal:filters-changed",
    () => {
      updateUrlState();
    }
  );

  return originalApplyFilters;
}

/* =========================================================
   GLOBAL FILTER EVENTS
========================================================= */

function setupFilterUrlUpdates() {
  const originalSearch =
    state.search;

  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target.closest(
          "[data-category], [data-goal], [data-clear-filters]"
        );

      if (!target) {
        return;
      }

      setTimeout(
        updateUrlState,
        0
      );
    }
  );

  document.addEventListener(
    "input",
    (event) => {
      if (
        event.target.matches(
          'input[type="search"], [data-product-search], #search-input'
        )
      ) {
        setTimeout(
          updateUrlState,
          0
        );
      }
    }
  );

  void originalSearch;
}

/* =========================================================
   INIT
========================================================= */

async function init() {
  readUrlState();

  bindSearch();
  bindCategoryFilters();
  bindGoalFilters();
  bindLoadMore();
  bindClearFilters();
  bindPlanner();
  bindAiCoach();
  bindNavigation();
  bindMobileMenu();
  bindUrlStateSync();
  setupFilterUrlUpdates();

  updateFilterButtons();

  await loadProducts();

  /*
   * Re-apply URL filters after products
   * have been loaded.
   */
  applyFilters();
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
