"use strict";

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
    product?.description,
    product?.goals
  ].join(" "));
}

/* =========================================================
   PRODUCT FILTERS
   ========================================================= */

const EXCLUDED_TERMS = [
  "voedingsschema",
  "voedingsschema's",
  "voedingsplan",
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
  "gymtas",
  "sporttas",
  "shirt",
  "t-shirt",
  "hoodie",
  "sweater",
  "legging",
  "sokken",
  "pet",
  "cap",
  "merchandise",
  "handdoek",
  "handdoekje"
];

const CUT_TERMS = [
  "fat burner",
  "fatburner",
  "thermogenic",
  "thermogenics",
  "cutting",
  "shred",
  "shredd",
  "weight loss",
  "gewichtsverlies",
  "afvallen",
  "l-carnitine",
  "carnitine",
  "appetite",
  "metabolism",
  "metabolisme"
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
  "calorie surplus",
  "muscle mass"
];

const PROTEIN_TERMS = [
  "protein",
  "proteine",
  "proteïne",
  "whey",
  "casein",
  "caseïne",
  "isolate",
  "isolaat",
  "hydrolyzed",
  "hydrolysate"
];

const CREATINE_TERMS = [
  "creatine",
  "creatine monohydrate",
  "creapure"
];

const PRE_WORKOUT_TERMS = [
  "pre workout",
  "pre-workout",
  "preworkout",
  "pump",
  "citrulline",
  "beta alanine",
  "beta-alanine",
  "caffeine",
  "cafeine",
  "nitric oxide"
];

const MUSCLE_TERMS = [
  "muscle",
  "spier",
  "spiermassa",
  "spiergroei",
  "hypertrophy",
  "hypertrofie",
  "strength",
  "kracht",
  "performance",
  "prestaties"
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

/* =========================================================
   DOELEN
   ========================================================= */

function isCutProduct(product) {
  return containsTerm(
    productText(product),
    CUT_TERMS
  );
}

function isBulkProduct(product) {
  return containsTerm(
    productText(product),
    BULK_TERMS
  );
}

function isProteinProduct(product) {
  return containsTerm(
    productText(product),
    PROTEIN_TERMS
  );
}

function isCreatineProduct(product) {
  return containsTerm(
    productText(product),
    CREATINE_TERMS
  );
}

function isPreWorkoutProduct(product) {
  return containsTerm(
    productText(product),
    PRE_WORKOUT_TERMS
  );
}

function isMuscleProduct(product) {
  return containsTerm(
    productText(product),
    MUSCLE_TERMS
  );
}

function matchesGoal(product, goal) {
  const selected = normalize(goal);

  if (!selected) {
    return true;
  }

  const text = productText(product);

  const cut = isCutProduct(product);
  const bulk = isBulkProduct(product);
  const protein = isProteinProduct(product);
  const creatine = isCreatineProduct(product);
  const preWorkout = isPreWorkoutProduct(product);
  const muscle = isMuscleProduct(product);

  /* -------------------------
     CUT
     ------------------------- */

  if (selected === "cut") {
    if (bulk) {
      return false;
    }

    return (
      cut ||
      protein ||
      creatine ||
      preWorkout ||
      muscle ||
      containsTerm(text, [
        "electrolyte",
        "electrolyten",
        "vitamine",
        "vitamin",
        "amino",
        "bcaa",
        "eaa"
      ])
    );
  }

  /* -------------------------
     BULK
     ------------------------- */

  if (selected === "bulk") {
    return (
      bulk ||
      protein ||
      creatine ||
      preWorkout ||
      muscle ||
      containsTerm(text, [
        "amino",
        "bcaa",
        "eaa",
        "carbo",
        "carbs",
        "dextrose",
        "maltodextrine"
      ])
    );
  }

  /* -------------------------
     LEAN BULK
     ------------------------- */

  if (
    selected === "lean-bulk" ||
    selected === "lean bulk" ||
    selected === "leanbulk"
  ) {
    /*
     * Een gewone whey of creatine hoeft
     * niet letterlijk "lean bulk" in de
     * productnaam te hebben.
     */

    if (bulk) {
      return false;
    }

    return (
      protein ||
      creatine ||
      preWorkout ||
      muscle ||
      containsTerm(text, [
        "lean bulk",
        "lean-bulk",
        "leanbulking",
        "amino",
        "bcaa",
        "eaa",
        "electrolyte",
        "vitamin",
        "vitamine"
      ])
    );
  }

  return true;
}

/* =========================================================
   CATEGORIEËN
   ========================================================= */

function matchesCategory(product, category) {
  const selected = normalize(category);

  if (!selected) {
    return true;
  }

  const text = productText(product);

  if (selected === "proteine") {
    return isProteinProduct(product);
  }

  if (selected === "creatine") {
    return isCreatineProduct(product);
  }

  if (
    selected === "pre-workout" ||
    selected === "pre workout" ||
    selected === "preworkout"
  ) {
    return isPreWorkoutProduct(product);
  }

  if (
    selected === "supplementen" ||
    selected === "supplement"
  ) {
    return (
      isProteinProduct(product) ||
      isCreatineProduct(product) ||
      isPreWorkoutProduct(product) ||
      containsTerm(text, [
        "supplement",
        "supplementen",
        "vitamin",
        "vitamine",
        "omega",
        "magnesium",
        "zinc",
        "zink",
        "amino",
        "bcaa",
        "eaa",
        "collagen",
        "collageen",
        "electrolyte",
        "electrolyten",
        "glutamine",
        "citrulline",
        "caffeine",
        "cafeine"
      ])
    );
  }

  return text.includes(selected);
}

/* =========================================================
   ZOEKEN
   ========================================================= */

function matchesSearch(product, search) {
  const query = normalize(search);

  if (!query) {
    return true;
  }

  return productText(product).includes(query);
}

/* =========================================================
   PRODUCT API
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

  if (Array.isArray(json)) {
    return json;
  }

  if (Array.isArray(json?.data)) {
    return json.data;
  }

  if (Array.isArray(json?.products)) {
    return json.products;
  }

  if (Array.isArray(json?.data?.products)) {
    return json.data.products;
  }

  return [];
}

async function loadAllProducts() {
  if (state.loading) {
    return;
  }

  state.loading = true;
  setProductLoading(true);

  try {
    const all = [];
    const seen = new Set();

    let offset = 0;

    while (all.length < MAX_PRODUCTS) {
      const page =
        await fetchProductsPage(offset);

      if (!page.length) {
        break;
      }

      for (const product of page) {
        const id = getProductId(product);

        if (!id || seen.has(id)) {
          continue;
        }

        seen.add(id);
        all.push(product);

        if (all.length >= MAX_PRODUCTS) {
          break;
        }
      }

      if (page.length < PAGE_SIZE) {
        break;
      }

      offset += page.length;
    }

    state.products =
      all.filter(productIsUsable);

    applyFilters();

  } catch (error) {
    console.error(
      "Producten laden mislukt:",
      error
    );

    showProductError(
      "De producten konden momenteel niet worden geladen. Probeer opnieuw."
    );

  } finally {
    state.loading = false;
    setProductLoading(false);
  }
}

/* =========================================================
   FILTERS TOEPASSEN
   ========================================================= */

function applyFilters() {
  state.visibleCount =
    PRODUCTS_PER_VIEW;

  state.filtered =
    state.products.filter(product => {
      return (
        matchesSearch(
          product,
          state.search
        ) &&
        matchesCategory(
          product,
          state.category
        ) &&
        matchesGoal(
          product,
          state.goal
        )
      );
    });

  renderProducts();
}

/* =========================================================
   PRODUCTKAARTEN
   ========================================================= */

function getDiscount(product) {
  const direct =
    Number(product?.discount_percent);

  if (
    Number.isFinite(direct) &&
    direct > 0
  ) {
    return Math.round(direct);
  }

  const price =
    Number(product?.price);

  const oldPrice =
    Number(product?.old_price);

  if (
    Number.isFinite(price) &&
    Number.isFinite(oldPrice) &&
    oldPrice > price &&
    oldPrice > 0
  ) {
    return Math.round(
      ((oldPrice - price) / oldPrice) *
      100
    );
  }

  return 0;
}

function productImage(product) {
  const url =
    String(
      product?.image_url ?? ""
    ).trim();

  if (!url) {
    return `
      <div class="product-image-placeholder">
        🏋️
      </div>
    `;
  }

  return `
    <img
      class="product-image"
      src="${escapeHtml(url)}"
      alt="${escapeHtml(
        product?.name ||
        "Supplement"
      )}"
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

  if (
    matchesGoal(
      product,
      "lean-bulk"
    )
  ) {
    goals.push("Lean Bulk");
  }

  return goals;
}

function renderProductCard(product) {
  const id =
    getProductId(product);

  const name =
    product?.name ||
    "Supplement";

  const brand =
    product?.brand || "";

  const merchant =
    product?.merchant_name ||
    "Winkel";

  const price =
    Number(product?.price);

  const oldPrice =
    Number(product?.old_price);

  const discount =
    getDiscount(product);

  const inStock =
    product?.in_stock === undefined ||
    Number(product?.in_stock) === 1 ||
    product?.in_stock === true;

  const goals =
    productGoals(product);

  const inCart =
    state.cart.some(
      item =>
        String(item.id) ===
        String(id)
    );

  return `
    <article
      class="product-card"
      data-product-id="${escapeHtml(id)}"
    >

      <div class="product-media">

        ${productImage(product)}

        ${
          discount > 0
            ? `
              <span class="discount-badge">
                -${discount}%
              </span>
            `
            : ""
        }

      </div>

      <div class="product-content">

        ${
          brand
            ? `
              <div class="product-brand">
                ${escapeHtml(brand)}
              </div>
            `
            : ""
        }

        <h3 class="product-title">
          ${escapeHtml(name)}
        </h3>

        <div class="product-store">
          ${escapeHtml(merchant)}
        </div>

        <div class="product-price-row">

          <strong class="product-price">
            ${formatPrice(
              price,
              product?.currency
            )}
          </strong>

          ${
            Number.isFinite(oldPrice) &&
            oldPrice > price
              ? `
                <span class="product-old-price">
                  ${formatPrice(
                    oldPrice,
                    product?.currency
                  )}
                </span>
              `
              : ""
          }

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
                  <span>
                    ${escapeHtml(goal)}
                  </span>
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
            class="button button-secondary"
            data-add-cart="${escapeHtml(id)}"
          >
            ${
              inCart
                ? "In winkelmand ✓"
                : "Winkelmand"
            }
          </button>

        </div>

      </div>

    </article>
  `;
}

function renderProducts() {
  const grid =
    $("#products-grid");

  const count =
    $("#result-count");

  if (!grid) {
    return;
  }

  if (count) {
    count.textContent =
      String(
        state.filtered.length
      );
  }

  if (!state.filtered.length) {
    grid.innerHTML = `
      <div class="empty-state">

        <h3>
          Geen producten gevonden
        </h3>

        <p>
          Probeer een andere
          zoekterm, categorie
          of doel.
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

    removeLoadMoreButton();
    renderCart();

    return;
  }

  const visible =
    state.filtered.slice(
      0,
      state.visibleCount
    );

  grid.innerHTML =
    visible
      .map(renderProductCard)
      .join("");

  updateLoadMoreButton();
  renderCart();
}

function showProductError(message) {
  const grid =
    $("#products-grid");

  if (!grid) {
    return;
  }

  grid.innerHTML = `
    <div class="empty-state">

      <h3>
        Producten tijdelijk niet beschikbaar
      </h3>

      <p>
        ${escapeHtml(message)}
      </p>

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
  const grid =
    $("#products-grid");

  if (!grid || !loading) {
    return;
  }

  grid.innerHTML = `
    <div class="loading-state">

      <div class="loading-spinner"></div>

      <p>
        Producten laden...
      </p>

    </div>
  `;
}

/* =========================================================
   MEER PRODUCTEN
   ========================================================= */

function removeLoadMoreButton() {
  const button =
    $("#load-more");

  if (button) {
    button.remove();
  }
}

function updateLoadMoreButton() {
  removeLoadMoreButton();

  if (
    state.visibleCount >=
      state.filtered.length ||
    !state.filtered.length
  ) {
    return;
  }

  const grid =
    $("#products-grid");

  if (
    !grid ||
    !grid.parentElement
  ) {
    return;
  }

  const button =
    document.createElement("button");

  button.id = "load-more";
  button.type = "button";
  button.className =
    "button button-secondary";

  button.textContent =
    "Meer producten laden";

  button.addEventListener(
    "click",
    () => {
      state.visibleCount +=
        PRODUCTS_PER_VIEW;

      renderProducts();
    }
  );

  grid.parentElement.appendChild(
    button
  );
}

/* =========================================================
   ZOEKMACHINE
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
        input.value.trim();

      applyFilters();

      const deals =
        $("#deals");

      if (deals) {
        deals.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    }
  );

  input.addEventListener(
    "input",
    () => {
      state.search =
        input.value.trim();

      applyFilters();
    }
  );
}

/* =========================================================
   DOELKNOPPEN
   ========================================================= */

function setupGoals() {
  $$("[data-goal]")
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const goal =
            normalize(
              button.dataset.goal ||
              ""
            );

          state.goal =
            state.goal === goal
              ? ""
              : goal;

          state.category = "";

          $$("[data-goal]")
            .forEach(item => {
              const active =
                normalize(
                  item.dataset.goal ||
                  ""
                ) === state.goal;

              item.classList.toggle(
                "active",
                active
              );

              item.classList.toggle(
                "selected",
                active
              );
            });

          $$("[data-category]")
            .forEach(item => {
              item.classList.remove(
                "active",
                "selected"
              );
            });

          applyFilters();

          const deals =
            $("#deals");

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
   CATEGORIEKNOPPEN
   ========================================================= */

function setupCategories() {
  $$("[data-category]")
    .forEach(element => {
      element.addEventListener(
        "click",
        () => {
          const category =
            normalize(
              element.dataset.category ||
              ""
            );

          state.category =
            state.category === category
              ? ""
              : category;

          state.goal = "";

          $$("[data-category]")
            .forEach(item => {
              const active =
                normalize(
                  item.dataset.category ||
                  ""
                ) === state.category;

              item.classList.toggle(
                "active",
                active
              );

              item.classList.toggle(
                "selected",
                active
              );
            });

          $$("[data-goal]")
            .forEach(item => {
              item.classList.remove(
                "active",
                "selected"
              );
            });

          applyFilters();

          const deals =
            $("#deals");

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
   FILTERS WISSEN
   ========================================================= */

function resetFilters() {
  state.search = "";
  state.goal = "";
  state.category = "";
  state.visibleCount =
    PRODUCTS_PER_VIEW;

  const input =
    $("#search-input");

  if (input) {
    input.value = "";
  }

  $$(
    "[data-goal], [data-category]"
  ).forEach(element => {
    element.classList.remove(
      "active",
      "selected"
    );
  });

  applyFilters();
}

/* =========================================================
   WINKELMANDJE
   ========================================================= */

function loadCart() {
  try {
    const raw =
      localStorage.getItem(
        CART_KEY
      );

    if (!raw) {
      return [];
    }

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
      "Winkelmand opslaan mislukt:",
      error
    );
  }
}

function getCartElement() {
  let cart =
    $("#fitdeal-cart");

  if (cart) {
    return cart;
  }

  const planner =
    $("#shopping-planner");

  const deals =
    $("#deals");

  cart =
    document.createElement("section");

  cart.id = "fitdeal-cart";
  cart.className =
    "cart-panel";

  cart.innerHTML = `
    <div class="cart-header">

      <h2>
        Winkelmandje
      </h2>

      <span id="cart-count">
        0
      </span>

    </div>

    <div id="cart-items"></div>

    <div class="cart-total">

      <span>
        Totaal
      </span>

      <strong id="cart-total-price">
        € 0,00
      </strong>

    </div>

    <button
      type="button"
      class="button button-secondary"
      id="clear-cart"
    >
      Winkelmand leegmaken
    </button>
  `;

  if (
    planner &&
    planner.parentElement
  ) {
    planner.parentElement.appendChild(
      cart
    );
  } else if (
    deals &&
    deals.parentElement
  ) {
    deals.parentElement.appendChild(
      cart
    );
  } else {
    document.body.appendChild(
      cart
    );
  }

  return cart;
}

function addToCart(productId) {
  const id =
    String(productId);

  const product =
    state.products.find(
      item =>
        getProductId(item) === id
    );

  if (!product) {
    return;
  }

  const existing =
    state.cart.find(
      item =>
        String(item.id) === id
    );

  if (existing) {
    existing.quantity =
      Number(
        existing.quantity || 1
      ) + 1;
  } else {
    state.cart.push({
      id,
      name:
        product.name ||
        "Supplement",
      merchant_name:
        product.merchant_name ||
        "Winkel",
      price:
        Number(product.price) ||
        0,
      currency:
        product.currency ||
        "EUR",
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
  const id =
    String(productId);

  state.cart =
    state.cart.filter(
      item =>
        String(item.id) !== id
    );

  saveCart();
  renderCart();
  renderProducts();
}

function changeCartQuantity(
  productId,
  change
) {
  const id =
    String(productId);

  const item =
    state.cart.find(
      cartItem =>
        String(cartItem.id) === id
    );

  if (!item) {
    return;
  }

  item.quantity =
    Number(
      item.quantity || 1
    ) + Number(change);

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
  const cart =
    getCartElement();

  if (!cart) {
    return;
  }

  const items =
    $("#cart-items", cart);

  const count =
    $("#cart-count", cart);

  const total =
    $("#cart-total-price", cart);

  if (!items) {
    return;
  }

  const totalItems =
    state.cart.reduce(
      (sum, item) =>
        sum +
        Number(
          item.quantity || 1
        ),
      0
    );

  const totalPrice =
    state.cart.reduce(
      (sum, item) =>
        sum +
        (
          Number(item.price) ||
          0
        ) *
        Number(
          item.quantity || 1
        ),
      0
    );

  if (count) {
    count.textContent =
      String(totalItems);
  }

  if (total) {
    total.textContent =
      formatPrice(totalPrice);
  }

  if (!state.cart.length) {
    items.innerHTML = `
      <div class="cart-empty">

        <p>
          Je winkelmandje is nog leeg.
        </p>

        <p>
          Voeg producten toe om
          hier je selectie te zien.
        </p>

      </div>
    `;

    return;
  }

  items.innerHTML =
    state.cart.map(item => `
      <div class="cart-item">

        <div class="cart-item-info">

          <strong>
            ${escapeHtml(
              item.name
            )}
          </strong>

          <small>
            ${escapeHtml(
              item.merchant_name
            )}
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
            data-cart-minus="${escapeHtml(
              item.id
            )}"
          >
            −
          </button>

          <span>
            ${Number(
              item.quantity || 1
            )}
          </span>

          <button
            type="button"
            data-cart-plus="${escapeHtml(
              item.id
            )}"
          >
            +
          </button>

          <button
            type="button"
            data-cart-remove="${escapeHtml(
              item.id
            )}"
          >
            ×
          </button>

        </div>

      </div>
    `).join("");
}

/* =========================================================
   PERSOONLIJK DOEL / SHOPPING PLANNER
   ========================================================= */

function plannerScore(product, goal) {
  const selected =
    normalize(goal);

  let score = 0;

  if (
    selected === "cut" &&
    isCutProduct(product)
  ) {
    score += 20;
  }

  if (
    selected === "bulk" &&
    isBulkProduct(product)
  ) {
    score += 20;
  }

  if (
    selected === "lean-bulk" &&
    !isBulkProduct(product)
  ) {
    score += 15;
  }

  if (isProteinProduct(product)) {
    score += 10;
  }

  if (isCreatineProduct(product)) {
    score += 8;
  }

  if (isPreWorkoutProduct(product)) {
    score += 5;
  }

  if (isMuscleProduct(product)) {
    score += 5;
  }

  score +=
    Math.min(
      getDiscount(product),
      20
    );

  if (
    Number(product?.in_stock) === 1
  ) {
    score += 3;
  }

  return score;
}

function getPlannerProducts(
  goal,
  budget
) {
  const selectedGoal =
    normalize(goal);

  const maxBudget =
    Number(budget);

  if (
    !selectedGoal ||
    !Number.isFinite(maxBudget) ||
    maxBudget <= 0
  ) {
    return [];
  }

  const candidates =
    state.products
      .filter(product => {
        const price =
          Number(product?.price);

        return (
          productIsUsable(product) &&
          matchesGoal(
            product,
            selectedGoal
          ) &&
          Number.isFinite(price) &&
          price > 0 &&
          price <= maxBudget
        );
      })
      .map(product => ({
        product,
        score:
          plannerScore(
            product,
            selectedGoal
          )
      }))
      .sort(
        (a, b) =>
          b.score - a.score
      );

  /*
   * Maak een selectie die echt binnen
   * het opgegeven budget blijft.
   */
  const selected = [];
  let total = 0;

  for (const candidate of candidates) {
    const price =
      Number(
        candidate.product.price
      );

    if (
      total + price <=
      maxBudget
    ) {
      selected.push(
        candidate.product
      );

      total += price;
    }

    if (selected.length >= 5) {
      break;
    }
  }

  return selected;
}

function renderPlannerResults(
  products,
  goal,
  budget
) {
  const result =
    $("#planner-result");

  if (!result) {
    return;
  }

  if (!products.length) {
    result.innerHTML = `
      <div class="empty-state">

        <h3>
          Geen passend doelplan gevonden
        </h3>

        <p>
          We vonden momenteel geen
          passende producten binnen
          ${formatPrice(budget)}
          voor
          ${escapeHtml(goal)}.
        </p>

        <p>
          Probeer een iets hoger budget.
        </p>

      </div>
    `;

    return;
  }

  const total =
    products.reduce(
      (sum, product) =>
        sum +
        (
          Number(product.price) ||
          0
        ),
      0
    );

  result.innerHTML = `
    <div class="planner-result-header">

      <h3>
        Jouw
        ${escapeHtml(goal)}
        selectie
      </h3>

      <p>
        ${products.length}
        producten · totaal
        ${formatPrice(total)}
        van
        ${formatPrice(budget)}
        budget
      </p>

    </div>

    <div class="planner-products">

      ${products.map(product => `
        <div class="planner-product">

          <div>

            <strong>
              ${escapeHtml(
                product.name
              )}
            </strong>

            <small>
              ${escapeHtml(
                product.merchant_name ||
                "Winkel"
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
  const container =
    $("#shopping-planner");

  if (!container) {
    return;
  }

  const form =
    $("#planner-form", container) ||
    $("form", container);

  const goalField =
    $("#planner-goal") ||
    $('[name="goal"]', container);

  const budgetField =
    $("#planner-budget") ||
    $('[name="budget"]', container);

  if (!form) {
    return;
  }

  form.addEventListener(
    "submit",
    event => {
      event.preventDefault();

      const goal =
        goalField?.value || "";

      const budget =
        Number(
          budgetField?.value || 0
        );

      const result =
        $("#planner-result");

      if (
        !goal ||
        !Number.isFinite(budget) ||
        budget <= 0
      ) {
        if (result) {
          result.innerHTML = `
            <div class="empty-state">

              <h3>
                Vul je doel en budget in
              </h3>

              <p>
                Kies bijvoorbeeld
                Cut en €70.
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
    }
  );
}

/* =========================================================
   AI COACH
   ========================================================= */

function setupAI() {
  const form =
    $("#ai-form");

  const input =
    $("#ai-input");

  const output =
    $("#ai-response");

  if (
    !form ||
    !input ||
    !output
  ) {
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
        <div class="ai-loading">
          Even nadenken...
        </div>
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
            De AI Coach is momenteel
            niet beschikbaar.
            Probeer het later opnieuw.
          </div>
        `;
      }
    }
  );
}

/* =========================================================
   KLIK-EVENTS
   ========================================================= */

function setupGlobalEvents() {
  document.addEventListener(
    "click",
    event => {
      const target =
        event.target;

      if (
        !(target instanceof Element)
      ) {
        return;
      }

      const addCart =
        target.closest(
          "[data-add-cart]"
        );

      if (addCart) {
        event.preventDefault();

        addToCart(
          addCart.dataset.addCart
        );

        return;
      }

      const addPlanner =
        target.closest(
          "[data-add-planner]"
        );

      if (addPlanner) {
        event.preventDefault();

        addToCart(
          addPlanner.dataset
            .addPlanner
        );

        return;
      }

      const minus =
        target.closest(
          "[data-cart-minus]"
        );

      if (minus) {
        changeCartQuantity(
          minus.dataset.cartMinus,
          -1
        );

        return;
      }

      const plus =
        target.closest(
          "[data-cart-plus]"
        );

      if (plus) {
        changeCartQuantity(
          plus.dataset.cartPlus,
          1
        );

        return;
      }

      const remove =
        target.closest(
          "[data-cart-remove]"
        );

      if (remove) {
        removeFromCart(
          remove.dataset.cartRemove
        );

        return;
      }

      if (
        target.closest(
          "#clear-cart"
        )
      ) {
        clearCart();
        return;
      }

      if (
        target.closest(
          "#reset-filters"
        )
      ) {
        resetFilters();
        return;
      }

      if (
        target.closest(
          "#retry-products"
        )
      ) {
        loadAllProducts();
        return;
      }

      if (
        target.closest(
          "#add-planner-all"
        )
      ) {
        addAllPlannerProducts();
      }
    }
  );
}

/* =========================================================
   PLANNER → WINKELMAND
   ========================================================= */

function addAllPlannerProducts() {
  const result =
    $("#planner-result");

  if (!result) {
    return;
  }

  const buttons =
    $$(
      "[data-add-planner]",
      result
    );

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
   START
   ========================================================= */

async function init() {
  setupSearch();
  setupGoals();
  setupCategories();
  setupPlanner();
  setupAI();
  setupGlobalEvents();

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
