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
   ALGEMENE HELPERS
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

function isValidUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function price(product) {
  const value = Number(product?.price);

  if (!Number.isFinite(value)) {
    return 0;
  }

  return value;
}

function formatMoney(value, currency = "EUR") {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency
  }).format(Number(value) || 0);
}

function discount(product) {
  const value = Number(product?.discount_percent);

  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function searchableText(product) {
  return normalize([
    product?.name,
    product?.brand,
    product?.merchant_name,
    product?.category,
    product?.description
  ].join(" "));
}

/* =========================================================
   PRODUCT UITSLUITEN
========================================================= */

const EXCLUDED_WORDS = [
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
  "shaker",
  "shaker bottle",
  "waterfles",
  "water bottle",
  "drinkfles",
  "bidon",

  "shirt",
  "t shirt",
  "t-shirt",
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
  "tas",

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
  "schema op maat",
  "advies op maat"
];

const SUPPLEMENT_WORDS = [
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
  "beef protein",

  "creatine",
  "creatine monohydraat",
  "creatine monohydrate",

  "pre workout",
  "pre-workout",
  "preworkout",
  "pump",
  "citrulline",
  "beta alanine",
  "beta-alanine",
  "nox",

  "bcaa",
  "eaa",
  "amino",
  "amino acids",

  "gainer",
  "mass gainer",
  "weight gainer",
  "mass builder",

  "carbo",
  "carbs",
  "koolhydraten",
  "dextrose",
  "maltodextrine",
  "glucose",

  "electrolyte",
  "electrolytes",
  "electrolyt",

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

  "fat burner",
  "fatburner",
  "thermogenic",

  "collagen",
  "collageen",

  "glutamine",
  "supplement",
  "supplementen"
];

function isExcluded(product) {
  const name = normalize(product?.name);
  const category = normalize(product?.category);
  const description = normalize(product?.description);

  return EXCLUDED_WORDS.some(word => {
    const term = normalize(word);

    return (
      name.includes(term) ||
      category.includes(term) ||
      (
        term.length >= 7 &&
        description.includes(term)
      )
    );
  });
}

function isSupplement(product) {
  if (!product || isExcluded(product)) {
    return false;
  }

  const text = searchableText(product);

  return SUPPLEMENT_WORDS.some(word =>
    text.includes(normalize(word))
  );
}

function productIsUsable(product) {
  if (!product) return false;

  if (!clean(product.id)) return false;
  if (!clean(product.name)) return false;
  if (!isValidUrl(product.product_url)) return false;

  if (product.in_stock === 0 || product.in_stock === false) {
    return false;
  }

  return isSupplement(product);
}

/* =========================================================
   DOELCLASSIFICATIE
========================================================= */

const GOALS = {
  cut: {
    include: [
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
    exclude: [
      "mass gainer",
      "weight gainer",
      "gainer",
      "mass builder",
      "mega calorie",
      "high calorie"
    ]
  },

  bulk: {
    include: [
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
    exclude: [
      "fat burner",
      "fatburner",
      "thermogenic"
    ]
  },

  "lean-bulk": {
    include: [
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
    exclude: [
      "fat burner",
      "fatburner",
      "thermogenic",
      "mass gainer",
      "weight gainer",
      "mega calorie"
    ]
  }
};

function matchesGoal(product, goal) {
  const selected = normalize(goal);

  if (!selected) {
    return true;
  }

  if (!productIsUsable(product)) {
    return false;
  }

  const rules = GOALS[selected];

  if (!rules) {
    return false;
  }

  const text = searchableText(product);

  if (
    rules.exclude.some(term =>
      text.includes(normalize(term))
    )
  ) {
    return false;
  }

  return rules.include.some(term =>
    text.includes(normalize(term))
  );
}

/* =========================================================
   CATEGORIEËN
========================================================= */

const CATEGORIES = {
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

  if (!selected) {
    return true;
  }

  const terms = CATEGORIES[selected];

  if (!terms || !productIsUsable(product)) {
    return false;
  }

  const text = searchableText(product);

  return terms.some(term =>
    text.includes(normalize(term))
  );
}

/* =========================================================
   SORTERING
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

    return price(a) - price(b);
  });
}

/* =========================================================
   PRODUCT API
========================================================= */

async function fetchProductPage(offset) {
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
      `Product API fout: ${response.status}`
    );
  }

  return response.json();
}

async function loadProducts() {
  state.loading = true;
  updateCount();

  try {
    const products = [];
    let offset = 0;

    while (products.length < MAX_PRODUCTS) {
      const data =
        await fetchProductPage(offset);

      const page =
        Array.isArray(data?.products)
          ? data.products
          : [];

      if (page.length === 0) {
        break;
      }

      products.push(...page);

      if (page.length < PAGE_SIZE) {
        break;
      }

      offset += page.length;
    }

    /*
     * HIER wordt de harde kwaliteitsfilter toegepast.
     * Alles wat geen echt supplement is verdwijnt.
     */
    state.products = sortProducts(
      products.filter(productIsUsable)
    );

    applyFilters();

  } catch (error) {
    console.error(error);

    const grid =
      document.querySelector("#products-grid");

    if (grid) {
      grid.innerHTML = `
        <div style="
          grid-column:1/-1;
          padding:25px;
          border-radius:16px;
          color:#dbe5f0;
          background:#111d2f;
        ">
          Producten konden tijdelijk niet worden geladen.
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
   FILTERS
========================================================= */

function applyFilters() {
  const search =
    normalize(state.search);

  const goal =
    normalize(state.goal);

  const category =
    normalize(state.category);

  state.filtered =
    state.products.filter(product => {

      if (search) {
        if (
          !searchableText(product)
            .includes(search)
        ) {
          return false;
        }
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
  const element =
    document.querySelector("#product-count");

  if (!element) {
    return;
  }

  if (state.loading) {
    element.textContent =
      "Producten laden…";
    return;
  }

  element.textContent =
    `${state.filtered.length} producten`;
}

/* =========================================================
   PRODUCT KAARTEN
========================================================= */

function productCard(product) {
  const oldPrice =
    Number(product.old_price);

  const hasOldPrice =
    Number.isFinite(oldPrice) &&
    oldPrice > price(product);

  const image =
    isValidUrl(product.image_url)
      ? `
        <img
          class="product-image"
          src="${escapeHtml(product.image_url)}"
          alt="${escapeHtml(product.name)}"
          loading="lazy"
        >
      `
      : `
        <div class="product-image product-image-placeholder">
          💪
        </div>
      `;

  return `
    <article class="product-card">

      <div class="product-image-wrap">
        ${image}
      </div>

      <div class="product-content">

        <div class="merchant">
          ${escapeHtml(product.merchant_name)}
        </div>

        <h3>
          ${escapeHtml(product.name)}
        </h3>

        <div class="price-row">

          <strong>
            ${formatMoney(
              price(product),
              product.currency || "EUR"
            )}
          </strong>

          ${
            hasOldPrice
              ? `
                <span class="old-price">
                  ${formatMoney(
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
                <span class="discount">
                  -${discount(product)}%
                </span>
              `
              : ""
          }

        </div>

        <div class="stock">
          ${product.in_stock
            ? "Op voorraad"
            : "Niet op voorraad"}
        </div>

        <div class="card-actions">

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

        <div class="price-note">
          Prijsindicatie · controleer de actuele prijs bij de winkel
        </div>

      </div>
    </article>
  `;
}

function renderProducts() {
  const grid =
    document.querySelector("#products-grid");

  if (!grid) {
    return;
  }

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
        Geen geschikte supplementen gevonden.
        Probeer een ander doel, categorie of zoekterm.
      </div>
    `;

    return;
  }

  grid.innerHTML =
    visible
      .map(productCard)
      .join("");

  bindCartButtons();

  const oldMore =
    document.querySelector(
      "[data-load-more]"
    );

  if (oldMore) {
    oldMore.remove();
  }

  if (
    state.visibleCount <
    state.filtered.length
  ) {
    const more =
      document.createElement("button");

    more.type = "button";
    more.dataset.loadMore = "true";
    more.className = "button secondary";

    more.style.cssText = `
      display:block;
      margin:22px auto;
    `;

    more.textContent =
      `Meer producten (${state.filtered.length - state.visibleCount})`;

    more.addEventListener(
      "click",
      () => {
        state.visibleCount +=
          PRODUCTS_PER_VIEW;

        renderProducts();
      }
    );

    grid.parentElement?.appendChild(
      more
    );
  }
}

/* =========================================================
   ZOEKEN
========================================================= */

function bindSearch() {
  const form =
    document.querySelector("#search-form");

  const input =
    document.querySelector("#search");

  if (!input) {
    return;
  }

  input.addEventListener(
    "input",
    () => {
      state.search =
        input.value;

      applyFilters();
    }
  );

  form?.addEventListener(
    "submit",
    event => {
      event.preventDefault();

      state.search =
        input.value;

      applyFilters();

      document
        .querySelector("#deals")
        ?.scrollIntoView({
          behavior: "smooth"
        });
    }
  );
}

/* =========================================================
   DOELEN EN CATEGORIEËN
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
              behavior: "smooth",
              block: "start"
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
              behavior: "smooth",
              block: "start"
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
      padding:13px;
      margin-top:8px;
      border-radius:13px;
      background:#111d2f;
      border:1px solid rgba(255,255,255,.08);
    ">

      <div style="
        min-width:0;
        flex:1;
      ">

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
          ${formatMoney(
            price(product),
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

function renderPlannerCart() {
  const result =
    document.querySelector("#planner-result");

  if (!result) {
    return;
  }

  const previous =
    result.querySelector(".planner-cart");

  if (previous) {
    previous.remove();
  }

  const products =
    state.cart.filter(productIsUsable);

  if (products.length === 0) {
    return;
  }

  const cart =
    document.createElement("div");

  cart.className = "planner-cart";

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
      gap:10px;
      align-items:center;
      margin-bottom:10px;
    ">

      <strong style="color:#fff">
        🛒 Jouw boodschappenmand
      </strong>

      <strong style="color:#8ee7b4">
        ${formatMoney(cartTotal())}
      </strong>

    </div>

    ${products.map(product => `
      <div style="
        display:flex;
        justify-content:space-between;
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
          data-planner-remove="${escapeHtml(product.id)}"
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
      "[data-planner-remove]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {
          removeFromCart(
            button.dataset.plannerRemove
          );
        }
      );
    });
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

          if (!product) {
            return;
          }

          addToCart(product);

          button.textContent =
            "✓ In mandje";

          button.disabled = true;
        }
      );
    });
}

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
    event => {

      event.preventDefault();

      const goal =
        form.querySelector(
          "[name='goal']"
        )?.value || "";

      const budgetInput =
        form.querySelector(
          "[name='budget']"
        )?.value || "";

      const budget =
        Number(budgetInput);

      /*
       * BELANGRIJK:
       * Planner gebruikt dezelfde echte
       * productclassificatie als de doelknoppen.
       */
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
              price(product) <= budget
          );
      }

      /*
       * Goedkoopste geschikte deals eerst,
       * daarna korting.
       */
      candidates =
        [...candidates].sort(
          (a, b) => {

            const priceDifference =
              price(a) - price(b);

            if (
              priceDifference !== 0
            ) {
              return priceDifference;
            }

            return (
              discount(b) -
              discount(a)
            );
          }
        )
        .slice(0, 8);

      const result =
        document.querySelector(
          "#planner-result"
        );

      if (!result) {
        return;
      }

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
            Deze producten passen bij je gekozen doel
            en budget.
          </div>

        </div>

        <div style="
          margin-top:10px;
        ">
          ${candidates
            .map(plannerCard)
            .join("")}
        </div>
      `;

      bindPlannerButtons(result);

      /*
       * Alleen bestaand mandje toevoegen.
       * Het planner-resultaat blijft staan.
       */
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

    if (!saved) {
      return [];
    }

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
      total + price(product),
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

          if (!product) {
            return;
          }

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
      gap:10px;
      align-items:center;
      margin-bottom:12px;
    ">

      <strong style="color:#fff">
        🛒 Boodschappenmand
      </strong>

      <strong style="color:#8ee7b4">
        ${formatMoney(cartTotal())}
      </strong>

    </div>

    ${state.cart.map(product => `
      <div style="
        display:flex;
        justify-content:space-between;
        gap:10px;
        align-items:center;
        padding:9px 0;
        border-bottom:1px solid rgba(255,255,255,.06);
      ">

        <div style="
          color:#d4deea;
          font-size:12px;
          line-height:1.4;
        ">
          ${escapeHtml(product.name)}
        </div>

        <button
          type="button"
          data-remove-cart="${escapeHtml(product.id)}"
          style="
            flex:none;
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
   AI COACH
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

      if (!message) {
        return;
      }

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

        console.error(
          "AI fout:",
          error
        );

        output.innerHTML = `
          <div style="
            color:#ffaaaa;
          ">
            De AI Coach kon momenteel geen antwoord geven.
            Probeer het opnieuw.
          </div>
        `;
      }
    }
  );
}

/* =========================================================
   AI NAAR BOVEN
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
   EXTRA CSS
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
      font-size:32px;
    }

    .product-card .merchant {
      color:#8fa0b7;
      font-size:12px;
      margin-bottom:5px;
    }

    .product-card .price-row {
      display:flex;
      align-items:center;
      flex-wrap:wrap;
      gap:8px;
      margin-top:8px;
    }

    .product-card .price-row strong {
      color:#fff;
      font-size:20px;
    }

    .product-card .old-price {
      color:#8290a4;
      text-decoration:line-through;
      font-size:13px;
    }

    .product-card .discount {
      color:#8ee7b4;
      font-size:12px;
      font-weight:700;
    }

    .product-card .stock {
      color:#8ee7b4;
      font-size:12px;
      margin-top:8px;
    }

    .product-card .card-actions {
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin-top:13px;
    }

    .product-card .price-note {
      color:#7f8da1;
      font-size:11px;
      margin-top:10px;
    }

    button:disabled {
      opacity:.65;
      cursor:default;
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
