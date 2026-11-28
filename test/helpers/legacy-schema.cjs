function removeEnterprise(db) {
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
module.exports = { removeEnterprise }
