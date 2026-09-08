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
    product?.description
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
   PRODUCT FILTER
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
  "gymtas",
  "sporttas",
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
   PRODUCT TYPES
========================================================= */

const CUT_WORDS = [
  "fat burner",
  "fatburner",
  "thermogenic",
  "weight loss",
  "gewichtsverlies",
  "afvallen",
  "l-carnitine",
  "carnitine",
  "cla",
  "green tea",
  "groene thee"
];

const BULK_WORDS = [
  "mass gainer",
  "massgainer",
  "weight gainer",
  "weightgainer",
  "gainer",
  "hard gainer",
  "mega mass",
  "mass gain",
  "calorie surplus"
];

const PROTEIN_WORDS = [
  "protein",
  "proteine",
  "whey",
  "casein",
  "caseine",
  "isolate",
  "isolaat"
];

const CREATINE_WORDS = [
  "creatine"
];

const PRE_WORKOUT_WORDS = [
  "pre workout",
  "pre-workout",
  "preworkout",
  "pump",
  "citrulline",
  "beta alanine"
];

const MUSCLE_WORDS = [
  "muscle",
  "spier",
  "spieren",
  "muscle gain",
  "strength",
  "kracht"
];

const GENERAL_SUPPLEMENT_WORDS = [
  ...PROTEIN_WORDS,
  ...CREATINE_WORDS,
  ...PRE_WORKOUT_WORDS,
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
  "caffeine",
  "cafeine",
  "carnitine",
  "beta alanine",
  "citrulline",
  "pump",
  "intra workout",
  "intra-workout",
  "post workout",
  "post-workout"
];

/* =========================================================
   GOAL MATCHING
========================================================= */

function matchesGoal(product, goal) {
  if (!goal) return true;

  const selectedGoal =
    normalize(goal);

  const text =
    productText(product);

  const isCut =
    hasAny(text, CUT_WORDS);

  const isBulk =
    hasAny(text, BULK_WORDS);

  const isProtein =
    hasAny(text, PROTEIN_WORDS);

  const isCreatine =
    hasAny(text, CREATINE_WORDS);

  const isPreWorkout =
    hasAny(text, PRE_WORKOUT_WORDS);

  const isMuscle =
    hasAny(text, MUSCLE_WORDS);

  /*
    BELANGRIJK:

    We gebruiken product.goals NIET meer om automatisch
    ieder product aan Cut/Bulk/Lean Bulk toe te wijzen.

    De database heeft namelijk een standaardwaarde
    met alle drie de doelen.
  */

  if (selectedGoal === "cut") {

    /*
      Mass gainers horen niet bij Cut.
    */
    if (isBulk) {
      return false;
    }

    return (
      isCut ||
      isProtein ||
      isCreatine ||
      isPreWorkout
    );
  }

  if (selectedGoal === "bulk") {

    /*
      Duidelijke fat burners horen niet bij Bulk.
    */
    if (isCut && !isProtein && !isCreatine) {
      return false;
    }

    return (
      isBulk ||
      isProtein ||
      isCreatine ||
      isMuscle
    );
  }

  if (
    selectedGoal === "lean-bulk" ||
    selectedGoal === "lean bulk"
  ) {

    /*
      Lean bulk is geen klassieke mass-gainer selectie.
    */
    if (isBulk) {
      return false;
    }

    return (
      isProtein ||
      isCreatine ||
      isPreWorkout ||
      isMuscle
    );
  }

  return true;
}

/* =========================================================
   CATEGORY MATCHING
========================================================= */

function matchesCategory(product, category) {
  if (!category) return true;

  const selectedCategory =
    normalize(category);

  const text =
    productText(product);

  if (selectedCategory === "proteine") {
    return hasAny(text, [
      ...PROTEIN_WORDS,
      "gainer",
      "mass"
    ]);
  }

  if (selectedCategory === "creatine") {
    return hasAny(
      text,
      CREATINE_WORDS
    );
  }

  if (selectedCategory === "pre-workout") {
    return hasAny(
      text,
      PRE_WORKOUT_WORDS
    );
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
    state.products.filter(product => {

      if (!isUsableProduct(product)) {
        return false;
      }

      if (
        !matchesSearch(
          product,
          query
        )
      ) {
        return false;
      }

      if (
        !matchesGoal(
          product,
          state.goal
        )
      ) {
        return false;
      }

      if (
        !matchesCategory(
          product,
          state.category
        )
      ) {
        return false;
      }

      return true;
    });

  /*
    Beste deals eerst.
  */
  state.filtered.sort(
    (a, b) => {

      const scoreA =
        Number(a.deal_score || 0);

      const scoreB =
        Number(b.deal_score || 0);

      if (
        scoreB !== scoreA
      ) {
        return scoreB - scoreA;
      }

      return (
        price(a) -
        price(b)
      );
    }
  );

  state.visibleCount =
    PRODUCTS_PER_VIEW;

  renderProducts();
}

/* =========================================================
   PRODUCTS LADEN
========================================================= */

async function loadProducts() {

  if (state.loading) {
    return;
  }

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
            Accept:
              "application/json"
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

      if (
        Array.isArray(data)
      ) {
        batch = data;

      } else if (
        Array.isArray(
          data.products
        )
      ) {
        batch =
          data.products;

      } else if (
        Array.isArray(
          data.data
        )
      ) {
        batch =
          data.data;
      }

      products.push(
        ...batch
      );

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

    /*
      Dubbele IDs verwijderen.
    */
    const unique =
      new Map();

    for (
      const product of products
    ) {

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
      "FitDealFinder:",
      state.products.length,
      "producten geladen"
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

          <h3>
            Producten konden niet worden geladen
          </h3>

          <p>
            Ververs de pagina en probeer opnieuw.
          </p>

        </div>
      `;
    }

  } finally {

    state.loading =
      false;
  }
}

/* =========================================================
   PRODUCT CARD
========================================================= */

function productCard(product) {

  const currentPrice =
    price(product);

  const oldPriceValue =
    Number(product.old_price);

  const oldPrice =
    Number.isFinite(
      oldPriceValue
    ) &&
    oldPriceValue >
      currentPrice
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
    Number(
      product.discount_percent
    );

  const discount =
    Number.isFinite(
      discountValue
    ) &&
    discountValue > 0
      ? `
        <span class="discount">
          -${Math.round(
            discountValue
          )}%
        </span>
      `
      : "";

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
          onerror="
            this.style.display='none'
          "
        >
      `
      : `
        <div class="product-image-placeholder">
          FitDealFinder
        </div>
      `;

  const stock =
    Number(
      product.in_stock
    ) === 1
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
      data-product-id="${escapeHtml(
        String(product.id)
      )}"
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

          ${oldPrice}

          ${discount}

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

  if (!grid) {
    return;
  }

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
   LOAD MORE
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

  if (!grid) {
    return;
  }

  const button =
    document.createElement(
      "button"
    );

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

  grid.parentElement
    ?.appendChild(button);
}

/* =========================================================
   SEARCH
========================================================= */

function setupSearch() {

  const form =
    $("#search-form");

  const input =
    $("#search");

  if (!input) {
    return;
  }

  input.addEventListener(
    "input",
    () => {

      state.search =
        input.value;

      /*
        Zoeken staat los van doel
        en categorie.
      */
      state.goal = "";
      state.category = "";

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
            behavior:
              "smooth",
            block:
              "start"
          });
        }
      }
    );
  }
}

/* =========================================================
   GOAL BUTTONS
========================================================= */

function setupGoals() {

  $all("[data-goal]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          state.goal =
            normalize(
              button.dataset.goal ||
              ""
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
              behavior:
                "smooth",
              block:
                "start"
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
          button.dataset.goal ||
          ""
        );

      button.classList.toggle(
        "active",
        value === state.goal
      );
    });
}

/* =========================================================
   CATEGORIES
========================================================= */

function setupCategories() {

  $all("[data-category]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          state.category =
            normalize(
              button.dataset.category ||
              ""
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
              behavior:
                "smooth",
              block:
                "start"
            });
          }
        }
      );
    });
}

/* =========================================================
   CART STORAGE
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
      JSON.stringify(
        state.cart
      )
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
   CART ELEMENT
========================================================= */

function getCartElement() {

  let cart =
    $("#cart");

  /*
    Als index.html geen #cart heeft,
    maken we hem automatisch.
  */
  if (!cart) {

    cart =
      document.createElement(
        "aside"
      );

    cart.id =
      "cart";

    cart.setAttribute(
      "aria-label",
      "Winkelmandje"
    );

    cart.innerHTML =
      "";

    Object.assign(
      cart.style,
      {
        position:
          "fixed",

        right:
          "20px",

        bottom:
          "20px",

        width:
          "min(390px, calc(100vw - 40px))",

        maxHeight:
          "70vh",

        overflowY:
          "auto",

        zIndex:
          "99999",

        background:
          "#07111f",

        color:
          "#ffffff",

        border:
          "1px solid rgba(255,255,255,.15)",

        borderRadius:
          "18px",

        padding:
          "20px",

        boxSizing:
          "border-box",

        boxShadow:
          "0 20px 60px rgba(0,0,0,.5)"
      }
    );

    document.body.appendChild(
      cart
    );
  }

  return cart;
}

/* =========================================================
   CART RENDER
========================================================= */

function renderCart() {

  const cart =
    getCartElement();

  if (!state.cart.length) {

    cart.innerHTML = `
      <div>

        <div
          style="
            display:flex;
            justify-content:space-between;
            align-items:center;
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

        <p style="opacity:.7;">
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
              ${escapeHtml(
                item.name
              )}
            </strong>

            <small
              style="
                display:block;
                opacity:.65;
                margin:4px 0 8px;
              "
            >
              ${escapeHtml(
                item.merchant_name ||
                ""
              )}
            </small>

            <div
              style="
                display:flex;
                justify-content:space-between;
                align-items:center;
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
                background:none;
                border:0;
                color:#aaa;
                padding:0;
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
   CART ACTIONS
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
      id:
        product.id,

      name:
        product.name,

      price:
        Number(product.price) || 0,

      currency:
        product.currency ||
        "EUR",

      merchant_name:
        product.merchant_name ||
        "",

      product_url:
        product.product_url ||
        product.affiliate_url ||
        "#",

      quantity:
        1
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
        String(item.id) !==
        String(productId)
    );

  saveCart();
}

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
      Number(
        item.quantity || 1
      ) + Number(amount || 0)
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

/* =========================================================
   CART EVENTS
========================================================= */

function setupCartEvents() {

  document.addEventListener(
    "click",
    event => {

      const add =
        event.target.closest(
          "[data-add-cart]"
        );

      if (add) {

        addToCart(
          add.dataset.addCart
        );

        return;
      }

      const remove =
        event.target.closest(
          "[data-cart-remove]"
        );

      if (remove) {

        removeFromCart(
          remove.dataset.cartRemove
        );

        return;
      }

      const plus =
        event.target.closest(
          "[data-cart-plus]"
        );

      if (plus) {

        changeCartQuantity(
          plus.dataset.cartPlus,
          1
        );

        return;
      }

      const minus =
        event.target.closest(
          "[data-cart-minus]"
        );

      if (minus) {

        changeCartQuantity(
          minus.dataset.cartMinus,
          -1
        );

        return;
      }

      const close =
        event.target.closest(
          "[data-close-cart]"
        );

      if (close) {

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
   CART MESSAGE
========================================================= */

function showCartMessage(message) {

  let box =
    $("#cart-message");

  if (!box) {

    box =
      document.createElement(
        "div"
      );

    box.id =
      "cart-message";

    Object.assign(
      box.style,
      {
        position:
          "fixed",

        left:
          "50%",

        bottom:
          "25px",

        transform:
          "translateX(-50%)",

        zIndex:
          "100000",

        background:
          "#102033",

        color:
          "#fff",

        padding:
          "12px 18px",

        borderRadius:
          "10px",

        boxShadow:
          "0 10px 30px rgba(0,0,0,.35)",

        maxWidth:
          "calc(100vw - 40px)",

        textAlign:
          "center"
      }
    );

    document.body.appendChild(
      box
    );
  }

  box.textContent =
    message;

  box.style.display =
    "block";

  clearTimeout(
    box._timer
  );

  box._timer =
    setTimeout(
      () => {
        box.style.display =
          "none";
      },
      2500
    );
}

/* =========================================================
   SHOPPING PLANNER
========================================================= */

function setupPlanner() {

  const form =
    $("#planner-form");

  if (!form) {
    return;
  }

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

      if (!result) {
        return;
      }

      if (
        !Number.isFinite(
          budget
        ) ||
        budget <= 0
      ) {

        result.innerHTML = `
          <p>
            Vul een geldig budget in.
          </p>
        `;

        return;
      }

      const candidates =
        state.products
          .filter(
            product =>
              isUsableProduct(
                product
              ) &&
              matchesGoal(
                product,
                goal
              )
          )
          .sort(
            (a, b) =>
              Number(
                b.deal_score || 0
              ) -
              Number(
                a.deal_score || 0
              )
          );

      const selected = [];

      let total = 0;

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
          total +
            productPrice <=
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
              Probeer een iets hoger budget.
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
              goal ||
              "fitness"
            )}
            selectie
          </h3>

          <div class="planner-products">

            ${selected.map(
              product => `
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
                        product.merchant_name ||
                        ""
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
                        String(
                          product.id
                        )
                      )}"
                    >
                      🛒
                    </button>

                  </div>

                </div>
              `
            ).join("")}

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

          <p>
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
              method:
                "POST",

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
            ${escapeHtml(
              reply
            ).replace(
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
      Winkelmandje klaarzetten.
    */
    renderCart();

    /*
      Producten ophalen.
    */
    loadProducts();

  }
);
