(() => {
  "use strict";

  const API_PRODUCTS = "/api/products";
  const API_AI = "/api/ai/chat";

  const PAGE_SIZE = 24;
  const API_PAGE_SIZE = 200;

  const state = {
    products: [],
    filtered: [],
    search: "",
    goal: "",
    category: "",
    visibleCount: PAGE_SIZE,
    loading: false,
  };

  const $ = (selector) =>
    document.querySelector(selector);

  const $$ = (selector) =>
    Array.from(
      document.querySelectorAll(selector),
    );

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(
        /[\u0300-\u036f]/g,
        "",
      )
      .toLowerCase()
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(
        /&/g,
        "&amp;",
      )
      .replace(
        /</g,
        "&lt;",
      )
      .replace(
        />/g,
        "&gt;",
      )
      .replace(
        /"/g,
        "&quot;",
      )
      .replace(
        /'/g,
        "&#039;",
      );
  }

  function formatPrice(
    price,
    currency = "EUR",
  ) {
    const number =
      Number(price);

    if (
      !Number.isFinite(number)
    ) {
      return "Prijs onbekend";
    }

    try {
      return new Intl.NumberFormat(
        "nl-NL",
        {
          style: "currency",
          currency:
            currency || "EUR",
        },
      ).format(number);
    } catch {
      return `€ ${number
        .toFixed(2)
        .replace(".", ",")}`;
    }
  }

  function getGoals(product) {
    if (
      Array.isArray(
        product?.goals,
      )
    ) {
      return product.goals
        .map(normalize)
        .filter(Boolean);
    }

    if (
      typeof product?.goals ===
      "string"
    ) {
      try {
        const parsed =
          JSON.parse(
            product.goals,
          );

        if (
          Array.isArray(parsed)
        ) {
          return parsed
            .map(normalize)
            .filter(Boolean);
        }
      } catch {
        // Tekstformaat.
      }

      return product.goals
        .split(
          /[;,|]/,
        )
        .map(normalize)
        .filter(Boolean);
    }

    return [];
  }

  function productIsUsable(
    product,
  ) {
    return Boolean(
      product &&
        product.id &&
        product.name &&
        product.product_url,
    );
  }

  function categoryTerms(
    category,
  ) {
    const normalized =
      normalize(category);

    if (
      normalized ===
      "proteine"
    ) {
      return [
        "proteine",
        "protein",
        "whey",
        "isolaat",
        "isolate",
        "casein",
        "caseine",
        "eiwit",
        "egg protein",
        "beef protein",
        "clear whey",
        "mass gainer",
        "gainer",
      ];
    }

    if (
      normalized ===
      "creatine"
    ) {
      return [
        "creatine",
        "crea",
        "creatine monohydraat",
        "creatine monohydrate",
      ];
    }

    if (
      normalized ===
        "pre-workout" ||
      normalized ===
        "pre workout"
    ) {
      return [
        "pre-workout",
        "pre workout",
        "preworkout",
        "pump",
        "nox",
        "5150",
        "abe",
      ];
    }

    if (
      normalized ===
      "supplementen"
    ) {
      return [
        "supplement",
        "vitamine",
        "vitamin",
        "mineral",
        "mineraal",
        "omega",
        "bcaa",
        "eaa",
        "amino",
        "carnitine",
        "glutamine",
        "magnesium",
        "zinc",
        "zink",
        "ashwagandha",
        "electrolyte",
        "elektrolyt",
        "collagen",
        "collageen",
        "multivitamin",
        "fish oil",
        "visolie",
      ];
    }

    return [normalized];
  }

  function matchesCategory(
    product,
    category,
  ) {
    if (!category) {
      return true;
    }

    const terms =
      categoryTerms(
        category,
      );

    const text = [
      product.category,
      product.name,
      product.brand,
      product.description,
    ]
      .filter(
        (value) =>
          value !== null &&
          value !== undefined,
      )
      .map(normalize)
      .join(" ");

    return terms.some(
      (term) =>
        term &&
        text.includes(term),
    );
  }

  function matchesSearch(
    product,
    search,
  ) {
    if (!search) {
      return true;
    }

    const query =
      normalize(search);

    const text = [
      product.name,
      product.brand,
      product.merchant_name,
      product.category,
      product.description,
    ]
      .filter(Boolean)
      .map(normalize)
      .join(" ");

    return text.includes(query);
  }

  function matchesGoal(
    product,
    goal,
  ) {
    if (!goal) {
      return true;
    }

    const goals =
      getGoals(product);

    return goals.includes(
      normalize(goal),
    );
  }

  function getProductImage(
    product,
  ) {
    const url =
      String(
        product?.image_url ??
          "",
      ).trim();

    if (!url) {
      return "";
    }

    return url;
  }

  function productCard(
    product,
  ) {
    const id =
      encodeURIComponent(
        String(product.id),
      );

    const name =
      escapeHtml(
        product.name,
      );

    const brand =
      escapeHtml(
        product.brand ||
          "",
      );

    const merchant =
      escapeHtml(
        product.merchant_name ||
          "Webshop",
      );

    const price =
      formatPrice(
        product.price,
        product.currency,
      );

    const oldPrice =
      product.old_price !==
        null &&
      product.old_price !==
        undefined &&
      Number(
        product.old_price,
      ) >
        Number(
          product.price,
        )
        ? formatPrice(
            product.old_price,
            product.currency,
          )
        : "";

    const discount =
      Number(
        product.discount_percent,
      );

    const hasDiscount =
      Number.isFinite(
        discount,
      ) &&
      discount > 0;

    const stock =
      Number(
        product.in_stock,
      ) === 1;

    const image =
      getProductImage(
        product,
      );

    const imageHtml =
      image
        ? `
          <div class="product-image">
            <img
              src="${escapeHtml(
                image,
              )}"
              alt="${name}"
              loading="lazy"
              referrerpolicy="no-referrer"
              onerror="this.parentElement.classList.add('image-error'); this.remove();"
            >
          </div>
        `
        : `
          <div class="product-image product-image-placeholder">
            <span>FitDeal</span>
          </div>
        `;

    const goalBadges =
      getGoals(product)
        .filter(
          (goal) =>
            [
              "cut",
              "bulk",
              "lean-bulk",
            ].includes(goal),
        )
        .map(
          (goal) =>
            `<span class="mini-badge">${escapeHtml(
              goal
                .replace(
                  "lean-bulk",
                  "Lean Bulk",
                )
                .replace(
                  /^./,
                  (letter) =>
                    letter.toUpperCase(),
                ),
            )}</span>`,
        )
        .join("");

    return `
      <article
        class="product-card"
        data-product-id="${id}"
      >
        ${
          hasDiscount
            ? `<div class="discount-badge">-${discount}%</div>`
            : ""
        }

        ${imageHtml}

        <div class="product-content">
          <div class="product-store">
            ${merchant}
          </div>

          ${
            brand
              ? `<div class="product-brand">${brand}</div>`
              : ""
          }

          <h3 class="product-title">
            ${name}
          </h3>

          <div class="product-price-row">
            <strong class="product-price">
              ${price}
            </strong>

            ${
              oldPrice
                ? `<span class="product-old-price">${oldPrice}</span>`
                : ""
            }
          </div>

          <div class="product-meta">
            <span class="stock">
              ${
                stock
                  ? "Op voorraad"
                  : "Niet op voorraad"
              }
            </span>

            ${
              hasDiscount
                ? `<span class="deal-label">Deal</span>`
                : ""
            }
          </div>

          ${
            goalBadges
              ? `<div class="product-goals">${goalBadges}</div>`
              : ""
          }

          <a
            class="product-button"
            href="/go/${id}"
          >
            Bekijk deal
          </a>

          <div class="price-note">
            Prijsindicatie · controleer de actuele prijs bij de winkel
          </div>
        </div>
      </article>
    `;
  }

  function renderProducts() {
    const grid =
      $("#products-grid");

    if (!grid) {
      return;
    }

    if (
      state.loading &&
      state.products.length === 0
    ) {
      grid.innerHTML = `
        <div class="empty-state">
          <strong>Deals laden...</strong>
          <span>We halen de actuele productcatalogus op.</span>
        </div>
      `;

      return;
    }

    const products =
      state.filtered.slice(
        0,
        state.visibleCount,
      );

    if (
      products.length === 0
    ) {
      grid.innerHTML = `
        <div class="empty-state">
          <strong>Geen producten gevonden</strong>
          <span>
            Probeer een andere zoekterm, doelstelling of rubriek.
          </span>
        </div>
      `;

      updateLoadMore();
      return;
    }

    grid.innerHTML =
      products
        .map(productCard)
        .join("");

    updateLoadMore();
  }

  function updateResultCount() {
    const count =
      $("#product-count");

    if (!count) {
      return;
    }

    const total =
      state.filtered.length;

    if (
      state.loading &&
      state.products.length === 0
    ) {
      count.textContent =
        "Deals laden...";
      return;
    }

    count.textContent =
      `${total.toLocaleString(
        "nl-NL",
      )} deals`;
  }

  function updateLoadMore() {
    const grid =
      $("#products-grid");

    if (!grid) {
      return;
    }

    const oldButton =
      document.querySelector(
        "#load-more-products",
      );

    if (oldButton) {
      oldButton.remove();
    }

    if (
      state.visibleCount >=
      state.filtered.length
    ) {
      return;
    }

    const wrapper =
      document.createElement(
        "div",
      );

    wrapper.className =
      "load-more-wrap";

    wrapper.innerHTML = `
      <button
        id="load-more-products"
        type="button"
        class="load-more-button"
      >
        Toon meer producten
      </button>
    `;

    grid.insertAdjacentElement(
      "afterend",
      wrapper,
    );

    const button =
      wrapper.querySelector(
        "#load-more-products",
      );

    button.addEventListener(
      "click",
      () => {
        state.visibleCount +=
          PAGE_SIZE;

        renderProducts();
      },
    );
  }

  function applyFilters() {
    state.filtered =
      state.products.filter(
        (product) => {
          if (
            !productIsUsable(
              product,
            )
          ) {
            return false;
          }

          if (
            !matchesSearch(
              product,
              state.search,
            )
          ) {
            return false;
          }

          if (
            !matchesGoal(
              product,
              state.goal,
            )
          ) {
            return false;
          }

          if (
            !matchesCategory(
              product,
              state.category,
            )
          ) {
            return false;
          }

          return true;
        },
      );

    state.visibleCount =
      PAGE_SIZE;

    renderProducts();
    updateResultCount();
    updateFilterButtons();
  }

  function updateFilterButtons() {
    $$(
      "[data-goal]",
    ).forEach(
      (button) => {
        const active =
          normalize(
            button.dataset.goal,
          ) ===
          normalize(
            state.goal,
          );

        button.classList.toggle(
          "active",
          Boolean(
            state.goal,
          ) &&
            active,
        );
      },
    );

    $$(
      "[data-category]",
    ).forEach(
      (button) => {
        const active =
          normalize(
            button.dataset
              .category,
          ) ===
          normalize(
            state.category,
          );

        button.classList.toggle(
          "active",
          Boolean(
            state.category,
          ) &&
            active,
        );
      },
    );
  }

  async function fetchProductsPage(
    offset,
  ) {
    const params =
      new URLSearchParams();

    params.set(
      "limit",
      String(
        API_PAGE_SIZE,
      ),
    );

    params.set(
      "offset",
      String(offset),
    );

    const response =
      await fetch(
        `${API_PRODUCTS}?${params.toString()}`,
        {
          method: "GET",
          headers: {
            accept:
              "application/json",
          },
          cache: "no-store",
        },
      );

    if (!response.ok) {
      throw new Error(
        `Product API HTTP ${response.status}`,
      );
    }

    const data =
      await response.json();

    if (
      !data ||
      !Array.isArray(
        data.products,
      )
    ) {
      throw new Error(
        "Product API gaf geen geldige productlijst terug.",
      );
    }

    return data;
  }

  async function loadProducts() {
    if (state.loading) {
      return;
    }

    state.loading = true;

    renderProducts();
    updateResultCount();

    try {
      const first =
        await fetchProductsPage(
          0,
        );

      const products =
        Array.isArray(
          first.products,
        )
          ? first.products
          : [];

      /*
       * We halen de catalogus in pagina's op.
       * Daardoor is de frontend niet afhankelijk
       * van een maximum van 100 producten.
       */
      let offset =
        products.length;

      const total =
        Number(
          first.total,
        );

      const expectedTotal =
        Number.isFinite(total) &&
        total > 0
          ? Math.min(
              total,
              2000,
            )
          : 2000;

      while (
        products.length <
          expectedTotal &&
        first.has_more !==
          false &&
        products.length <
          2000
      ) {
        const page =
          await fetchProductsPage(
            offset,
          );

        if (
          !page.products.length
        ) {
          break;
        }

        products.push(
          ...page.products,
        );

        offset =
          products.length;

        if (
          page.has_more ===
          false
        ) {
          break;
        }

        if (
          page.products.length <
          API_PAGE_SIZE
        ) {
          break;
        }
      }

      /*
       * Deduplicatie op product-ID.
       */
      const unique =
        new Map();

      products.forEach(
        (product) => {
          if (
            productIsUsable(
              product,
            )
          ) {
            unique.set(
              String(
                product.id,
              ),
              product,
            );
          }
        },
      );

      state.products =
        Array.from(
          unique.values(),
        );

      applyFilters();
    } catch (
      error
    ) {
      console.error(
        "FitDealFinder products error:",
        error,
      );

      state.products = [];
      state.filtered = [];

      const grid =
        $("#products-grid");

      if (grid) {
        grid.innerHTML = `
          <div class="empty-state">
            <strong>Deals konden niet worden geladen</strong>
            <span>
              Probeer de pagina opnieuw te laden.
            </span>
          </div>
        `;
      }

      const count =
        $("#product-count");

      if (count) {
        count.textContent =
          "Geen deals geladen";
      }
    } finally {
      state.loading =
        false;

      renderProducts();
      updateResultCount();
    }
  }

  function bindSearch() {
    const input =
      $("#search");

    if (!input) {
      return;
    }

    let timer = null;

    input.addEventListener(
      "input",
      () => {
        clearTimeout(timer);

        timer = setTimeout(
          () => {
            state.search =
              input.value;

            applyFilters();
          },
          120,
        );
      },
    );
  }

  function bindGoalFilters() {
    $$(
      "[data-goal]",
    ).forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const value =
              button.dataset.goal ||
              "";

            if (
              normalize(
                state.goal,
              ) ===
              normalize(value)
            ) {
              state.goal = "";
            } else {
              state.goal =
                value;
            }

            applyFilters();
          },
        );
      },
    );
  }

  function bindCategoryFilters() {
    $$(
      "[data-category]",
    ).forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const value =
              button.dataset
                .category ||
              "";

            if (
              normalize(
                state.category,
              ) ===
              normalize(value)
            ) {
              state.category =
                "";
            } else {
              state.category =
                value;
            }

            applyFilters();
          },
        );
      },
    );
  }

  function setupPlanner() {
    const form =
      $("#planner-form");

    const result =
      $("#planner-result");

    if (
      !form ||
      !result
    ) {
      return;
    }

    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();

        const goal =
          normalize(
            $("#planner-goal")
              ?.value ||
              "",
          );

        const budget =
          Number(
            $("#planner-budget")
              ?.value ||
              0,
          );

        if (
          !goal ||
          !Number.isFinite(
            budget,
          ) ||
          budget <= 0
        ) {
          result.innerHTML = `
            <div class="planner-message">
              Kies een doel en vul een budget in.
            </div>
          `;

          return;
        }

        const products =
          state.products
            .filter(
              (product) =>
                productIsUsable(
                  product,
                ),
            )
            .filter(
              (product) =>
                matchesGoal(
                  product,
                  goal,
                ),
            )
            .filter(
              (product) =>
                Number(
                  product.price,
                ) <= budget,
            )
            .sort(
              (a, b) =>
                Number(
                  b.deal_score ||
                    0,
                ) -
                Number(
                  a.deal_score ||
                    0,
                ),
            )
            .slice(
              0,
              5,
            );

        if (
          !products.length
        ) {
          result.innerHTML = `
            <div class="planner-message">
              Geen passende deals gevonden binnen dit budget.
            </div>
          `;

          return;
        }

        result.innerHTML = `
          <div class="planner-message">
            <strong>${products.length} passende deals</strong>
            <div class="planner-products">
              ${products
                .map(
                  (product) =>
                    `
                    <a
                      href="/go/${encodeURIComponent(
                        product.id,
                      )}"
                      class="planner-product"
                    >
                      <span>
                        ${escapeHtml(
                          product.name,
                        )}
                      </span>
                      <strong>
                        ${formatPrice(
                          product.price,
                          product.currency,
                        )}
                      </strong>
                    </a>
                  `,
                )
                .join("")}
            </div>
          </div>
        `;
      },
    );
  }

  async function setupAiCoach() {
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
      async (event) => {
        event.preventDefault();

        const message =
          input.value.trim();

        if (!message) {
          return;
        }

        output.innerHTML = `
          <div class="ai-loading">
            Even nadenken...
          </div>
        `;

        try {
          const response =
            await fetch(
              API_AI,
              {
                method:
                  "POST",

                headers: {
                  "content-type":
                    "application/json",

                  accept:
                    "application/json",
                },

                body:
                  JSON.stringify({
                    message,
                  }),
              },
            );

          const data =
            await response.json();

          if (
            !response.ok
          ) {
            throw new Error(
              data?.error ||
                "AI-service niet beschikbaar.",
            );
          }

          const answer =
            data?.answer ??
            data?.response ??
            data?.message ??
            "";

          if (
            typeof answer ===
              "object" &&
            answer !== null
          ) {
            output.textContent =
              JSON.stringify(
                answer,
              );
          } else {
            output.textContent =
              String(
                answer,
              );
          }
        } catch (
          error
        ) {
          console.error(
            "AI Coach error:",
            error,
          );

          output.innerHTML = `
            <div class="ai-error">
              De Supplement Coach is tijdelijk niet beschikbaar.
            </div>
          `;
        }
      },
    );
  }

  function setupNavigation() {
    $$(
      "[data-scroll]",
    ).forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const target =
              button.dataset
                .scroll;

            if (!target) {
              return;
            }

            const element =
              document.querySelector(
                target,
              );

            if (
              element
            ) {
              element.scrollIntoView(
                {
                  behavior:
                    "smooth",
                  block:
                    "start",
                },
              );
            }
          },
        );
      },
    );
  }

  function setupMobileMenu() {
    const button =
      document.querySelector(
        "[data-menu-toggle]",
      );

    const menu =
      document.querySelector(
        "[data-mobile-menu]",
      );

    if (
      !button ||
      !menu
    ) {
      return;
    }

    button.addEventListener(
      "click",
      () => {
        const open =
          menu.classList.toggle(
            "open",
          );

        button.setAttribute(
          "aria-expanded",
          String(open),
        );
      },
    );

    menu
      .querySelectorAll("a")
      .forEach(
        (link) => {
          link.addEventListener(
            "click",
            () => {
              menu.classList.remove(
                "open",
              );

              button.setAttribute(
                "aria-expanded",
                "false",
              );
            },
          );
        },
      );
  }

  function setupUrlState() {
    const params =
      new URLSearchParams(
        window.location.search,
      );

    const search =
      params.get("search");

    const goal =
      params.get("goal");

    const category =
      params.get("category");

    if (search) {
      state.search =
        search;

      const input =
        $("#search");

      if (input) {
        input.value =
          search;
      }
    }

    if (goal) {
      state.goal =
        goal;
    }

    if (category) {
      state.category =
        category;
    }
  }

  function setup() {
    setupUrlState();

    bindSearch();
    bindGoalFilters();
    bindCategoryFilters();

    setupPlanner();
    setupAiCoach();
    setupNavigation();
    setupMobileMenu();

    updateFilterButtons();

    loadProducts();
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      setup,
    );
  } else {
    setup();
  }
})();
