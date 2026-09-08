"use strict";

/* =========================================================
   FitDealFinder - app.js
   ========================================================= */

const API_PRODUCTS = "/api/products";
const API_AI = "/api/ai/chat";

const PAGE_SIZE = 200;
const MAX_PRODUCTS = 2000;
const PRODUCTS_PER_VIEW = 24;
const CART_KEY = "fitdealfinder_cart";

/* =========================================================
   STATE
   ========================================================= */

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
   HELPERS
   ========================================================= */

function $(selector, parent = document) {
  return parent.querySelector(selector);
}

function $$(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

function normalize(value) {
  return String(value ?? "")
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

function formatPrice(value, currency = "EUR") {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "Prijs onbekend";
  }

  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: currency || "EUR"
    }).format(number);
  } catch {
    return `€ ${number.toFixed(2).replace(".", ",")}`;
  }
}

function getProductId(product) {
  return String(
    product?.id ??
    product?.external_id ??
    product?.slug ??
    ""
  );
}

function productText(product) {
  return normalize([
    product?.name,
    product?.brand,
    product?.merchant_name,
    product?.category,
    product?.description
  ].join(" "));
}

/* =========================================================
   PRODUCT CLASSIFICATION
   ========================================================= */

const EXCLUDED_TERMS = [
  "voedingsschema",
  "voedingsschema's",
  "voedingsplan",
  "meal plan",
  "mealplan",
  "diet plan",
  "ebook",
  "e-book",
  "kookboek",
  "receptenboek",
  "recepten",
  "drinkbeker",
  "drinkfles",
  "waterfles",
  "shaker bottle",
  "shakerbeker",
  "bidon",
  "beker",
  "bottle",
  "gymtas",
  "sporttas",
  "tas",
  "shirt",
  "t-shirt",
  "hoodie",
  "sweater",
  "broek",
  "short",
  "legging",
  "sokken",
  "pet",
  "cap",
  "accessoire",
  "accessoires",
  "merchandise",
  "merch",
  "handdoek",
  "handdoekje",
  "riem",
  "lifting straps",
  "wrist wraps",
  "knieband",
  "kniebanden"
];

const PRODUCT_TERMS = [
  "protein",
  "proteine",
  "proteïne",
  "whey",
  "casein",
  "caseine",
  "caseïne",
  "isolate",
  "isolaat",
  "creatine",
  "pre workout",
  "pre-workout",
  "preworkout",
  "post workout",
  "amino",
  "bcaa",
  "eaa",
  "intra workout",
  "intra-workout",
  "collagen",
  "collageen",
  "vitamin",
  "vitamine",
  "multivitamin",
  "omega",
  "magnesium",
  "zinc",
  "zink",
  "caffeine",
  "cafeine",
  "cafeïne",
  "electrolyte",
  "electrolyten",
  "supplement",
  "supplementen",
  "fat burner",
  "fatburner",
  "thermogenic",
  "thermogenics",
  "mass gainer",
  "massgainer",
  "weight gainer",
  "weightgainer",
  "gainer",
  "glutamine",
  "citrulline",
  "beta alanine",
  "beta-alanine",
  "arginine",
  "pump",
  "test booster",
  "testbooster",
  "greens",
  "fiber",
  "vezels",
  "carbo",
  "carbs",
  "dextrose",
  "maltodextrine",
  "creatine monohydraat",
  "creatine monohydrate"
];

const CUT_TERMS = [
  "fat burner",
  "fatburner",
  "thermogenic",
  "thermogenics",
  "cut",
  "cutting",
  "shred",
  "shredd",
  "weight loss",
  "gewichtsverlies",
  "afvallen",
  "diet",
  "dieet",
  "caffeine",
  "cafeine",
  "cafeïne",
  "l-carnitine",
  "carnitine",
  "appetite"
];

const BULK_TERMS = [
  "mass gainer",
  "massgainer",
  "weight gainer",
  "weightgainer",
  "gainer",
  "hard gainer",
  "hardgainer",
  "mega mass",
  "mass gain",
  "calorie surplus"
];

const LEAN_BULK_TERMS = [
  "lean bulk",
  "lean-bulk",
  "leanbulking",
  "muscle",
  "muscle gain",
  "spiermassa",
  "spiergroei",
  "hypertrophy",
  "strength",
  "kracht",
  "protein",
  "proteine",
  "proteïne",
  "whey",
  "casein",
  "caseine",
  "caseïne",
  "creatine",
  "amino",
  "bcaa",
  "eaa",
  "pre workout",
  "pre-workout",
  "preworkout"
];

function containsTerm(text, terms) {
  const value = normalize(text);

  return terms.some(term => {
    const needle = normalize(term);
    return needle && value.includes(needle);
  });
}

function productIsUsable(product) {
  if (!product) {
    return false;
  }

  const id = getProductId(product);
  const name = String(product?.name ?? "").trim();
  const url = String(
    product?.affiliate_url ??
    product?.product_url ??
    ""
  ).trim();

  if (!id || !name || !url) {
    return false;
  }

  const text = productText(product);

  if (containsTerm(text, EXCLUDED_TERMS)) {
    return false;
  }

  return true;
}

function isBulkProduct(product) {
  return containsTerm(productText(product), BULK_TERMS);
}

function isCutProduct(product) {
  return containsTerm(productText(product), CUT_TERMS);
}

function matchesGoal(product, goal) {
  const selected = normalize(goal);

  if (!selected) {
    return true;
  }

  const text = productText(product);

  const bulk = isBulkProduct(product);
  const cut = isCutProduct(product);

  if (selected === "cut") {
    /*
      Cut:
      - voorkom duidelijke bulk/gainer producten
      - geef voorkeur aan cut/fatburner/cafeine
      - maar laat normale eiwit/creatine/pre-workout producten
        ook toe
    */

    if (bulk) {
      return false;
    }

    if (cut) {
      return true;
    }

    return containsTerm(text, [
      "protein",
      "proteine",
      "proteïne",
      "whey",
      "isolate",
      "casein",
      "caseine",
      "caseïne",
      "creatine",
      "pre workout",
      "pre-workout",
      "preworkout",
      "amino",
      "bcaa",
      "eaa",
      "electrolyte",
      "vitamin",
      "vitamine",
      "magnesium",
      "omega"
    ]);
  }

  if (selected === "bulk") {
    /*
      Bulk:
      - gainer/mass producten zijn sterk relevant
      - eiwit, creatine en spiergerichte producten blijven zichtbaar
      - duidelijke cut-only producten worden vermeden
    */

    if (bulk) {
      return true;
    }

    if (cut && !containsTerm(text, [
      "protein",
      "proteine",
      "proteïne",
      "whey",
      "creatine"
    ])) {
      return false;
    }

    return containsTerm(text, [
      "protein",
      "proteine",
      "proteïne",
      "whey",
      "isolate",
      "isolaat",
      "casein",
      "caseine",
      "caseïne",
      "creatine",
      "amino",
      "bcaa",
      "eaa",
      "pre workout",
      "pre-workout",
      "preworkout",
      "muscle",
      "spier",
      "strength",
      "kracht",
      "mass",
      "gainer"
    ]);
  }

  if (
    selected === "lean-bulk" ||
    selected === "lean bulk" ||
    selected === "leanbulk"
  ) {
    /*
      Lean bulk:
      - geen klassieke mass gainers
      - vooral protein/creatine/pre-workout/muscle
    */

    if (bulk) {
      return false;
    }

    return containsTerm(text, LEAN_BULK_TERMS);
  }

  return true;
}

/* =========================================================
   CATEGORIES
   ========================================================= */

function matchesCategory(product, category) {
  const selected = normalize(category);

  if (!selected) {
    return true;
  }

  const text = productText(product);

  if (selected === "proteine" || selected === "proteine") {
    return containsTerm(text, [
      "protein",
      "proteine",
      "proteïne",
      "whey",
      "casein",
      "caseine",
      "caseïne",
      "isolate",
      "isolaat",
      "hydro whey",
      "hydrolyzed whey"
    ]);
  }

  if (selected === "creatine") {
    return containsTerm(text, [
      "creatine"
    ]);
  }

  if (
    selected === "pre-workout" ||
    selected === "pre workout" ||
    selected === "preworkout"
  ) {
    return containsTerm(text, [
      "pre workout",
      "pre-workout",
      "preworkout",
      "pre-workout formula",
      "pump",
      "citrulline",
      "beta alanine",
      "beta-alanine",
      "caffeine",
      "cafeine",
      "cafeïne"
    ]);
  }

  if (
    selected === "supplementen" ||
    selected === "supplement"
  ) {
    return containsTerm(text, PRODUCT_TERMS);
  }

  return text.includes(selected);
}

/* =========================================================
   SEARCH
   ========================================================= */

function matchesSearch(product, search) {
  const query = normalize(search);

  if (!query) {
    return true;
  }

  return productText(product).includes(query);
}

/* =========================================================
   API
   ========================================================= */

async function fetchProductsPage(offset = 0) {
  const params = new URLSearchParams();

  params.set("limit", String(PAGE_SIZE));
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
      `Product API gaf status ${response.status}`
    );
  }

  const json = await response.json();

  /*
    Ondersteunt meerdere mogelijke API-vormen:
    - { data: [...] }
    - { products: [...] }
    - { data: { products: [...] } }
    - [...]
  */

  let products = [];

  if (Array.isArray(json)) {
    products = json;
  } else if (Array.isArray(json?.data)) {
    products = json.data;
  } else if (Array.isArray(json?.products)) {
    products = json.products;
  } else if (Array.isArray(json?.data?.products)) {
    products = json.data.products;
  }

  return products;
}

async function loadAllProducts() {
  if (state.loading) {
    return;
  }

  state.loading = true;

  setProductLoading(true);

  try {
    const all = [];
    let offset = 0;

    while (all.length < MAX_PRODUCTS) {
      const page = await fetchProductsPage(offset);

      if (!page.length) {
        break;
      }

      for (const product of page) {
        const id = getProductId(product);

        if (!id) {
          continue;
        }

        const exists = all.some(
          item => getProductId(item) === id
        );

        if (!exists) {
          all.push(product);
        }

        if (all.length >= MAX_PRODUCTS) {
          break;
        }
      }

      if (page.length < PAGE_SIZE) {
        break;
      }

      offset += page.length;
    }

    state.products = all.filter(productIsUsable);

    applyFilters();

  } catch (error) {
    console.error("Producten laden mislukt:", error);

    showProductError(
      "De producten konden momenteel niet worden geladen. Probeer de pagina opnieuw te openen."
    );

  } finally {
    state.loading = false;
    setProductLoading(false);
  }
}

/* =========================================================
   FILTERING
   ========================================================= */

function applyFilters() {
  state.visibleCount = PRODUCTS_PER_VIEW;

  state.filtered = state.products.filter(product => {
    if (!matchesSearch(product, state.search)) {
      return false;
    }

    if (!matchesCategory(product, state.category)) {
      return false;
    }

    if (!matchesGoal(product, state.goal)) {
      return false;
    }

    return true;
  });

  renderProducts();
}

/* =========================================================
   PRODUCT RENDERING
   ========================================================= */

function getDiscount(product) {
  const direct = Number(product?.discount_percent);

  if (Number.isFinite(direct) && direct > 0) {
    return Math.round(direct);
  }

  const price = Number(product?.price);
  const oldPrice = Number(product?.old_price);

  if (
    Number.isFinite(price) &&
    Number.isFinite(oldPrice) &&
    oldPrice > price &&
    oldPrice > 0
  ) {
    return Math.round(
      ((oldPrice - price) / oldPrice) * 100
    );
  }

  return 0;
}

function productImage(product) {
  const url = String(product?.image_url ?? "").trim();

  if (!url) {
    return `
      <div class="product-image-placeholder" aria-hidden="true">
        🏋️
      </div>
    `;
  }

  return `
    <img
      src="${escapeHtml(url)}"
      alt="${escapeHtml(product?.name || "Supplement")}"
      loading="lazy"
      onerror="this.style.display='none'"
    >
  `;
}

function productGoals(product) {
  const goals = [];

  if (matchesGoal(product, "cut")) {
    goals.push("Cut");
  }

  if (matchesGoal(product, "bulk")) {
    goals.push("Bulk");
  }

  if (matchesGoal(product, "lean-bulk")) {
    goals.push("Lean Bulk");
  }

  return goals;
}

function renderProductCard(product) {
  const id = getProductId(product);
  const name = product?.name || "Supplement";
  const brand = product?.brand || "";
  const merchant = product?.merchant_name || "Winkel";
  const price = Number(product?.price);
  const oldPrice = Number(product?.old_price);
  const discount = getDiscount(product);
  const inStock =
    product?.in_stock === undefined ||
    Number(product?.in_stock) === 1 ||
    product?.in_stock === true;

  const goals = productGoals(product);

  const cartItem = state.cart.find(
    item => String(item.id) === String(id)
  );

  const isInCart = Boolean(cartItem);

  return `
    <article class="product-card" data-product-id="${escapeHtml(id)}">

      <div class="product-image">
        ${productImage(product)}

        ${
          discount > 0
            ? `<span class="discount-badge">-${discount}%</span>`
            : ""
        }
      </div>

      <div class="product-content">

        ${
          brand
            ? `<div class="product-brand">${escapeHtml(brand)}</div>`
            : ""
        }

        <h3 class="product-title">
          ${escapeHtml(name)}
        </h3>

        <div class="product-store">
          ${escapeHtml(merchant)}
        </div>

        <div class="product-price-row">

          <div>
            <strong class="product-price">
              ${formatPrice(price, product?.currency)}
            </strong>

            ${
              Number.isFinite(oldPrice) && oldPrice > price
                ? `
                  <span class="product-old-price">
                    ${formatPrice(oldPrice, product?.currency)}
                  </span>
                `
                : ""
            }
          </div>

        </div>

        <div class="product-stock">
          ${
            inStock
              ? "✓ Op voorraad"
              : "Niet op voorraad"
          }
        </div>

        ${
          goals.length
            ? `
              <div class="product-goals">
                ${goals.map(goal => `
                  <span>${escapeHtml(goal)}</span>
                `).join("")}
              </div>
            `
            : ""
        }

        <div class="product-actions">

          <a
            class="button button-primary"
            href="/go/${encodeURIComponent(id)}"
          >
            Bekijk deal
          </a>

          <button
            type="button"
            class="button button-secondary add-cart-button"
            data-add-cart="${escapeHtml(id)}"
          >
            ${isInCart ? "In winkelmand ✓" : "Winkelmand"}
          </button>

        </div>

      </div>

    </article>
  `;
}

function renderProducts() {
  const grid = $("#products-grid");
  const count = $("#product-count");

  if (!grid) {
    return;
  }

  if (count) {
    count.textContent = String(state.filtered.length);
  }

  if (!state.filtered.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>Geen producten gevonden</h3>
        <p>
          Probeer een andere zoekterm, categorie of doel.
        </p>
        <button
          type="button"
          class="button button-primary"
          id="reset-filters"
        >
          Filters wissen
        </button>
      </div>
    `;

    updateLoadMoreButton();
    return;
  }

  const visible = state.filtered.slice(
    0,
    state.visibleCount
  );

  grid.innerHTML = visible
    .map(renderProductCard)
    .join("");

  updateLoadMoreButton();
  renderCart();
}

function showProductError(message) {
  const grid = $("#products-grid");

  if (!grid) {
    return;
  }

  grid.innerHTML = `
    <div class="empty-state">
      <h3>Producten tijdelijk niet beschikbaar</h3>
      <p>${escapeHtml(message)}</p>
      <button
        type="button"
        class="button button-primary"
        id="retry-products"
      >
        Opnieuw proberen
      </button>
    </div>
  `;
}

function setProductLoading(loading) {
  const grid = $("#products-grid");

  if (!grid || !loading) {
    return;
  }

  grid.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Producten laden...</p>
    </div>
  `;
}

/* =========================================================
   LOAD MORE
   ========================================================= */

function updateLoadMoreButton() {
  const existing = $("#load-more-products");

  if (existing) {
    existing.remove();
  }

  if (
    state.visibleCount >= state.filtered.length ||
    !state.filtered.length
  ) {
    return;
  }

  const grid = $("#products-grid");

  if (!grid || !grid.parentElement) {
    return;
  }

  const button = document.createElement("button");

  button.id = "load-more-products";
  button.type = "button";
  button.className = "button button-secondary";
  button.textContent = "Meer producten laden";

  button.addEventListener("click", () => {
    state.visibleCount += PRODUCTS_PER_VIEW;
    renderProducts();

    const cards = $$(".product-card");

    if (cards.length) {
      cards[Math.max(0, cards.length - PRODUCTS_PER_VIEW)]
        ?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
    }
  });

  grid.parentElement.appendChild(button);
}

/* =========================================================
   SEARCH
   ========================================================= */

function setupSearch() {
  const form = $("#search-form");
  const input = $("#search");

  if (!form || !input) {
    return;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();

    state.search = input.value.trim();
    state.category = "";

    $$(".category-card, [data-category]").forEach(element => {
      element.classList.remove("active", "selected");
    });

    applyFilters();

    const deals = $("#deals");

    if (deals) {
      deals.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });

  input.addEventListener("input", () => {
    state.search = input.value.trim();

    /*
      Live zoeken zonder dat de pagina bij iedere letter
      opnieuw naar de server gaat.
    */
    applyFilters();
  });
}

/* =========================================================
   GOALS
   ========================================================= */

function setupGoals() {
  $$("[data-goal]").forEach(button => {
    button.addEventListener("click", () => {
      const goal = normalize(
        button.dataset.goal || ""
      );

      state.goal =
        state.goal === goal
          ? ""
          : goal;

      state.category = "";

      $$("[data-goal]").forEach(item => {
        item.classList.toggle(
          "active",
          normalize(item.dataset.goal || "") === state.goal
        );

        item.classList.toggle(
          "selected",
          normalize(item.dataset.goal || "") === state.goal
        );
      });

      $$("[data-category]").forEach(item => {
        item.classList.remove("active", "selected");
      });

      applyFilters();
    });
  });
}

/* =========================================================
   CATEGORIES
   ========================================================= */

function setupCategories() {
  $$("[data-category]").forEach(element => {
    element.addEventListener("click", () => {
      const category = normalize(
        element.dataset.category || ""
      );

      state.category =
        state.category === category
          ? ""
          : category;

      state.goal = "";

      $$("[data-category]").forEach(item => {
        const active =
          normalize(item.dataset.category || "") ===
          state.category;

        item.classList.toggle("active", active);
        item.classList.toggle("selected", active);
      });

      $$("[data-goal]").forEach(item => {
        item.classList.remove("active", "selected");
      });

      applyFilters();

      const deals = $("#deals");

      if (deals) {
        deals.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });
  });
}

/* =========================================================
   RESET
   ========================================================= */

function resetFilters() {
  state.search = "";
  state.goal = "";
  state.category = "";
  state.visibleCount = PRODUCTS_PER_VIEW;

  const input = $("#search");

  if (input) {
    input.value = "";
  }

  $$("[data-goal], [data-category]").forEach(
    element => {
      element.classList.remove(
        "active",
        "selected"
      );
    }
  );

  applyFilters();
}

/* =========================================================
   CART
   ========================================================= */

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch (error) {
    console.warn("Winkelmand kon niet worden geladen:", error);
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
    console.warn("Winkelmand kon niet worden opgeslagen:", error);
  }
}

function getCartElement() {
  let cart = $("#cart");

  if (cart) {
    return cart;
  }

  /*
    Sommige versies van index.html hadden geen #cart.
    Daarom maken we hem automatisch aan.
  */

  const planner = $("#planner-result");
  const main = $("main") || document.body;

  cart = document.createElement("aside");

  cart.id = "cart";
  cart.className = "cart-panel";

  cart.innerHTML = `
    <div class="cart-header">
      <h2>Winkelmandje</h2>
      <span id="cart-count">0</span>
    </div>

    <div id="cart-items"></div>

    <div class="cart-total">
      <span>Totaal</span>
      <strong id="cart-total-price">€ 0,00</strong>
    </div>

    <button
      type="button"
      class="button button-secondary"
      id="clear-cart"
    >
      Winkelmand leegmaken
    </button>
  `;

  if (planner && planner.parentElement) {
    planner.parentElement.appendChild(cart);
  } else {
    main.appendChild(cart);
  }

  return cart;
}

function addToCart(productId) {
  const id = String(productId);

  const product = state.products.find(
    item => getProductId(item) === id
  );

  if (!product) {
    return;
  }

  const existing = state.cart.find(
    item => String(item.id) === id
  );

  if (existing) {
    existing.quantity =
      Number(existing.quantity || 1) + 1;
  } else {
    state.cart.push({
      id,
      name: product.name || "Supplement",
      merchant_name:
        product.merchant_name || "Winkel",
      price: Number(product.price) || 0,
      currency: product.currency || "EUR",
      product_url:
        product.affiliate_url ||
        product.product_url ||
        "",
      quantity: 1
    });
  }

  saveCart();
  renderCart();
  renderProducts();
}

function removeFromCart(productId) {
  const id = String(productId);

  state.cart = state.cart.filter(
    item => String(item.id) !== id
  );

  saveCart();
  renderCart();
  renderProducts();
}

function changeCartQuantity(productId, change) {
  const id = String(productId);

  const item = state.cart.find(
    cartItem => String(cartItem.id) === id
  );

  if (!item) {
    return;
  }

  item.quantity =
    Number(item.quantity || 1) + Number(change);

  if (item.quantity <= 0) {
    removeFromCart(id);
    return;
  }

  saveCart();
  renderCart();
}

function clearCart() {
  state.cart = [];

  saveCart();
  renderCart();
  renderProducts();
}

function renderCart() {
  const cart = getCartElement();

  if (!cart) {
    return;
  }

  const itemsContainer =
    $("#cart-items", cart);

  const countElement =
    $("#cart-count", cart);

  const totalElement =
    $("#cart-total-price", cart);

  if (!itemsContainer) {
    return;
  }

  const totalItems = state.cart.reduce(
    (sum, item) =>
      sum + Number(item.quantity || 1),
    0
  );

  const totalPrice = state.cart.reduce(
    (sum, item) =>
      sum +
      (Number(item.price) || 0) *
      Number(item.quantity || 1),
    0
  );

  if (countElement) {
    countElement.textContent =
      String(totalItems);
  }

  if (totalElement) {
    totalElement.textContent =
      formatPrice(totalPrice);
  }

  if (!state.cart.length) {
    itemsContainer.innerHTML = `
      <div class="cart-empty">
        <p>Je winkelmandje is nog leeg.</p>
        <p>
          Voeg producten toe om hier je selectie te zien.
        </p>
      </div>
    `;

    return;
  }

  itemsContainer.innerHTML = state.cart
    .map(item => `
      <div class="cart-item">

        <div class="cart-item-info">
          <strong>
            ${escapeHtml(item.name)}
          </strong>

          <small>
            ${escapeHtml(item.merchant_name)}
          </small>

          <span>
            ${formatPrice(
              item.price,
              item.currency
            )}
          </span>
        </div>

        <div class="cart-item-actions">

          <button
            type="button"
            data-cart-minus="${escapeHtml(item.id)}"
            aria-label="Aantal verlagen"
          >
            −
          </button>

          <span>
            ${Number(item.quantity || 1)}
          </span>

          <button
            type="button"
            data-cart-plus="${escapeHtml(item.id)}"
            aria-label="Aantal verhogen"
          >
            +
          </button>

          <button
            type="button"
            data-cart-remove="${escapeHtml(item.id)}"
            aria-label="Verwijderen"
          >
            ×
          </button>

        </div>

      </div>
    `)
    .join("");
}

/* =========================================================
   PLANNER
   ========================================================= */

function plannerScore(product, goal) {
  const text = productText(product);
  const selected = normalize(goal);

  let score = 0;

  if (
    selected === "cut" &&
    isCutProduct(product)
  ) {
    score += 10;
  }

  if (
    selected === "bulk" &&
    isBulkProduct(product)
  ) {
    score += 10;
  }

  if (
    selected === "lean-bulk" &&
    !isBulkProduct(product) &&
    containsTerm(text, [
      "protein",
      "proteine",
      "proteïne",
      "whey",
      "creatine",
      "muscle",
      "spier"
    ])
  ) {
    score += 10;
  }

  if (getDiscount(product) > 0) {
    score += getDiscount(product) / 10;
  }

  if (product?.in_stock === 1) {
    score += 2;
  }

  return score;
}

function getPlannerProducts(goal, budget) {
  const selectedGoal = normalize(goal);
  const maxBudget = Number(budget);

  if (!selectedGoal || !Number.isFinite(maxBudget)) {
    return [];
  }

  if (maxBudget <= 0) {
    return [];
  }

  const candidates = state.products
    .filter(product => {
      if (!productIsUsable(product)) {
        return false;
      }

      if (!matchesGoal(product, selectedGoal)) {
        return false;
      }

      const price = Number(product.price);

      return (
        Number.isFinite(price) &&
        price > 0 &&
        price <= maxBudget
      );
    })
    .map(product => ({
      product,
      score: plannerScore(
        product,
        selectedGoal
      )
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      const discountDifference =
        getDiscount(b.product) -
        getDiscount(a.product);

      if (discountDifference !== 0) {
        return discountDifference;
      }

      return (
        Number(a.product.price) -
        Number(b.product.price)
      );
    });

  return candidates
    .slice(0, 5)
    .map(item => item.product);
}

function renderPlannerResults(
  products,
  goal,
  budget
) {
  const result = $("#planner-result");

  if (!result) {
    return;
  }

  if (!products.length) {
    result.innerHTML = `
      <div class="empty-state">
        <h3>Geen passend plan gevonden</h3>
        <p>
          Er zijn momenteel geen passende producten
          binnen ${formatPrice(budget)} voor
          ${escapeHtml(goal)}.
        </p>
        <p>
          Probeer een iets hoger budget.
        </p>
      </div>
    `;

    return;
  }

  const total = products.reduce(
    (sum, product) =>
      sum + (Number(product.price) || 0),
    0
  );

  result.innerHTML = `
    <div class="planner-result-header">
      <h3>Jouw ${escapeHtml(goal)} selectie</h3>

      <p>
        ${products.length} producten ·
        totaal ${formatPrice(total)}
        van ${formatPrice(budget)} budget
      </p>
    </div>

    <div class="planner-products">
      ${products.map(product => `
        <div class="planner-product">

          <div>
            <strong>
              ${escapeHtml(product.name)}
            </strong>

            <small>
              ${escapeHtml(
                product.merchant_name || "Winkel"
              )}
            </small>
          </div>

          <div class="planner-product-right">
            <strong>
              ${formatPrice(
                product.price,
                product.currency
              )}
            </strong>

            <button
              type="button"
              class="button button-secondary"
              data-add-planner="${escapeHtml(
                getProductId(product)
              )}"
            >
              Toevoegen
            </button>
          </div>

        </div>
      `).join("")}
    </div>

    <button
      type="button"
      class="button button-primary"
      id="add-planner-all"
    >
      Alles toevoegen aan winkelmand
    </button>
  `;
}

function setupPlanner() {
  const form = $("#planner-form");

  if (!form) {
    return;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();

    const goalField =
      $('[name="goal"]', form) ||
      $("#planner-goal");

    const budgetField =
      $('[name="budget"]', form) ||
      $("#planner-budget");

    const goal =
      goalField?.value || "";

    const budget =
      Number(budgetField?.value || 0);

    if (!goal || !Number.isFinite(budget) || budget <= 0) {
      const result = $("#planner-result");

      if (result) {
        result.innerHTML = `
          <div class="empty-state">
            <h3>Vul je doel en budget in</h3>
            <p>
              Kies bijvoorbeeld Cut en een budget van €70.
            </p>
          </div>
        `;
      }

      return;
    }

    const products =
      getPlannerProducts(
        goal,
        budget
      );

    renderPlannerResults(
      products,
      goal,
      budget
    );
  });
}

/* =========================================================
   AI COACH
   ========================================================= */

function setupAI() {
  const form = $("#ai-form");
  const input = $("#ai-input");
  const output = $("#ai-output");

  if (!form || !input || !output) {
    return;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const message =
      input.value.trim();

    if (!message) {
      return;
    }

    output.innerHTML = `
      <div class="ai-loading">
        Even nadenken...
      </div>
    `;

    try {
      const response = await fetch(
        API_AI,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            message
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          `AI gaf status ${response.status}`
        );
      }

      const json =
        await response.json();

      const answer =
        json?.answer ??
        json?.message ??
        json?.data?.answer ??
        json?.data?.message ??
        "Ik kon geen antwoord genereren.";

      output.innerHTML = `
        <div class="ai-answer">
          ${escapeHtml(answer)}
        </div>
      `;

    } catch (error) {
      console.error(
        "AI Coach fout:",
        error
      );

      output.innerHTML = `
        <div class="ai-error">
          De AI Coach is momenteel niet beschikbaar.
          Probeer het later opnieuw.
        </div>
      `;
    }
  });
}

/* =========================================================
   EVENT DELEGATION
   ========================================================= */

function setupGlobalEvents() {
  document.addEventListener("click", event => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const addButton =
      target.closest("[data-add-cart]");

    if (addButton) {
      event.preventDefault();

      addToCart(
        addButton.dataset.addCart
      );

      return;
    }

    const plannerButton =
      target.closest("[data-add-planner]");

    if (plannerButton) {
      event.preventDefault();

      addToCart(
        plannerButton.dataset.addPlanner
      );

      return;
    }

    const minusButton =
      target.closest("[data-cart-minus]");

    if (minusButton) {
      changeCartQuantity(
        minusButton.dataset.cartMinus,
        -1
      );

      return;
    }

    const plusButton =
      target.closest("[data-cart-plus]");

    if (plusButton) {
      changeCartQuantity(
        plusButton.dataset.cartPlus,
        1
      );

      return;
    }

    const removeButton =
      target.closest("[data-cart-remove]");

    if (removeButton) {
      removeFromCart(
        removeButton.dataset.cartRemove
      );

      return;
    }

    if (
      target.id === "clear-cart" ||
      target.closest("#clear-cart")
    ) {
      clearCart();
      return;
    }

    if (
      target.id === "reset-filters" ||
      target.closest("#reset-filters")
    ) {
      resetFilters();
      return;
    }

    if (
      target.id === "retry-products" ||
      target.closest("#retry-products")
    ) {
      loadAllProducts();
      return;
    }

    if (
      target.id === "add-planner-all" ||
      target.closest("#add-planner-all")
    ) {
      addAllPlannerProducts();
      return;
    }
  });
}

/* =========================================================
   PLANNER CART
   ========================================================= */

function addAllPlannerProducts() {
  const result = $("#planner-result");

  if (!result) {
    return;
  }

  const buttons =
    $$("[data-add-planner]", result);

  if (!buttons.length) {
    return;
  }

  buttons.forEach(button => {
    addToCart(
      button.dataset.addPlanner
    );
  });

  renderCart();

  const cart =
    getCartElement();

  if (cart) {
    cart.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

async function init() {
  setupSearch();
  setupGoals();
  setupCategories();
  setupPlanner();
  setupAI();
  setupGlobalEvents();

  /*
    Winkelmand direct klaarzetten.
  */
  getCartElement();
  renderCart();

  await loadAllProducts();
}

if (
  document.readyState === "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    init
  );
} else {
  init();
                    }
