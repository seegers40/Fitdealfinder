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

/* =========================
   BASIS
========================= */

function text(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function money(product) {
  const price = Number(product.price);

  if (!Number.isFinite(price)) {
    return "Prijs onbekend";
  }

  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: product.currency || "EUR"
  }).format(price);
}

function validUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return /^https?:$/.test(url.protocol);
  } catch {
    return false;
  }
}

/* =========================
   PRODUCT KWALITEIT
========================= */

/*
 * Deze producten willen we NIET tonen.
 * Dit voorkomt o.a.:
 * - voedingsschema's
 * - drinkbekers
 * - kleding
 * - accessoires
 * - trainingsschema's
 */

const EXCLUDED_TERMS = [
  "voedingsschema",
  "voedingsschema's",
  "voedingsplan",
  "voedingsplannen",
  "meal plan",
  "mealplan",
  "diet plan",
  "dieetplan",
  "trainingsschema",
  "trainingsschema's",
  "trainingsplan",
  "workout plan",
  "workoutplan",

  "drinkbeker",
  "shaker",
  "shaker bottle",
  "waterfles",
  "water bottle",
  "drinkfles",
  "bidon",

  "t shirt",
  "t-shirt",
  "shirt",
  "hoodie",
  "trui",
  "broek",
  "short",
  "legging",
  "pet",
  "cap",
  "sokken",

  "tas",
  "sporttas",
  "gym bag",

  "handdoek",
  "handdoeken",

  "accessoire",
  "accessoires",

  "merchandise",
  "merch",

  "e book",
  "ebook",
  "pdf",
  "boek",
  "boekje",

  "schema op maat",
  "advies op maat",
  "coaching",
  "coachingspakket"
];

const SUPPLEMENT_TERMS = [
  "whey",
  "protein",
  "proteine",
  "eiwit",
  "casein",
  "caseïne",
  "isolate",
  "isolaat",
  "clear whey",
  "vegan protein",
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
  "nox",
  "citrulline",
  "beta alanine",
  "beta-alanine",

  "bcaa",
  "eaa",
  "amino",
  "amino acids",

  "gainer",
  "mass gainer",
  "weight gainer",
  "mass builder",

  "bcaa",
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
  "glucose",
  "dextrose",
  "maltodextrine",

  "carbo",
  "carbs",
  "koolhydraten",

  "supplement",
  "supplementen"
];

function productSearchText(product) {
  return normalize([
    product.name,
    product.brand,
    product.category,
    product.description,
    product.merchant_name
  ].join(" "));
}

function isExcludedProduct(product) {
  const name = normalize(product.name);
  const category = normalize(product.category);
  const description = normalize(product.description);

  const combined = [
    name,
    category,
    description
  ].join(" ");

  return EXCLUDED_TERMS.some(term => {
    const normalizedTerm = normalize(term);

    return (
      name.includes(normalizedTerm) ||
      category.includes(normalizedTerm) ||
      (
        normalizedTerm.length > 6 &&
        description.includes(normalizedTerm)
      )
    );
  });
}

function isSupplementProduct(product) {
  if (isExcludedProduct(product)) {
    return false;
  }

  const combined = productSearchText(product);

  return SUPPLEMENT_TERMS.some(term =>
    combined.includes(normalize(term))
  );
}

function productIsUsable(product) {
  if (!product) {
    return false;
  }

  if (!text(product.id)) {
    return false;
  }

  if (!text(product.name)) {
    return false;
  }

  if (!validUrl(product.product_url)) {
    return false;
  }

  if (isExcludedProduct(product)) {
    return false;
  }

  /*
   * Alleen echte supplementen.
   * Hierdoor verdwijnen bijvoorbeeld drinkbekers
   * en voedingsschema's uit de productweergave.
   */
  return isSupplementProduct(product);
}

/* =========================
   DOELEN
========================= */

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
      "fat burner",
      "fatburner",
      "thermogenic",
      "vitamin",
      "vitamine",
      "magnesium",
      "zinc",
      "zink"
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
      "creatine monohydraat",
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
      "caseïne",
      "creatine",
      "creatine monohydraat",
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
      "fat burner",
      "fatburner",
      "thermogenic",
      "mega calorie"
    ]
  }
};

function matchesGoal(product, goal) {
  if (!goal) {
    return true;
  }

  if (!productIsUsable(product)) {
    return false;
  }

  const rules = GOAL_RULES[goal];

  if (!rules) {
    return true;
  }

  const combined = productSearchText(product);

  const negativeMatch = rules.negative.some(term =>
    combined.includes(normalize(term))
  );

  if (negativeMatch) {
    return false;
  }

  return rules.positive.some(term =>
    combined.includes(normalize(term))
  );
}

/* =========================
   CATEGORIEËN
========================= */

const CATEGORY_RULES = {
  proteine: [
    "whey",
    "protein",
    "proteine",
    "eiwit",
    "isolate",
    "isolaat",
    "casein",
    "caseïne",
    "clear whey",
    "vegan protein",
    "plant protein",
    "egg protein",
    "beef protein"
  ],

  creatine: [
    "creatine",
    "creatine monohydraat",
    "creatine monohydrate"
  ],

  "pre-workout": [
    "pre workout",
    "pre-workout",
    "preworkout",
    "pump",
    "nox",
    "citrulline",
    "beta alanine",
    "beta-alanine"
  ],

  supplementen: [
    "supplement",
    "supplementen",
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
    "bcaa"
  ]
};

function matchesCategory(product, category) {
  if (!category) {
    return true;
  }

  if (!productIsUsable(product)) {
    return false;
  }

  const rules = CATEGORY_RULES[category];

  if (!rules) {
    return false;
  }

  const combined = productSearchText(product);

  return rules.some(term =>
    combined.includes(normalize(term))
  );
}

/* =========================
   SORTEREN
========================= */

function discountValue(product) {
  const value = Number(product.discount_percent);

  return Number.isFinite(value) ? value : 0;
}

function dealScore(product) {
  const value = Number(product.deal_score);

  return Number.isFinite(value) ? value : 0;
}

function sortProducts(products) {
  return [...products].sort((a, b) => {
    const discountDifference =
      discountValue(b) - discountValue(a);

    if (discountDifference !== 0) {
      return discountDifference;
    }

    return dealScore(b) - dealScore(a);
  });
}

/* =========================
   CART
========================= */

function loadCart() {
  try {
    const saved = localStorage.getItem(CART_KEY);

    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved);

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
    // localStorage kan geblokkeerd zijn
  }
}

function addToCart(product) {
  if (!productIsUsable(product)) {
    return;
  }

  const exists = state.cart.some(
    item => item.id === product.id
  );

  if (!exists) {
    state.cart.push(product);
    saveCart();
    renderCart();
    renderPlannerCart();
  }
}

function removeFromCart(id) {
  state.cart =
    state.cart.filter(
      product => product.id !== id
    );

  saveCart();
  renderCart();
  renderPlannerCart();
}

function cartTotal() {
  return state.cart.reduce(
    (total, product) =>
      total + Number(product.price || 0),
    0
  );
}

function cartProducts() {
  return state.cart.filter(productIsUsable);
}

function renderCart() {
  const existing =
    document.querySelector(
      "#site-cart"
    );

  if (existing) {
    existing.remove();
  }

  if (state.cart.length === 0) {
    return;
  }

  const cart =
    document.createElement("div");

  cart.id = "site-cart";

  cart.style.cssText = `
    position:fixed;
    right:18px;
    bottom:18px;
    z-index:9999;
    width:min(360px,calc(100vw - 36px));
    background:#101a2b;
    border:1px solid rgba(255,255,255,.12);
    border-radius:18px;
    padding:16px;
    box-shadow:0 20px 50px rgba(0,0,0,.4);
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

      <span style="
        color:#9ee6bd;
        font-weight:700;
      ">
        ${money({
          price: cartTotal(),
          currency:"EUR"
        })}
      </span>
    </div>

    <div>
      ${state.cart.map(product => `
        <div style="
          display:flex;
          justify-content:space-between;
          gap:10px;
          padding:8px 0;
          border-bottom:1px solid rgba(255,255,255,.07);
        ">
          <span style="
            color:#dce5ef;
            font-size:13px;
          ">
            ${escapeHtml(product.name)}
          </span>

          <button
            type="button"
            data-remove-cart="${escapeHtml(product.id)}"
            style="
              border:0;
              background:none;
              color:#ff8c8c;
              cursor:pointer;
            "
          >
            ×
          </button>
        </div>
      `).join("")}
    </div>
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

/* =========================
   HTML VEILIG MAKEN
========================= */

function escapeHtml(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   PRODUCT KAART
========================= */

function productCard(product) {
  const discount =
    discountValue(product);

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
        <div class="product-image" style="
          display:flex;
          align-items:center;
          justify-content:center;
          background:#172338;
          color:#8fa0b7;
          font-size:32px;
        ">
          💪
        </div>
      `;

  const goals =
    Array.isArray(product.goals)
      ? product.goals
      : [];

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
          margin-top:8px;
          display:flex;
          align-items:center;
          gap:8px;
          flex-wrap:wrap;
        ">
          <strong style="
            font-size:20px;
            color:#fff;
          ">
            ${money(product)}
          </strong>

          ${
            product.old_price &&
            Number(product.old_price) >
            Number(product.price)
              ? `
                <span style="
                  color:#8290a4;
                  text-decoration:line-through;
                  font-size:13px;
                ">
                  ${money({
                    price:product.old_price,
                    currency:product.currency || "EUR"
                  })}
                </span>
              `
              : ""
          }

          ${
            discount > 0
              ? `
                <span style="
                  color:#8ee7b4;
                  font-weight:700;
                  font-size:12px;
                ">
                  -${discount}%
                </span>
              `
              : ""
          }
        </div>

        <div style="
          margin-top:8px;
          color:#8ee7b4;
          font-size:12px;
        ">
          ${product.in_stock ? "Op voorraad" : "Niet op voorraad"}
        </div>

        ${
          goals.length
            ? `
              <div style="
                display:flex;
                flex-wrap:wrap;
                gap:5px;
                margin-top:9px;
              ">
                ${goals.map(goal => `
                  <span style="
                    padding:4px 7px;
                    border-radius:999px;
                    background:#18283a;
                    color:#b8c6d8;
                    font-size:10px;
                  ">
                    ${escapeHtml(
                      goal
                        .replace(
                          "lean-bulk",
                          "Lean Bulk"
                        )
                        .replace(
                          "cut",
                          "Cut"
                        )
                        .replace(
                          "bulk",
                          "Bulk"
                        )
                    )}
                  </span>
                `).join("")}
              </div>
            `
            : ""
        }

        <div style="
          margin-top:12px;
          color:#7f8da1;
          font-size:11px;
        ">
          Prijsindicatie · controleer de actuele prijs bij de winkel
        </div>

        <div style="
          display:flex;
          gap:8px;
          margin-top:13px;
          flex-wrap:wrap;
        ">

          <a
            href="/go/${encodeURIComponent(product.id)}"
            class="button primary"
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

      </div>
    </article>
  `;
}

/* =========================
   PRODUCTEN LADEN
========================= */

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
        headers: {
          Accept:"application/json"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Product API fout ${response.status}`
    );
  }

  return response.json();
}

async function loadProducts() {
  state.loading = true;

  updateResultCount();

  try {
    const all = [];

    let offset = 0;

    while (
      all.length < MAX_PRODUCTS
    ) {
      const data =
        await fetchProductsPage(
          offset
        );

      const products =
        Array.isArray(data.products)
          ? data.products
          : [];

      if (
        products.length === 0
      ) {
        break;
      }

      all.push(...products);

      if (
        products.length <
        API_PAGE_SIZE
      ) {
        break;
      }

      offset += products.length;
    }

    /*
     * Eerst alle slechte producttypes eruit.
     */
    state.products =
      all.filter(
        productIsUsable
      );

    state.products =
      sortProducts(
        state.products
      );

    applyFilters();

  } catch (error) {
    console.error(
      "Producten laden mislukt:",
      error
    );

    const grid =
      document.querySelector(
        "#products-grid"
      );

    if (grid) {
      grid.innerHTML = `
        <div style="
          grid-column:1/-1;
          padding:25px;
          border:1px solid rgba(255,255,255,.1);
          border-radius:16px;
          color:#c6d0dd;
        ">
          Producten konden tijdelijk niet worden geladen.
          Vernieuw de pagina opnieuw.
        </div>
      `;
    }

  } finally {
    state.loading = false;

    updateResultCount();
  }
}

/* =========================
   FILTEREN
========================= */

function applyFilters() {
  const search =
    normalize(state.search);

  const goal =
    normalize(state.goal);

  const category =
    normalize(state.category);

  state.filtered =
    state.products.filter(
      product => {

        if (search) {
          const searchable =
            productSearchText(
              product
            );

          if (
            !searchable.includes(
              search
            )
          ) {
            return false;
          }
        }

        if (
          category &&
          !matchesCategory(
            product,
            category
          )
        ) {
          return false;
        }

        if (
          goal &&
          !matchesGoal(
            product,
            goal
          )
        ) {
          return false;
        }

        return true;
      }
    );

  state.visibleCount =
    PRODUCTS_PER_VIEW;

  renderProducts();
  updateResultCount();
}

function renderProducts() {
  const grid =
    document.querySelector(
      "#products-grid"
    );

  if (!grid) {
    return;
  }

  const visible =
    state.filtered.slice(
      0,
      state.visibleCount
    );

  if (
    visible.length === 0
  ) {
    grid.innerHTML = `
      <div style="
        grid-column:1/-1;
        padding:30px 10px;
        text-align:center;
        color:#9aa8ba;
      ">
        Geen geschikte supplementen gevonden.
        Probeer een ander doel of een andere categorie.
      </div>
    `;

    return;
  }

  grid.innerHTML =
    visible
      .map(productCard)
      .join("");

  bindProductButtons();

  if (
    state.visibleCount <
    state.filtered.length
  ) {
    const more =
      document.createElement(
        "button"
      );

    more.type = "button";
    more.className =
      "button secondary";

    more.style.cssText = `
      display:block;
      margin:20px auto;
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

    grid.parentElement
      ?.appendChild(more);
  }
}

function bindProductButtons() {
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

          if (product) {
            addToCart(product);

            button.textContent =
              "✓ In mandje";

            setTimeout(() => {
              button.textContent =
                "+ Mandje";
            }, 1200);
          }
        }
      );
    });
}

function updateResultCount() {
  const count =
    document.querySelector(
      "#product-count"
    );

  if (!count) {
    return;
  }

  if (state.loading) {
    count.textContent =
      "Producten laden…";

    return;
  }

  count.textContent =
    `${state.filtered.length} producten`;
}

/* =========================
   DOELEN & CATEGORIEËN UI
========================= */

function bindFilters() {
  document
    .querySelectorAll(
      "[data-goal]"
    )
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
            .querySelector(
              "#deals"
            )
            ?.scrollIntoView({
              behavior:"smooth",
              block:"start"
            });
        }
      );
    });

  document
    .querySelectorAll(
      "[data-category]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const category =
            button.dataset.category ||
            "";

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
            .querySelector(
              "#deals"
            )
            ?.scrollIntoView({
              behavior:"smooth",
              block:"start"
            });
        }
      );
    });
}

/* =========================
   ZOEKEN
========================= */

function bindSearch() {
  const form =
    document.querySelector(
      "#search-form"
    );

  const input =
    document.querySelector(
      "#search"
    );

  if (!input) {
    return;
  }

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
        .querySelector(
          "#deals"
        )
        ?.scrollIntoView({
          behavior:"smooth"
        });
    }
  );
}

/* =========================
   PLANNER
========================= */

function plannerProductHtml(product) {
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

      <div style="
        min-width:0;
      ">

        <div style="
          color:#fff;
          font-weight:700;
          font-size:13px;
        ">
          ${escapeHtml(product.name)}
        </div>

        <div style="
          margin-top:4px;
          color:#8ee7b4;
          font-weight:700;
        ">
          ${money(product)}
        </div>

        <div style="
          margin-top:3px;
          color:#8290a4;
          font-size:11px;
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

function bindPlannerAddButtons(
  container
) {
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
        }
      );
    });
}

function renderPlannerCart() {
  const result =
    document.querySelector(
      "#planner-result"
    );

  if (!result) {
    return;
  }

  const existing =
    result.querySelector(
      ".planner-cart"
    );

  if (existing) {
    existing.remove();
  }

  const products =
    cartProducts();

  /*
   * BELANGRIJK:
   * Een lege winkelmand mag het
   * planner-resultaat NIET wissen.
   */
  if (
    products.length === 0
  ) {
    return;
  }

  const cart =
    document.createElement(
      "div"
    );

  cart.className =
    "planner-cart";

  cart.style.cssText = `
    margin-top:18px;
    padding:15px;
    border-radius:15px;
    background:#0d1727;
    border:1px solid rgba(142,231,180,.2);
  `;

  cart.innerHTML = `
    <div style="
      display:flex;
      justify-content:space-between;
      gap:10px;
      margin-bottom:10px;
    ">
      <strong style="color:#fff">
        🛒 Jouw boodschappenmand
      </strong>

      <strong style="color:#8ee7b4">
        ${money({
          price:cartTotal(),
          currency:"EUR"
        })}
      </strong>
    </div>

    ${products.map(product => `
      <div style="
        display:flex;
        justify-content:space-between;
        gap:10px;
        padding:7px 0;
        border-bottom:1px solid rgba(255,255,255,.06);
      ">
        <span style="
          color:#c7d2df;
          font-size:12px;
        ">
          ${escapeHtml(product.name)}
        </span>

        <button
          type="button"
          data-planner-remove="${escapeHtml(product.id)}"
          style="
            background:none;
            border:0;
            color:#ff9696;
            cursor:pointer;
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

      const budgetRaw =
        form.querySelector(
          "[name='budget']"
        )?.value || "";

      const budget =
        Number(budgetRaw);

      let candidates =
        state.products.filter(
          productIsUsable
        );

      /*
       * Gebruik de echte doelclassificatie,
       * niet simpelweg product.goals.
       */
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
              Number(
                product.price
              ) <= budget
          );
      }

      candidates =
        sortProducts(
          candidates
        ).slice(0, 8);

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
          <div>
            Geen geschikte producten gevonden
            voor deze combinatie van doel en budget.
            Probeer een hoger budget of een ander doel.
          </div>
        `;

        renderPlannerCart();

        return;
      }

      result.innerHTML = `
        <div>
          <strong style="color:#fff">
            ${candidates.length}
            passende producten
          </strong>

          <div style="
            margin-top:5px;
            color:#aebaca;
            font-size:12px;
          ">
            Kies hieronder producten voor je boodschappenmand.
          </div>
        </div>

        <div style="
          margin-top:10px;
        ">
          ${candidates
            .map(
              plannerProductHtml
            )
            .join("")}
        </div>
      `;

      bindPlannerAddButtons(
        result
      );

      renderPlannerCart();
    }
  );
}

/* =========================
   AI COACH
========================= */

function bindAI() {
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
    async event => {

      event.preventDefault();

      const message =
        input.value.trim();

      if (!message) {
        return;
      }

      output.innerHTML = `
        <div style="color:#aebaca">
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
                "Accept":
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
            white-space:pre-wrap;
            color:#d9e3ef;
            line-height:1.6;
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
          <div style="color:#ffaaaa">
            De AI Coach kon momenteel geen antwoord geven.
            Probeer het opnieuw.
          </div>
        `;
      }
    }
  );
}

/* =========================
   COACH NAAR BOVEN
========================= */

function moveCoachBeforeDeals() {
  const coach =
    document.querySelector(
      "#coach"
    );

  const deals =
    document.querySelector(
      "#deals"
    );

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

/* =========================
   CSS VOOR PRODUCTAFBEELDINGEN
========================= */

function injectProductStyles() {
  if (
    document.querySelector(
      "#fitdeal-app-styles"
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
      max-width:100%;
      object-fit:contain;
      display:block;
    }

    .planner-products {
      margin-top:10px;
    }

    #site-cart .button,
    .planner-cart button {
      -webkit-tap-highlight-color:transparent;
    }
  `;

  document.head.appendChild(
    style
  );
}

/* =========================
   START
========================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    injectProductStyles();

    moveCoachBeforeDeals();

    bindSearch();
    bindFilters();
    bindPlanner();
    bindAI();

    renderCart();

    loadProducts();
  }
);
