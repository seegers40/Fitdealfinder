(() => {
  "use strict";

  const state = {
    products: [],
    filtered: [],
    goal: "",
    category: "",
    search: "",
    visible: 24
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);

      return /^https?:$/.test(url.protocol)
        ? url.href
        : "";
    } catch {
      return "";
    }
  }

  function normalize(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function getGoals(product) {
    if (Array.isArray(product.goals)) {
      return product.goals;
    }

    if (typeof product.goals === "string") {
      try {
        const parsed = JSON.parse(product.goals);

        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Geen JSON; hieronder als tekst behandelen.
      }

      return product.goals
        .split(/[|,;]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  function formatPrice(value, currency = "EUR") {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "";
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

  function calculateDiscount(price, oldPrice, discountPercent) {
    const explicit = Number(discountPercent);
    const current = Number(price);
    const old = Number(oldPrice);

    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.round(explicit);
    }

    if (
      Number.isFinite(current) &&
      Number.isFinite(old) &&
      old > current &&
      old > 0
    ) {
      return Math.round(((old - current) / old) * 100);
    }

    return 0;
  }

  function productIsUsable(product) {
    if (!product || typeof product !== "object") {
      return false;
    }

    const id =
      product.id !== undefined &&
      product.id !== null &&
      String(product.id).trim() !== "";

    const productUrl = safeUrl(product.product_url);

    return Boolean(id && productUrl);
  }

  function matchesCategory(product, category) {
    const text = normalize([
      product.category,
      product.name,
      product.brand,
      product.description
    ].join(" "));

    if (category === "proteine") {
      return /prote|protein|whey|isolaat|isolate|casein|caseine|eiwit|egg protein|beef protein|clear whey|gainer|mass/.test(text);
    }

    if (category === "creatine") {
      return /creatine|crea[- ]?monohydraat|crea[- ]?tabs/.test(text);
    }

    if (category === "pre-workout") {
      return /pre[- ]?workout|preworkout|pump|nox|5150|abe/.test(text);
    }

    if (category === "supplementen") {
      const nonSupplement = /shirt|t-shirt|sporttas|tas|handschoen|glove|riem|strap|pads|beker|schema|training/;

      if (nonSupplement.test(text)) {
        return false;
      }

      return (
        /supplement|vitamin|mineral|amino|bcaa|eaa|omega|carnitine|glutamine|magnesium|zink|protein|creatine|workout|whey|gainer/.test(text) ||
        !product.category
      );
    }

    return true;
  }

  function getProductImage(product) {
    const imageUrl = safeUrl(product.image_url);

    if (!imageUrl) {
      return `
        <div class="image-placeholder">
          <span>FIT</span>
        </div>
      `;
    }

    return `
      <img
        class="product-image"
        src="${escapeHtml(imageUrl)}"
        alt="${escapeHtml(product.name || "Supplement")}"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        onerror="
          this.style.display='none';
          this.nextElementSibling.style.display='flex';
        "
      >

      <div
        class="image-placeholder"
        style="display:none;"
      >
        <span>FIT</span>
      </div>
    `;
  }

  function renderProduct(product) {
    const discount = calculateDiscount(
      product.price,
      product.old_price,
      product.discount_percent
    );

    const price = Number(product.price);
    const oldPrice = Number(product.old_price);

    const hasPrice = Number.isFinite(price);

    const hasOldPrice =
      Number.isFinite(oldPrice) &&
      oldPrice > 0 &&
      (!hasPrice || oldPrice > price);

    const inStock =
      product.in_stock === true ||
      product.in_stock === 1 ||
      product.in_stock === "1";

    const productId =
      product.id !== undefined &&
      product.id !== null
        ? String(product.id)
        : "";

    const shopUrl = productId
      ? `/go/${encodeURIComponent(productId)}`
      : safeUrl(product.product_url);

    const goals = [
      ...new Set(
        getGoals(product)
          .map((goal) => {
            const value = normalize(goal);

            if (value.includes("lean")) {
              return "Lean Bulk";
            }

            if (value.includes("cut")) {
              return "Cut";
            }

            if (value.includes("bulk")) {
              return "Bulk";
            }

            return "";
          })
          .filter(Boolean)
      )
    ];

    return `
      <article class="product-card">

        <div class="product-image">

          ${
            discount > 0
              ? `<span class="deal-badge">-${escapeHtml(discount)}%</span>`
              : ""
          }

          ${getProductImage(product)}

        </div>

        <div class="product-body">

          <div class="product-top">

            <div class="product-brand">
              ${escapeHtml(product.brand || "")}
            </div>

            <span class="stock ${inStock ? "in" : "out"}">
              ${inStock ? "Op voorraad" : "Niet op voorraad"}
            </span>

          </div>

          <h3 class="product-name">
            ${escapeHtml(product.name || "Supplement")}
          </h3>

          <div class="merchant">
            ${escapeHtml(product.merchant_name || "Winkel")}
          </div>

          <div class="price-row">

            ${
              hasPrice
                ? `<span class="price">${escapeHtml(
                    formatPrice(price, product.currency || "EUR")
                  )}</span>`
                : `<span class="price">Prijs bekijken</span>`
            }

            ${
              hasOldPrice
                ? `<span class="old-price">${escapeHtml(
                    formatPrice(oldPrice, product.currency || "EUR")
                  )}</span>`
                : ""
            }

            ${
              discount > 0
                ? `<span class="discount">-${discount}%</span>`
                : ""
            }

          </div>

          <div class="price-note">
            Prijsindicatie · controleer de actuele prijs bij de winkel
          </div>

          ${
            goals.length
              ? `
                <div class="chips">
                  ${goals
                    .slice(0, 3)
                    .map(
                      (goal) =>
                        `<span class="chip">${escapeHtml(goal)}</span>`
                    )
                    .join("")}
                </div>
              `
              : ""
          }

          <div class="product-action">

            <a
              class="shop-button"
              href="${escapeHtml(shopUrl || "#")}"
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              Bekijk deal
            </a>

          </div>

        </div>

      </article>
    `;
  }

  function renderProducts() {
    const container =
      $("#products-grid") ||
      $("#productsGrid") ||
      $(".products-grid") ||
      $("#product-list") ||
      $("#productList");

    if (!container) {
      return;
    }

    const products = state.filtered.slice(0, state.visible);

    if (!products.length) {
      container.innerHTML = `
        <div class="empty-state">
          <strong>Geen producten gevonden</strong>
          <p>
            Probeer een andere zoekterm of pas je filters aan.
          </p>
        </div>
      `;
    } else {
      container.innerHTML = products
        .map(renderProduct)
        .join("");
    }

    let moreContainer = $("#products-more");

    if (!moreContainer) {
      moreContainer = document.createElement("div");
      moreContainer.id = "products-more";

      moreContainer.style.cssText = `
        width: 100%;
        text-align: center;
        margin-top: 24px;
      `;

      container.parentElement.appendChild(moreContainer);
    }

    if (state.visible < state.filtered.length) {
      moreContainer.innerHTML = `
        <button
          type="button"
          class="shop-button"
          style="max-width:280px;margin:0 auto;"
        >
          Toon meer producten
        </button>
      `;

      moreContainer
        .querySelector("button")
        .addEventListener("click", () => {
          state.visible += 24;
          renderProducts();
        });
    } else {
      moreContainer.innerHTML = "";
    }

    const count =
      $("#product-count") ||
      $("#productCount") ||
      $(".product-count");

    if (count) {
      count.textContent =
        state.filtered.length === 1
          ? "1 product gevonden"
          : `${state.filtered.length} producten gevonden`;
    }
  }

  function applyFilters() {
    const search = normalize(state.search.trim());
    const goal = normalize(state.goal);
    const category = normalize(state.category);

    state.filtered = state.products.filter((product) => {
      if (!productIsUsable(product)) {
        return false;
      }

      if (search) {
        const haystack = normalize([
          product.name,
          product.brand,
          product.description,
          product.merchant_name,
          product.category
        ].join(" "));

        if (!haystack.includes(search)) {
          return false;
        }
      }

      if (
        category &&
        !matchesCategory(product, category)
      ) {
        return false;
      }

      if (goal) {
        const productGoals = getGoals(product)
          .map((item) => normalize(item))
          .join(" ");

        const productGoal = normalize(product.goal);

        if (
          !productGoals.includes(goal) &&
          !productGoal.includes(goal)
        ) {
          return false;
        }
      }

      return true;
    });

    state.visible = 24;

    renderProducts();
  }

  /*
   * De API heeft momenteel een limiet van 100 per request.
   * Daarom halen we de catalogus via meerdere zoekvensters op
   * en voegen we dubbele producten lokaal samen.
   */

  async function fetchCatalogPart(searchTerm) {
    try {
      const response = await fetch(
        `/api/products?limit=100&search=${encodeURIComponent(searchTerm)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json"
          },
          credentials: "same-origin",
          cache: "no-store"
        }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();

      return Array.isArray(data)
        ? data
        : Array.isArray(data.products)
          ? data.products
          : [];
    } catch {
      return [];
    }
  }

  async function loadProducts() {
    const container =
      $("#products-grid") ||
      $("#productsGrid") ||
      $(".products-grid") ||
      $("#product-list") ||
      $("#productList");

    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <strong>Deals laden...</strong>
          <p>
            We halen de actuele productcatalogus op.
          </p>
        </div>
      `;
    }

    /*
     * We gebruiken letters en cijfers als zoekvensters.
     * Producten worden daarna op ID ontdubbeld.
     */
    const searchWindows =
      "abcdefghijklmnopqrstuvwxyz0123456789".split("");

    try {
      const batches = await Promise.all(
        searchWindows.map(fetchCatalogPart)
      );

      const productsById = new Map();

      batches
        .flat()
        .forEach((product) => {
          if (!productIsUsable(product)) {
            return;
          }

          productsById.set(
            String(product.id),
            product
          );
        });

      state.products = [
        ...productsById.values()
      ];

      applyFilters();
    } catch (error) {
      console.error(
        "FitDealFinder: producten laden mislukt",
        error
      );

      state.products = [];
      state.filtered = [];

      if (container) {
        container.innerHTML = `
          <div class="empty-state">
            <strong>Producten konden niet worden geladen</strong>
            <p>
              Probeer het later opnieuw.
            </p>
          </div>
        `;
      }
    }
  }

  function debounce(fn, delay) {
    let timer;

    return (...args) => {
      clearTimeout(timer);

      timer = setTimeout(() => {
        fn(...args);
      }, delay);
    };
  }

  function bindSearch() {
    const input =
      $("#search") ||
      $("#searchInput") ||
      $('input[type="search"]');

    if (!input) {
      return;
    }

    const runSearch = () => {
      state.search = input.value || "";
      applyFilters();
    };

    input.addEventListener(
      "input",
      debounce(runSearch, 200)
    );

    const form = input.closest("form");

    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        runSearch();
      });
    }
  }

  function bindGoalFilters() {
    const buttons = $$(
      "[data-goal], [data-filter-goal], [data-filter]"
    );

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const goal =
          button.dataset.goal ||
          button.dataset.filterGoal ||
          button.dataset.filter ||
          "";

        if (!goal) {
          return;
        }

        state.goal =
          normalize(state.goal) === normalize(goal)
            ? ""
            : goal;

        buttons.forEach((item) => {
          const itemGoal =
            item.dataset.goal ||
            item.dataset.filterGoal ||
            item.dataset.filter ||
            "";

          item.classList.toggle(
            "active",
            Boolean(state.goal) &&
              normalize(itemGoal) ===
                normalize(state.goal)
          );
        });

        applyFilters();
      });
    });
  }

  function bindCategoryFilters() {
    const buttons = $$(
      "[data-category]"
    );

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const category =
          button.dataset.category || "";

        state.category =
          normalize(state.category) ===
          normalize(category)
            ? ""
            : category;

        buttons.forEach((item) => {
          item.classList.toggle(
            "active",
            Boolean(state.category) &&
              normalize(item.dataset.category) ===
                normalize(state.category)
          );
        });

        applyFilters();
      });
    });
  }

  function setupPlanner() {
    const form = $("#planner-form");

    if (!form) {
      return;
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const goal =
        String(
          $("#planner-goal")?.value || ""
        ).trim();

      const budget =
        Number(
          $("#planner-budget")?.value || 0
        );

      const products =
        state.products
          .filter((product) => {
            if (goal) {
              const productGoals =
                getGoals(product)
                  .map(normalize)
                  .join(" ");

              if (
                !productGoals.includes(
                  normalize(goal)
                )
              ) {
                return false;
              }
            }

            if (
              budget > 0 &&
              Number(product.price) > budget
            ) {
              return false;
            }

            return true;
          })
          .sort(
            (a, b) =>
              Number(a.price) -
              Number(b.price)
          );

      const output =
        $("#planner-result");

      if (!output) {
        return;
      }

      if (!products.length) {
        output.innerHTML = `
          <strong>
            Geen passende deal gevonden
          </strong>
        `;
        return;
      }

      output.innerHTML = `
        <strong>
          ${products.length}
          passende
          ${products.length === 1 ? "deal" : "deals"}
        </strong>
      `;
    });
  }

  function setupAiCoach() {
    const form = $("#ai-form");
    const input = $("#ai-input");
    const output = $("#ai-output");

    if (!form || !input || !output) {
      return;
    }

    form.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        const message =
          String(input.value || "").trim();

        if (!message) {
          return;
        }

        output.textContent =
          "Even denken...";

        try {
          const response =
            await fetch(
              "/api/ai/chat",
              {
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/json",
                  Accept:
                    "application/json"
                },
                credentials:
                  "same-origin",
                body: JSON.stringify({
                  message
                })
              }
            );

          if (!response.ok) {
            throw new Error(
              `AI API returned ${response.status}`
            );
          }

          const data =
            await response.json();

          output.textContent =
            String(
              data.answer ||
              data.response ||
              data.message ||
              "Ik kon op dit moment geen antwoord geven."
            );
        } catch (error) {
          console.error(
            "FitDealFinder: AI request mislukt",
            error
          );

          output.textContent =
            "De AI Supplement Coach is tijdelijk niet beschikbaar. Probeer het later opnieuw.";
        }
      }
    );
  }

  function setup() {
    bindSearch();
    bindGoalFilters();
    bindCategoryFilters();
    setupPlanner();
    setupAiCoach();
    loadProducts();
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      setup,
      { once: true }
    );
  } else {
    setup();
  }
})();
