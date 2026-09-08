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
   BASIS HELPERS
========================================================= */

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

function price(product) {
  const value = Number(product?.price);
  return Number.isFinite(value) ? value : 0;
}

function money(value, currency = "EUR") {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency || "EUR"
  }).format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasAny(text, words) {
  const value = normalize(text);

  return words.some(word =>
    value.includes(normalize(word))
  );
}

/* =========================================================
   PRODUCT FILTERING
========================================================= */

const BAD_WORDS = [
  "drinkbeker",
  "drink beker",
  "shaker cup",
  "waterfles",
  "water fles",
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
  "gym tas",
  "sporttas",
  "voedingsschema",
  "voedingsplan",
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

  const productUrl =
    product.product_url ||
    product.affiliate_url;

  if (!productUrl) return false;

  const text = productText(product);

  return !BAD_WORDS.some(word =>
    text.includes(normalize(word))
  );
}

/* =========================================================
   DOELEN
========================================================= */

const CUT_WORDS = [
  "cut",
  "cutting",
  "fat burner",
  "fatburner",
  "fat burner",
  "thermogenic",
  "weight loss",
  "gewichtsverlies",
  "afvallen",
  "l-carnitine",
  "carnitine",
  "cla",
  "caffeine",
  "cafeine",
  "green tea",
  "groene thee"
];

const BULK_WORDS = [
  "bulk",
  "bulking",
  "mass",
  "mass gainer",
  "massgainer",
  "gainer",
  "weight gainer",
  "weightgainer",
  "calorie",
  "calorien",
  "muscle gain",
  "weight gain",
  "hard gainer"
];

const LEAN_BULK_WORDS = [
  "lean bulk",
  "lean-bulk",
  "lean mass",
  "muscle",
  "muscle gain",
  "spier",
  "spieren",
  "protein",
  "proteine",
  "whey",
  "casein",
  "caseine",
  "isolate",
  "isolaat",
  "creatine",
  "creatine monohydrate",
  "amino",
  "bcaa",
  "pre workout",
  "pre-workout",
  "citrulline",
  "beta alanine"
];

const GENERAL_SUPPLEMENT_WORDS = [
  "protein",
  "proteine",
  "whey",
  "casein",
  "caseine",
  "isolate",
  "isolaat",
  "creatine",
  "creatine monohydrate",
  "pre workout",
  "pre-workout",
  "preworkout",
  "bcaa",
  "amino",
  "amino acid",
  "vitamin",
  "vitamine",
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
  "voeding",
  "mass",
  "gainer",
  "caffeine",
  "cafeine",
  "carnitine",
  "l-carnitine",
  "beta alanine",
  "citrulline",
  "pump",
  "intra workout",
  "intra-workout",
  "post workout",
  "post-workout"
];

function productGoals(product) {
  const raw = product?.goals;

  if (Array.isArray(raw)) {
    return raw
      .map(normalize)
      .filter(Boolean);
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed
          .map(normalize)
          .filter(Boolean);
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

  const selectedGoal = normalize(goal);
  const text = productText(product);
  const goals = productGoals(product);

  /*
    Eerst kijken naar het doelveld uit de database.
  */
  if (
    goals.includes(selectedGoal) ||
    goals.includes(selectedGoal.replace("-", " "))
  ) {
    return true;
  }

  const isCutProduct =
    hasAny(text, CUT_WORDS);

  const isBulkProduct =
    hasAny(text, BULK_WORDS);

  const isLeanBulkProduct =
    hasAny(text, LEAN_BULK_WORDS);

  const isGeneralSupplement =
    hasAny(text, GENERAL_SUPPLEMENT_WORDS);

  /*
    CUT
    Geen mass gainers bij cut.
  */
  if (selectedGoal === "cut") {
    if (isBulkProduct) {
      return false;
    }

    return (
      isCutProduct ||
      isGeneralSupplement
    );
  }

  /*
    BULK
    Geen duidelijke fat burners bij bulk.
  */
  if (selectedGoal === "bulk") {
    if (isCutProduct && !isGeneralSupplement) {
      return false;
    }

    return (
      isBulkProduct ||
      isGeneralSupplement
    );
  }

  /*
    LEAN BULK
    Geen klassieke mass gainers.
    Wel eiwit, creatine, pre-workout,
    spierproducten en algemene supplementen.
  */
  if (
    selectedGoal === "lean-bulk" ||
    selectedGoal === "lean bulk"
  ) {
    if (isBulkProduct) {
      return false;
    }

    return (
      isLeanBulkProduct ||
      isGeneralSupplement
    );
  }

  return true;
}

/* =========================================================
   CATEGORIEËN
========================================================= */

function matchesCategory(product, category) {
  if (!category) return true;

  const selectedCategory =
    normalize(category);

  const text =
    productText(product);

  if (selectedCategory === "proteine") {
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

  if (selectedCategory === "creatine") {
    return text.includes("creatine");
  }

  if (selectedCategory === "pre-workout") {
    return hasAny(text, [
      "pre workout",
      "pre-workout",
      "preworkout",
      "pump",
      "citrulline",
      "beta alanine"
    ]);
  }

  if (selectedCategory === "supplementen") {
    return hasAny(
      text,
      GENERAL_SUPPLEMENT_WORDS
    );
  }

  return true;
}

/* =========================================================
   ZOEKEN
========================================================= */

function matchesSearch(product, query) {
  if (!query) return true;

  const searchWords =
    normalize(query)
      .split(/\s+/)
      .filter(Boolean);

  const text =
    productText(product);

  /*
    Alle woorden van de zoekopdracht
    moeten ergens in het product voorkomen.
  */
  return searchWords.every(word =>
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
    state.products.filter(product => {

      if (!isUsableProduct(product)) {
        return false;
      }

      if (!matchesSearch(product, query)) {
        return false;
      }

      if (!matchesGoal(product, state.goal)) {
        return false;
      }

      if (!matchesCategory(product, state.category)) {
        return false;
      }

      return true;
    });

  /*
    Beste deals eerst.
  */
  state.filtered.sort((a, b) => {
    const scoreA =
      Number(a.deal_score || 0);

    const scoreB =
      Number(b.deal_score || 0);

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    return price(a) - price(b);
  });

  state.visibleCount =
    PRODUCTS_PER_VIEW;

  renderProducts();
}

/* =========================================================
   PRODUCTEN LADEN
========================================================= */

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

      const response =
        await fetch(url, {
          headers: {
            Accept: "application/json"
          }
        });

      if (!response.ok) {
        throw new Error(
          `Product API: ${response.status}`
        );
      }

      const data =
        await response.json();

      let batch = [];

      if (Array.isArray(data)) {
        batch = data;
      } else if (
        Array.isArray(data.products)
      ) {
        batch = data.products;
      } else if (
        Array.isArray(data.data)
      ) {
        batch = data.data;
      }

      products.push(...batch);

      /*
        Als de API minder dan één volledige pagina
        terugstuurt, zijn we klaar.
      */
      if (batch.length < PAGE_SIZE) {
        break;
      }

      if (products.length >= MAX_PRODUCTS) {
        break;
      }
    }

    /*
      Dubbele producten verwijderen.
    */
    const unique =
      new Map();

    for (const product of products) {
      if (
        product &&
        product.id
      ) {
        unique.set(
          String(product.id),
          product
        );
      }
    }

    state.products =
      [...unique.values()];

    console.log(
      "FitDealFinder producten geladen:",
      state.products.length
    );

    applyFilters();

  } catch (error) {
    console.error(
      "Product loading failed:",
      error
    );

    const grid =
      $("#products-grid");

    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>Producten konden niet worden geladen</h3>
          <p>
            Ververs de pagina en probeer opnieuw.
          </p>
        </div>
      `;
    }

  } finally {
    state.loading = false;
  }
}

/* =========================================================
   PRODUCT KAART
========================================================= */

function productCard(product) {
  const currentPrice =
    price(product);

  const oldPriceValue =
    Number(product.old_price);

  const oldPrice =
    Number.isFinite(oldPriceValue) &&
    oldPriceValue > currentPrice
      ? `
        <span class="old-price">
          ${money(
            oldPriceValue,
            product.currency
          )}
        </span>
      `
      : "";

  const discountValue =
    Number(product.discount_percent);

  const discount =
    Number.isFinite(discountValue) &&
    discountValue > 0
      ? `
        <span class="discount">
          -${Math.round(discountValue)}%
        </span>
      `
      : "";

  const image =
    product.image_url
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
      ? `
        <span class="stock">
          Op voorraad
        </span>
      `
      : `
        <span class="stock out">
          Niet op voorraad
        </span>
      `;

  return `
    <article
      class="product-card"
      data-product-id="${escapeHtml(String(product.id))}"
    >

      <div class="product-image">
        ${image}
      </div>

      <div class="product-content">

        <div class="product-brand">
          ${escapeHtml(
            product.brand ||
            product.merchant_name ||
            ""
          )}
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

          ${oldPrice}

          ${discount}

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
              product.id
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
   PRODUCTEN RENDEREN
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
          Geen producten gevonden
        </h3>

        <p>
          Probeer een andere zoekterm
          of kies een ander doel.
        </p>

      </div>
    `;

  } else {

    grid.innerHTML =
      visible
        .map(productCard)
        .join("");
  }

  const count =
    $("#product-count");

  if (count) {
    count.textContent =
      `${state.filtered.length} producten`;
  }

  renderLoadMore();
  updateGoalButtons();
}

/* =========================================================
   MEER PRODUCTEN
========================================================= */

function renderLoadMore() {
  const existing =
    $("#load-more-products");

  if (existing) {
    existing.remove();
  }

  if (
    state.visibleCount >=
    state.filtered.length
  ) {
    return;
  }

  const grid =
    $("#products-grid");

  if (!grid) return;

  const button =
    document.createElement("button");

  button.id =
    "load-more-products";

  button.className =
    "load-more";

  button.type =
    "button";

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

  const parent =
    grid.parentElement;

  if (parent) {
    parent.appendChild(button);
  }
}

/* =========================================================
   ZOEKFORMULIER
========================================================= */

function setupSearch() {
  const form =
    $("#search-form");

  const input =
    $("#search");

  if (!input) return;

  input.addEventListener(
    "input",
    () => {
      state.search =
        input.value;

      /*
        Als iemand gaat zoeken,
        resetten we doel en categorie.
      */
      if (normalize(input.value)) {
        state.goal = "";
        state.category = "";
      }

      applyFilters();
    }
  );

  input.addEventListener(
    "search",
    () => {
      state.search =
        input.value;

      applyFilters();
    }
  );

  if (form) {
    form.addEventListener(
      "submit",
      event => {
        event.preventDefault();

        state.search =
          input.value;

        state.goal = "";
        state.category = "";

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
  }
}

/* =========================================================
   DOEL KNOPPEN
========================================================= */

function setupGoals() {
  $all("[data-goal]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          state.goal =
            normalize(
              button.dataset.goal || ""
            );

          state.search = "";
          state.category = "";

          const input =
            $("#search");

          if (input) {
            input.value = "";
          }

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

function updateGoalButtons() {
  $all("[data-goal]")
    .forEach(button => {

      const value =
        normalize(
          button.dataset.goal || ""
        );

      button.classList.toggle(
        "active",
        value === state.goal
      );

    });
}

/* =========================================================
   CATEGORIE KNOPPEN
========================================================= */

function setupCategories() {
  $all("[data-category]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          state.category =
            normalize(
              button.dataset.category || ""
            );

          state.goal = "";
          state.search = "";

          const input =
            $("#search");

          if (input) {
            input.value = "";
          }

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
   WINKELMANDJE - OPSLAAN
========================================================= */

function loadCart() {
  try {
    const saved =
      localStorage.getItem(
        CART_KEY
      );

    if (!saved) {
      return [];
    }

    const parsed =
      JSON.parse(saved);

    return Array.isArray(parsed)
      ? parsed
      : [];

  } catch (error) {
    console.warn(
      "Cart load failed:",
      error
    );

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
      "Cart save failed:",
      error
    );
  }

  renderCart();
}

/* =========================================================
   WINKELMANDJE - TOEVOEGEN
========================================================= */

function addToCart(productId) {
  const product =
    state.products.find(
      item =>
        String(item.id) ===
        String(productId)
    );

  if (!product) {
    console.error(
      "Product niet gevonden:",
      productId
    );

    return;
  }

  const existing =
    state.cart.find(
      item =>
        String(item.id) ===
        String(product.id)
    );

  if (existing) {

    existing.quantity =
      Number(
        existing.quantity || 1
      ) + 1;

  } else {

    state.cart.push({
      id: product.id,
      name: product.name,
      price: Number(product.price) || 0,
      currency:
        product.currency || "EUR",
      merchant_name:
        product.merchant_name || "",
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

  openCart();
}

/* =========================================================
   WINKELMANDJE - VERWIJDEREN
========================================================= */

function removeFromCart(productId) {
  state.cart =
    state.cart.filter(
      item =>
        String(item.id) !==
        String(productId)
    );

  saveCart();
}

/* =========================================================
   WINKELMANDJE - AANTAL
========================================================= */

function changeCartQuantity(
  productId,
  amount
) {
  const item =
    state.cart.find(
      product =>
        String(product.id) ===
        String(productId)
    );

  if (!item) return;

  item.quantity =
    Math.max(
      1,
      Number(item.quantity || 1) +
        Number(amount || 0)
    );

  saveCart();
}

/* =========================================================
   WINKELMANDJE - TOTAAL
========================================================= */

function cartTotal() {
  return state.cart.reduce(
    (total, item) => {

      return (
        total +
        Number(item.price || 0) *
        Number(item.quantity || 1)
      );

    },
    0
  );
}

/* =========================================================
   WINKELMANDJE - ELEMENT
========================================================= */

function getOrCreateCartElement() {
  let cart =
    $("#cart");

  if (cart) {
    return cart;
  }

  cart =
    document.createElement("aside");

  cart.id =
    "cart";

  cart.setAttribute(
    "aria-label",
    "Winkelmandje"
  );

  /*
    Basis styling zodat het winkelmandje
    ook werkt als er nog geen CSS voor
    #cart bestaat.
  */
  Object.assign(
    cart.style,
    {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      width: "min(390px, calc(100vw - 40px))",
      maxHeight: "70vh",
      overflowY: "auto",
      zIndex: "99999",
      background: "#07111f",
      color: "#ffffff",
      border: "1px solid rgba(255,255,255,.15)",
      borderRadius: "18px",
      padding: "20px",
      boxSizing: "border-box",
      boxShadow:
        "0 20px 60px rgba(0,0,0,.5)"
    }
  );

  document.body.appendChild(cart);

  return cart;
}

/* =========================================================
   WINKELMANDJE - RENDER
========================================================= */

function renderCart() {
  const cart =
    getOrCreateCartElement();

  if (!state.cart.length) {

    cart.innerHTML = `
      <div>

        <div
          style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:10px;
          "
        >
          <h3 style="margin:0;">
            🛒 Winkelmandje
          </h3>

          <button
            type="button"
            data-close-cart
            style="
              background:none;
              border:0;
              color:#fff;
              font-size:22px;
              cursor:pointer;
            "
          >
            ×
          </button>
        </div>

        <p
          style="
            opacity:.7;
            margin-bottom:0;
          "
        >
          Je winkelmandje is nog leeg.
        </p>

      </div>
    `;

    return;
  }

  cart.innerHTML = `
    <div>

      <div
        style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
          margin-bottom:12px;
        "
      >

        <h3 style="margin:0;">
          🛒 Winkelmandje
        </h3>

        <button
          type="button"
          data-close-cart
          style="
            background:none;
            border:0;
            color:#fff;
            font-size:22px;
            cursor:pointer;
          "
        >
          ×
        </button>

      </div>

      <div class="cart-items">

        ${state.cart.map(item => `
          <div
            class="cart-item"
            style="
              padding:13px 0;
              border-bottom:
                1px solid rgba(255,255,255,.1);
            "
          >

            <strong>
              ${escapeHtml(item.name)}
            </strong>

            <small
              style="
                display:block;
                opacity:.65;
                margin:4px 0 8px;
              "
            >
              ${escapeHtml(
                item.merchant_name || ""
              )}
            </small>

            <div
              style="
                display:flex;
                justify-content:space-between;
                align-items:center;
                gap:10px;
              "
            >

              <span>
                ${money(
                  item.price,
                  item.currency
                )}
              </span>

              <div
                style="
                  display:flex;
                  align-items:center;
                  gap:7px;
                "
              >

                <button
                  type="button"
                  data-cart-minus="${escapeHtml(
                    String(item.id)
                  )}"
                >
                  −
                </button>

                <strong>
                  ${item.quantity}
                </strong>

                <button
                  type="button"
                  data-cart-plus="${escapeHtml(
                    String(item.id)
                  )}"
                >
                  +
                </button>

              </div>

            </div>

            <button
              type="button"
              data-cart-remove="${escapeHtml(
                String(item.id)
              )}"
              style="
                margin-top:8px;
                padding:0;
                background:none;
                border:0;
                color:#aaa;
                cursor:pointer;
              "
            >
              Verwijderen
            </button>

          </div>
        `).join("")}

      </div>

      <div
        style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          margin-top:18px;
          font-size:18px;
        "
      >

        <strong>
          Totaal
        </strong>

        <strong>
          ${money(
            cartTotal(),
            "EUR"
          )}
        </strong>

      </div>

      <p
        style="
          font-size:12px;
          opacity:.6;
          line-height:1.5;
          margin-bottom:0;
        "
      >
        Prijzen zijn indicatief.
        Controleer de actuele prijs
        bij de winkel voordat je bestelt.
      </p>

    </div>
  `;
}

/* =========================================================
   WINKELMANDJE - OPENEN
========================================================= */

function openCart() {
  const cart =
    getOrCreateCartElement();

  cart.style.display =
    "block";
}

/* =========================================================
   WINKELMANDJE - EVENTS
========================================================= */

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
          addButton.dataset.addCart
        );
        return;
      }

      const removeButton =
        event.target.closest(
          "[data-cart-remove]"
        );

      if (removeButton) {
        removeFromCart(
          removeButton.dataset.cartRemove
        );
        return;
      }

      const plusButton =
        event.target.closest(
          "[data-cart-plus]"
        );

      if (plusButton) {
        changeCartQuantity(
          plusButton.dataset.cartPlus,
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
          minusButton.dataset.cartMinus,
          -1
        );
        return;
      }

      const closeButton =
        event.target.closest(
          "[data-close-cart]"
        );

      if (closeButton) {
        const cart =
          $("#cart");

        if (cart) {
          cart.style.display =
            "none";
        }
      }
    }
  );
}

/* =========================================================
   WINKELMANDJE MELDING
========================================================= */

function showCartMessage(message) {
  let box =
    $("#cart-message");

  if (!box) {

    box =
      document.createElement("div");

    box.id =
      "cart-message";

    Object.assign(
      box.style,
      {
        position: "fixed",
        left: "50%",
        bottom: "25px",
        transform:
          "translateX(-50%)",
        zIndex: "100000",
        background: "#102033",
        color: "#fff",
        padding: "12px 18px",
        borderRadius: "10px",
        boxShadow:
          "0 10px 30px rgba(0,0,0,.35)",
        maxWidth:
          "calc(100vw - 40px)",
        textAlign: "center"
      }
    );

    document.body.appendChild(box);
  }

  box.textContent =
    message;

  box.style.display =
    "block";

  clearTimeout(
    box._timer
  );

  box._timer =
    setTimeout(() => {
      box.style.display =
        "none";
    }, 2500);
}

/* =========================================================
   SHOPPING PLANNER
========================================================= */

function setupPlanner() {
  const form =
    $("#planner-form");

  if (!form) return;

  form.addEventListener(
    "submit",
    event => {

      event.preventDefault();

      const goal =
        normalize(
          form.querySelector(
            "[name='goal']"
          )?.value
        );

      const budget =
        Number(
          form.querySelector(
            "[name='budget']"
          )?.value
        );

      const result =
        $("#planner-result");

      if (!result) return;

      if (
        !Number.isFinite(budget) ||
        budget <= 0
      ) {

        result.innerHTML = `
          <div class="planner-empty">
            <h3>
              Vul een geldig budget in
            </h3>

            <p>
              Bijvoorbeeld €70.
            </p>
          </div>
        `;

        return;
      }

      /*
        Planner gebruikt dezelfde doel-logica
        als de normale doelknoppen.
      */
      const candidates =
        state.products
          .filter(product =>
            isUsableProduct(product) &&
            matchesGoal(product, goal)
          )
          .sort((a, b) => {

            const scoreA =
              Number(a.deal_score || 0);

            const scoreB =
              Number(b.deal_score || 0);

            return scoreB - scoreA;
          });

      const selected = [];

      let total = 0;

      /*
        Probeer meerdere verschillende producten
        binnen het opgegeven budget te plaatsen.
      */
      for (
        const product of candidates
      ) {

        const productPrice =
          price(product);

        if (
          productPrice <= 0
        ) {
          continue;
        }

        if (
          total + productPrice <=
          budget
        ) {

          selected.push(
            product
          );

          total +=
            productPrice;
        }

        if (
          selected.length >= 5
        ) {
          break;
        }
      }

      if (!selected.length) {

        result.innerHTML = `
          <div class="planner-empty">

            <h3>
              Geen passende combinatie gevonden
            </h3>

            <p>
              Probeer een iets hoger budget
              of kies een ander doel.
            </p>

          </div>
        `;

        return;
      }

      result.innerHTML = `
        <div class="planner-success">

          <h3>
            Jouw
            ${escapeHtml(
              goal || "fitness"
            )}
            selectie
          </h3>

          <div
            class="planner-products"
          >

            ${selected.map(product => `
              <div
                class="planner-product"
                style="
                  display:flex;
                  justify-content:space-between;
                  align-items:center;
                  gap:12px;
                  padding:12px 0;
                  border-bottom:
                    1px solid rgba(255,255,255,.1);
                "
              >

                <div>

                  <strong>
                    ${escapeHtml(
                      product.name
                    )}
                  </strong>

                  <small
                    style="
                      display:block;
                      opacity:.65;
                    "
                  >
                    ${escapeHtml(
                      product.merchant_name || ""
                    )}
                  </small>

                </div>

                <div
                  style="
                    display:flex;
                    align-items:center;
                    gap:8px;
                    white-space:nowrap;
                  "
                >

                  <strong>
                    ${money(
                      product.price,
                      product.currency
                    )}
                  </strong>

                  <button
                    type="button"
                    class="cart-button"
                    data-add-cart="${escapeHtml(
                      String(product.id)
                    )}"
                  >
                    🛒
                  </button>

                </div>

              </div>
            `).join("")}

          </div>

          <div
            class="planner-total"
            style="
              display:flex;
              justify-content:space-between;
              margin-top:16px;
            "
          >

            <strong>
              Totaal
            </strong>

            <strong>
              ${money(
                total,
                "EUR"
              )}
            </strong>

          </div>

          <p
            style="
              opacity:.65;
              font-size:13px;
            "
          >
            Budget:
            ${money(
              budget,
              "EUR"
            )}
          </p>

        </div>
      `;
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
    $("#ai-output");

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
                  "application/json"
              },

              body:
                JSON.stringify({
                  message
                })
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data?.error ||
            "AI request failed"
          );
        }

        const reply =
          data.reply ||
          data.message ||
          "Geen antwoord ontvangen.";

        output.innerHTML = `
          <p>
            ${escapeHtml(reply)
              .replace(
                /\n/g,
                "<br>"
              )}
          </p>
        `;

      } catch (error) {

        console.error(
          "AI error:",
          error
        );

        output.innerHTML = `
          <p>
            De AI Coach is tijdelijk
            niet beschikbaar.
          </p>
        `;
      }
    }
  );
}

/* =========================================================
   START
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    setupSearch();
    setupGoals();
    setupCategories();
    setupCartEvents();
    setupPlanner();
    setupAI();

    /*
      Winkelmandje direct klaarzetten.
    */
    renderCart();

    /*
      Daarna producten laden.
    */
    loadProducts();

  }
);
