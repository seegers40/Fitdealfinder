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
  if (!product) return false;
  if (!product.id) return false;
  if (!product.name) return false;

  if (
    !product.product_url &&
    !product.affiliate_url
  ) {
    return false;
  }

  const text = productText(product);

  return !BAD_WORDS.some(word =>
    text.includes(normalize(word))
  );
}


/* =========================================================
   GOAL DEFINITIONS
========================================================= */

/*
 * Deze lijsten worden gebruikt voor zowel:
 *
 * - de Cut / Bulk / Lean Bulk filters bovenaan
 * - de Shopping Planner
 *
 * We gebruiken NIET meer de algemene D1 `goals` als
 * automatische match. Dat veld bevat bij veel producten
 * standaard meerdere doelen en veroorzaakte overlap.
 */

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

  /*
   * -------------------------------------------------------
   * CUT
   * -------------------------------------------------------
   */

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

    /*
     * Gewone protein/whey/creatine producten
     * worden NIET automatisch Cut.
     */
    return 0;
  }


  /*
   * -------------------------------------------------------
   * BULK
   * -------------------------------------------------------
   */

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


  /*
   * -------------------------------------------------------
   * LEAN BULK
   * -------------------------------------------------------
   */

  if (
    normalizedGoal ===
    "lean-bulk"
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
  if (!category) return true;

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
  if (!query) return true;

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
    /*
     * Bij een doel eerst de doelrelevantie.
     */
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

  state.visibleCount =
    PRODUCTS_PER_VIEW;

  renderProducts();
}


/* =========================================================
   LOAD PRODUCTS
========================================================= */

async function loadProducts() {
  if (state.loading) return;

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
  const grid =
    $("#products-grid");

  if (!grid) return;

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

  if (!element) return;

  element.textContent =
    `${count} producten`;
}

function updateLoadMore() {
  const button =
    $("#load-more");

  if (!button) return;

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
   CART
========================================================= */

function loadCart() {
  try {
    const raw =
      localStorage.getItem(
        CART_KEY
      );

    const parsed =
      raw
        ? JSON.parse(raw)
        : [];

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
      JSON.stringify(
        state.cart
      )
    );
  } catch {
    // localStorage kan geblokkeerd zijn.
  }
}

function cartProductById(id) {
  return state.products.find(
    product =>
      String(product.id) ===
      String(id)
  );
}

function addToCart(id) {
  const product =
    cartProductById(id);

  if (!product) {
    return;
  }

  const existing =
    state.cart.find(
      item =>
        String(item.id) ===
        String(id)
    );

  if (existing) {
    existing.quantity =
      (Number(
        existing.quantity
      ) || 1) + 1;
  } else {
    state.cart.push({
      id: String(product.id),
      name: product.name,
      price: price(product),
      currency:
        product.currency ||
        "EUR",
      merchant_name:
        product.merchant_name ||
        "",
      quantity: 1
    });
  }

  saveCart();
  renderCart();
  updateCartTriggers();
}

function removeFromCart(id) {
  state.cart =
    state.cart.filter(
      item =>
        String(item.id) !==
        String(id)
    );

  saveCart();
  renderCart();
  updateCartTriggers();
}

function changeCartQuantity(
  id,
  delta
) {
  const item =
    state.cart.find(
      cartItem =>
        String(cartItem.id) ===
        String(id)
    );

  if (!item) return;

  item.quantity =
    Math.max(
      1,
      (Number(
        item.quantity
      ) || 1) + delta
    );

  saveCart();
  renderCart();
}

function renderCart() {
  const cart =
    first(
      "#cart",
      "#shopping-cart",
      "#cart-panel"
    );

  if (!cart) {
    return;
  }

  const existingEmpty =
    cart.querySelector(
      ".cart-empty"
    );

  if (
    !state.cart.length
  ) {
    if (existingEmpty) {
      existingEmpty.hidden =
        false;
    }

    return;
  }

  const total =
    state.cart.reduce(
      (sum, item) =>
        sum +
        (
          Number(item.price) ||
          0
        ) *
          (
            Number(
              item.quantity
            ) || 1
          ),
      0
    );

  cart.innerHTML = `
    <div class="cart-items">

      ${state.cart
        .map(
          item => `
            <div class="cart-item">

              <div>
                <strong>
                  ${escapeHtml(
                    item.name
                  )}
                </strong>

                <div>
                  ${money(
                    item.price,
                    item.currency
                  )}
                </div>
              </div>

              <div class="cart-quantity">

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
                    item.quantity
                  ) || 1}
                </span>

                <button
                  type="button"
                  data-cart-plus="${escapeHtml(
                    item.id
                  )}"
                >
                  +
                </button>

              </div>

              <button
                type="button"
                data-cart-remove="${escapeHtml(
                  item.id
                )}"
              >
                Verwijderen
              </button>

            </div>
          `
        )
        .join("")}

    </div>

    <div class="cart-total">
      <strong>
        Totaal
      </strong>

      <strong>
        ${money(total)}
      </strong>
    </div>
  `;
}

function updateCartTriggers() {
  const count =
    state.cart.reduce(
      (sum, item) =>
        sum +
        (
          Number(
            item.quantity
          ) || 1
        ),
      0
    );

  $all(
    "[data-cart-count]"
  ).forEach(element => {
    element.textContent =
      String(count);
  });
}

function setupCartEvents() {
  document.addEventListener(
    "click",
    event => {
      const addButton =
        event.target.closest(
          "[data-add-cart]"
        );

      if (addButton) {
        addToCart(
          addButton.dataset
            .addCart
        );

        return;
      }

      const removeButton =
        event.target.closest(
          "[data-cart-remove]"
        );

      if (removeButton) {
        removeFromCart(
          removeButton.dataset
            .cartRemove
        );

        return;
      }

      const plusButton =
        event.target.closest(
          "[data-cart-plus]"
        );

      if (plusButton) {
        changeCartQuantity(
          plusButton.dataset
            .cartPlus,
          1
        );

        return;
      }

      const minusButton =
        event.target.closest(
          "[data-cart-minus]"
        );

      if (minusButton) {
        changeCartQuantity(
          minusButton.dataset
            .cartMinus,
          -1
        );
      }
    }
  );
}

function setupCartTrigger() {
  $all(
    "[data-cart-trigger]"
  ).forEach(button => {
    button.addEventListener(
      "click",
      () => {
        const cart =
          first(
            "#cart",
            "#shopping-cart",
            "#cart-panel"
          );

        if (cart) {
          cart.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      }
    );
  });

  renderCart();
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
        1fr auto auto;
      align-items: center;
      gap: 18px;
      padding: 22px;
      border:
        1px solid
        rgba(255,255,255,.08);
      border-radius: 20px;
      background:
        rgba(3,7,18,.55);
    }

    .planner-result-item strong {
      color: #fff;
      font-size: 18px;
      line-height: 1.4;
    }

    .planner-result-item span {
      color: #36c978;
      font-weight: 800;
      font-size: 18px;
      white-space: nowrap;
    }

    .planner-result-item .cart-button {
      border: 0;
      border-radius: 12px;
      padding: 12px 18px;
      background: #00a83b;
      color: #fff;
      font-weight: 800;
      cursor: pointer;
    }

    .planner-result-item
      .cart-button:hover {
      background: #00bd43;
    }

    @media (max-width: 700px) {
      .planner-result-item {
        grid-template-columns:
          1fr auto;
      }

      .planner-result-item strong {
        grid-column:
          1 / -1;
      }

      .planner-result-item
        .cart-button {
        justify-self: end;
      }
    }
  `;

  document.head.appendChild(
    style
  );
}

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

            seen.add(key);

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
              product => `
                <div
                  class="planner-result-item"
                >

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
                      String(
                        product.id
                      )
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

  form.addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const message =
        input.value.trim();

      if (!message) {
        return;
      }

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

        if (!response.ok) {
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
          <p>
            ${escapeHtml(answer)}
          </p>
        `;

      } catch (error) {
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
   AFFILIATE / DEAL TRACKING
========================================================= */

function setupDealTracking() {
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

      const match =
        link
          .getAttribute("href")
          ?.match(
            /^\/go\/([^/?#]+)/
          );

      if (!match) {
        return;
      }

      const productId =
        decodeURIComponent(
          match[1]
        );

      fetch(
        `/api/click/${encodeURIComponent(
          productId
        )}`,
        {
          method: "POST",
          keepalive: true
        }
      ).catch(() => {
        // Tracking mag de klik niet blokkeren.
      });
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

  if (loadMore) {
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
