const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const initSqlJs = require('sql.js')
const { PosDatabase } = require('../dist-electron/electron/db')
const { FloorService } = require('../dist-electron/electron/service')
const { editRect } = require('../dist-electron/src/types/floorLayout')

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'servex-floor-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'store.db')
  const db = await PosDatabase.open(file)
  return { file, db, service: new FloorService(db) }
}

test('layout save snaps within bounds and rolls back all writes on invalid input', async t => {
  const { file, service } = await setup(t)
  const current = service.table(1)
  const moved = { ...editRect(current, 77, 17, false), id: 1, zoneId: current.zone_id }
  assert.deepEqual([moved.x_pos, moved.y_pos, moved.width, moved.height], [120, 60, 120, 120])
  assert.throws(() => service.saveLayout([moved, { ...moved, id: 9999 }]), /disappeared/)
  assert.equal(service.table(1).x_pos, current.x_pos)
  assert.throws(() => service.saveLayout([{ ...moved, width: 111 }]), /20 px grid/)
  const added = { x_pos: 500, y_pos: 40, width: 160, height: 120, zoneId: current.zone_id, label: 'Room test', type: 'room', capacity: 2 }
  service.saveLayout([moved, added])
  const reopened = await PosDatabase.open(file)
  assert.equal(reopened.all('SELECT x_pos FROM tables WHERE id = 1')[0].x_pos, moved.x_pos)
  assert.equal(reopened.all('SELECT label FROM tables WHERE id = 13')[0].label, added.label)
  assert.throws(() => service.saveLayout([{ ...added, label: ' room Test ' }]), /already exists/)
})

test('transfer and merge preserve immutable order amounts, recover availability, and audit operations', async t => {
  const { db, service } = await setup(t)
  const targetId = service.createOrder({ type: 'dinein', tableId: 1, guestName: 'Party', guestCount: 2, items: [{ id: 1, quantity: 2 }] }, 1)
  const sourceId = service.createOrder({ type: 'dinein', tableId: 2, guestCount: 3, items: [{ id: 2, quantity: 1 }] }, 1)
  const total = service.activeOrder(targetId).grand_total + service.activeOrder(sourceId).grand_total
  db.write('UPDATE menu_items SET price = 1000, tax_slab = 99')
  assert.throws(() => service.transfer({ orderId: targetId, fromTableId: 1, toTableId: 2 }, 1), /no longer vacant/)
  assert.throws(() => service.updateStatus({ tableId: 1, status: 'cleaning' }, 1), /idle/)
  service.markPrinted(targetId, 0, 1)
  service.transfer({ orderId: targetId, fromTableId: 1, toTableId: 9 }, 1)
  assert.equal(service.table(1).status, 'vacant')
  assert.equal(service.table(9).status, 'billed')
  assert.equal(service.activeOrder(targetId).order_type, 'room')
  assert.throws(() => service.merge({ targetOrderId: targetId, sourceOrderId: sourceId, sourceTableId: 3 }, 1), /selected location/)
  assert.equal(service.table(2).status, 'occupied')
  service.merge({ targetOrderId: targetId, sourceOrderId: sourceId, sourceTableId: 2 }, 1)
  assert.equal(service.table(2).status, 'vacant')
  assert.equal(service.table(9).status, 'occupied')
  assert.equal(service.activeOrder(targetId).grand_total, total)
  assert.equal(service.activeOrder(targetId).guest_count, 5)
  assert.equal(service.lines(targetId).length, 2)
  assert.equal(service.lines(sourceId).length, 0)
  assert.equal(db.all('SELECT status FROM orders WHERE id = ?', [sourceId])[0].status, 'void')
  assert.deepEqual(db.all('SELECT action FROM audit_logs ORDER BY id').map(row => row.action), ['bill-printed', 'table-transfer', 'table-merge'])
})

test('checkout edits apply recorded tax, detect stale changes, and follow the cleaning preference', async t => {
  const { db, service } = await setup(t)
  db.write('UPDATE menu_items SET price = 0.10, tax_slab = 5 WHERE id = 1')
  const id = service.createOrder({ type: 'room', tableId: 9, items: [{ id: 1, quantity: 1 }] }, 1)
  const line = service.lines(id)[0]
  db.write('UPDATE menu_items SET price = 100, tax_slab = 50 WHERE id = 1')
  service.editBill({ orderId: id, revision: 0, guestName: 'Guest', guestCount: 2, quantities: [{ id: line.id, quantity: 2 }] }, 1)
  assert.equal(service.activeOrder(id).grand_total, 0.21)
  assert.throws(() => service.payOrder(id, 'Cash', 0), /changed/)
  service.markPrinted(id, 1, 1)
  service.addItems(id, 2, [{ id: 1, quantity: 1 }], 1)
  assert.equal(service.table(9).status, 'occupied')
  assert.equal(service.activeOrder(id).grand_total, 150.21)
  db.write('UPDATE settings SET auto_cleaning = 1')
  service.payOrder(id, 'UPI', 3)
  assert.equal(service.table(9).status, 'cleaning')
  assert.throws(() => service.createOrder({ type: 'room', tableId: 9, items: [{ id: 1, quantity: 1 }] }, 1), /unavailable/)
  service.updateStatus({ tableId: 9, status: 'vacant' }, 1)
  assert.equal(service.table(9).status, 'vacant')
  assert.equal(db.all("SELECT action FROM audit_logs ORDER BY id DESC LIMIT 1")[0].action, 'table-status-override')
  db.write('UPDATE settings SET auto_cleaning = 0')
  const next = service.createOrder({ type: 'room', tableId: 9, items: [{ id: 1, quantity: 1 }] }, 1)
  service.payOrder(next, 'Cash', 0)
  assert.equal(service.table(9).status, 'vacant')
})

test('v2 migration preserves the recorded cents of existing active orders', async t => {
  const { db, service } = await setup(t)
  db.write('UPDATE settings SET tax_inclusive = 1')
  const id = service.createOrder({ type: 'dinein', tableId: 1, items: [{ id: 1, quantity: 1 }, { id: 3, quantity: 2 }] }, 1)
  const order = service.activeOrder(id)
  const SQL = await initSqlJs()
  const legacy = new SQL.Database(db.bytes())
  t.after(() => legacy.close())
  legacy.run(`DROP INDEX orders_active_location;
    ALTER TABLE settings DROP COLUMN auto_cleaning;
    ALTER TABLE orders DROP COLUMN revision;
    ALTER TABLE orders DROP COLUMN guest_count;
    ALTER TABLE order_items DROP COLUMN net_minor;
    ALTER TABLE order_items DROP COLUMN tax_minor;
    ALTER TABLE order_items DROP COLUMN tax_rate_snapshot;
    ALTER TABLE order_items DROP COLUMN tax_inclusive_snapshot;
    PRAGMA user_version = 2;`)
  db.restore(legacy.export(), () => {})
  assert.equal(service.activeOrder(id).grand_total, order.grand_total)
  assert.equal(service.lines(id).reduce((sum, line) => sum + line.net_minor, 0), Math.round(order.subtotal * 100))
  assert.equal(service.lines(id).reduce((sum, line) => sum + line.tax_minor, 0), Math.round(order.tax_amount * 100))
})
