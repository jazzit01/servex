import { foodReferenceForName } from '../src/types/foodLibrary'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import initSqlJs, { Database, SqlJsStatic, SqlValue } from 'sql.js'

const schema = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), restaurant_name TEXT NOT NULL, tagline TEXT,
  logo_path TEXT, address TEXT, phone TEXT, gstin TEXT, currency_symbol TEXT DEFAULT '₹',
  tax_rate REAL DEFAULT 5.0, tax_inclusive INTEGER DEFAULT 0, receipt_footer TEXT,
  manager_pin TEXT DEFAULT '1234', cloud_sync_enabled INTEGER DEFAULT 0, cloud_endpoint TEXT, license_key TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  role TEXT CHECK(role IN ('admin','manager','cashier')) NOT NULL, pin TEXT NOT NULL, is_active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT, zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  label TEXT NOT NULL, type TEXT CHECK(type IN ('table','garden','room')) DEFAULT 'table',
  x_pos INTEGER DEFAULT 40, y_pos INTEGER DEFAULT 40, width INTEGER DEFAULT 120, height INTEGER DEFAULT 110,
  capacity INTEGER DEFAULT 4, status TEXT CHECK(status IN ('vacant','occupied','billed','cleaning')) DEFAULT 'vacant'
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL, price REAL NOT NULL, tax_slab REAL DEFAULT 5.0, is_veg INTEGER DEFAULT 1,
  image_path TEXT, is_available INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bill_number TEXT UNIQUE, table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,
  order_type TEXT CHECK(order_type IN ('dinein','parcel','room')) NOT NULL, customer_name TEXT, customer_phone TEXT,
  status TEXT CHECK(status IN ('open','billed','paid','void')) DEFAULT 'open', subtotal REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0, discount_percent REAL DEFAULT 0, tax_amount REAL DEFAULT 0, grand_total REAL DEFAULT 0,
  payment_mode TEXT, cash_tendered REAL DEFAULT 0, change_returned REAL DEFAULT 0, created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id), item_name TEXT NOT NULL, unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1, notes TEXT, kot_printed INTEGER DEFAULT 0, line_total REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, entity_type TEXT,
  entity_id INTEGER, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`

const v2Columns = `
ALTER TABLE settings ADD COLUMN pin_salt TEXT;
ALTER TABLE settings ADD COLUMN cloud_last_synced TEXT;
ALTER TABLE menu_items ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`

const v3Columns = `
ALTER TABLE settings ADD COLUMN auto_cleaning INTEGER NOT NULL DEFAULT 0 CHECK (auto_cleaning IN (0, 1));
ALTER TABLE orders ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN guest_count INTEGER;
ALTER TABLE order_items ADD COLUMN net_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN tax_rate_snapshot REAL;
ALTER TABLE order_items ADD COLUMN tax_inclusive_snapshot INTEGER;`

const v4Schema = `
ALTER TABLE settings ADD COLUMN upi_id TEXT NOT NULL DEFAULT 'servex@upi';
ALTER TABLE settings ADD COLUMN receipt_width INTEGER NOT NULL DEFAULT 80;
ALTER TABLE settings ADD COLUMN print_preview INTEGER NOT NULL DEFAULT 1;
ALTER TABLE settings ADD COLUMN printer_name TEXT;
ALTER TABLE orders ADD COLUMN receipt_json TEXT;
CREATE TABLE bill_sequences (day TEXT PRIMARY KEY, last_number INTEGER NOT NULL);
CREATE TABLE kitchen_tickets (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'preparing', reference TEXT NOT NULL, lines TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`

const v5Schema = `
ALTER TABLE settings ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 1;
ALTER TABLE settings ADD COLUMN lan_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN lan_actor INTEGER;
CREATE TABLE z_reports (day TEXT PRIMARY KEY, actor INTEGER NOT NULL REFERENCES users(id),
  closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, content TEXT NOT NULL);
CREATE TABLE lan_requests (request_id TEXT PRIMARY KEY, payload TEXT NOT NULL, order_id INTEGER NOT NULL);
CREATE TRIGGER z_reports_no_update BEFORE UPDATE ON z_reports BEGIN SELECT RAISE(ABORT, 'Z-reports are immutable'); END;
CREATE TRIGGER z_reports_no_delete BEFORE DELETE ON z_reports BEGIN SELECT RAISE(ABORT, 'Z-reports are immutable'); END;
`

const enterpriseSchema = `
CREATE TABLE IF NOT EXISTS ingredients (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,unit TEXT NOT NULL,current_stock REAL DEFAULT 0,low_stock_threshold REAL DEFAULT 10,cost_per_unit REAL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS menu_recipes (id INTEGER PRIMARY KEY AUTOINCREMENT,menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,quantity_required REAL NOT NULL,UNIQUE(menu_item_id,ingredient_id));
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,birthday TEXT,loyalty_points REAL DEFAULT 0,total_visits INTEGER DEFAULT 0,total_spent REAL DEFAULT 0,favorite_item TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reservations (id INTEGER PRIMARY KEY AUTOINCREMENT,table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,customer_name TEXT NOT NULL,customer_phone TEXT NOT NULL,guest_count INTEGER DEFAULT 2,reservation_time TEXT NOT NULL,status TEXT CHECK(status IN ('booked','seated','cancelled','waitlist')) DEFAULT 'booked',notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,order_id INTEGER);
CREATE TABLE IF NOT EXISTS pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,rule_type TEXT CHECK(rule_type IN ('discount_percent','surcharge_percent')) NOT NULL,value REAL NOT NULL,category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,days_of_week TEXT DEFAULT '0,1,2,3,4,5,6',start_time TEXT NOT NULL,end_time TEXT NOT NULL,is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,category TEXT NOT NULL,amount REAL NOT NULL,payment_mode TEXT DEFAULT 'Cash',notes TEXT,recorded_by INTEGER REFERENCES users(id),created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS printers (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,role TEXT CHECK(role IN ('receipt','kitchen','bar')) NOT NULL UNIQUE,connection_type TEXT CHECK(connection_type IN ('os','usb','lan')) DEFAULT 'os',address TEXT,paper_width TEXT DEFAULT '80mm',is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS ingredient_movements (id INTEGER PRIMARY KEY, ingredient_id INTEGER NOT NULL REFERENCES ingredients(id), order_id INTEGER REFERENCES orders(id), quantity REAL NOT NULL, reason TEXT NOT NULL, actor INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS loyalty_ledger (order_id INTEGER PRIMARY KEY REFERENCES orders(id), customer_id INTEGER NOT NULL REFERENCES customers(id), earned REAL NOT NULL, redeemed REAL NOT NULL, spent REAL NOT NULL);
CREATE INDEX IF NOT EXISTS reservation_lookup ON reservations(table_id,status,reservation_time);
CREATE INDEX IF NOT EXISTS movement_orders ON ingredient_movements(order_id);
`
const enterpriseColumns = {
  categories: { station: "TEXT CHECK(station IN ('kitchen','bar','none')) DEFAULT 'kitchen'" },
  menu_items: { station: "TEXT CHECK(station IN ('kitchen','bar','none')) DEFAULT 'kitchen'" },
  order_items: { station: "TEXT NOT NULL DEFAULT 'kitchen'", pricing_label: 'TEXT' },
  kitchen_tickets: { station: "TEXT NOT NULL DEFAULT 'kitchen'" },
  orders: { customer_id: 'INTEGER', loyalty_redeemed: 'REAL DEFAULT 0', is_parked: 'INTEGER DEFAULT 0' },
  settings: { theme_mode: "TEXT DEFAULT 'light'", sound_enabled: 'INTEGER DEFAULT 1', loyalty_earn_percent: 'REAL DEFAULT 2.0' },
}

function enterpriseMigrate(db: Database) {
  db.run(enterpriseSchema)
  for (const [table, fields] of Object.entries(enterpriseColumns)) {
    const columns = new Set(db.exec(`PRAGMA table_info(${table})`)[0].values.map(row => row[1]))
    for (const [column, definition] of Object.entries(fields)) {
      if (!columns.has(column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }
}

export function atomicWrite(file: string, bytes: Uint8Array) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600, flush: true })
    fs.renameSync(temp, file)
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

export function hashPin(pin: string, salt: string) {
  return scryptSync(pin, salt, 32).toString('hex')
}

const v8OrderItems = `
CREATE TABLE order_items_v8 (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id), item_name TEXT NOT NULL, unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1, notes TEXT, kot_printed INTEGER DEFAULT 0, line_total REAL NOT NULL,
  net_minor INTEGER NOT NULL DEFAULT 0, tax_minor INTEGER NOT NULL DEFAULT 0, tax_rate_snapshot REAL,
  tax_inclusive_snapshot INTEGER, station TEXT NOT NULL DEFAULT 'kitchen', pricing_label TEXT
);
INSERT INTO order_items_v8
  SELECT id, order_id, menu_item_id, item_name, unit_price, quantity, notes, kot_printed, line_total,
    net_minor, tax_minor, tax_rate_snapshot, tax_inclusive_snapshot, station, pricing_label FROM order_items;
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name='order_items'), 0))
  WHERE name='order_items_v8';
DROP TABLE order_items;
ALTER TABLE order_items_v8 RENAME TO order_items;
`

const v9ZoneColor = "ALTER TABLE zones ADD COLUMN color TEXT CHECK(color IN ('sky','emerald','amber','purple','rose','teal','indigo','orange'));"

function migrate(db: Database) {
  db.run('PRAGMA foreign_keys = ON')
  const version = Number(db.exec('PRAGMA user_version')[0].values[0][0])
  if (version > 9) throw new Error('This database requires a newer ServeX version.')
  db.run('BEGIN')
  const fresh = version === 0 && !db.exec("SELECT name FROM sqlite_master WHERE name = 'settings' AND type = 'table'").length
  if (version < 1) db.run(schema + 'PRAGMA user_version = 1;')
  if (!db.exec('SELECT id FROM settings').length) {
    db.run(`INSERT INTO settings (id, restaurant_name, tagline) VALUES (1, 'ServeX Demo Kitchen', 'Powered by ServeX POS');
      INSERT INTO users (name, role, pin) SELECT 'Admin', 'admin', '1234' WHERE NOT EXISTS (SELECT 1 FROM users);`)
    const zones = [
      ['Ground Floor', 'table', 'T'], ['Garden Lawn', 'garden', 'G'], ['Luxury Rooms', 'room', 'R'],
    ]
    zones.forEach(([name, type, prefix], index) => {
      db.run('INSERT INTO zones (name, sort_order) VALUES (?, ?)', [name, index])
      const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0]
      for (let i = 0; i < 4; i++) {
        db.run('INSERT INTO tables (zone_id, label, type, x_pos, y_pos, capacity) VALUES (?, ?, ?, ?, ?, ?)',
          [id, `${prefix}-0${i + 1}`, type, 40 + (i % 2) * 168, 40 + Math.floor(i / 2) * 144, type === 'room' ? 2 : 4])
      }
    })
    const groups = [
      { name: 'Starters', items: [['Paneer Tikka', 280, 1], ['Chicken Tikka', 340, 0], ['Masala Papad', 95, 1]] },
      { name: 'Main Course', items: [['Dal Makhani', 310, 1], ['Butter Chicken', 465, 0], ['Veg Pulao', 240, 1]] },
      { name: 'Beverages', items: [['Masala Chai', 75, 1], ['Fresh Lime Soda', 110, 1], ['Mango Lassi', 145, 1]] },
    ]
    groups.forEach(({ name, items }, index) => {
      db.run('INSERT INTO categories (name, sort_order) VALUES (?, ?)', [name, index])
      const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0]
      for (const [item, price, veg] of items) {
        db.run('INSERT INTO menu_items (category_id, name, price, is_veg, image_path) VALUES (?, ?, ?, ?, ?)', [id, item, price, veg, foodReferenceForName(String(item))])
      }
    })
  }
  if (version < 2) {
    db.run(v2Columns)
    const salt = randomBytes(32).toString('hex')
    const pin = String(db.exec('SELECT manager_pin FROM settings')[0].values[0][0] ?? '1234')
    db.run('UPDATE settings SET pin_salt = ?, manager_pin = ?', [salt, hashPin(pin, salt)])
    for (const [id, oldPin] of db.exec('SELECT id, pin FROM users')[0]?.values ?? []) {
      db.run('UPDATE users SET pin = ? WHERE id = ?', [hashPin(String(oldPin), salt), id])
    }
    db.run('PRAGMA user_version = 2')
  }
  if (version < 3) {
    db.run(v3Columns)
    // Allocate legacy order totals across their lines using cumulative weights.
    // The allocated cents sum to the original recorded subtotal and tax.
    db.run(`
      WITH weighted AS (
        SELECT i.id, o.subtotal, o.tax_amount, MAX(COALESCE(i.line_total, 0), 0) AS weight,
          SUM(MAX(COALESCE(i.line_total, 0), 0)) OVER (PARTITION BY i.order_id ORDER BY i.id) AS running,
          SUM(MAX(COALESCE(i.line_total, 0), 0)) OVER (PARTITION BY i.order_id) AS total,
          ROW_NUMBER() OVER (PARTITION BY i.order_id ORDER BY i.id) AS position,
          COUNT(*) OVER (PARTITION BY i.order_id) AS count
        FROM order_items i JOIN orders o ON o.id = i.order_id
      ), ratios AS (
        SELECT id, subtotal, tax_amount,
          CASE WHEN total > 0 THEN running / total ELSE 1.0 * position / count END AS through_line,
          CASE WHEN total > 0 THEN (running - weight) / total ELSE 1.0 * (position - 1) / count END AS before_line
        FROM weighted
      )
      UPDATE order_items AS i SET
        net_minor = ROUND(COALESCE(r.subtotal, 0) * 100 * r.through_line) - ROUND(COALESCE(r.subtotal, 0) * 100 * r.before_line),
        tax_minor = ROUND(COALESCE(r.tax_amount, 0) * 100 * r.through_line) - ROUND(COALESCE(r.tax_amount, 0) * 100 * r.before_line)
      FROM ratios r WHERE r.id = i.id;
      CREATE INDEX IF NOT EXISTS orders_active_location ON orders(table_id) WHERE status IN ('open','billed');
      PRAGMA user_version = 3;
    `)
  }
  if (version < 4) db.run(v4Schema + `
    INSERT INTO kitchen_tickets (order_id, reference, lines, created_at)
    SELECT o.id, COALESCE(t.label, o.bill_number, 'Takeaway'),
      json_group_array(json_object('name', i.item_name, 'quantity', i.quantity, 'notes', i.notes)), o.created_at
    FROM orders o JOIN order_items i ON i.order_id = o.id LEFT JOIN tables t ON t.id = o.table_id
    WHERE o.status IN ('open','billed') AND i.kot_printed = 1 GROUP BY o.id;
    PRAGMA user_version = 4;
  `)
  if (version < 5) {
    db.run(v5Schema)
    if (fresh) db.run('UPDATE settings SET onboarding_completed = 0 WHERE id = 1')
    db.run('PRAGMA user_version = 5')
  }
  if (version < 6) {
    const originalSeed = ['Paneer Tikka', 'Chicken Tikka', 'Masala Papad', 'Dal Makhani', 'Butter Chicken',
      'Veg Pulao', 'Masala Chai', 'Fresh Lime Soda', 'Mango Lassi']
    originalSeed.forEach((name, index) => db.run(
      'UPDATE menu_items SET image_path=? WHERE id=? AND name=? AND image_path IS NULL AND archived=0',
      [foodReferenceForName(name), index + 1, name],
    ))
    db.run('PRAGMA user_version = 6')
  }
  if (version < 7) {
    enterpriseMigrate(db)
    db.run(`
      WITH sample(name,unit,stock,threshold,cost) AS (VALUES
        ('Basmati Rice','kg',12,3,95),('Chicken','kg',8,2,240),('Paneer','kg',5,1,350),
        ('Milk','L',12,3,60),('Coffee Beans','kg',2,0.5,800))
      INSERT INTO ingredients(name,unit,current_stock,low_stock_threshold,cost_per_unit)
        SELECT * FROM sample WHERE NOT EXISTS (SELECT 1 FROM ingredients);
      INSERT INTO customers(name,phone) SELECT 'Demo Guest','0000000000' WHERE NOT EXISTS(SELECT 1 FROM customers);
      INSERT INTO pricing_rules(name,rule_type,value,category_id,start_time,end_time,is_active)
        SELECT 'Happy Hour','discount_percent',20,(SELECT id FROM categories WHERE name='Beverages' ORDER BY id LIMIT 1),'16:00','19:00',0
        WHERE NOT EXISTS(SELECT 1 FROM pricing_rules);
      WITH sample(name,role) AS (VALUES ('Front Receipt','receipt'),('Kitchen KOT','kitchen'),('Bar KOT','bar'))
      INSERT INTO printers(name,role,is_active) SELECT name,role,0 FROM sample WHERE NOT EXISTS(SELECT 1 FROM printers);
    `)
    if (fresh) db.run(`
      UPDATE categories SET station='bar' WHERE name='Beverages';
      UPDATE menu_items SET station='bar' WHERE category_id IN (SELECT id FROM categories WHERE name='Beverages');
    `)
    db.run('PRAGMA user_version = 7')
  }
  if (version < 8) db.run(v8OrderItems + 'PRAGMA user_version = 8;')
  if (version < 9) db.run(v9ZoneColor + 'PRAGMA user_version = 9;')
  db.run('COMMIT')
}

export class PosDatabase {
  private constructor(private engine: SqlJsStatic, private db: Database, private file: string) {}

  static async open(file: string) {
    const engine = await initSqlJs({ locateFile: name => path.join(path.dirname(require.resolve('sql.js')), name) })
    const exists = fs.existsSync(file)
    const db = new engine.Database(exists ? fs.readFileSync(file) : undefined)
    try {
      migrate(db)
      const result = new PosDatabase(engine, db, file)
      result.persist()
      return result
    } catch (error) {
      db.close()
      throw error
    }
  }

  all<T>(sql: string, params: SqlValue[] = []): T[] {
    const statement = this.db.prepare(sql)
    try {
      statement.bind(params)
      const rows: T[] = []
      while (statement.step()) rows.push(statement.getAsObject() as T)
      return rows
    } finally {
      statement.free()
    }
  }

  write(sql: string, params: SqlValue[] = []) {
    this.transaction(db => db.run(sql, params))
  }

  transaction<T>(run: (db: Database) => T) {
    const before = this.bytes()
    try {
      this.db.run('BEGIN IMMEDIATE')
      const result = run(this.db)
      this.db.run('COMMIT')
      this.persist()
      return result
    } catch (error) {
      this.db.close()
      this.db = new this.engine.Database(before)
      this.db.run('PRAGMA foreign_keys = ON')
      throw error
    }
  }

  bytes() {
    const bytes = this.db.export()
    this.db.run('PRAGMA foreign_keys = ON')
    return bytes
  }

  private persist() {
    atomicWrite(this.file, this.bytes())
  }

  restore(bytes: Uint8Array, beforeCommit: () => void, legacy = false) {
    const candidate = new this.engine.Database(bytes)
    try {
      if (candidate.exec('PRAGMA quick_check')[0]?.values[0][0] !== 'ok') throw new Error('The backup is damaged.')
      const version = Number(candidate.exec('PRAGMA user_version')[0].values[0][0])
      if (legacy && version > 1) throw new Error('Current ServeX backups must be encrypted.')
      const reference = new this.engine.Database()
      try {
        reference.run(schema)
        if (version >= 2) reference.run(v2Columns)
        if (version >= 3) reference.run(v3Columns)
        if (version >= 4) reference.run(v4Schema)
        if (version >= 5) reference.run(v5Schema)
        if (version >= 7) enterpriseMigrate(reference)
        if (version >= 8) reference.run(v8OrderItems)
        if (version >= 9) reference.run(v9ZoneColor)
        const tables = reference.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")[0].values.flat()
        const codeObjects = "SELECT name, sql FROM sqlite_master WHERE type IN ('trigger', 'view') ORDER BY name"
        if (JSON.stringify(candidate.exec(codeObjects)) !== JSON.stringify(reference.exec(codeObjects)) ||
            tables.some(table => ['table_info', 'foreign_key_list'].some(pragma =>
              JSON.stringify(candidate.exec(`PRAGMA ${pragma}(${table})`)) !== JSON.stringify(reference.exec(`PRAGMA ${pragma}(${table})`))))) {
          throw new Error('The backup does not match the ServeX database schema.')
        }
      } finally { reference.close() }
      migrate(candidate)
      if (candidate.exec('PRAGMA foreign_key_check').length) throw new Error('The backup has invalid references.')
      const settings = candidate.exec('SELECT pin_salt FROM settings WHERE id = 1')
      if (!/^[0-9a-f]{64}$/.test(String(settings[0]?.values[0][0]))) throw new Error('The backup is missing ServeX settings.')
      if (!candidate.exec("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").length) {
        throw new Error('The backup has no active administrator.')
      }
      const exported = candidate.export()
      candidate.run('PRAGMA foreign_keys = ON')
      beforeCommit()
      atomicWrite(this.file, exported)
    } catch (error) {
      candidate.close()
      throw error
    }
    this.db.close()
    this.db = candidate
  }
}
