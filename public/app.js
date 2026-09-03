"use strict";

const FALLBACK_PRODUCTS = [
  {
    id: 1,
    name: "Whey Delicious",
    brand: "XXL Nutrition",
    category: "whey",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 19.99,
    productUrl: "https://xxlnutrition.com/nl/whey-delicious",
    protein: 24
  },
  {
    id: 2,
    name: "Perfect Whey Protein",
    brand: "XXL Nutrition",
    category: "whey",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 25.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 24
  },
  {
    id: 3,
    name: "Whey Isolaat",
    brand: "XXL Nutrition",
    category: "whey",
    goals: ["cut", "lean-bulk"],
    price: 25.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 25
  },
  {
    id: 4,
    name: "Clear Whey Isolate",
    brand: "XXL Nutrition",
    category: "whey",
    goals: ["cut", "lean-bulk"],
    price: 29.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 20
  },
  {
    id: 5,
    name: "Whey Isolate Zero",
    brand: "XXL Nutrition",
    category: "whey",
    goals: ["cut", "lean-bulk"],
    price: 28.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 25
  },
  {
    id: 6,
    name: "Green Protein",
    brand: "XXL Nutrition",
    category: "whey",
    goals: ["cut", "lean-bulk"],
    price: 18.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 20
  },
  {
    id: 7,
    name: "Perfect Milk Protein",
    brand: "XXL Nutrition",
    category: "whey",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 9.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 22
  },
  {
    id: 8,
    name: "Creatine Monohydraat",
    brand: "XXL Nutrition",
    category: "creatine",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 8.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 0
  },
  {
    id: 9,
    name: "Muscle Grow",
    brand: "XXL Nutrition",
    category: "gainer",
    goals: ["bulk", "lean-bulk"],
    price: 28.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 20
  },
  {
    id: 10,
    name: "Protein Lemonade",
    brand: "XXL Nutrition",
    category: "whey",
    goals: ["cut", "lean-bulk"],
    price: 2.25,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 10
  },
  {
    id: 11,
    name: "Diet Shake",
    brand: "XXL Nutrition",
    category: "meals",
    goals: ["cut"],
    price: 15.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 20
  },
  {
    id: 12,
    name: "Protein Drink Zero",
    brand: "XXL Nutrition",
    category: "whey",
    goals: ["cut", "lean-bulk"],
    price: 8.49,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 20
  },
  {
    id: 13,
    name: "High Protein Bar",
    brand: "XXL Nutrition",
    category: "snacks",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 2.59,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 20
  },
  {
    id: 14,
    name: "Blast! Pre-Workout",
    brand: "XXL Nutrition",
    category: "preworkout",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 27.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 0
  },
  {
    id: 15,
    name: "Multivit - 120 tabletten",
    brand: "XXL Nutrition",
    category: "vitamins",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 17.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 0
  },
  {
    id: 16,
    name: "Omega 3 Ultra Pure",
    brand: "XXL Nutrition",
    category: "vitamins",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 13.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 0
  },
  {
    id: 17,
    name: "Hydrate - 20 bruistabletten",
    brand: "XXL Nutrition",
    category: "vitamins",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 4.99,
    productUrl: "https://xxlnutrition.com/nl/alle-producten",
    protein: 0
  },
  {
    id: 18,
    name: "Perfection Whey",
    brand: "Body & Fit",
    category: "whey",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 34.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 24
  },
  {
    id: 19,
    name: "GOLD STANDARD 100% Whey Protein",
    brand: "Optimum Nutrition",
    category: "whey",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 22.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 24
  },
  {
    id: 20,
    name: "Creatine Monohydrate",
    brand: "Body & Fit",
    category: "creatine",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 6.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 0
  },
  {
    id: 21,
    name: "Creatine Creapure",
    brand: "Body & Fit",
    category: "creatine",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 29.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 0
  },
  {
    id: 22,
    name: "Mass Perfection Weight Gainer",
    brand: "Body & Fit",
    category: "gainer",
    goals: ["bulk"],
    price: 72.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 20
  },
  {
    id: 23,
    name: "Massive Gainer",
    brand: "Body & Fit",
    category: "gainer",
    goals: ["bulk"],
    price: 56.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 20
  },
  {
    id: 24,
    name: "Micellar Casein Perfection",
    brand: "Body & Fit",
    category: "whey",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 29.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 24
  },
  {
    id: 25,
    name: "Perfection Pre-Workout",
    brand: "Body & Fit",
    category: "preworkout",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 27.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 0
  },
  {
    id: 26,
    name: "BF10 Pre-workout",
    brand: "Body & Fit",
    category: "preworkout",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 14.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 0
  },
  {
    id: 27,
    name: "High Fibre Protein Bar",
    brand: "Body & Fit",
    category: "snacks",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 24.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 20
  },
  {
    id: 28,
    name: "Perfection Protein Bar",
    brand: "Body & Fit",
    category: "snacks",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 24.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 20
  },
  {
    id: 29,
    name: "Protein Cookies",
    brand: "Body & Fit",
    category: "snacks",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 16.19,
    productUrl: "https://www.bodyandfit.com/",
    protein: 20
  },
  {
    id: 30,
    name: "Smart Chips",
    brand: "Body & Fit",
    category: "snacks",
    goals: ["cut", "lean-bulk"],
    price: 0.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 10
  },
  {
    id: 31,
    name: "Smart Pasta",
    brand: "Body & Fit",
    category: "meals",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 2.79,
    productUrl: "https://www.bodyandfit.com/",
    protein: 10
  },
  {
    id: 32,
    name: "Smart Crunchy Wafels",
    brand: "Body & Fit",
    category: "snacks",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 18.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 10
  },
  {
    id: 33,
    name: "All In One",
    brand: "Body & Fit",
    category: "meals",
    goals: ["bulk", "lean-bulk"],
    price: 32.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 20
  },
  {
    id: 34,
    name: "Low Calorie Meal Replacement",
    brand: "Body & Fit",
    category: "meals",
    goals: ["cut"],
    price: 20.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 20
  },
  {
    id: 35,
    name: "Perfection Whey Lemonade",
    brand: "Body & Fit",
    category: "whey",
    goals: ["cut", "lean-bulk"],
    price: 26.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 20
  },
  {
    id: 36,
    name: "Whey Isolate XP",
    brand: "Body & Fit",
    category: "whey",
    goals: ["cut", "lean-bulk"],
    price: 41.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 25
  },
  {
    id: 37,
    name: "Isolate Perfection",
    brand: "Body & Fit",
    category: "whey",
    goals: ["cut", "lean-bulk"],
    price: 39.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 25
  },
  {
    id: 38,
    name: "Smart Protein",
    brand: "Body & Fit",
    category: "whey",
    goals: ["cut", "bulk", "lean-bulk"],
    price: 35.99,
    productUrl: "https://www.bodyandfit.com/",
    protein: 24
  }
];

const state = {
  products: [],
  goal: "cut",
  search: "",
  category: ""
};

const elements = {
  goalButtons: document.querySelectorAll("[data-goal-button]"),
  goalSelect: document.getElementById("goal-select"),
  budgetInput: document.getElementById("budget-input"),
  periodSelect: document.getElementById("period-select"),
  proteinInput: document.getElementById("protein-input"),
  makePlanButton: document.getElementById("make-plan-button"),
  plannerResult: document.getElementById("planner-result"),
  searchInput: document.getElementById("search-input"),
  categorySelect: document.getElementById("category-select"),
  productsStatus: document.getElementById("products-status"),
  productGrid: document.getElementById("product-grid"),
  currentYear: document.getElementById("current-year")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPrice(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "Prijs onbekend";
  }

  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR"
  }).format(number);
}

function normalizeProduct(product, fallbackId) {
  const goals = Array.isArray(product.goals)
    ? product.goals
        .map((goal) => String(goal).trim().toLowerCase())
        .filter(Boolean)
    : ["cut", "bulk", "lean-bulk"];

  return {
    id: product.id ?? fallbackId,
    name: String(product.name ?? "Onbekend product"),
    brand: String(product.brand ?? "Onbekend merk"),
    category: String(product.category ?? "overig").toLowerCase(),
    goals,
    price: Number(product.price) || 0,
    productUrl: String(
      product.productUrl ??
      product.product_url ??
      product.url ??
      ""
    ),
    protein: Number(product.protein) || 0
  };
}

function productMatchesGoal(product, goal) {
  return (
    Array.isArray(product.goals) &&
    product.goals.includes(goal)
  );
}

function getFilteredProducts() {
  const search = state.search.trim().toLowerCase();

  return state.products.filter((product) => {
    const matchesSearch =
      !search ||
      product.name.toLowerCase().includes(search) ||
      product.brand.toLowerCase().includes(search);

    const matchesCategory =
      !state.category ||
      product.category === state.category;

    return matchesSearch && matchesCategory;
  });
}

function getProductLink(product) {
  const hasApiProductId =
    typeof product.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      product.id
    );

  if (hasApiProductId) {
    return `/go/${encodeURIComponent(product.id)}`;
  }

  return product.productUrl || "#";
}
function renderProducts() {
  const products = getFilteredProducts();

  if (!elements.productGrid) {
    return;
  }

  if (elements.productsStatus) {
    elements.productsStatus.textContent =
      `${products.length} product${products.length === 1 ? "" : "en"} gevonden`;
  }

  if (products.length === 0) {
    elements.productGrid.innerHTML = `
      <div class="empty-state">
        Geen producten gevonden met deze zoekopdracht.
      </div>
    `;
    return;
  }

  elements.productGrid.innerHTML = products
    .map((product) => {
      const goals = product.goals
        .map((goal) => {
          const labels = {
            cut: "Cut",
            bulk: "Bulk",
            "lean-bulk": "Lean Bulk"
          };

          return `
            <span class="product-goal">
              ${escapeHtml(labels[goal] || goal)}
            </span>
          `;
        })
        .join("");

      return `
        <article class="product-card">
          <span class="product-category">
            ${escapeHtml(product.category)}
          </span>

          <h3>${escapeHtml(product.name)}</h3>

          <p class="product-brand">
            ${escapeHtml(product.brand)}
          </p>

          <div class="product-goals">
            ${goals}
          </div>

          <div class="product-bottom">
            <div class="product-price">
              ${formatPrice(product.price)}
              ${
                product.protein > 0
                  ? `<small>${escapeHtml(product.protein)} g eiwit</small>`
                  : ""
              }
            </div>

            <a
              class="product-link"
              href="${escapeHtml(getProductLink(product))}"
            >
              Bekijk deal
            </a>
          </div>
        </article>
      `;
    })
    .join("");
}

function setGoal(goal) {
  const validGoals = ["cut", "bulk", "lean-bulk"];

  if (!validGoals.includes(goal)) {
    return;
  }

  state.goal = goal;

  if (elements.goalSelect) {
    elements.goalSelect.value = goal;
  }

  elements.goalButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.goalButton === goal
    );
  });
}

function createPlan() {
  const budget = Number(elements.budgetInput?.value);
  const period = elements.periodSelect?.value || "week";
  const proteinTarget = Number(elements.proteinInput?.value);

  if (!Number.isFinite(budget) || budget <= 0) {
    elements.plannerResult.innerHTML = `
      <div class="plan-summary">
        <h3>Vul een geldig budget in</h3>
        <p>Gebruik een bedrag groter dan €0.</p>
      </div>
    `;
    return;
  }

  const candidates = state.products
    .filter((product) => productMatchesGoal(product, state.goal))
    .filter((product) => Number.isFinite(product.price) && product.price > 0)
    .sort((a, b) => a.price - b.price);

  const selected = [];
  let total = 0;

  for (const product of candidates) {
    if (selected.length >= 5) {
      break;
    }

    if (total + product.price <= budget) {
      selected.push(product);
      total += product.price;
    }
  }

  const goalLabels = {
    cut: "Cut",
    bulk: "Bulk",
    "lean-bulk": "Lean Bulk"
  };

  const periodLabel =
    period === "month" ? "per maand" : "per week";

  const proteinText =
    Number.isFinite(proteinTarget) && proteinTarget > 0
      ? `Je ingevoerde eiwitdoel is ${proteinTarget} g per dag.`
      : "Er is geen eiwitdoel ingesteld.";

  if (selected.length === 0) {
    elements.plannerResult.innerHTML = `
      <div class="plan-summary">
        <h3>Geen pakket binnen budget</h3>
        <p>
          Er zijn momenteel geen geschikte producten binnen
          ${formatPrice(budget)}.
        </p>
        <p>${escapeHtml(proteinText)}</p>
      </div>
    `;
    return;
  }

  const remaining = Math.max(0, budget - total);

  const productsHtml = selected
    .map(
      (product) => `
        <div class="plan-product">
          <div>
            <div class="plan-product-name">
              ${escapeHtml(product.name)}
            </div>

            <div class="plan-product-meta">
              ${escapeHtml(product.brand)}
            </div>
          </div>

          <div class="plan-product-price">
            ${formatPrice(product.price)}
          </div>
        </div>
      `
    )
    .join("");

  elements.plannerResult.innerHTML = `
    <div class="plan-summary">
      <h3>Jouw ${escapeHtml(goalLabels[state.goal])}-pakket</h3>

      <p>
        ${selected.length} producten voor
        ${formatPrice(total)} ${escapeHtml(periodLabel)}.
      </p>

      <p>
        Resterend budget:
        ${formatPrice(remaining)}.
      </p>

      <p>${escapeHtml(proteinText)}</p>

      <div class="plan-products">
        ${productsHtml}
      </div>

      <div class="plan-warning">
        De planner gebruikt prijs en doel om maximaal vijf producten
        binnen het budget te selecteren. Het ingevoerde eiwitdoel wordt
        momenteel alleen weergegeven en nog niet gebruikt voor de selectie.
      </div>
    </div>
  `;
}

async function loadProducts() {
  state.products = FALLBACK_PRODUCTS.map((product) =>
    normalizeProduct(product, product.id)
  );

  renderProducts();

  try {
    const response = await fetch("/api/products?limit=100", {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();

    const apiProducts = Array.isArray(data)
      ? data
      : Array.isArray(data.products)
        ? data.products
        : [];

    if (apiProducts.length > 0) {
      state.products = apiProducts.map((product, index) =>
        normalizeProduct(product, index + 1)
      );

      if (elements.productsStatus) {
        elements.productsStatus.textContent =
          `${state.products.length} actuele producten geladen`;
      }

      renderProducts();
    }
  } catch {
    if (elements.productsStatus) {
      elements.productsStatus.textContent =
        `${state.products.length} producten beschikbaar`;
    }
  }
}

function initializeEvents() {
  elements.goalButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setGoal(button.dataset.goalButton);
      createPlan();
    });
  });

  elements.goalSelect?.addEventListener("change", (event) => {
    setGoal(event.target.value);
    createPlan();
  });

  elements.makePlanButton?.addEventListener(
    "click",
    createPlan
  );

  elements.searchInput?.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderProducts();
  });

  elements.categorySelect?.addEventListener("change", (event) => {
    state.category = event.target.value;
    renderProducts();
  });
}

function initialize() {
  if (elements.currentYear) {
    elements.currentYear.textContent = String(
      new Date().getFullYear()
    );
  }

  setGoal("cut");
  initializeEvents();
  loadProducts();
}

document.addEventListener("DOMContentLoaded", initialize);
