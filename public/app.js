"use strict";

(() => {
  const state = {
    products: [],
    goal: "",
    category: "",
    query: "",
    loading: false
  };

  const $ = (selector) => document.querySelector(selector);

  const searchInput = $("#search-input");
  const categorySelect = $("#category-select");
  const goalSelect = $("#goal-select");
  const productGrid = $("#product-grid");
  const productsStatus = $("#products-status");

  const plannerResult = $("#planner-result");
  const budgetInput = $("#budget-input");
  const periodSelect = $("#period-select");
  const proteinInput = $("#protein-input");
  const makePlanButton = $("#make-plan-button");

  const aiForm = $("#ai-form");
  const aiInput = $("#ai-input");
  const aiSubmit = $("#ai-submit");
  const aiResponse = $("#ai-response");

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeCategory(value) {
    const v = normalize(value);

    if (["preworkout", "pre-workout", "pre workout"].includes(v)) {
      return "preworkout";
    }

    if (["vitamine", "vitamins", "vitamines"].includes(v)) {
      return "vitamins";
    }

    if (["eiwit", "protein", "whey", "proteine"].includes(v)) {
      return "whey";
    }

    if (["creatine"].includes(v)) {
      return "creatine";
    }

    if (["gainer", "weight gainer"].includes(v)) {
      return "gainer";
    }

    if (["snacks", "protein bars", "protein bar"].includes(v)) {
      return "snacks";
    }

    if (["maaltijden", "meal replacement", "meals"].includes(v)) {
      return "meals";
    }

    return v;
  }

  function parseGoals(value) {
    if (Array.isArray(value)) {
      return value.map(normalize);
    }

    if (!value) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map(normalize);
      }
    } catch {
      // Continue with separator parsing.
    }

    return String(value)
      .split(/[;,|]/)
      .map(normalize)
      .filter(Boolean);
  }

  function formatPrice(product) {
    const price = Number(product.price);

    if (!Number.isFinite(price)) {
      return "Prijs bekijken";
    }

    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: product.currency || "EUR"
    }).format(price);
  }

  function getDiscount(product) {
    const price = Number(product.price);
    const oldPrice = Number(product.old_price);

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(oldPrice) ||
      oldPrice <= price ||
      oldPrice <= 0
    ) {
      return null;
    }

    return Math.round(((oldPrice - price) / oldPrice) * 100);
  }

  function productMatches(product) {
    const query = normalize(state.query);
    const category = normalizeCategory(state.category);
    const goal = normalize(state.goal);

    const text = [
      product.name,
      product.brand,
      product.merchant_name,
      product.category,
      product.description
    ]
      .map(normalize)
      .join(" ");

    if (query && !text.includes(query)) {
      return false;
    }

    if (
      category &&
      normalizeCategory(product.category) !== category
    ) {
      return false;
    }

    if (goal) {
      const goals = parseGoals(product.goals);

      if (!goals.includes(goal)) {
        return false;
      }
    }

    return true;
  }

  function renderProducts() {
    if (!productGrid || !productsStatus) {
      return;
    }

    const products = state.products.filter(productMatches);

    if (!products.length) {
      productsStatus.textContent =
        state.products.length === 0
          ? "Er zijn momenteel geen producten geladen."
          : "Geen producten gevonden voor deze selectie.";

      productGrid.innerHTML = `
        <div class="empty-state">
          <strong>Geen producten gevonden</strong>
          <p>
            Probeer een andere categorie, doelstelling of zoekterm.
          </p>
        </div>
      `;

      return;
    }

    productsStatus.textContent =
      `${products.length} product${products.length === 1 ? "" : "en"} gevonden`;

    productGrid.innerHTML = products
      .map((product) => {
        const discount = getDiscount(product);
        const image = product.image_url
          ? `
            <img
              src="${escapeHtml(product.image_url)}"
              alt="${escapeHtml(product.name)}"
              loading="lazy"
              referrerpolicy="no-referrer"
            >
          `
          : `
            <div class="product-placeholder">
              <span>FIT</span>
            </div>
          `;

        return `
          <article class="product-card">
            <div class="product-image">
              ${image}
              ${
                discount
                  ? `<span class="deal-badge">-${discount}%</span>`
                  : ""
              }
            </div>

            <div class="product-content">
              <div class="product-meta">
                <span>${escapeHtml(product.brand || "Supplement")}</span>
                <span>${escapeHtml(product.merchant_name || "")}</span>
              </div>

              <h3>${escapeHtml(product.name)}</h3>

              ${
                product.description
                  ? `<p>${escapeHtml(product.description).slice(0, 120)}</p>`
                  : ""
              }

              <div class="product-price">
                ${formatPrice(product)}
                ${
                  discount
                    ? `<del>${new Intl.NumberFormat("nl-NL", {
                        style: "currency",
                        currency: product.currency || "EUR"
                      }).format(Number(product.old_price))}</del>`
                    : ""
                }
              </div>

              <div class="product-actions">
                <a
                  class="product-button"
                  href="${escapeHtml(product.product_url)}"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  Bekijk winkel
                </a>
              </div>

              <small class="price-note">
                Prijsindicatie · controleer de actuele prijs bij de winkel
              </small>
            </div>
          </article>
        `;
      })
      .join("");
  }

  async function loadProducts() {
    state.loading = true;

    if (productsStatus) {
      productsStatus.textContent = "Producten laden…";
    }

    try {
      const response = await fetch(
        "/api/products?limit=100",
        {
          headers: {
            Accept: "application/json"
          },
          cache: "no-store"
        }
      );

      if (!response.ok) {
        throw new Error("Product API unavailable");
      }

      const payload = await response.json();

      const products = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.products)
          ? payload.products
          : Array.isArray(payload.data)
            ? payload.data
            : [];

      state.products = products
        .filter((product) => product && product.active !== 0)
        .filter((product) => {
          return (
            typeof product.product_url === "string" &&
            /^https?:\/\//i.test(product.product_url)
          );
        });

      renderProducts();
    } catch (error) {
      console.error("FitDealFinder product load failed:", error);

      state.products = [];

      if (productsStatus) {
        productsStatus.textContent =
          "Productgegevens konden momenteel niet worden geladen.";
      }

      if (productGrid) {
        productGrid.innerHTML = `
          <div class="empty-state">
            <strong>Producten tijdelijk niet beschikbaar</strong>
            <p>
              Probeer het later opnieuw.
            </p>
          </div>
        `;
      }
    } finally {
      state.loading = false;
    }
  }

  function applyFilters() {
    state.query = searchInput?.value || "";
    state.category = categorySelect?.value || "";
    state.goal = goalSelect?.value || "";

    renderProducts();
  }

  function setupFilters() {
    searchInput?.addEventListener("input", applyFilters);
    categorySelect?.addEventListener("change", applyFilters);
    goalSelect?.addEventListener("change", applyFilters);

    document.querySelectorAll("[data-goal-button]").forEach((button) => {
      button.addEventListener("click", () => {
        const goal = button.dataset.goalButton || "";

        state.goal = goal;

        if (goalSelect) {
          goalSelect.value = goal;
        }

        document
          .querySelectorAll("[data-goal-button]")
          .forEach((item) => item.classList.remove("active"));

        button.classList.add("active");

        renderProducts();
      });
    });

    document.querySelectorAll("[data-category]").forEach((button) => {
      button.addEventListener("click", () => {
        const category = normalizeCategory(
          button.dataset.category || ""
        );

        state.category = category;

        if (categorySelect) {
          categorySelect.value = category;
        }

        if (searchInput) {
          searchInput.value = "";
        }

        renderProducts();

        document
          .querySelector("#producten")
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
      });
    });
  }

  function setupPlanner() {
    makePlanButton?.addEventListener("click", () => {
      const budget = Number(budgetInput?.value || 0);
      const period = periodSelect?.value || "week";
      const protein = Number(proteinInput?.value || 0);

      if (!plannerResult) {
        return;
      }

      if (!Number.isFinite(budget) || budget <= 0) {
        plannerResult.innerHTML =
          "<p>Vul eerst een geldig budget in.</p>";
        return;
      }

      const periodText =
        period === "month" ? "maand" : "week";

      const suitable = state.products
        .filter((product) => productMatches(product))
        .filter((product) => Number(product.price) <= budget)
        .sort((a, b) => {
          return Number(a.price) - Number(b.price);
        })
        .slice(0, 5);

      if (!suitable.length) {
        plannerResult.innerHTML = `
          <p>
            Er is momenteel geen passend product binnen dit budget.
          </p>
        `;
        return;
      }

      const proteinText =
        protein > 0
          ? ` voor ongeveer ${protein} g eiwit per dag`
          : "";

      plannerResult.innerHTML = `
        <strong>Voorstel voor je ${periodText}${proteinText}</strong>
        <ul>
          ${suitable
            .map(
              (product) => `
                <li>
                  ${escapeHtml(product.name)}
                  — ${formatPrice(product)}
                </li>
              `
            )
            .join("")}
        </ul>
        <small>
          Dit is een eenvoudige productselectie en geen medisch of
          voedingskundig advies.
        </small>
      `;
    });
  }

  async function askAI(question) {
    if (!question.trim()) {
      return;
    }

    if (aiSubmit) {
      aiSubmit.disabled = true;
    }

    if (aiResponse) {
      aiResponse.innerHTML =
        "<p>Even nadenken…</p>";
    }

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          message: question.trim()
        })
      });

      if (!response.ok) {
        throw new Error("AI request failed");
      }

      const payload = await response.json();

      const answer =
        payload.answer ||
        payload.response ||
        payload.message ||
        "Ik kon daar momenteel geen antwoord op geven.";

      if (aiResponse) {
        aiResponse.innerHTML = `
          <p>${escapeHtml(answer).replaceAll("\n", "<br>")}</p>
          <small>
            De AI geeft algemene informatie en geen medisch advies.
          </small>
        `;
      }
    } catch (error) {
      console.error("AI request failed:", error);

      if (aiResponse) {
        aiResponse.innerHTML = `
          <p>
            De AI Coach is momenteel tijdelijk niet beschikbaar.
          </p>
        `;
      }
    } finally {
      if (aiSubmit) {
        aiSubmit.disabled = false;
      }
    }
  }

  function setupAI() {
    aiForm?.addEventListener("submit", (event) => {
      event.preventDefault();

      askAI(aiInput?.value || "");
    });
  }

  function setYear() {
    const year = $("#current-year");

    if (year) {
      year.textContent = new Date().getFullYear();
    }
  }

  function init() {
    setupFilters();
    setupPlanner();
    setupAI();
    setYear();
    loadProducts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
