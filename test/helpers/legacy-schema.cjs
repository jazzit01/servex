function restoreRequiredMenuReference(db) {
  const [[schema]] = db.exec("SELECT sql FROM sqlite_master WHERE name = 'order_items'")[0].values
  const table = schema.replace(/^CREATE TABLE "?order_items"?/, 'CREATE TABLE legacy_order_items')
    .replace('menu_item_id INTEGER REFERENCES', 'menu_item_id INTEGER NOT NULL REFERENCES')
  db.run(table + '; INSERT INTO legacy_order_items SELECT * FROM order_items; DROP TABLE order_items; ALTER TABLE legacy_order_items RENAME TO order_items;')
}

function removeEnterprise(db) {
  restoreRequiredMenuReference(db)
  db.run(`
    DROP TABLE loyalty_ledger;
    DROP TABLE ingredient_movements;
    DROP TABLE menu_recipes;
    DROP TABLE ingredients;
    DROP TABLE customers;
    DROP TABLE reservations;
    DROP TABLE pricing_rules;
    DROP TABLE expenses;
    DROP TABLE printers;
    ALTER TABLE categories DROP COLUMN station;
    ALTER TABLE menu_items DROP COLUMN station;
    ALTER TABLE order_items DROP COLUMN station;
    ALTER TABLE order_items DROP COLUMN pricing_label;
    ALTER TABLE kitchen_tickets DROP COLUMN station;
    ALTER TABLE orders DROP COLUMN customer_id;
    ALTER TABLE orders DROP COLUMN loyalty_redeemed;
    ALTER TABLE orders DROP COLUMN is_parked;
    ALTER TABLE settings DROP COLUMN theme_mode;
    ALTER TABLE settings DROP COLUMN sound_enabled;
    ALTER TABLE settings DROP COLUMN loyalty_earn_percent;
  `)
}
module.exports = { removeEnterprise, restoreRequiredMenuReference }
