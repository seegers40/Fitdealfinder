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
 */

const API_PRODUCTS = "/api/products";
const API_AI = "/api/ai/chat";

const PAGE_SIZE = 200;
const MAX_PRODUCTS = 2000;
const PRODUCTS_PER_VIEW = 24;
const CART_KEY = "fitdealfinder_cart";

const state = {
  products: [],
  filtered: [],
  search: "",
  goal: "",
  category: "",
  visibleCount: PRODUCTS_PER_VIEW,
  loading: false,
  cart: loadCart()
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
    if (element) return element;
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

function price(product) {
  const value = Number(product?.price);

  return Number.isFinite(value) ? value : 0;
}

function money(value, currency = "EUR") {
  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: currency || "EUR"
    }).format(Number(value) || 0);
  } catch {
    return `€ ${Number(value || 0).toFixed(2).replace(".", ",")}`;
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
  if (!product) return false;
  if (!product.id) return false;
  if (!product.name) return false;

  if (!product.product_url && !product.affiliate_url) {
    return false;
  }

  const text = productText(product);

  return !BAD_WORDS.some(word =>
    text.includes(normalize(word))
  );
}


/* =========================================================
   GOALS
========================================================= */

const CUT_WORDS = [
  "cut",
  "cutting",
  "fat burner",
  "fatburner",
  "thermogenic",
  "weight loss",
  "gewichtsverlies",
  "afvallen",
  "l-carnitine",
  "carnitine",
  "cla",
  "caffeine",
  "cafeine"
];

const BULK_WORDS = [
  "bulk",
  "bulking",
  "mass",
  "mass gainer",
  "gainer",
  "weight gainer",
  "calorie",
  "calorien",
  "muscle gain",
  "weight gain"
];

const LEAN_BULK_WORDS = [
  "lean bulk",
  "lean-bulk",
  "lean mass",
  "muscle",
  "muscle gain",
  "protein",
  "proteine",
  "whey",
  "casein",
  "caseine",
  "creatine",
  "amino",
  "bcaa",
  "pre workout",
  "pre-workout"
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

function hasAny(text, words) {
  return words.some(word =>
    text.includes(normalize(word))
  );
}

function productGoals(product) {
  const raw = product?.goals;

  if (Array.isArray(raw)) {
    return raw.map(normalize);
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed.map(normalize);
      }
    } catch {
      // Gewone tekst hieronder afhandelen.
    }

    return raw
      .split(/[;,|]/)
      .map(normalize)
      .filter(Boolean);
  }

  return [];
}

function matchesGoal(product, goal) {
  if (!goal) return true;

  const normalizedGoal = normalize(goal);
  const text = productText(product);
  const goals = productGoals(product);

  if (goals.includes(normalizedGoal)) {
    return true;
  }

  const generalSupplement =
    hasAny(text, GENERAL_SUPPLEMENT_WORDS);

  if (normalizedGoal === "cut") {
    return (
      hasAny(text, CUT_WORDS) ||
      generalSupplement
    );
  }

  if (normalizedGoal === "bulk") {
    return (
      hasAny(text, BULK_WORDS) ||
      generalSupplement
    );
  }

  if (normalizedGoal === "lean-bulk") {
    return (
      hasAny(text, LEAN_BULK_WORDS) ||
      generalSupplement
    );
  }

  return true;
}


/* =========================================================
   CATEGORIES
========================================================= */

/*
 * AANGEPAST:
 *
 * Categorieën gebruiken uitsluitend:
 * - productnaam
 * - merk
 * - het echte category-veld
 *
 * De volledige beschrijving wordt hier NIET gebruikt.
 *
 * Daardoor kan bijvoorbeeld een creatineproduct
 * niet door het woord "protein" in de omschrijving
 * opeens onder Proteïne verschijnen.
 */

function matchesCategory(product, category) {
  if (!category) return true;

  const normalizedCategory =
    normalize(category);

  const categoryText = normalize([
    product?.name,
    product?.brand,
    product?.category
  ].join(" "));

  /*
   * PROTEÏNE
   */
  if (normalizedCategory === "proteine") {
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

  /*
   * CREATINE
   */
  if (normalizedCategory === "creatine") {
    return hasAny(categoryText, [
      "creatine",
      "creatine monohydrate",
      "creatine hcl"
    ]);
  }

  /*
   * PRE-WORKOUT
   */
  if (normalizedCategory === "pre-workout") {
    return hasAny(categoryText, [
      "pre workout",
      "pre-workout",
      "preworkout"
    ]);
  }

  /*
   * SUPPLEMENTEN
   */
  if (normalizedCategory === "supplementen") {
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
  if (!query) return true;

  const words = normalize(query)
    .split(/\s+/)
    .filter(Boolean);

  const text = productText(product);

  return words.every(word =>
    text.includes(word)
  );
}


/* =========================================================
   FILTER PIPELINE
========================================================= */

function applyFilters() {
  const query = normalize(state.search);

  state.filtered = state.products
    .filter(isUsableProduct)
    .filter(product =>
      matchesSearch(product, query)
    )
    .filter(product =>
      matchesGoal(product, state.goal)
    )
    .filter(product =>
      matchesCategory(product, state.category)
    );

  /*
   * Beste deals eerst.
   * Daarna producten met korting.
   * Daarna prijs laag naar hoog.
   */
  state.filtered.sort((a, b) => {
    const scoreA = Number(a.deal_score) || 0;
    const scoreB = Number(b.deal_score) || 0;

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
  });

  state.visibleCount = PRODUCTS_PER_VIEW;

  renderProducts();
}


/* =========================================================
   LOAD PRODUCTS
========================================================= */

async function loadProducts() {
  if (state.loading) return;

  state.loading = true;

  const grid = $("#products-grid");

  if (grid && !state.products.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>Deals laden...</h3>
        <p>We halen de actuele producten op.</p>
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

      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(
          `Product API gaf status ${response.status}`
        );
      }

      const data = await response.json();

      const batch =
        Array.isArray(data)
          ? data
          : Array.isArray(data.products)
            ? data.products
            : Array.isArray(data.data)
              ? data.data
              : [];

      products.push(...batch);

      if (batch.length < PAGE_SIZE) {
        break;
      }

      if (products.length >= MAX_PRODUCTS) {
        break;
      }
    }

    const unique = new Map();

    for (const product of products) {
      if (!product?.id) continue;

      unique.set(
        String(product.id),
        product
      );
    }

    state.products = [...unique.values()];

    applyFilters();
  } catch (error) {
    console.error(
      "FitDealFinder product loading error:",
      error
    );

    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>Deals konden niet worden geladen</h3>
          <p>
            Er ging iets mis met het ophalen van de producten.
            Probeer de pagina opnieuw te laden.
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
  const currentPrice = price(product);
  const oldPriceValue =
    Number(product.old_price) || 0;

  const hasDiscount =
    oldPriceValue > currentPrice;

  const discount =
    Number(product.discount_percent) > 0
      ? Math.round(
          Number(product.discount_percent)
        )
      : hasDiscount
        ? Math.round(
            ((oldPriceValue - currentPrice) /
              oldPriceValue) *
              100
          )
        : 0;

  const image = product.image_url
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
          ${escapeHtml(product.name)}
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
              product.merchant_name || ""
            )}
          </span>
        </div>

        <div class="product-actions">

          <a
            class="deal-button"
            href="/go/${encodeURIComponent(
              String(product.id)
            )}"
          >
            Bekijk deal
          </a>

          <button
            type="button"
            class="cart-button"
            data-add-cart="${escapeHtml(
              String(product.id)
            )}"
          >
            🛒 In winkelmand
          </button>

        </div>

      </div>

    </article>
  `;
}


/* =========================================================
   RENDER PRODUCTS
========================================================= */

function renderProducts() {
  const grid = $("#products-grid");

  if (!grid) return;

  const visible =
    state.filtered.slice(
      0,
      state.visibleCount
    );

  if (!visible.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>Geen producten gevonden</h3>
        <p>
          Probeer een andere zoekterm,
          categorie of doel.
        </p>
      </div>
    `;
  } else {
    grid.innerHTML =
      visible
        .map(productCard)
        .join("");
  }

  updateProductCount(
    state.filtered.length
  );

  updateLoadMore();
  updateGoalButtons();
  updateCategoryButtons();
}


/* =========================================================
   PRODUCT COUNT
========================================================= */

function updateProductCount(count) {
  const element =
    first(
      "#result-count",
      "#product-count"
    );

  if (!element) return;

  element.textContent =
    `${count} producten`;
}


/* =========================================================
   LOAD MORE
========================================================= */

function updateLoadMore() {
  const button =
    first(
      "#load-more",
      "#load-more-products"
    );

  if (!button) return;

  const hasMore =
    state.visibleCount <
    state.filtered.length;

  button.hidden = !hasMore;

  if (hasMore) {
    button.disabled = false;
    button.textContent =
      "Meer producten laden";
  }
}

function loadMore() {
  state.visibleCount +=
    PRODUCTS_PER_VIEW;

  renderProducts();

  const button =
    first(
      "#load-more",
      "#load-more-products"
    );

  if (button) {
    button.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }
}


/* =========================================================
   SEARCH EVENTS
========================================================= */

function setupSearch() {
  const form = $("#search-form");

  const input =
    first(
      "#search-input",
      "#search"
    );

  if (!input) return;

  input.addEventListener(
    "input",
    () => {
      state.search = input.value;
      applyFilters();
    }
  );

  input.addEventListener(
    "search",
    () => {
      state.search = input.value;
      applyFilters();
    }
  );

  if (form) {
    form.addEventListener(
      "submit",
      event => {
        event.preventDefault();

        state.search = input.value;

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
  $all("[data-goal]").forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          const goal =
            normalize(
              button.dataset.goal || ""
            );

          /*
           * Nogmaals klikken op hetzelfde doel
           * zet het doel uit.
           */
          state.goal =
            state.goal === goal
              ? ""
              : goal;

          state.category = "";

          applyFilters();
          scrollToDeals();
        }
      );
    }
  );
}

function updateGoalButtons() {
  $all("[data-goal]").forEach(
    button => {
      const value =
        normalize(
          button.dataset.goal || ""
        );

      button.classList.toggle(
        "active",
        value === state.goal
      );
    }
  );
}


/* =========================================================
   CATEGORY BUTTONS
========================================================= */

function setupCategories() {
  $all("[data-category]").forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          const category =
            normalize(
              button.dataset.category || ""
            );

          state.category =
            state.category === category
              ? ""
              : category;

          /*
           * Een categorie is leidend.
           * Een oude doelkeuze mag de categorie
           * niet leegtrekken.
           */
          applyFilters();
          scrollToDeals();
        }
      );
    }
  );
}

function updateCategoryButtons() {
  $all("[data-category]").forEach(
    button => {
      const value =
        normalize(
          button.dataset.category || ""
        );

      button.classList.toggle(
        "active",
        value === state.category
      );
    }
  );
}


/* =========================================================
   CART STORAGE
========================================================= */

function loadCart() {
  try {
    const raw =
      localStorage.getItem(CART_KEY);

    if (!raw) return [];

    const parsed =
      JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem(
      CART_KEY,
      JSON.stringify(state.cart)
    );
  } catch (error) {
    console.warn(
      "Could not save cart:",
      error
    );
  }
}


/* =========================================================
   CART
========================================================= */

function addToCart(productId) {
  const id = String(productId);

  const product =
    state.products.find(
      item =>
        String(item.id) === id
    );

  if (!product) return;

  const existing =
    state.cart.find(
      item =>
        String(item.id) === id
    );

  if (existing) {
    existing.quantity =
      Math.min(
        Number(existing.quantity || 1) + 1,
        99
      );
  } else {
    state.cart.push({
      id,
      quantity: 1
    });
  }

  saveCart();
  renderCart();
  openCart();
}

function removeFromCart(productId) {
  const id = String(productId);

  state.cart =
    state.cart.filter(
      item =>
        String(item.id) !== id
    );

  saveCart();
  renderCart();
}

function changeCartQuantity(
  productId,
  delta
) {
  const id = String(productId);

  const item =
    state.cart.find(
      cartItem =>
        String(cartItem.id) === id
    );

  if (!item) return;

  item.quantity =
    Math.max(
      1,
      Math.min(
        99,
        Number(item.quantity || 1) +
          delta
      )
    );

  saveCart();
  renderCart();
}

function cartProducts() {
  return state.cart
    .map(item => {
      const product =
        state.products.find(
          candidate =>
            String(candidate.id) ===
            String(item.id)
        );

      if (!product) return null;

      return {
        product,
        quantity:
          Number(item.quantity) || 1
      };
    })
    .filter(Boolean);
}

function cartTotal() {
  return cartProducts()
    .reduce(
      (total, item) =>
        total +
        price(item.product) *
          item.quantity,
      0
    );
}

function cartCount() {
  return state.cart
    .reduce(
      (total, item) =>
        total +
        (Number(item.quantity) || 1),
      0
    );
}


/* =========================================================
   CART UI
========================================================= */

function ensureCartUI() {
  if ($("#fitdeal-cart-overlay")) {
    return;
  }

  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <div
        id="fitdeal-cart-overlay"
        class="fitdeal-cart-overlay"
        hidden
      >
        <div
          class="fitdeal-cart-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Winkelmand"
        >

          <div class="fitdeal-cart-header">
            <div>
              <strong>Winkelmand</strong>
              <span id="fitdeal-cart-count">
                0 producten
              </span>
            </div>

            <button
              type="button"
              id="fitdeal-cart-close"
              aria-label="Winkelmand sluiten"
            >
              ✕
            </button>
          </div>

          <div
            id="fitdeal-cart-items"
            class="fitdeal-cart-items"
          ></div>

          <div
            id="fitdeal-cart-footer"
            class="fitdeal-cart-footer"
          ></div>

        </div>
      </div>
    `
  );

  const overlay =
    $("#fitdeal-cart-overlay");

  const close =
    $("#fitdeal-cart-close");

  close?.addEventListener(
    "click",
    closeCart
  );

  overlay?.addEventListener(
    "click",
    event => {
      if (event.target === overlay) {
        closeCart();
      }
    }
  );
}

function injectCartStyles() {
  if ($("#fitdeal-cart-styles")) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "fitdeal-cart-styles";

  style.textContent = `
    .fitdeal-cart-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      justify-content: flex-end;
      background: rgba(0,0,0,.62);
    }

    .fitdeal-cart-overlay[hidden] {
      display: none;
    }

    .fitdeal-cart-panel {
      width: min(440px, 100%);
      height: 100%;
      overflow: auto;
      background: #07111f;
      color: #f5f8fb;
      box-shadow: -20px 0 70px rgba(0,0,0,.35);
      padding: 22px;
    }

    .fitdeal-cart-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 18px;
      border-bottom: 1px solid rgba(255,255,255,.1);
    }

    .fitdeal-cart-header strong {
      display: block;
      font-size: 21px;
    }

    .fitdeal-cart-header span {
      display: block;
      margin-top: 3px;
      color: #9eacbd;
      font-size: 13px;
    }

    #fitdeal-cart-close {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: rgba(255,255,255,.08);
      color: #fff;
      font-size: 18px;
    }

    .fitdeal-cart-item {
      display: grid;
      grid-template-columns: 70px 1fr;
      gap: 13px;
      padding: 18px 0;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }

    .fitdeal-cart-item img {
      width: 70px;
      height: 70px;
      object-fit: contain;
      border-radius: 12px;
      background: #fff;
    }

    .fitdeal-cart-item h4 {
      margin: 0 0 6px;
      font-size: 14px;
      line-height: 1.35;
    }

    .fitdeal-cart-price {
      font-weight: 800;
      color: #67e5a2;
    }

    .fitdeal-cart-controls {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-top: 10px;
    }

    .fitdeal-cart-controls button {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: #142942;
      color: #fff;
    }

    .fitdeal-cart-remove {
      margin-left: auto;
      color: #ff8b94;
      background: transparent !important;
      width: auto !important;
      padding: 0 5px;
    }

    .fitdeal-cart-footer {
      position: sticky;
      bottom: 0;
      padding-top: 20px;
      margin-top: 8px;
      background: #07111f;
    }

    .fitdeal-cart-total {
      display: flex;
      justify-content: space-between;
      gap: 15px;
      font-size: 19px;
      font-weight: 900;
    }

    .fitdeal-cart-note {
      margin: 10px 0 16px;
      color: #9eacbd;
      font-size: 12px;
      line-height: 1.5;
    }

    .fitdeal-cart-close-button {
      width: 100%;
      min-height: 48px;
      border-radius: 12px;
      background: #67e5a2;
      color: #07140d;
      font-weight: 900;
    }

    .fitdeal-cart-empty {
      padding: 45px 10px;
      text-align: center;
      color: #9eacbd;
    }
  `;

  document.head.appendChild(style);
}

function renderCart() {
  ensureCartUI();

  const itemsElement =
    $("#fitdeal-cart-items");

  const footerElement =
    $("#fitdeal-cart-footer");

  const countElement =
    $("#fitdeal-cart-count");

  if (!itemsElement) return;

  const items =
    cartProducts();

  if (countElement) {
    countElement.textContent =
      `${cartCount()} ${
        cartCount() === 1
          ? "product"
          : "producten"
      }`;
  }

  if (!items.length) {
    itemsElement.innerHTML = `
      <div class="fitdeal-cart-empty">
        <strong>Je winkelmand is leeg.</strong>
        <p>
          Voeg een product toe vanuit de deals.
        </p>
      </div>
    `;

    if (footerElement) {
      footerElement.innerHTML = "";
    }

    return;
  }

  itemsElement.innerHTML =
    items
      .map(({ product, quantity }) => `
        <div
          class="fitdeal-cart-item"
          data-cart-id="${escapeHtml(
            String(product.id)
          )}"
        >

          ${
            product.image_url
              ? `
                <img
                  src="${escapeHtml(
                    product.image_url
                  )}"
                  alt=""
                >
              `
              : `
                <div></div>
              `
          }

          <div>

            <h4>
              ${escapeHtml(
                product.name
              )}
            </h4>

            <div class="fitdeal-cart-price">
              ${money(
                price(product),
                product.currency
              )}
            </div>

            <div class="fitdeal-cart-controls">

              <button
                type="button"
                data-cart-minus="${escapeHtml(
                  String(product.id)
                )}"
              >
                −
              </button>

              <span>
                ${quantity}
              </span>

              <button
                type="button"
                data-cart-plus="${escapeHtml(
                  String(product.id)
                )}"
              >
                +
              </button>

              <button
                type="button"
                class="fitdeal-cart-remove"
                data-cart-remove="${escapeHtml(
                  String(product.id)
                )}"
              >
                Verwijder
              </button>

            </div>

          </div>

        </div>
      `)
      .join("");

  if (footerElement) {
    footerElement.innerHTML = `
      <div class="fitdeal-cart-total">
        <span>Totaal</span>
        <span>
          ${money(cartTotal())}
        </span>
      </div>

      <p class="fitdeal-cart-note">
        Dit is een vergelijkingsmandje.
        Je koopt rechtstreeks bij de betreffende winkel.
      </p>

      <button
        type="button"
        class="fitdeal-cart-close-button"
        data-cart-close
      >
        Verder winkelen
      </button>
    `;
  }
}

function openCart() {
  ensureCartUI();
  renderCart();

  const overlay =
    $("#fitdeal-cart-overlay");

  if (overlay) {
    overlay.hidden = false;
    document.body.style.overflow =
      "hidden";
  }
}

function closeCart() {
  const overlay =
    $("#fitdeal-cart-overlay");

  if (overlay) {
    overlay.hidden = true;
  }

  document.body.style.overflow = "";
}

function setupCartEvents() {
  ensureCartUI();
  injectCartStyles();

  document.addEventListener(
    "click",
    event => {
      const target =
        event.target.closest?.(
          "[data-add-cart], [data-cart-plus], [data-cart-minus], [data-cart-remove], [data-cart-close]"
        );

      if (!target) return;

      if (
        target.dataset.addCart
      ) {
        addToCart(
          target.dataset.addCart
        );
        return;
      }

      if (
        target.dataset.cartPlus
      ) {
        changeCartQuantity(
          target.dataset.cartPlus,
          1
        );
        return;
      }

      if (
        target.dataset.cartMinus
      ) {
        changeCartQuantity(
          target.dataset.cartMinus,
          -1
        );
        return;
      }

      if (
        target.dataset.cartRemove
      ) {
        removeFromCart(
          target.dataset.cartRemove
        );
        return;
      }

      if (
        target.dataset.cartClose !==
        undefined
      ) {
        closeCart();
      }
    }
  );
}


/* =========================================================
   CART BUTTON / HEADER
========================================================= */

function setupCartTrigger() {
  /*
   * Als index.html al een winkelmandknop heeft,
   * koppelen we bekende varianten.
   */
  const selectors = [
    "#cart-button",
    "#cart-toggle",
    "[data-cart-toggle]",
    ".cart-toggle",
    ".cart-button-header"
  ];

  for (const selector of selectors) {
    $all(selector).forEach(
      button => {
        button.addEventListener(
          "click",
          event => {
            event.preventDefault();
            openCart();
          }
        );
      }
    );
  }
}

function updateCartTriggers() {
  const count = cartCount();

  $all(
    "#cart-count, [data-cart-count]"
  ).forEach(element => {
    element.textContent =
      String(count);
  });
}


/* =========================================================
   PLANNER
========================================================= */

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

function plannerKeywords(goal) {
  const normalized =
    normalize(goal);

  if (normalized === "cut") {
    return [
      "protein",
      "proteine",
      "whey",
      "creatine",
      "caffeine",
      "carnitine"
    ];
  }

  if (normalized === "bulk") {
    return [
      "gainer",
      "mass",
      "protein",
      "proteine",
      "whey",
      "creatine"
    ];
  }

  return [
    "protein",
    "proteine",
    "whey",
    "creatine",
    "amino",
    "bcaa",
    "pre workout"
  ];
}

function createPlanner() {
  const {
    container,
    goal,
    budget,
    result
  } = getPlannerElements();

  if (!container || !goal || !budget || !result) {
    return;
  }

  /*
   * We gebruiken het bestaande HTML-element.
   * Geen tweede planner ernaast.
   */
  const form =
    goal.closest("form") ||
    container.querySelector("form");

  if (!form) {
    return;
  }

  form.addEventListener(
    "submit",
    event => {
      event.preventDefault();

      const selectedGoal =
        normalize(goal.value);

      const maxBudget =
        Number(
          String(
            budget.value || ""
          ).replace(",", ".")
        );

      if (
        !selectedGoal ||
        !Number.isFinite(maxBudget) ||
        maxBudget <= 0
      ) {
        result.innerHTML = `
          <p>
            Kies een doel en vul een geldig budget in.
          </p>
        `;

        return;
      }

      const keywords =
        plannerKeywords(
          selectedGoal
        );

      const candidates =
        state.products
          .filter(isUsableProduct)
          .filter(product => {
            if (
              price(product) >
              maxBudget
            ) {
              return false;
            }

            return (
              matchesGoal(
                product,
                selectedGoal
              ) ||
              hasAny(
                productText(product),
                keywords
              )
            );
          })
          .sort(
            (a, b) =>
              (Number(b.deal_score) || 0) -
              (Number(a.deal_score) || 0)
          )
          .slice(0, 5);

      if (!candidates.length) {
        result.innerHTML = `
          <p>
            Binnen dit budget vonden we nu geen passende producten.
          </p>
        `;

        return;
      }

      result.innerHTML = `
        <div class="planner-results">

          ${candidates
            .map(
              product => `
                <div class="planner-result-item">

                  <strong>
                    ${escapeHtml(
                      product.name
                    )}
                  </strong>

                  <span>
                    ${money(
                      price(product),
                      product.currency
                    )}
                  </span>

                  <button
                    type="button"
                    class="cart-button"
                    data-add-cart="${escapeHtml(
                      String(product.id)
                    )}"
                  >
                    Toevoegen
                  </button>

                </div>
              `
            )
            .join("")}

        </div>
      `;
    }
  );
}


/* =========================================================
   AI SUPPLEMENT COACH
========================================================= */

function setupAI() {
  const form = $("#ai-form");

  const input =
    first(
      "#ai-input",
      "#ai-question"
    );

  const output =
    first(
      "#ai-response",
      "#ai-output"
    );

  if (!form || !input || !output) {
    return;
  }

  form.addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const message =
        input.value.trim();

      if (!message) {
        return;
      }

      output.innerHTML = `
        <p>
          Even nadenken...
        </p>
      `;

      const submit =
        form.querySelector(
          'button[type="submit"]'
        );

      if (submit) {
        submit.disabled = true;
      }

      try {
        const response =
          await fetch(
            API_AI,
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
                Accept:
                  "application/json"
              },
              body: JSON.stringify({
                message
              })
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data?.error ||
            `AI status ${response.status}`
          );
        }

        const answer =
          data?.response ??
          data?.answer ??
          data?.message ??
          data?.text ??
          "";

        if (!answer) {
          throw new Error(
            "Geen AI-antwoord ontvangen."
          );
        }

        output.innerHTML = `
          <div class="ai-answer">
            ${formatAIText(answer)}
          </div>
        `;
      } catch (error) {
        console.error(
          "AI Coach error:",
          error
        );

        output.innerHTML = `
          <p>
            De Supplement Coach is momenteel niet beschikbaar.
            Probeer het later opnieuw.
          </p>
        `;
      } finally {
        if (submit) {
          submit.disabled = false;
        }
      }
    }
  );
}

function formatAIText(value) {
  const text =
    String(value || "").trim();

  /*
   * Geen innerHTML vanuit AI gebruiken.
   * Eerst volledig escapen.
   */
  return escapeHtml(text)
    .replace(
      /\n\n+/g,
      "</p><p>"
    )
    .replace(
      /\n/g,
      "<br>"
    )
    .replace(
      /^/,
      "<p>"
    )
    .replace(
      /$/,
      "</p>"
    );
}


/* =========================================================
   DEAL / AFFILIATE TRACKING
========================================================= */

function setupDealTracking() {
  document.addEventListener(
    "click",
    event => {
      const link =
        event.target.closest?.(
          'a[href^="/go/"]'
        );

      if (!link) return;

      /*
       * De daadwerkelijke affiliate redirect
       * wordt door worker.ts afgehandeld.
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
        event.key === "Escape"
      ) {
        closeCart();
      }
    }
  );
}


/* =========================================================
   INITIALISATION
========================================================= */

function init() {
  setupSearch();
  setupGoals();
  setupCategories();

  setupCartEvents();
  setupCartTrigger();
  updateCartTriggers();

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
