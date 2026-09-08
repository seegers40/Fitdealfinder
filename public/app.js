const API_PRODUCTS = "/api/products";
const API_AI = "/api/ai/chat";

const API_PAGE_SIZE = 200;
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
   BASIS
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

function formatPrice(value, currency = "EUR") {
  const price = Number(value);

  if (!Number.isFinite(price)) {
    return "";
  }

  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: currency || "EUR"
    }).format(price);
  } catch {
    return `€ ${price.toFixed(2).replace(".", ",")}`;
  }
}

function productIsUsable(product) {
  return Boolean(
    product &&
    product.id &&
    product.name &&
    product.product_url
  );
}

function getProductText(product) {
  return normalizeText([
    product?.name,
    product?.brand,
    product?.category,
    product?.description,
    product?.merchant_name
  ].join(" "));
}

/* =========================================================
   GOALS
========================================================= */

function getGoals(product) {
  const raw = product?.goals;

  if (Array.isArray(raw)) {
    return raw
      .map(normalizeText)
      .filter(Boolean);
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

/*
 * Veel feeds geven standaard:
 * ["cut","bulk","lean-bulk"]
 *
 * Dat betekent NIET dat ieder product even geschikt
 * is voor ieder doel. Daarom gebruiken we de database-goals
 * alleen als extra signaal en bepalen we daarnaast de
 * productrelevantie.
 */

const GOAL_RULES = {
  cut: {
    strong: [
      "fat burner",
      "fatburner",
      "weight loss",
      "weightloss",
      "cut",
      "cutting",
      "thermogenic",
      "l carnitine",
      "carnitine"
    ],
    medium: [
      "whey",
      "whey isolate",
      "whey isolaat",
      "protein",
      "proteine",
      "eiwit",
      "clear whey",
      "clear protein",
      "casein",
      "caseine",
      "creatine",
      "pre workout",
      "pre-workout",
      "vitamin",
      "vitamine",
      "electrolyte"
    ],
    exclude: [
      "mass gainer",
      "massgainer",
      "weight gainer",
      "gainer"
    ]
  },

  bulk: {
    strong: [
      "mass gainer",
      "massgainer",
      "weight gainer",
      "gainer",
      "bulk",
      "bulking",
      "hard gainer",
      "mass builder"
    ],
    medium: [
      "whey",
      "protein",
      "proteine",
      "eiwit",
      "creatine",
      "creatine monohydraat",
      "casein",
      "caseine",
      "amino",
      "bcaa",
      "eaa",
      "pre workout",
      "pre-workout"
    ],
    exclude: [
      "fat burner",
      "fatburner",
      "weight loss",
      "thermogenic"
    ]
  },

  "lean-bulk": {
    strong: [
      "lean bulk",
      "leanbulking",
      "lean builder",
      "lean mass"
    ],
    medium: [
      "whey",
      "whey isolate",
      "whey isolaat",
      "clear whey",
      "clear protein",
      "protein",
      "proteine",
      "eiwit",
      "creatine",
      "creatine monohydraat",
      "casein",
      "caseine",
      "pre workout",
      "pre-workout",
      "amino",
      "bcaa",
      "eaa"
    ],
    exclude: [
      "fat burner",
      "fatburner",
      "weight loss"
    ]
  }
};

function goalScore(product, goal) {
  const wanted = normalizeText(goal);

  if (!wanted) {
    return 0;
  }

  const rules =
    GOAL_RULES[wanted];

  if (!rules) {
    return 0;
  }

  const text =
    getProductText(product);

  let score = 0;

  for (const term of rules.strong) {
    if (text.includes(normalizeText(term))) {
      score += 10;
    }
  }

  for (const term of rules.medium) {
    if (text.includes(normalizeText(term))) {
      score += 4;
    }
  }

  for (const term of rules.exclude) {
    if (text.includes(normalizeText(term))) {
      score -= 15;
    }
  }

  /*
   * Gebruik echte database-goal als aanvullend signaal,
   * maar niet als hoofdregel.
   */
  const goals =
    getGoals(product);

  if (goals.includes(wanted)) {
    score += 1;
  }

  return score;
}

function matchesGoal(product, goal) {
  const wanted =
    normalizeText(goal);

  if (!wanted) {
    return true;
  }

  return goalScore(
    product,
    wanted
  ) > 0;
}

/* =========================================================
   CATEGORIEËN
========================================================= */

const CATEGORY_RULES = {
  proteine: [
    "protein",
    "proteine",
    "whey",
    "whey isolate",
    "whey isolaat",
    "clear whey",
    "clear protein",
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
    "hydration"
  ]
};

function matchesCategory(
  product,
  category
) {
  const wanted =
    normalizeText(category);

  if (!wanted) {
    return true;
  }

  const text =
    getProductText(product);

  const rules =
    CATEGORY_RULES[wanted];

  if (!rules) {
    return normalizeText(
      product?.category
    ) === wanted;
  }

  return rules.some(
    (term) =>
      text.includes(
        normalizeText(term)
      )
  );
}

/* =========================================================
   ZOEKEN
========================================================= */

function matchesSearch(
  product,
  search
) {
  const query =
    normalizeText(search);

  if (!query) {
    return true;
  }

  const text =
    getProductText(product);

  /*
   * Hele zoekopdracht
   */
  if (text.includes(query)) {
    return true;
  }

  /*
   * Ook zoeken op losse woorden.
   * Hierdoor werkt bijvoorbeeld:
   * "creatine monohydraat"
   */
  const words =
    query
      .split(" ")
      .filter(Boolean);

  if (words.length > 1) {
    return words.every(
      (word) =>
        text.includes(word)
    );
  }

  return false;
}

/* =========================================================
   PRODUCT SORTERING
========================================================= */

function dealScore(product) {
  const discount =
    Number(
      product?.discount_percent
    );

  if (
    Number.isFinite(discount) &&
    discount > 0
  ) {
    return discount;
  }

  const oldPrice =
    Number(product?.old_price);

  const price =
    Number(product?.price);

  if (
    oldPrice > price &&
    price >= 0
  ) {
    return (
      (oldPrice - price) /
      oldPrice
    ) * 100;
  }

  return 0;
}

function sortProducts(
  products
) {
  return [...products].sort(
    (a, b) => {

      if (state.goal) {
        const goalDifference =
          goalScore(b, state.goal) -
          goalScore(a, state.goal);

        if (
          goalDifference !== 0
        ) {
          return goalDifference;
        }
      }

      return (
        dealScore(b) -
        dealScore(a)
      );
    }
  );
}

/* =========================================================
   PRODUCT KAART
========================================================= */

function productCard(product) {
  const id =
    encodeURIComponent(
      product.id
    );

  const name =
    escapeHtml(
      product.name
    );

  const brand =
    escapeHtml(
      product.brand || ""
    );

  const merchant =
    escapeHtml(
      product.merchant_name || ""
    );

  const image =
    escapeHtml(
      product.image_url || ""
    );

  const price =
    formatPrice(
      product.price,
      product.currency || "EUR"
    );

  const oldPriceNumber =
    Number(
      product.old_price
    );

  const priceNumber =
    Number(
      product.price
    );

  const oldPrice =
    Number.isFinite(
      oldPriceNumber
    ) &&
    Number.isFinite(
      priceNumber
    ) &&
    oldPriceNumber >
      priceNumber
      ? formatPrice(
          oldPriceNumber,
          product.currency || "EUR"
        )
      : "";

  const discount =
    dealScore(product);

  const discountText =
    discount > 0
      ? `-${Math.round(discount)}%`
      : "";

  const inStock =
    Number(product.in_stock) === 1;

  const stockText =
    inStock
      ? "Op voorraad"
      : "Controleer voorraad";

  const stockClass =
    inStock
      ? "in"
      : "out";

  const goals =
    getGoals(product);

  const goalLabels =
    goals
      .filter(Boolean)
      .slice(0, 3)
      .map(
        (goal) =>
          `<span class="product-goal">${escapeHtml(goal)}</span>`
      )
      .join("");

  const imageHtml =
    image
      ? `
        <img
          class="product-image"
          src="${image}"
          alt="${name}"
          loading="lazy"
          onerror="
            this.onerror=null;
            this.style.display='none';
            if(this.nextElementSibling){
              this.nextElementSibling.style.display='grid';
            }
          "
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
    <article
      class="product-card"
      data-product-id="${escapeHtml(product.id)}"
    >

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
            ? `
              <div class="product-brand">
                ${brand}
              </div>
            `
            : ""
        }

        <h3 class="product-title">
          <a href="/go/${id}">
            ${name}
          </a>
        </h3>

        ${
          merchant
            ? `
              <div class="product-store">
                ${merchant}
              </div>
            `
            : ""
        }

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
            discountText
              ? `
                <span class="product-discount">
                  ${discountText}
                </span>
              `
              : ""
          }

        </div>

        <div class="product-meta">
          <span class="stock ${stockClass}">
            ${stockText}
          </span>
        </div>

        ${
          goalLabels
            ? `
              <div class="product-goals">
                ${goalLabels}
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
   CSS REPARATIE
========================================================= */

function injectAppStyles() {
  if (
    document.getElementById(
      "fitdeal-app-styles"
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.id =
    "fitdeal-app-styles";

  style.textContent = `
    /* Compacte productafbeeldingen */
    .product-card {
      min-width: 0;
    }

    .product-image-link {
      display: block;
      height: 190px !important;
      overflow: hidden;
      background: #f4f7fa;
    }

    .product-card .product-image {
      width: 100% !important;
      height: 190px !important;
      max-height: 190px !important;
      object-fit: contain !important;
      padding: 14px !important;
    }

    .product-image-placeholder {
      width: 100%;
      height: 190px;
      place-items: center;
      background: #eef2f5;
      color: #8290a0;
      font-size: 22px;
      font-weight: 900;
    }

    .product-card-body {
      padding: 16px !important;
    }

    .product-title {
      margin: 8px 0 4px !important;
      font-size: 17px !important;
    }

    .product-price {
      font-size: 21px !important;
    }

    .product-button {
      display: flex !important;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      margin-top: 14px;
      padding: 0 12px;
      border-radius: 11px;
      background: #07111f;
      color: #fff !important;
      font-weight: 900;
      text-decoration: none !important;
    }

    .product-button:hover {
      background: #142942;
    }

    .product-goals {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 10px;
    }

    .product-goal {
      padding: 5px 8px;
      border-radius: 999px;
      background: #edf8f2;
      color: #147b49;
      font-size: 10px;
      font-weight: 800;
    }

    .products-message {
      grid-column: 1 / -1;
      padding: 35px 20px;
      border: 1px dashed #ccd5df;
      border-radius: 18px;
      background: #fff;
      text-align: center;
      color: #687688;
    }

    .products-message strong {
      color: #182332;
      font-size: 18px;
    }

    /* AI + planner hoger */
    #coach {
      order: initial;
    }

    /* Planner */
    .planner-products {
      display: grid;
      gap: 9px;
      margin-top: 12px;
    }

    .planner-item {
      display: grid;
      grid-template-columns: 52px 1fr auto;
      align-items: center;
      gap: 10px;
      padding: 9px;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 12px;
      background: rgba(255,255,255,.045);
    }

    .planner-item img {
      width: 52px;
      height: 52px;
      object-fit: contain;
      border-radius: 9px;
      background: #fff;
    }

    .planner-item-name {
      color: #fff;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.3;
    }

    .planner-item-store {
      margin-top: 3px;
      color: #91a0b0;
      font-size: 11px;
    }

    .planner-item-price {
      color: #67e5a2;
      font-size: 14px;
      font-weight: 900;
      white-space: nowrap;
    }

    .planner-cart {
      margin-top: 14px;
      padding: 15px;
      border-radius: 14px;
      background: rgba(103,229,162,.08);
      border: 1px solid rgba(103,229,162,.18);
    }

    .planner-cart-title {
      color: #67e5a2;
      font-weight: 900;
    }

    .planner-cart-total {
      margin-top: 7px;
      color: #fff;
      font-size: 19px;
      font-weight: 950;
    }

    .planner-cart-list {
      display: grid;
      gap: 7px;
      margin-top: 10px;
    }

    .planner-cart-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: #c6d0db;
      font-size: 12px;
    }

    .planner-remove {
      padding: 4px 7px;
      border-radius: 7px;
      background: rgba(255,255,255,.08);
      color: #c6d0db;
      cursor: pointer;
    }

    .planner-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    .planner-action {
      padding: 9px 12px;
      border-radius: 9px;
      background: #67e5a2;
      color: #07140d;
      font-size: 12px;
      font-weight: 900;
      cursor: pointer;
    }

    .planner-action.secondary {
      background: rgba(255,255,255,.08);
      color: #fff;
    }

    @media (max-width: 650px) {
      .product-image-link,
      .product-card .product-image,
      .product-image-placeholder {
        height: 170px !important;
        max-height: 170px !important;
      }

      .product-card .product-image {
        padding: 10px !important;
      }

      .planner-item {
        grid-template-columns: 44px 1fr auto;
      }

      .planner-item img {
        width: 44px;
        height: 44px;
      }
    }
  `;

  document.head.appendChild(
    style
  );
}

/* =========================================================
   PRODUCT DOM
========================================================= */

function getGrid() {
  return document.querySelector(
    "#products-grid"
  );
}

function getCountElement() {
  return (
    document.querySelector(
      "#product-count"
    ) ||
    document.querySelector(
      "#result-count"
    )
  );
}

function updateCount() {
  const element =
    getCountElement();

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
   PRODUCTEN RENDEREN
========================================================= */

function renderProducts() {
  const grid =
    getGrid();

  if (!grid) {
    return;
  }

  if (
    state.loading &&
    state.products.length === 0
  ) {
    grid.innerHTML = `
      <div class="products-message">
        <strong>
          Producten laden...
        </strong>
      </div>
    `;

    return;
  }

  const visible =
    state.filtered.slice(
      0,
      state.visibleCount
    );

  if (visible.length === 0) {
    grid.innerHTML = `
      <div class="products-message">
        <strong>
          Geen producten gevonden.
        </strong>
        <br><br>
        Probeer een andere zoekterm,
        categorie of doel.
      </div>
    `;

    renderLoadMore();

    return;
  }

  grid.innerHTML =
    visible
      .map(productCard)
      .join("");

  renderLoadMore();
}

function renderLoadMore() {
  let button =
    document.querySelector(
      "#fitdeal-load-more"
    );

  if (!button) {
    button =
      document.createElement(
        "button"
      );

    button.id =
      "fitdeal-load-more";

    button.type =
      "button";

    button.className =
      "planner-action";

    button.style.display =
      "block";

    button.style.margin =
      "22px auto 0";

    const grid =
      getGrid();

    if (
      grid &&
      grid.parentElement
    ) {
      grid.parentElement.appendChild(
        button
      );
    }

    button.addEventListener(
      "click",
      () => {
        state.visibleCount +=
          PRODUCTS_PER_VIEW;

        renderProducts();
      }
    );
  }

  const remaining =
    state.filtered.length -
    Math.min(
      state.visibleCount,
      state.filtered.length
    );

  if (remaining > 0) {
    button.style.display =
      "block";

    button.textContent =
      `Toon meer producten (${remaining})`;
  } else {
    button.style.display =
      "none";
  }
}

/* =========================================================
   FILTERS TOEPASSEN
========================================================= */

function applyFilters() {
  let products =
    state.products.filter(
      productIsUsable
    );

  if (state.search) {
    products =
      products.filter(
        (product) =>
          matchesSearch(
            product,
            state.search
          )
      );
  }

  if (state.category) {
    products =
      products.filter(
        (product) =>
          matchesCategory(
            product,
            state.category
          )
      );
  }

  if (state.goal) {
    products =
      products.filter(
        (product) =>
          matchesGoal(
            product,
            state.goal
          )
      );
  }

  state.filtered =
    sortProducts(
      products
    );

  state.visibleCount =
    PRODUCTS_PER_VIEW;

  renderProducts();
  updateCount();
  updateFilterButtons();
}

/* =========================================================
   FILTER BUTTONS
========================================================= */

function updateFilterButtons() {
  document
    .querySelectorAll(
      "[data-goal]"
    )
    .forEach(
      (button) => {

        const value =
          normalizeText(
            button.dataset.goal
          );

        const active =
          value ===
          normalizeText(
            state.goal
          );

        button.classList.toggle(
          "active",
          active
        );
      }
    );

  document
    .querySelectorAll(
      "[data-category]"
    )
    .forEach(
      (button) => {

        const value =
          normalizeText(
            button.dataset.category
          );

        const active =
          value ===
          normalizeText(
            state.category
          );

        button.classList.toggle(
          "active",
          active
        );
      }
    );
}

/* =========================================================
   ZOEKEN BINDEN
========================================================= */

function bindSearch() {
  const inputs =
    document.querySelectorAll(
      "#search, #search-input, [data-product-search]"
    );

  inputs.forEach(
    (input) => {

      input.addEventListener(
        "input",
        () => {

          state.search =
            input.value.trim();

          applyFilters();
        }
      );
    }
  );

  const form =
    document.querySelector(
      "#search-form"
    );

  if (!form) {
    return;
  }

  form.addEventListener(
    "submit",
    (event) => {

      event.preventDefault();

      const input =
        form.querySelector(
          "input"
        );

      state.search =
        input
          ? input.value.trim()
          : "";

      applyFilters();

      scrollToDeals();
    }
  );
}

/* =========================================================
   DOELKNOPPEN
========================================================= */

function bindGoalButtons() {
  document
    .querySelectorAll(
      "[data-goal]"
    )
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          () => {

            const value =
              normalizeText(
                button.dataset.goal
              );

            /*
             * Nogmaals klikken = filter wissen.
             */
            if (
              normalizeText(
                state.goal
              ) === value
            ) {
              state.goal = "";
            } else {
              state.goal =
                value;
            }

            applyFilters();
            scrollToDeals();
          }
        );
      }
    );
}

/* =========================================================
   CATEGORIEËN
========================================================= */

function bindCategoryButtons() {
  document
    .querySelectorAll(
      "[data-category]"
    )
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          () => {

            const value =
              normalizeText(
                button.dataset.category
              );

            if (
              normalizeText(
                state.category
              ) === value
            ) {
              state.category =
                "";
            } else {
              state.category =
                value;
            }

            applyFilters();
            scrollToDeals();
          }
        );
      }
    );
}

/* =========================================================
   SCROLL
========================================================= */

function scrollToDeals() {
  const deals =
    document.querySelector(
      "#deals"
    );

  if (!deals) {
    return;
  }

  setTimeout(
    () => {
      deals.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    },
    50
  );
}

/* =========================================================
   API PRODUCTEN
========================================================= */

async function fetchProductsPage(
  offset
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
      `Product API HTTP ${response.status}`
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
      Boolean(
        data.has_more
      )
  };
}

/* =========================================================
   PRODUCTEN LADEN
========================================================= */

async function loadProducts() {
  if (state.loading) {
    return;
  }

  state.loading =
    true;

  renderProducts();

  try {

    const products = [];
    const seen = new Set();

    let offset = 0;
    let total = 0;
    let hasMore = true;

    while (
      hasMore &&
      products.length <
        MAX_PRODUCTS
    ) {

      const page =
        await fetchProductsPage(
          offset
        );

      total =
        page.total;

      for (
        const product
        of page.products
      ) {

        if (
          !productIsUsable(
            product
          )
        ) {
          continue;
        }

        const key =
          String(
            product.id
          );

        if (
          seen.has(key)
        ) {
          continue;
        }

        seen.add(key);
        products.push(
          product
        );
      }

      if (
        page.products.length === 0
      ) {
        hasMore = false;
        break;
      }

      offset +=
        page.products.length;

      hasMore =
        page.hasMore;

      if (
        total > 0 &&
        products.length >=
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
      products.slice(
        0,
        MAX_PRODUCTS
      );

    state.loading =
      false;

    applyFilters();

  } catch (error) {

    console.error(
      "FitDealFinder product error:",
      error
    );

    state.loading =
      false;

    const grid =
      getGrid();

    if (grid) {
      grid.innerHTML = `
        <div class="products-message">
          <strong>
            Producten konden niet worden geladen.
          </strong>
          <br><br>
          Vernieuw de pagina en probeer opnieuw.
        </div>
      `;
    }
  }
}

/* =========================================================
   AI COACH
========================================================= */

async function askAi(
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
      `AI HTTP ${response.status}`
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
      "#ai-output"
    ) ||
    document.querySelector(
      "#ai-response"
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
        output.textContent =
          "Typ eerst je vraag.";
        return;
      }

      output.textContent =
        "De AI Coach denkt mee...";

      try {

        const data =
          await askAi(
            message
          );

        const answer =
          data?.answer ||
          data?.message ||
          data?.response ||
          data?.text;

        output.textContent =
          answer ||
          "Er kwam geen antwoord terug.";

      } catch (error) {

        console.error(
          "AI Coach error:",
          error
        );

        output.textContent =
          "De AI Coach is tijdelijk niet beschikbaar.";

      }
    }
  );
}

/* =========================================================
   BOODSCHAPPENMAND
========================================================= */

function loadCart() {
  try {
    const saved =
      localStorage.getItem(
        CART_KEY
      );

    const parsed =
      saved
        ? JSON.parse(saved)
        : [];

    return Array.isArray(
      parsed
    )
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
      JSON.stringify(
        state.cart
      )
    );
  } catch {
    /*
     * LocalStorage kan geblokkeerd zijn.
     * De planner blijft dan gewoon werken
     * tijdens de huidige sessie.
     */
  }
}

function cartProducts() {
  return state.cart
    .map(
      (id) =>
        state.products.find(
          (product) =>
            String(
              product.id
            ) ===
            String(id)
        )
    )
    .filter(Boolean);
}

function addToCart(id) {
  const key =
    String(id);

  if (
    state.cart.some(
      (item) =>
        String(item) === key
    )
  ) {
    return;
  }

  state.cart.push(
    key
  );

  saveCart();
  renderPlannerCart();
}

function removeFromCart(id) {
  const key =
    String(id);

  state.cart =
    state.cart.filter(
      (item) =>
        String(item) !== key
    );

  saveCart();
  renderPlannerCart();
}

function clearCart() {
  state.cart = [];

  saveCart();
  renderPlannerCart();
}

function cartTotal() {
  return cartProducts()
    .reduce(
      (total, product) =>
        total +
        (
          Number(
            product.price
          ) || 0
        ),
      0
    );
}

/* =========================================================
   PLANNER RESULTAAT
========================================================= */

function plannerProductHtml(
  product
) {
  const id =
    escapeHtml(
      product.id
    );

  const name =
    escapeHtml(
      product.name
    );

  const merchant =
    escapeHtml(
      product.merchant_name || ""
    );

  const image =
    escapeHtml(
      product.image_url || ""
    );

  const price =
    formatPrice(
      product.price,
      product.currency || "EUR"
    );

  return `
    <div class="planner-item">

      ${
        image
          ? `
            <img
              src="${image}"
              alt=""
              loading="lazy"
            >
          `
          : `
            <div
              style="
                width:52px;
                height:52px;
                display:grid;
                place-items:center;
                border-radius:9px;
                background:#fff;
                color:#172333;
                font-weight:900;
              "
            >
              FIT
            </div>
          `
      }

      <div>
        <div class="planner-item-name">
          ${name}
        </div>

        <div class="planner-item-store">
          ${merchant}
        </div>
      </div>

      <div>
        <div class="planner-item-price">
          ${price}
        </div>

        <button
          type="button"
          class="planner-action"
          data-add-cart="${id}"
          style="
            margin-top:5px;
            padding:6px 8px;
            font-size:10px;
          "
        >
          + Mandje
        </button>
      </div>

    </div>
  `;
}

function renderPlannerCart() {
  const result =
    document.querySelector(
      "#planner-result"
    );

  if (!result) {
    return;
  }

  const products =
    cartProducts();

  if (
    products.length === 0
  ) {
    result.innerHTML = `
      Kies een doel en budget.
      Daarna kun je producten rechtstreeks
      aan je boodschappenmand toevoegen.
    `;

    return;
  }

  const rows =
    products
      .map(
        (product) => `
          <div class="planner-cart-row">

            <span>
              ${escapeHtml(
                product.name
              )}
            </span>

            <span>
              ${formatPrice(
                product.price,
                product.currency || "EUR"
              )}

              <button
                type="button"
                class="planner-remove"
                data-remove-cart="${escapeHtml(product.id)}"
              >
                ×
              </button>
            </span>

          </div>
        `
      )
      .join("");

  result.innerHTML = `
    <div class="planner-cart">

      <div class="planner-cart-title">
        🛒 Jouw boodschappenmand
      </div>

      <div class="planner-cart-total">
        Totaal: ${formatPrice(
          cartTotal()
        )}
      </div>

      <div class="planner-cart-list">
        ${rows}
      </div>

      <div class="planner-actions">

        <button
          type="button"
          class="planner-action secondary"
          data-clear-cart
        >
          Mandje leegmaken
        </button>

        <button
          type="button"
          class="planner-action"
          data-view-cart
        >
          Bekijk producten
        </button>

      </div>

    </div>
  `;

  result
    .querySelectorAll(
      "[data-remove-cart]"
    )
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          () => {

            removeFromCart(
              button.dataset.removeCart
            );
          }
        );
      }
    );

  const clearButton =
    result.querySelector(
      "[data-clear-cart]"
    );

  if (clearButton) {
    clearButton.addEventListener(
      "click",
      clearCart
    );
  }

  const viewButton =
    result.querySelector(
      "[data-view-cart]"
    );

  if (viewButton) {
    viewButton.addEventListener(
      "click",
      () => {

        scrollToDeals();
      }
    );
  }
}

/* =========================================================
   PLANNER
========================================================= */

function bindPlanner() {
  const form =
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

      const budgetValue =
        form.querySelector(
          "[name='budget']"
        )?.value || "";

      const budget =
        Number(
          budgetValue
        );

      let candidates =
        state.products.filter(
          productIsUsable
        );

      if (goal) {
        candidates =
          candidates.filter(
            (product) =>
              matchesGoal(
                product,
                goal
              )
          );
      }

      if (
        Number.isFinite(
          budget
        ) &&
        budget > 0
      ) {
        candidates =
          candidates.filter(
            (product) =>
              Number(
                product.price
              ) <= budget
          );
      }

      candidates =
        sortProducts(
          candidates
        ).slice(
          0,
          8
        );

      const result =
        document.querySelector(
          "#planner-result"
        );

      if (!result) {
        return;
      }

      if (
        candidates.length === 0
      ) {

        result.innerHTML = `
          Geen geschikte producten gevonden
          voor deze combinatie van doel en budget.
          Probeer een ruimer budget.
        `;

        return;
      }

      const html =
        candidates
          .map(
            plannerProductHtml
          )
          .join("");

      result.innerHTML = `
        <div>
          <strong style="color:#fff">
            ${candidates.length}
            passende producten
          </strong>
        </div>

        <div class="planner-products">
          ${html}
        </div>

        <div
          class="planner-cart"
          style="margin-top:15px"
        >
          <div class="planner-cart-title">
            🛒 Boodschappenmand
          </div>

          <div style="
            margin-top:6px;
            color:#aebaca;
            font-size:12px;
          ">
            Tik op <strong>+ Mandje</strong>
            bij de producten die je wilt meenemen.
          </div>
        </div>
      `;

      result
        .querySelectorAll(
          "[data-add-cart]"
        )
        .forEach(
          (button) => {

            button.addEventListener(
              "click",
              () => {

                addToCart(
                  button.dataset.addCart
                );

                button.textContent =
                  "✓ In mandje";

                button.disabled =
                  true;

                button.style.opacity =
                  "0.7";

                /*
                 * Mandje opnieuw zichtbaar
                 * onder de planner.
                 */
                setTimeout(
                  renderPlannerCart,
                  0
                );
              }
            );
          }
        );

      renderPlannerCart();
    }
  );

  renderPlannerCart();
}

/* =========================================================
   AI + PLANNER NAAR BOVEN
========================================================= */

function moveToolsBeforeDeals() {
  const coach =
    document.querySelector(
      "#coach"
    );

  const deals =
    document.querySelector(
      "#deals"
    );

  if (
    !coach ||
    !deals ||
    !deals.parentElement
  ) {
    return;
  }

  /*
   * De volledige AI/Planner sectie komt
   * direct vóór de deals.
   */
  deals.parentElement.insertBefore(
    coach,
    deals
  );
}

/* =========================================================
   NAVIGATIE
========================================================= */

function bindNavigation() {
  document
    .querySelectorAll(
      "a[href^='#']"
    )
    .forEach(
      (link) => {

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
      }
    );
}

/* =========================================================
   FILTER URL
========================================================= */

function readUrlFilters() {
  try {

    const params =
      new URLSearchParams(
        window.location.search
      );

    const search =
      params.get(
        "search"
      );

    const goal =
      params.get(
        "goal"
      );

    const category =
      params.get(
        "category"
      );

    if (search) {
      state.search =
        search;
    }

    if (goal) {
      state.goal =
        normalizeText(
          goal
        );
    }

    if (category) {
      state.category =
        normalizeText(
          category
        );
    }

  } catch {
    /*
     * URL-filters zijn optioneel.
     */
  }
}

function writeUrlFilters() {
  try {

    const url =
      new URL(
        window.location.href
      );

    if (state.search) {
      url.searchParams.set(
        "search",
        state.search
      );
    } else {
      url.searchParams.delete(
        "search"
      );
    }

    if (state.goal) {
      url.searchParams.set(
        "goal",
        state.goal
      );
    } else {
      url.searchParams.delete(
        "goal"
      );
    }

    if (state.category) {
      url.searchParams.set(
        "category",
        state.category
      );
    } else {
      url.searchParams.delete(
        "category"
      );
    }

    window.history.replaceState(
      {},
      "",
      url
    );

  } catch {
    /*
     * Niet essentieel.
     */
  }
}

/* =========================================================
   FILTER OVERRIDE
========================================================= */

const originalApplyFilters =
  applyFilters;

function applyFiltersWithUrl() {
  originalApplyFilters();
  writeUrlFilters();
}

/* =========================================================
   EVENT DELEGATION
========================================================= */

function bindGlobalEvents() {

  document.addEventListener(
    "click",
    (event) => {

      const target =
        event.target;

      if (
        !(target instanceof
          HTMLElement)
      ) {
        return;
      }

      const clear =
        target.closest(
          "[data-clear-filters]"
        );

      if (clear) {

        event.preventDefault();

        state.search = "";
        state.goal = "";
        state.category = "";

        document
          .querySelectorAll(
            "#search, #search-input"
          )
          .forEach(
            (input) => {
              input.value = "";
            }
          );

        originalApplyFilters();
        writeUrlFilters();

        return;
      }
    }
  );
}

/* =========================================================
   SEARCH SYNCHRONISEREN
========================================================= */

function syncSearchInput() {
  document
    .querySelectorAll(
      "#search, #search-input"
    )
    .forEach(
      (input) => {
        input.value =
          state.search;
      }
    );
}

/* =========================================================
   START
========================================================= */

async function init() {

  injectAppStyles();

  moveToolsBeforeDeals();

  readUrlFilters();

  syncSearchInput();

  bindSearch();
  bindGoalButtons();
  bindCategoryButtons();
  bindAiCoach();
  bindPlanner();
  bindNavigation();
  bindGlobalEvents();

  updateFilterButtons();

  /*
   * Producten laden.
   */
  await loadProducts();

  /*
   * URL-filters opnieuw toepassen
   * nadat de producten binnen zijn.
   */
  originalApplyFilters();

  writeUrlFilters();

  updateFilterButtons();
  syncSearchInput();
}

/* =========================================================
   START NA DOM
========================================================= */

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
