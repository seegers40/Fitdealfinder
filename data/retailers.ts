export interface RetailerProduct {
  id: string;
  name: string;
  retailer: string;
  url: string;
  category: string;
  currency: "EUR";
}

export const RETAILER_PRODUCTS: RetailerProduct[] = [
  {
    id: "xxl-whey-delicious",
    name: "Whey Delicious",
    retailer: "XXL Nutrition",
    url: "https://xxlnutrition.com/nl/whey-delicious",
    category: "protein",
    currency: "EUR",
  },
  {
    id: "xxl-creatine-monohydraat",
    name: "Creatine Monohydraat",
    retailer: "XXL Nutrition",
    url: "https://xxlnutrition.com/nl/xxl-creatine-monohydraat",
    category: "creatine",
    currency: "EUR",
  },
  {
    id: "xxl-perfect-whey-protein",
    name: "Perfect Whey Protein",
    retailer: "XXL Nutrition",
    url: "https://xxlnutrition.com/nl/perfect-whey-protein",
    category: "protein",
    currency: "EUR",
  },
  {
    id: "xxl-clear-whey-isolate",
    name: "Clear Whey Isolate",
    retailer: "XXL Nutrition",
    url: "https://xxlnutrition.com/nl/clear-whey-isolate",
    category: "protein",
    currency: "EUR",
  },
];
