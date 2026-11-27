const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const initSqlJs = require('sql.js')
const { BackupEngine, decodeBackup } = require('../dist-electron/electron/backup')
const { Catalog, pinDigest } = require('../dist-electron/electron/catalog')
const { PosDatabase } = require('../dist-electron/electron/db')
const { MediaLibrary } = require('../dist-electron/electron/media')

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'servex-management-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const db = await PosDatabase.open(path.join(dir, 'live.db'))
  const media = new MediaLibrary(path.join(dir, 'media'), path.join(dir, 'logos'))
  return { dir, db, media, catalog: new Catalog(db, media) }
}

test('staff PINs, auditing, and administrator protection', async t => {
  const { db, catalog } = await fixture(t)
  const digest = pinDigest(db, '1234')
  assert.notEqual(digest, '1234')
  assert.equal(db.all('SELECT pin FROM users')[0].pin, digest)
  assert.throws(() => catalog.saveStaff({ name: 'Duplicate', role: 'cashier', pin: '1234', active: true }, 1), /another active/)
  catalog.saveStaff({ name: 'Cashier', role: 'cashier', pin: '7854', active: true }, 1)
  const user = catalog.staff().find(row => row.name === 'Cashier')
  catalog.saveStaff({ id: user.id, name: user.name, role: user.role, active: false }, 1)
  assert.throws(() => catalog.saveStaff({ id: 1, name: 'Admin', role: 'admin', active: false }, 1), /remain active/)
  const logs = db.all('SELECT action, details FROM audit_logs ORDER BY id')
  assert.deepEqual(logs.map(row => row.action), ['staff-added', 'staff-deactivated'])
  assert.ok(logs.every(row => !row.details.includes('7854')))
})

test('legacy v1 backups migrate staff PINs without losing seeded data', async t => {
  const { db } = await fixture(t)
  const SQL = await initSqlJs()
  const old = new SQL.Database(db.bytes())
  t.after(() => old.close())
  old.run(`ALTER TABLE settings DROP COLUMN pin_salt;
    ALTER TABLE settings DROP COLUMN cloud_last_synced;
    ALTER TABLE menu_items DROP COLUMN archived;
    UPDATE users SET pin = '1234';
    UPDATE settings SET manager_pin = '1234';
    PRAGMA user_version = 1;`)
  let snapshot = 0
  db.restore(old.export(), () => { snapshot++ }, true)
  assert.equal(snapshot, 1)
  assert.equal(db.all('SELECT pin FROM users')[0].pin, pinDigest(db, '1234'))
  assert.equal(db.all('SELECT COUNT(*) AS count FROM menu_items')[0].count, 9)
})

test('CSV imports are atomic, support quoted fields, and round-trip in bulk', async t => {
  const { db, catalog } = await fixture(t)
  const header = 'Category,Name,Price,Tax Slab %,Veg,In Stock\r\n'
  const rows = Array.from({ length: 200 }, (_, index) => `New,"Dish, ${index}",12.50,5,1,0`).join('\r\n')
  assert.throws(() => catalog.importCsv(header + rows + '\r\nNew,Bad,-7,5,1,1'), /data row 201/)
  assert.equal(db.all("SELECT id FROM categories WHERE name = 'New'").length, 0)
  assert.equal(catalog.importCsv(header + rows), 200)
  assert.equal(catalog.importCsv(catalog.exportCsv(false)), 209)
  assert.equal(db.all("SELECT id FROM menu_items WHERE name = 'Dish, 15'").length, 1)
})

test('catalog deletion retains sales history and location configuration protects open orders', async t => {
  const { db, catalog } = await fixture(t)
  catalog.zone({ name: 'Rooftop' })
  const id = db.all("SELECT id FROM zones WHERE name = 'Rooftop'")[0].id
  catalog.saveLocations(['R-1', 'R-2'].map(label => ({ zoneId: id, label, type: 'room', capacity: 2 })))
  const locations = db.all('SELECT * FROM tables WHERE zone_id = ?', [id])
  assert.notEqual(locations[0].x_pos, locations[1].x_pos)
  assert.throws(() => catalog.saveLocations([{ zoneId: id, label: 'r-1', type: 'room', capacity: 2 }]), /already exists/)
  db.transaction(sql => {
    sql.run("INSERT INTO orders (table_id, order_type) VALUES (?, 'room')", [locations[0].id])
    sql.run("INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, line_total) VALUES (1, 1, 'Desk order', 100, 100)")
  })
  assert.throws(() => catalog.deleteLocation(locations[0].id), /open order/)
  catalog.deleteMenuItem(1)
  assert.equal(db.all('SELECT archived FROM menu_items WHERE id = 1')[0].archived, 1)
  assert.equal(db.all('SELECT item_name FROM order_items WHERE id = 1')[0].item_name, 'Desk order')
})

test('encrypted restores authenticate the archive, migrate media, and retain five rolling copies', async t => {
  const { db, media, dir } = await fixture(t)
  const rolling = path.join(dir, 'auto-backups')
  const engine = new BackupEngine(db, media, rolling)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64')
  const image = 'image-' + createHash('sha256').update(png).digest('hex') + '.png'
  const imageFile = path.join(media.directory, image)
  fs.writeFileSync(imageFile, png)
  db.write('UPDATE settings SET logo_path = ?', [image])
  const passphrase = 'a portable test passphrase'
  const original = engine.archive(passphrase)
  const good = path.join(dir, 'good.svxbak')
  const damaged = path.join(dir, 'damaged.svxbak')
  fs.writeFileSync(good, original)
  fs.writeFileSync(damaged, Buffer.concat([original.subarray(0, -1), Buffer.from([original.at(-1) ^ 1])]))
  fs.unlinkSync(imageFile)
  db.write("UPDATE settings SET restaurant_name = 'Updated name', logo_path = NULL")
  assert.throws(() => engine.restore(damaged, passphrase, undefined, passphrase), /damaged or its passphrase/)
  assert.throws(() => engine.restore(good, 'wrong passphrase', undefined, passphrase), /damaged or its passphrase/)
  assert.equal(db.all('SELECT restaurant_name FROM settings')[0].restaurant_name, 'Updated name')
  engine.restore(good, passphrase, undefined, passphrase)
  assert.deepEqual(fs.readFileSync(imageFile), png)
  assert.equal(db.all('SELECT logo_path FROM settings')[0].logo_path, image)
  const safetyDir = path.join(dir, 'restore-safety')
  const [safety] = fs.readdirSync(safetyDir)
  const saved = decodeBackup(fs.readFileSync(path.join(safetyDir, safety)), passphrase)
  const sql = await initSqlJs()
  const safetyDb = new sql.Database(saved.db)
  t.after(() => safetyDb.close())
  assert.equal(safetyDb.exec('SELECT restaurant_name FROM settings')[0].values[0][0], 'Updated name')
  for (let i = 0; i < 7; i++) engine.rolling(passphrase)
  assert.equal(fs.readdirSync(rolling).length, 5)
})
