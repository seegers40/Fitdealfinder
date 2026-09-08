(() => {
  "use strict";

  const state = {
    products: [],
    filtered: [],
    goal: "",
    category: "",
    search: "",
    limit: 100
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

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.href
        : "";
    } catch {
      return "";
    }
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

  function calculateDiscount(price, oldPrice, discountPercent) {
    const explicit = Number(discountPercent);

    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.round(explicit);
    }

    const current = Number(price);
    const old = Number(oldPrice);

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

  function getProductImage(product) {
    const imageUrl = safeHttpUrl(product.image_url);

    if (!imageUrl) {
      return `
        <div class="image-placeholder" aria-hidden="true">
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
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      >
      <div class="image-placeholder" aria-hidden="true" style="display:none;">
        <span>FIT</span>
      </div>
    `;
  }

  function goalLabel(goal) {
    const value = String(goal || "").toLowerCase();

    if (value.includes("cut")) return "Cut";
    if (value.includes("lean")) return "Lean Bulk";
    if (value.includes("bulk")) return "Bulk";

    return "";
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
        // Niet-JSON: behandel als komma/pipe-gescheiden tekst.
      }

      return product.goals
        .split(/[|,;]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  function renderGoalChips(product) {
    const goals = getGoals(product)
      .map(goalLabel)
      .filter(Boolean);

    const unique = [...new Set(goals)];

    if (!unique.length) {
      return "";
    }

    return `
      <div class="chips" aria-label="Doelen">
        ${unique
          .slice(0, 3)
          .map((goal) => `<span class="chip">${escapeHtml(goal)}</span>`)
          .join("")}
      </div>
    `;
  }

  function renderProduct(product) {
    const id = product.id;
    const name = product.name || "Supplement";
    const brand = product.brand || "";
    const merchant = product.merchant_name || "Winkel";
    const currency = product.currency || "EUR";

    const price = Number(product.price);
    const oldPrice = Number(product.old_price);

    const hasPrice = Number.isFinite(price);
    const hasOldPrice =
      Number.isFinite(oldPrice) &&
      oldPrice > 0 &&
      (!hasPrice || oldPrice > price);

    const discount = calculateDiscount(
      product.price,
      product.old_price,
      product.discount_percent
    );

    const inStock =
      product.in_stock === true ||
      product.in_stock === 1 ||
      product.in_stock === "1";

    const goUrl =
      id !== undefined && id !== null && String(id).trim() !== ""
        ? `/go/${encodeURIComponent(String(id))}`
        : safeHttpUrl(product.product_url);

    const safeGoUrl = goUrl || "#";

    return `
      <article class="product-card">
        <div class="product-image">
          ${discount > 0 ? `<span class="deal-badge">-${escapeHtml(discount)}%</span>` : ""}
          ${getProductImage(product)}
        </div>

        <div class="product-body">
          <div class="product-top">
            <div class="product-brand">
              ${escapeHtml(brand)}
            </div>

            <span class="stock ${inStock ? "in" : "out"}">
              ${inStock ? "Op voorraad" : "Niet op voorraad"}
            </span>
          </div>

          <h3 class="product-name">
            ${escapeHtml(name)}
          </h3>

          <div class="merchant">
            ${escapeHtml(merchant)}
          </div>

          <div class="price-row">
            ${
              hasPrice
                ? `<span class="price">${escapeHtml(formatPrice(price, currency))}</span>`
                : `<span class="price">Prijs bekijken</span>`
            }

            ${
              hasOldPrice
                ? `<span class="old-price">${escapeHtml(formatPrice(oldPrice, currency))}</span>`
                : ""
            }

            ${
              discount > 0
                ? `<span class="discount">-${escapeHtml(discount)}%</span>`
                : ""
            }
          </div>

          <div class="price-note">
            Prijsindicatie · controleer de actuele prijs bij de winkel
          </div>

          ${renderGoalChips(product)}

          <div class="product-action">
            <a
              class="shop-button"
              href="${escapeHtml(safeGoUrl)}"
              target="_blank"
              rel="noopener noreferrer nofollow"
              ${safeGoUrl === "#" ? 'aria-disabled="true"' : ""}
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

    const products = state.filtered.slice(0, state.limit);

    if (!products.length) {
      container.innerHTML = `
        <div class="empty-state">
          <strong>Geen producten gevonden</strong>
          <p>
            Probeer een andere zoekterm of pas je filters aan.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = products.map(renderProduct).join("");
  }

  function productIsUsable(product) {
    if (!product || typeof product !== "object") {
      return false;
    }

    const id =
      product.id !== undefined &&
      product.id !== null &&
      String(product.id).trim() !== "";

    const url = safeHttpUrl(product.product_url);

    return id && url;
  }

  function applyFilters() {
    const search = state.search.trim().toLowerCase();
    const goal = state.goal.trim().toLowerCase();
    const category = state.category.trim().toLowerCase();

    state.filtered = state.products.filter((product) => {
      if (!productIsUsable(product)) {
        return false;
      }

      if (search) {
        const haystack = [
          product.name,
          product.brand,
          product.description,
          product.merchant_name,
          product.category
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(search)) {
          return false;
        }
      }

      if (category) {
        if (String(product.category || "").toLowerCase() !== category) {
          return false;
        }
      }

      if (goal) {
        const goals = getGoals(product)
          .map((item) => String(item).toLowerCase());

        const productGoal = String(product.goal || "").toLowerCase();

        if (
          !goals.some((item) => item.includes(goal)) &&
          !productGoal.includes(goal)
        ) {
          return false;
        }
      }

      return true;
    });

    renderProducts();
    updateResultCount();
  }

  function updateResultCount() {
    const count =
      $("#product-count") ||
      $("#productCount") ||
      $(".product-count");

    if (!count) {
      return;
    }

    const total = state.filtered.length;

    count.textContent =
      total === 1
        ? "1 product gevonden"
        : `${total} producten gevonden`;
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
          <p>We halen de actuele productgegevens op.</p>
        </div>
      `;
    }

    try {
      const params = new URLSearchParams();

      params.set("limit", "100");

      if (state.search.trim()) {
        params.set("search", state.search.trim());
      }

      if (state.goal.trim()) {
        params.set("goal", state.goal.trim());
      }

      if (state.category.trim()) {
        params.set("category", state.category.trim());
      }

      const response = await fetch(
        `/api/products?${params.toString()}`,
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
        throw new Error(`Products API returned ${response.status}`);
      }

      const data = await response.json();

      const products = Array.isArray(data)
        ? data
        : Array.isArray(data.products)
          ? data.products
          : [];

      state.products = products.filter(productIsUsable);

      applyFilters();
    } catch (error) {
      console.error("FitDealFinder: producten laden mislukt", error);

      state.products = [];
      state.filtered = [];

      if (container) {
        container.innerHTML = `
          <div class="empty-state">
            <strong>Producten konden niet worden geladen</strong>
            <p>
              Probeer het later opnieuw. Er worden geen verzonnen
              producten of prijzen getoond.
            </p>
          </div>
        `;
      }

      updateResultCount();
    }
  }

  function bindSearch() {
    const searchInput =
      $("#search") ||
      $("#searchInput") ||
      $('input[type="search"]');

    if (!searchInput) {
      return;
    }

    const runSearch = () => {
      state.search = searchInput.value || "";
      applyFilters();
    };

    searchInput.addEventListener("input", debounce(runSearch, 250));

    const form = searchInput.closest("form");

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
          state.goal.toLowerCase() === goal.toLowerCase()
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
              itemGoal.toLowerCase() === state.goal.toLowerCase()
          );
        });

        applyFilters();
      });
    });
  }

  function bindCategoryFilters() {
    const buttons = $$("[data-category]");

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const category = button.dataset.category || "";

        state.category =
          state.category.toLowerCase() === category.toLowerCase()
            ? ""
            : category;

        buttons.forEach((item) => {
          item.classList.toggle(
            "active",
            Boolean(state.category) &&
              (item.dataset.category || "").toLowerCase() ===
                state.category.toLowerCase()
          );
        });

        applyFilters();
      });
    });
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

  function setupPlanner() {
    const form =
      $("#planner-form") ||
      $("#plannerForm") ||
      document.querySelector("[data-planner-form]");

    if (!form) {
      return;
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const goalInput =
        form.querySelector("[name='goal']") ||
        form.querySelector("#planner-goal");

      const budgetInput =
        form.querySelector("[name='budget']") ||
        form.querySelector("#planner-budget");

      const goal = String(goalInput?.value || "").trim();
      const budget = Number(budgetInput?.value || 0);

      state.goal = goal;
      state.search = "";

      const searchInput =
        $("#search") ||
        $("#searchInput") ||
        $('input[type="search"]');

      if (searchInput) {
        searchInput.value = "";
      }

      applyFilters();

      const products = state.filtered.filter((product) => {
        if (!Number.isFinite(budget) || budget <= 0) {
          return true;
        }

        const price = Number(product.price);

        return Number.isFinite(price) && price <= budget;
      });

      const plannerResult =
        $("#planner-result") ||
        $("#plannerResult") ||
        form.parentElement?.querySelector(".planner-result");

      if (plannerResult) {
        if (!products.length) {
          plannerResult.innerHTML = `
            <div class="empty-state">
              <strong>Geen passende deal gevonden</strong>
              <p>
                Pas je doel of budget aan en probeer opnieuw.
              </p>
            </div>
          `;
          return;
        }

        plannerResult.innerHTML = `
          <div class="planner-result">
            <strong>${products.length} passende ${
              products.length === 1 ? "deal" : "deals"
            }</strong>
          </div>
        `;

        plannerResult.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      }
    });
  }

  function setupAiCoach() {
    const form =
      $("#ai-form") ||
      $("#aiForm") ||
      document.querySelector("[data-ai-form]");

    const input =
      $("#ai-input") ||
      $("#aiInput") ||
      form?.querySelector("textarea") ||
      form?.querySelector("input[name='message']");

    const output =
      $("#ai-output") ||
      $("#aiOutput") ||
      document.querySelector("[data-ai-output]");

    if (!form || !input || !output) {
      return;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const message = String(input.value || "").trim();

      if (!message) {
        return;
      }

      output.textContent = "Even denken...";

      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          credentials: "same-origin",
          body: JSON.stringify({
            message
          })
        });

        if (!response.ok) {
          throw new Error(`AI API returned ${response.status}`);
        }

        const data = await response.json();

        const answer =
          data.answer ||
          data.response ||
          data.message ||
          "Ik kon op dit moment geen antwoord geven.";

        output.textContent = String(answer);
      } catch (error) {
        console.error("FitDealFinder: AI request mislukt", error);

        output.textContent =
          "De AI Supplement Coach is tijdelijk niet beschikbaar. Probeer het later opnieuw.";
      }
    });
  }

  function setupNavigation() {
    $$("a[href^='#']").forEach((link) => {
      link.addEventListener("click", (event) => {
        const targetId = link.getAttribute("href");

        if (!targetId || targetId === "#") {
          return;
        }

        const target = document.querySelector(targetId);

        if (!target) {
          return;
        }

        event.preventDefault();

        target.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    });
  }

  function setup() {
    bindSearch();
    bindGoalFilters();
    bindCategoryFilters();
    setupPlanner();
    setupAiCoach();
    setupNavigation();
    loadProducts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup, {
      once: true
    });
  } else {
    setup();
  }
})();
