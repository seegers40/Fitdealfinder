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

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function validUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function productPrice(product) {
  const value = Number(product?.price);
  return Number.isFinite(value) ? value : 0;
}

function money(value, currency = "EUR") {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency
  }).format(Number(value) || 0);
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

function discount(product) {
  const value = Number(product?.discount_percent);
  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/* =========================================================
   NIET-GESCHIKTE PRODUCTEN
========================================================= */

const EXCLUDED_TERMS = [
  "voedingsschema",
  "voedingsschema's",
  "voedingsplan",
  "voedingsplannen",
  "dieetplan",
  "meal plan",
  "mealplan",

  "trainingsschema",
  "trainingsschema's",
  "trainingsplan",
  "workout plan",
  "workoutplan",

  "drinkbeker",
  "drinkbekers",
  "waterfles",
  "water bottle",
  "drinkfles",
  "bidon",

  "shaker",
  "shaker bottle",

  "t shirt",
  "t-shirt",
  "shirt",
  "hoodie",
  "trui",
  "broek",
  "short",
  "legging",
  "sokken",
  "pet",
  "cap",

  "sporttas",
  "gym bag",
  "handdoek",
  "handdoeken",

  "accessoire",
  "accessoires",
  "merchandise",
  "merch",

  "ebook",
  "e book",
  "boek",
  "pdf",

  "coaching",
  "coachingspakket",
  "schema op maat"
];

function isExcluded(product) {
  const name = normalize(product?.name);
  const category = normalize(product?.category);

  return EXCLUDED_TERMS.some(term => {
    const t = normalize(term);

    return (
      name.includes(t) ||
      category.includes(t)
    );
  });
}

function productIsUsable(product) {
  if (!product) return false;
  if (!clean(product.id)) return false;
  if (!clean(product.name)) return false;
  if (!validUrl(product.product_url)) return false;

  return !isExcluded(product);
}

/* =========================================================
   DOELEN
========================================================= */

const GOAL_RULES = {
  cut: {
    positive: [
      "whey",
      "protein",
      "proteine",
      "eiwit",
      "isolate",
      "isolaat",
      "clear whey",
      "casein",
      "caseine",
      "creatine",
      "pre workout",
      "pre-workout",
      "preworkout",
      "bcaa",
      "eaa",
      "amino",
      "electrolyte",
      "electrolytes",
      "vitamin",
      "vitamine",
      "magnesium",
      "zinc",
      "zink",
      "fat burner",
      "fatburner",
      "thermogenic"
    ],
    negative: [
      "mass gainer",
      "weight gainer",
      "gainer",
      "mass builder",
      "mega calorie",
      "high calorie"
    ]
  },

  bulk: {
    positive: [
      "mass gainer",
      "weight gainer",
      "gainer",
      "mass builder",
      "whey",
      "protein",
      "proteine",
      "eiwit",
      "creatine",
      "carbo",
      "carbs",
      "koolhydraten",
      "dextrose",
      "maltodextrine",
      "glucose",
      "amino",
      "eaa",
      "bcaa"
    ],
    negative: [
      "fat burner",
      "fatburner",
      "thermogenic"
    ]
  },

  "lean-bulk": {
    positive: [
      "whey",
      "protein",
      "proteine",
      "eiwit",
      "isolate",
      "isolaat",
      "clear whey",
      "casein",
      "caseine",
      "creatine",
      "pre workout",
      "pre-workout",
      "preworkout",
      "eaa",
      "bcaa",
      "amino",
      "collagen",
      "collageen"
    ],
    negative: [
      "mass gainer",
      "weight gainer",
      "gainer",
      "mass builder",
      "mega calorie",
      "fat burner",
      "fatburner",
      "thermogenic"
    ]
  }
};

function matchesGoal(product, goal) {
  const selected = normalize(goal);

  if (!selected) {
    return true;
  }

  const rules = GOAL_RULES[selected];

  if (!rules) {
    return false;
  }

  if (!productIsUsable(product)) {
    return false;
  }

  const text = productText(product);

  if (
    rules.negative.some(term =>
      text.includes(normalize(term))
    )
  ) {
    return false;
  }

  return rules.positive.some(term =>
    text.includes(normalize(term))
  );
}

/* =========================================================
   RUBRIEKEN
========================================================= */

const CATEGORY_RULES = {
  proteine: [
    "whey",
    "protein",
    "proteine",
    "eiwit",
    "isolate",
    "isolaat",
    "clear whey",
    "casein",
    "caseine",
    "caseïne",
    "vegan protein",
    "plant protein",
    "egg protein",
    "beef protein"
  ],

  creatine: [
    "creatine"
  ],

  "pre-workout": [
    "pre workout",
    "pre-workout",
    "preworkout",
    "pump",
    "citrulline",
    "beta alanine",
    "beta-alanine",
    "nox"
  ],

  supplementen: [
    "vitamin",
    "vitamine",
    "multivitamin",
    "multivitamine",
    "magnesium",
    "zinc",
    "zink",
    "omega",
    "fish oil",
    "visolie",
    "electrolyte",
    "electrolytes",
    "collagen",
    "collageen",
    "glutamine",
    "amino",
    "eaa",
    "bcaa",
    "supplement"
  ]
};

function matchesCategory(product, category) {
  const selected = normalize(category);
  const terms = CATEGORY_RULES[selected];

  if (!selected) {
    return true;
  }

  if (!terms || !productIsUsable(product)) {
    return false;
  }

  const text = productText(product);

  return terms.some(term =>
    text.includes(normalize(term))
  );
}

/* =========================================================
   SORTEREN
========================================================= */

function sortProducts(products) {
  return [...products].sort((a, b) => {
    const discountDifference =
      discount(b) - discount(a);

    if (discountDifference !== 0) {
      return discountDifference;
    }

    const scoreA = Number(a.deal_score) || 0;
    const scoreB = Number(b.deal_score) || 0;

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    return productPrice(a) - productPrice(b);
  });
}

/* =========================================================
   PRODUCTEN LADEN
========================================================= */

async function fetchProducts(offset) {
  const params = new URLSearchParams();

  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));

  const response = await fetch(
    `${API_PRODUCTS}?${params.toString()}`,
    {
      headers: {
        Accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `API fout ${response.status}`
    );
  }

  return response.json();
}

async function loadProducts() {
  state.loading = true;
  updateCount();

  try {
    const allProducts = [];
    let offset = 0;

    while (allProducts.length < MAX_PRODUCTS) {
      const data = await fetchProducts(offset);

      const page = Array.isArray(data?.products)
        ? data.products
        : [];

      if (page.length === 0) {
        break;
      }

      allProducts.push(...page);

      if (page.length < PAGE_SIZE) {
        break;
      }

      offset += page.length;
    }

    state.products = sortProducts(
      allProducts.filter(productIsUsable)
    );

    applyFilters();

  } catch (error) {
    console.error(
      "Producten laden mislukt:",
      error
    );

    const grid =
      document.querySelector("#products-grid");

    if (grid) {
      grid.innerHTML = `
        <div style="
          grid-column:1/-1;
          padding:30px;
          text-align:center;
          color:#9eacbd;
        ">
          Producten konden niet worden geladen.
          Vernieuw de pagina opnieuw.
        </div>
      `;
    }
  } finally {
    state.loading = false;
    updateCount();
  }
}

/* =========================================================
   FILTEREN
========================================================= */

function applyFilters() {
  const search = normalize(state.search);
  const goal = normalize(state.goal);
  const category = normalize(state.category);

  state.filtered = state.products.filter(product => {

    if (
      search &&
      !productText(product).includes(search)
    ) {
      return false;
    }

    if (
      goal &&
      !matchesGoal(product, goal)
    ) {
      return false;
    }

    if (
      category &&
      !matchesCategory(product, category)
    ) {
      return false;
    }

    return true;
  });

  state.visibleCount =
    PRODUCTS_PER_VIEW;

  renderProducts();
  updateCount();
}

function updateCount() {
  const count =
    document.querySelector("#product-count");

  if (!count) return;

  if (state.loading) {
    count.textContent =
      "Producten laden…";
    return;
  }

  count.textContent =
    `${state.filtered.length} producten`;
}

/* =========================================================
   PRODUCT KAART
========================================================= */

function productCard(product) {
  const oldPrice =
    Number(product.old_price);

  const hasOldPrice =
    Number.isFinite(oldPrice) &&
    oldPrice > productPrice(product);

  const image =
    validUrl(product.image_url)
      ? `
        <img
          class="product-image"
          src="${escapeHtml(product.image_url)}"
          alt="${escapeHtml(product.name)}"
          loading="lazy"
        >
      `
      : `
        <div
          class="product-image"
          style="
            display:flex;
            align-items:center;
            justify-content:center;
            background:#172338;
            font-size:30px;
          "
        >
          💪
        </div>
      `;

  return `
    <article class="product-card">

      <div class="product-image-wrap">
        ${image}
      </div>

      <div class="product-content">

        <div style="
          color:#8fa0b7;
          font-size:12px;
          margin-bottom:5px;
        ">
          ${escapeHtml(product.merchant_name)}
        </div>

        <h3>
          ${escapeHtml(product.name)}
        </h3>

        <div style="
          display:flex;
          align-items:center;
          gap:8px;
          flex-wrap:wrap;
          margin-top:8px;
        ">

          <strong style="
            color:#fff;
            font-size:20px;
          ">
            ${money(
              productPrice(product),
              product.currency || "EUR"
            )}
          </strong>

          ${
            hasOldPrice
              ? `
                <span style="
                  color:#8290a4;
                  text-decoration:line-through;
                  font-size:13px;
                ">
                  ${money(
                    oldPrice,
                    product.currency || "EUR"
                  )}
                </span>
              `
              : ""
          }

          ${
            discount(product) > 0
              ? `
                <span style="
                  color:#8ee7b4;
                  font-weight:700;
                  font-size:12px;
                ">
                  -${discount(product)}%
                </span>
              `
              : ""
          }

        </div>

        <div style="
          color:#8ee7b4;
          font-size:12px;
          margin-top:8px;
        ">
          ${product.in_stock
            ? "Op voorraad"
            : "Niet op voorraad"}
        </div>

        <div style="
          display:flex;
          gap:8px;
          flex-wrap:wrap;
          margin-top:13px;
        ">

          <a
            class="button primary"
            href="/go/${encodeURIComponent(product.id)}"
          >
            Bekijk deal
          </a>

          <button
            type="button"
            class="button secondary"
            data-add-cart="${escapeHtml(product.id)}"
          >
            + Mandje
          </button>

        </div>

        <div style="
          color:#7f8da1;
          font-size:11px;
          margin-top:10px;
        ">
          Prijsindicatie · controleer de actuele prijs bij de winkel
        </div>

      </div>
    </article>
  `;
}

function renderProducts() {
  const grid =
    document.querySelector("#products-grid");

  if (!grid) return;

  const visible =
    state.filtered.slice(
      0,
      state.visibleCount
    );

  if (visible.length === 0) {
    grid.innerHTML = `
      <div style="
        grid-column:1/-1;
        padding:35px 15px;
        text-align:center;
        color:#9eacbd;
      ">
        Geen geschikte producten gevonden.
      </div>
    `;

    removeLoadMore();
    return;
  }

  grid.innerHTML =
    visible
      .map(productCard)
      .join("");

  bindCartButtons();

  removeLoadMore();

  if (
    state.visibleCount <
    state.filtered.length
  ) {
    const button =
      document.createElement("button");

    button.type = "button";
    button.dataset.loadMore = "1";
    button.className =
      "button secondary";

    button.style.cssText = `
      display:block;
      margin:22px auto;
    `;

    button.textContent =
      `Meer producten (${state.filtered.length - state.visibleCount})`;

    button.addEventListener(
      "click",
      () => {
        state.visibleCount +=
          PRODUCTS_PER_VIEW;

        renderProducts();
      }
    );

    grid.parentElement?.appendChild(
      button
    );
  }
}

function removeLoadMore() {
  document
    .querySelectorAll(
      "[data-load-more]"
    )
    .forEach(element =>
      element.remove()
    );
}

/* =========================================================
   ZOEKEN
========================================================= */

function bindSearch() {
  const input =
    document.querySelector("#search");

  const form =
    document.querySelector("#search-form");

  if (!input) return;

  input.addEventListener(
    "input",
    () => {
      state.search =
        input.value || "";

      applyFilters();
    }
  );

  form?.addEventListener(
    "submit",
    event => {
      event.preventDefault();

      state.search =
        input.value || "";

      applyFilters();

      document
        .querySelector("#deals")
        ?.scrollIntoView({
          behavior:"smooth"
        });
    }
  );
}

/* =========================================================
   DOELEN + CATEGORIEËN
========================================================= */

function bindFilters() {

  document
    .querySelectorAll("[data-goal]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const goal =
            button.dataset.goal || "";

          state.goal =
            state.goal === goal
              ? ""
              : goal;

          document
            .querySelectorAll(
              "[data-goal]"
            )
            .forEach(item => {
              item.classList.toggle(
                "active",
                item.dataset.goal ===
                  state.goal
              );
            });

          applyFilters();

          document
            .querySelector("#deals")
            ?.scrollIntoView({
              behavior:"smooth",
              block:"start"
            });
        }
      );
    });

  document
    .querySelectorAll("[data-category]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const category =
            button.dataset.category || "";

          state.category =
            state.category === category
              ? ""
              : category;

          document
            .querySelectorAll(
              "[data-category]"
            )
            .forEach(item => {
              item.classList.toggle(
                "active",
                item.dataset.category ===
                  state.category
              );
            });

          applyFilters();

          document
            .querySelector("#deals")
            ?.scrollIntoView({
              behavior:"smooth",
              block:"start"
            });
        }
      );
    });
}

/* =========================================================
   SHOPPING PLANNER
========================================================= */

function plannerCard(product) {
  return `
    <div style="
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:12px;
      padding:12px;
      margin-top:8px;
      border-radius:12px;
      background:#111d2f;
      border:1px solid rgba(255,255,255,.08);
    ">

      <div style="min-width:0;flex:1;">

        <div style="
          color:#fff;
          font-size:13px;
          font-weight:700;
          line-height:1.4;
        ">
          ${escapeHtml(product.name)}
        </div>

        <div style="
          color:#8ee7b4;
          font-weight:700;
          margin-top:4px;
        ">
          ${money(
            productPrice(product),
            product.currency || "EUR"
          )}
        </div>

        <div style="
          color:#8392a5;
          font-size:11px;
          margin-top:3px;
        ">
          ${escapeHtml(product.merchant_name)}
        </div>

      </div>

      <button
        type="button"
        class="button secondary"
        data-planner-add="${escapeHtml(product.id)}"
      >
        + Mandje
      </button>

    </div>
  `;
}

function bindPlannerButtons(container) {
  container
    .querySelectorAll(
      "[data-planner-add]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const product =
            state.products.find(
              item =>
                String(item.id) ===
                String(
                  button.dataset.plannerAdd
                )
            );

          if (!product) return;

          addToCart(product);

          button.textContent =
            "✓ In mandje";

          button.disabled = true;
        }
      );
    });
}

function renderPlannerCart() {
  const result =
    document.querySelector(
      "#planner-result"
    );

  if (!result) return;

  const old =
    result.querySelector(
      ".planner-cart"
    );

  if (old) {
    old.remove();
  }

  if (state.cart.length === 0) {
    return;
  }

  const cart =
    document.createElement("div");

  cart.className =
    "planner-cart";

  cart.style.cssText = `
    margin-top:18px;
    padding:15px;
    border-radius:15px;
    background:#0d1727;
    border:1px solid rgba(142,231,180,.25);
  `;

  cart.innerHTML = `
    <div style="
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
      margin-bottom:10px;
    ">

      <strong style="color:#fff">
        🛒 Jouw boodschappenmand
      </strong>

      <strong style="color:#8ee7b4">
        ${money(cartTotal())}
      </strong>

    </div>

    ${state.cart.map(product => `
      <div style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:10px;
        padding:8px 0;
        border-bottom:1px solid rgba(255,255,255,.06);
      ">

        <span style="
          color:#c8d2df;
          font-size:12px;
        ">
          ${escapeHtml(product.name)}
        </span>

        <button
          type="button"
          data-remove-planner="${escapeHtml(product.id)}"
          style="
            border:0;
            background:none;
            color:#ff9898;
            cursor:pointer;
            font-size:18px;
          "
        >
          ×
        </button>

      </div>
    `).join("")}
  `;

  result.appendChild(cart);

  cart
    .querySelectorAll(
      "[data-remove-planner]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {
          removeFromCart(
            button.dataset.removePlanner
          );
        }
      );
    });
}

function bindPlanner() {
  const form =
    document.querySelector(
      "#planner-form"
    );

  if (!form) return;

  form.addEventListener(
    "submit",
    event => {

      event.preventDefault();

      const goal =
        form.querySelector(
          "[name='goal']"
        )?.value || "";

      const budget =
        Number(
          form.querySelector(
            "[name='budget']"
          )?.value || 0
        );

      let candidates =
        state.products.filter(
          productIsUsable
        );

      if (goal) {
        candidates =
          candidates.filter(
            product =>
              matchesGoal(
                product,
                goal
              )
          );
      }

      if (
        Number.isFinite(budget) &&
        budget > 0
      ) {
        candidates =
          candidates.filter(
            product =>
              productPrice(product) <=
              budget
          );
      }

      candidates =
        [...candidates]
          .sort((a,b) => {

            const priceDifference =
              productPrice(a) -
              productPrice(b);

            if (priceDifference !== 0) {
              return priceDifference;
            }

            return (
              discount(b) -
              discount(a)
            );
          })
          .slice(0,8);

      const result =
        document.querySelector(
          "#planner-result"
        );

      if (!result) return;

      if (candidates.length === 0) {

        result.innerHTML = `
          <div style="
            color:#cbd5e1;
            line-height:1.6;
          ">
            <strong style="color:#fff">
              Geen geschikte producten gevonden.
            </strong>

            <br>

            Probeer een hoger budget of een ander doel.
          </div>
        `;

        renderPlannerCart();
        return;
      }

      result.innerHTML = `
        <div>

          <strong style="
            color:#fff;
            font-size:15px;
          ">
            ${candidates.length}
            passende producten
          </strong>

          <div style="
            margin-top:5px;
            color:#9eacbd;
            font-size:12px;
          ">
            Producten die passen bij je doel en budget.
          </div>

        </div>

        <div style="margin-top:10px;">
          ${candidates
            .map(plannerCard)
            .join("")}
        </div>
      `;

      bindPlannerButtons(result);
      renderPlannerCart();
    }
  );
}

/* =========================================================
   WINKELMANDJE
========================================================= */

function loadCart() {
  try {
    const saved =
      localStorage.getItem(CART_KEY);

    if (!saved) return [];

    const parsed =
      JSON.parse(saved);

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
  } catch {
    // niets doen
  }
}

function cartTotal() {
  return state.cart.reduce(
    (total, product) =>
      total + productPrice(product),
    0
  );
}

function addToCart(product) {
  if (!productIsUsable(product)) {
    return;
  }

  const exists =
    state.cart.some(
      item =>
        String(item.id) ===
        String(product.id)
    );

  if (exists) {
    return;
  }

  state.cart.push(product);

  saveCart();
  renderCart();
  renderPlannerCart();
}

function removeFromCart(id) {
  state.cart =
    state.cart.filter(
      product =>
        String(product.id) !==
        String(id)
    );

  saveCart();
  renderCart();
  renderPlannerCart();
}

function bindCartButtons() {
  document
    .querySelectorAll(
      "[data-add-cart]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const product =
            state.products.find(
              item =>
                String(item.id) ===
                String(
                  button.dataset.addCart
                )
            );

          if (!product) return;

          addToCart(product);

          button.textContent =
            "✓ In mandje";

          button.disabled = true;
        }
      );
    });
}

function renderCart() {
  const old =
    document.querySelector(
      "#site-cart"
    );

  if (old) {
    old.remove();
  }

  if (state.cart.length === 0) {
    return;
  }

  const cart =
    document.createElement("div");

  cart.id = "site-cart";

  cart.style.cssText = `
    position:fixed;
    right:16px;
    bottom:16px;
    z-index:9999;
    width:min(370px,calc(100vw - 32px));
    max-height:70vh;
    overflow:auto;
    background:#101a2b;
    border:1px solid rgba(255,255,255,.12);
    border-radius:18px;
    padding:16px;
    box-shadow:0 20px 55px rgba(0,0,0,.45);
  `;

  cart.innerHTML = `
    <div style="
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
      margin-bottom:12px;
    ">

      <strong style="color:#fff">
        🛒 Boodschappenmand
      </strong>

      <strong style="color:#8ee7b4">
        ${money(cartTotal())}
      </strong>

    </div>

    ${state.cart.map(product => `
      <div style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:10px;
        padding:9px 0;
        border-bottom:1px solid rgba(255,255,255,.06);
      ">

        <div style="
          color:#d4deea;
          font-size:12px;
        ">
          ${escapeHtml(product.name)}
        </div>

        <button
          type="button"
          data-remove-cart="${escapeHtml(product.id)}"
          style="
            border:0;
            background:none;
            color:#ff9898;
            cursor:pointer;
            font-size:19px;
          "
        >
          ×
        </button>

      </div>
    `).join("")}
  `;

  document.body.appendChild(cart);

  cart
    .querySelectorAll(
      "[data-remove-cart]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {
          removeFromCart(
            button.dataset.removeCart
          );
        }
      );
    });
}

/* =========================================================
   AI
========================================================= */

function bindAI() {
  const form =
    document.querySelector("#ai-form");

  const input =
    document.querySelector("#ai-input");

  const output =
    document.querySelector("#ai-output");

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

      if (!message) return;

      output.innerHTML = `
        <div style="color:#9eacbd">
          Even nadenken…
        </div>
      `;

      try {

        const response =
          await fetch(
            API_AI,
            {
              method:"POST",
              headers:{
                "Content-Type":
                  "application/json",
                Accept:
                  "application/json"
              },
              body:JSON.stringify({
                message
              })
            }
          );

        if (!response.ok) {
          throw new Error(
            `AI fout ${response.status}`
          );
        }

        const data =
          await response.json();

        const answer =
          data.answer ||
          data.message ||
          data.response ||
          "Geen antwoord ontvangen.";

        output.innerHTML = `
          <div style="
            color:#d8e2ee;
            line-height:1.6;
            white-space:pre-wrap;
          ">
            ${escapeHtml(answer)}
          </div>
        `;

      } catch (error) {

        console.error(error);

        output.innerHTML = `
          <div style="color:#ffaaaa">
            De AI Coach kon momenteel geen antwoord geven.
          </div>
        `;
      }
    }
  );
}

/* =========================================================
   COACH NAAR BOVEN
========================================================= */

function moveCoachBeforeDeals() {
  const coach =
    document.querySelector("#coach");

  const deals =
    document.querySelector("#deals");

  if (
    coach &&
    deals &&
    deals.parentNode
  ) {
    deals.parentNode.insertBefore(
      coach,
      deals
    );
  }
}

/* =========================================================
   EXTRA STYLING
========================================================= */

function injectStyles() {
  if (
    document.querySelector(
      "#fitdeal-app-styles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "fitdeal-app-styles";

  style.textContent = `
    .product-image-wrap {
      width:100%;
      height:210px;
      display:flex;
      align-items:center;
      justify-content:center;
      overflow:hidden;
      background:#fff;
      border-radius:14px;
    }

    .product-card .product-image {
      width:100%;
      height:100%;
      object-fit:contain;
      display:block;
    }

    .product-image-placeholder {
      display:flex;
      align-items:center;
      justify-content:center;
      background:#172338;
      color:#8fa0b7;
      font-size:30px;
    }

    button:disabled {
      opacity:.65;
    }
  `;

  document.head.appendChild(style);
}

/* =========================================================
   START
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    injectStyles();

    moveCoachBeforeDeals();

    bindSearch();
    bindFilters();
    bindPlanner();
    bindAI();

    renderCart();

    loadProducts();
  }
);
