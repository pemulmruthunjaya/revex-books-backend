class ProductStockSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProductStockSafetyError";
    this.code = code;
    this.status = 409;
  }
}

const normalizeKey = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[_./-]+/g, " ")
  .replace(/\s+/g, " ");

const aliases = Object.freeze({
  stock: ["stock", "current stock", "qty", "quantity"],
  opening_stock: ["opening stock", "opening qty"],
});

const suppliedQuantity = (body, names) => {
  const normalized = Object.fromEntries(
    Object.entries(body || {}).map(([key, value]) => [normalizeKey(key), value])
  );
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(normalized, name)) continue;
    const value = normalized[name];
    if (value === "" || value === null || value === undefined) return { supplied: false };
    const parsed = Number(String(value).replace(/[₹,]/g, "").trim());
    return { supplied: true, valid: Number.isFinite(parsed), value: parsed };
  }
  return { supplied: false };
};

const assertZeroInitialStock = (body) => {
  for (const names of Object.values(aliases)) {
    const quantity = suppliedQuantity(body, names);
    if (quantity.supplied && (!quantity.valid || quantity.value !== 0)) {
      throw new ProductStockSafetyError(
        "PRODUCT_INITIAL_STOCK_WORKFLOW_REQUIRED",
        "Initial stock requires a dedicated dated inventory-opening workflow"
      );
    }
  }
};

const assertUnchangedProductStock = (body, persisted) => {
  for (const [field, names] of Object.entries(aliases)) {
    const quantity = suppliedQuantity(body, names);
    if (!quantity.supplied) continue;
    if (!quantity.valid || quantity.value !== Number(persisted[field] || 0)) {
      throw new ProductStockSafetyError(
        "PRODUCT_STOCK_DIRECT_UPDATE_RESTRICTED",
        "Product stock cannot be changed through product master editing"
      );
    }
  }
};

const assertSafeProductImportRows = (rows) => {
  for (const row of rows) {
    for (const names of Object.values(aliases)) {
      const quantity = suppliedQuantity(row, names);
      if (quantity.supplied && (!quantity.valid || quantity.value !== 0)) {
        throw new ProductStockSafetyError(
          "PRODUCT_IMPORT_STOCK_RESTRICTED",
          "Product stock cannot be assigned through master import; use a dedicated inventory workflow"
        );
      }
    }
  }
};

module.exports = {
  ProductStockSafetyError,
  assertSafeProductImportRows,
  assertUnchangedProductStock,
  assertZeroInitialStock,
};
