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
  cart: loadCart()
};

/* =========================
   HELPERS
========================= */

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return [...document.querySelectorAll(selector)];
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function productText(product) {
  return normalize([
    product.name,
    product.brand,
    product.merchant_name,
    product.category,
    product.description,
    Array.isArray(product.goals) ? product.goals.join(" ") : product.goals
  ].join(" "));
}

function price(product) {
  const n = Number(product.price);
  return Number.isFinite(n) ? n : 0;
}

function money(value, currency = "EUR") {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency || "EUR"
  }).format(Number(value) || 0);
}

/* =========================
   PRODUCT VALIDATION
========================= */

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
  if (!product.product_url && !product.affiliate_url) return false;

  const text = productText(product);

  return !BAD_WORDS.some(word => text.includes(normalize(word)));
}

/* =========================
   GOAL FILTERING
========================= */

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
  "cafeine",
  "pre workout",
  "pre-workout"
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
  "creatine monohydrate",
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
  "creatine monohydrate",
  "pre workout",
  "pre-workout",
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
  "voeding",
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
  return words.some(word => text.includes(normalize(word)));
}

function productGoals(product) {
  const raw = product.goals;

  if (Array.isArray(raw)) {
    return raw.map(normalize);
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(normalize);
      }
    } catch (_) {}

    return raw
      .split(",")
      .map(normalize)
      .filter(Boolean);
  }

  return [];
}

function matchesGoal(product, goal) {
  if (!goal) return true;

  const text = productText(product);
  const goals = productGoals(product);

  if (goals.includes(normalize(goal))) {
    return true;
  }

  /*
    Belangrijk:
    algemene supplementen mogen bij alle fitnessdoelen
    zichtbaar blijven. Daardoor wordt Lean Bulk niet leeg.
  */
  const isGeneralSupplement =
    hasAny(text, GENERAL_SUPPLEMENT_WORDS);

  if (goal === "cut") {
    return (
      hasAny(text, CUT_WORDS) ||
      isGeneralSupplement
    );
  }

  if (goal === "bulk") {
    return (
      hasAny(text, BULK_WORDS) ||
      isGeneralSupplement
    );
  }

  if (goal === "lean-bulk") {
    return (
      hasAny(text, LEAN_BULK_WORDS) ||
      isGeneralSupplement
    );
  }

  return true;
}

/* =========================
   CATEGORY FILTERING
========================= */

function matchesCategory(product, category) {
  if (!category) return true;

  const text = productText(product);

  if (category === "proteine") {
    return hasAny(text, [
      "protein",
      "proteine",
      "whey",
      "casein",
      "caseine",
      "isolate",
      "isolaat",
      "gainer",
      "mass"
    ]);
  }

  if (category === "creatine") {
    return text.includes("creatine");
  }

  if (category === "pre-workout") {
    return hasAny(text, [
      "pre workout",
      "pre-workout",
      "preworkout",
      "pump",
      "citrulline",
      "beta alanine"
    ]);
  }

  if (category === "supplementen") {
    return hasAny(text, GENERAL_SUPPLEMENT_WORDS);
  }

  return true;
}

/* =========================
   SEARCH
========================= */

function matchesSearch(product, query) {
  if (!query) return true;

  const words = normalize(query)
    .split(/\s+/)
    .filter(Boolean);

  const text = productText(product);

  return words.every(word => text.includes(word));
}

/* =========================
   FILTER PIPELINE
========================= */

function applyFilters() {
  const query = normalize(state.search);

  state.filtered = state.products.filter(product => {
    if (!isUsableProduct(product)) return false;
    if (!matchesSearch(product, query)) return false;
    if (!matchesGoal(product, state.goal)) return false;
    if (!matchesCategory(product, state.category)) return false;

    return true;
  });

  state.visibleCount = PRODUCTS_PER_VIEW;

  renderProducts();
}

/* =========================
   API LOADING
========================= */

async function loadProducts() {
  if (state.loading) return;

  state.loading = true;

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
          "Accept": "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Product API: ${response.status}`);
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
      if (product && product.id) {
        unique.set(String(product.id), product);
      }
    }

    state.products = [...unique.values()];

    applyFilters();
  } catch (error) {
    console.error("Product loading failed:", error);

    const grid = $("#products-grid");

    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>Producten konden niet worden geladen</h3>
          <p>Ververs de pagina en probeer opnieuw.</p>
        </div>
      `;
    }
  } finally {
    state.loading = false;
  }
}

/* =========================
   PRODUCT CARD
========================= */

function productCard(product) {
  const oldPrice =
    Number(product.old_price) > Number(product.price)
      ? `<span class="old-price">${money(
          product.old_price,
          product.currency
        )}</span>`
      : "";

  const discount =
    Number(product.discount_percent) > 0
      ? `<span class="discount">-${Math.round(
          Number(product.discount_percent)
        )}%</span>`
      : "";

  const image = product.image_url
    ? `
      <img
        src="${escapeHtml(product.image_url)}"
        alt="${escapeHtml(product.name)}"
        loading="lazy"
        onerror="this.style.display='none'"
      >
    `
    : "";

  const stock =
    Number(product.in_stock) === 1
      ? `<span class="stock">Op voorraad</span>`
      : `<span class="stock out">Niet op voorraad</span>`;

  return `
    <article class="product-card">

      <div class="product-image">
        ${image}
      </div>

      <div class="product-content">

        <div class="product-brand">
          ${escapeHtml(product.brand || product.merchant_name || "")}
        </div>

        <h3>${escapeHtml(product.name)}</h3>

        <div class="product-price">
          <strong>${money(product.price, product.currency)}</strong>
          ${oldPrice}
          ${discount}
        </div>

        <div class="product-meta">
          ${stock}
          <span>${escapeHtml(product.merchant_name || "")}</span>
        </div>

        <div class="product-actions">

          <a
            class="deal-button"
            href="/go/${encodeURIComponent(product.id)}"
          >
            Bekijk deal
          </a>

          <button
            type="button"
            class="cart-button"
            data-add-cart="${escapeHtml(String(product.id))}"
          >
            🛒 In winkelmand
          </button>

        </div>

      </div>
    </article>
  `;
}

/* =========================
   RENDER PRODUCTS
========================= */

function renderProducts() {
  const grid = $("#products-grid");
  if (!grid) return;

  const visible = state.filtered.slice(
    0,
    state.visibleCount
  );

  if (!visible.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>Geen producten gevonden</h3>
        <p>
          Probeer een andere zoekterm of kies een ander doel.
        </p>
      </div>
    `;
  } else {
    grid.innerHTML = visible
      .map(productCard)
      .join("");
  }

  const count = $("#product-count");

  if (count) {
    count.textContent =
      `${state.filtered.length} producten`;
  }

  renderLoadMore();
  updateGoalButtons();
}

/* =========================
   LOAD MORE
========================= */

function renderLoadMore() {
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

  if (!grid) return;

  const button = document.createElement("button");

  button.id = "load-more-products";
  button.className = "load-more";
  button.type = "button";
  button.textContent = "Meer producten laden";

  button.addEventListener("click", () => {
    state.visibleCount += PRODUCTS_PER_VIEW;
    renderProducts();
  });

  grid.parentElement?.appendChild(button);
}

/* =========================
   SEARCH EVENTS
========================= */

function setupSearch() {
  const form = $("#search-form");
  const input = $("#search");

  if (!input) return;

  input.addEventListener("input", () => {
    state.search = input.value;
    applyFilters();
  });

  input.addEventListener("search", () => {
    state.search = input.value;
    applyFilters();
  });

  if (form) {
    form.addEventListener("submit", event => {
      event.preventDefault();

      state.search = input.value;
      applyFilters();

      const deals = $("#deals");

      if (deals) {
        deals.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });
  }
}

/* =========================
   GOAL BUTTONS
========================= */

function setupGoals() {
  $all("[data-goal]").forEach(button => {
    button.addEventListener("click", () => {
      state.goal =
        normalize(button.dataset.goal || "");

      state.category = "";

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

function updateGoalButtons() {
  $all("[data-goal]").forEach(button => {
    const value =
      normalize(button.dataset.goal || "");

    button.classList.toggle(
      "active",
      value === state.goal
    );
  });
}

/* =========================
   CATEGORY BUTTONS
========================= */

function setupCategories() {
  $all("[data-category]").forEach(button => {
    button.addEventListener("click", () => {
      state.category =
        normalize(button.dataset.category || "");

      state.goal = "";

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

/* =========================
   CART
========================= */

function loadCart() {
  try {
    const saved =
      localStorage.getItem(CART_KEY);

    if (!saved) return [];

    const parsed = JSON.parse(saved);

    return Array.isArray(parsed)
      ? parsed
      : [];
  } catch (error) {
    console.warn("Cart load failed:", error);
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
    console.warn("Cart save failed:", error);
  }

  renderCart();
}

function addToCart(productId) {
  const product =
    state.products.find(
      item => String(item.id) === String(productId)
    );

  if (!product) return;

  const existing =
    state.cart.find(
      item => String(item.id) === String(product.id)
    );

  if (existing) {
    existing.quantity =
      Number(existing.quantity || 1) + 1;
  } else {
    state.cart.push({
      id: product.id,
      name: product.name,
      price: Number(product.price) || 0,
      currency: product.currency || "EUR",
      merchant_name: product.merchant_name || "",
      product_url:
        product.product_url ||
        product.affiliate_url ||
        "#",
      quantity: 1
    });
  }

  saveCart();

  showCartMessage(
    `${product.name} is toegevoegd aan je winkelmand.`
  );
}

function removeFromCart(productId) {
  state.cart =
    state.cart.filter(
      item =>
        String(item.id) !== String(productId)
    );

  saveCart();
}

function changeCartQuantity(productId, amount) {
  const item =
    state.cart.find(
      product =>
        String(product.id) === String(productId)
    );

  if (!item) return;

  item.quantity =
    Math.max(
      1,
      Number(item.quantity || 1) + amount
    );

  saveCart();
}

function cartTotal() {
  return state.cart.reduce(
    (total, item) =>
      total +
      Number(item.price || 0) *
      Number(item.quantity || 1),
    0
  );
}

function renderCart() {
  const cart = $("#cart");

  if (!cart) return;

  if (!state.cart.length) {
    cart.innerHTML = `
      <div class="cart-empty">
        <strong>Je winkelmand is leeg</strong>
        <p>Voeg producten toe om hier je selectie te zien.</p>
      </div>
    `;
    return;
  }

  cart.innerHTML = `
    <div class="cart-items">

      ${state.cart.map(item => `
        <div class="cart-item">

          <div>
            <strong>
              ${escapeHtml(item.name)}
            </strong>

            <small>
              ${escapeHtml(item.merchant_name || "")}
            </small>

            <div>
              ${money(item.price, item.currency)}
              × ${item.quantity}
            </div>
          </div>

          <div class="cart-item-actions">

            <button
              type="button"
              data-cart-minus="${escapeHtml(String(item.id))}"
            >−</button>

            <span>${item.quantity}</span>

            <button
              type="button"
              data-cart-plus="${escapeHtml(String(item.id))}"
            >+</button>

            <button
              type="button"
              data-cart-remove="${escapeHtml(String(item.id))}"
            >
              Verwijder
            </button>

          </div>

        </div>
      `).join("")}

    </div>

    <div class="cart-total">
      <strong>Totaal indicatie</strong>
      <strong>
        ${money(cartTotal(), "EUR")}
      </strong>
    </div>

    <p class="cart-note">
      Prijzen zijn indicatief. Controleer de actuele prijs
      bij de winkel voordat je bestelt.
    </p>
  `;
}

function setupCartEvents() {
  document.addEventListener("click", event => {
    const add =
      event.target.closest("[data-add-cart]");

    if (add) {
      addToCart(add.dataset.addCart);
      return;
    }

    const remove =
      event.target.closest("[data-cart-remove]");

    if (remove) {
      removeFromCart(remove.dataset.cartRemove);
      return;
    }

    const plus =
      event.target.closest("[data-cart-plus]");

    if (plus) {
      changeCartQuantity(
        plus.dataset.cartPlus,
        1
      );
      return;
    }

    const minus =
      event.target.closest("[data-cart-minus]");

    if (minus) {
      changeCartQuantity(
        minus.dataset.cartMinus,
        -1
      );
    }
  });
}

function showCartMessage(message) {
  let box = $("#cart-message");

  if (!box) {
    box = document.createElement("div");
    box.id = "cart-message";
    box.className = "cart-message";
    document.body.appendChild(box);
  }

  box.textContent = message;
  box.classList.add("show");

  clearTimeout(box._timer);

  box._timer = setTimeout(() => {
    box.classList.remove("show");
  }, 2500);
}

/* =========================
   PLANNER
========================= */

function setupPlanner() {
  const form = $("#planner-form");

  if (!form) return;

  form.addEventListener("submit", event => {
    event.preventDefault();

    const goal =
      normalize(
        form.querySelector("[name='goal']")?.value
      );

    const budget =
      Number(
        form.querySelector("[name='budget']")?.value
      );

    const result = $("#planner-result");

    if (!result) return;

    if (!budget || budget <= 0) {
      result.innerHTML = `
        <p>Vul een geldig budget in.</p>
      `;
      return;
    }

    let candidates =
      state.products.filter(product =>
        isUsableProduct(product) &&
        matchesGoal(product, goal)
      );

    candidates.sort((a, b) => {
      const scoreA =
        Number(a.deal_score || 0);

      const scoreB =
        Number(b.deal_score || 0);

      return scoreB - scoreA;
    });

    const selected = [];

    let total = 0;

    for (const product of candidates) {
      const p = price(product);

      if (p <= 0) continue;

      if (total + p <= budget) {
        selected.push(product);
        total += p;
      }

      if (selected.length >= 5) {
        break;
      }
    }

    if (!selected.length) {
      result.innerHTML = `
        <div class="planner-empty">
          <h3>Geen passende combinatie gevonden</h3>
          <p>
            Probeer een iets hoger budget.
          </p>
        </div>
      `;
      return;
    }

    result.innerHTML = `
      <div class="planner-success">

        <h3>Jouw ${escapeHtml(goal || "fitness")} selectie</h3>

        <div class="planner-products">
          ${selected.map(product => `
            <div class="planner-product">

              <div>
                <strong>
                  ${escapeHtml(product.name)}
                </strong>

                <small>
                  ${escapeHtml(product.merchant_name || "")}
                </small>
              </div>

              <div>
                ${money(product.price, product.currency)}

                <button
                  type="button"
                  class="cart-button"
                  data-add-cart="${escapeHtml(String(product.id))}"
                >
                  🛒
                </button>
              </div>

            </div>
          `).join("")}
        </div>

        <div class="planner-total">
          Totaal: <strong>${money(total, "EUR")}</strong>
          <span>van ${money(budget, "EUR")}</span>
        </div>

      </div>
    `;
  });
}

/* =========================
   AI COACH
========================= */

function setupAI() {
  const form = $("#ai-form");
  const input = $("#ai-input");
  const output = $("#ai-output");

  if (!form || !input || !output) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const message =
      input.value.trim();

    if (!message) return;

    output.innerHTML =
      `<p>Even nadenken...</p>`;

    try {
      const response =
        await fetch(API_AI, {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            message
          })
        });

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          "AI request failed"
        );
      }

      output.innerHTML =
        `<p>${escapeHtml(
          data.reply ||
          data.message ||
          "Geen antwoord ontvangen."
        ).replace(/\n/g, "<br>")}</p>`;

    } catch (error) {
      console.error(error);

      output.innerHTML = `
        <p>
          De AI Coach is tijdelijk niet beschikbaar.
        </p>
      `;
    }
  });
}

/* =========================
   HTML ESCAPING
========================= */

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   START
========================= */

document.addEventListener("DOMContentLoaded", () => {
  setupSearch();
  setupGoals();
  setupCategories();
  setupCartEvents();
  setupPlanner();
  setupAI();

  renderCart();
  loadProducts();
});
