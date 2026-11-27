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

function migrate(db: Database) {
  db.run('PRAGMA foreign_keys = ON')
  const version = Number(db.exec('PRAGMA user_version')[0].values[0][0])
  if (version > 4) throw new Error('This database requires a newer ServeX version.')
  db.run('BEGIN')
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
        db.run('INSERT INTO menu_items (category_id, name, price, is_veg) VALUES (?, ?, ?, ?)', [id, item, price, veg])
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
        const tables = reference.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")[0].values.flat()
        if (candidate.exec("SELECT name FROM sqlite_master WHERE type IN ('trigger', 'view')").length ||
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
