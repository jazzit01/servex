const { removeEnterprise } = require('./helpers/legacy-schema.cjs')
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
  assert.throws(() => service.settle({ orderId: id, mode: 'Cash', revision: 0, tendered: 1, split: { kind: 'none' } }, 1, JSON.stringify), /changed/)
  service.markPrinted(id, 1, 1)
  service.addItems(id, 2, [{ id: 1, quantity: 1 }], 1)
  assert.equal(service.table(9).status, 'occupied')
  assert.equal(service.activeOrder(id).grand_total, 150.21)
  db.write('UPDATE settings SET auto_cleaning = 1')
  service.settle({ orderId: id, mode: 'UPI', revision: 3, split: { kind: 'none' } }, 1, order => JSON.stringify(order))
  assert.equal(service.table(9).status, 'cleaning')
  assert.throws(() => service.createOrder({ type: 'room', tableId: 9, items: [{ id: 1, quantity: 1 }] }, 1), /unavailable/)
  service.updateStatus({ tableId: 9, status: 'vacant' }, 1)
  assert.equal(service.table(9).status, 'vacant')
  assert.equal(db.all("SELECT action FROM audit_logs ORDER BY id DESC LIMIT 1")[0].action, 'table-status-override')
  db.write('UPDATE settings SET auto_cleaning = 0')
  const next = service.createOrder({ type: 'room', tableId: 9, items: [{ id: 1, quantity: 1 }] }, 1)
  service.settle({ orderId: next, mode: 'Cash', revision: 0, tendered: 150, split: { kind: 'none' } }, 1, order => JSON.stringify(order))
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
  removeEnterprise(legacy)
  legacy.run(`DROP TABLE z_reports;
    DROP TABLE lan_requests;
    ALTER TABLE settings DROP COLUMN onboarding_completed;
    ALTER TABLE settings DROP COLUMN lan_enabled;
    ALTER TABLE settings DROP COLUMN lan_actor;
    DROP TABLE kitchen_tickets;
    DROP TABLE bill_sequences;
    ALTER TABLE orders DROP COLUMN receipt_json;
    ALTER TABLE settings DROP COLUMN printer_name;
    ALTER TABLE settings DROP COLUMN print_preview;
    ALTER TABLE settings DROP COLUMN receipt_width;
    ALTER TABLE settings DROP COLUMN upi_id;
    DROP INDEX orders_active_location;
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

test('delta tickets retain the exact sent items and manager authorization rolls back an attempted void', async t => {
  const { db, service } = await setup(t)
  const id = service.createOrder({ type: 'dinein', tableId: 1, items: [{ id: 1, quantity: 2, notes: 'No onion' }] }, 1)
  const [first] = service.sendKot(id, 0, 1)
  assert.equal(service.ticket(first).lines[0].notes, 'No onion')
  assert.throws(() => service.sendKot(id, 1, 1), /no unsent/)
  service.addItems(id, 1, [{ id: 2, quantity: 1 }], 1)
  const [second] = service.sendKot(id, 2, 1)
  assert.deepEqual(service.ticket(second).lines.map(row => row.name), ['Chicken Tikka'])
  const [line] = service.lines(id)
  const edit = { orderId: id, revision: 3, guestName: '', guestCount: null, quantities: [{ id: line.id, quantity: 1 }] }
  assert.throws(() => service.editBill(edit, 1), /Manager PIN required/)
  assert.equal(service.lines(id)[0].quantity, 2)
  service.editBill({ ...edit, pin: '8642' }, 1, pin => assert.equal(pin, '8642'))
  assert.equal(service.ticket(first).lines[0].quantity, 2)
  assert.equal(service.lines(id)[0].quantity, 1)
  assert.equal(db.all("SELECT count(*) AS n FROM audit_logs WHERE action = 'VOID_KOT_ITEM'")[0].n, 1)
  service.readyTicket(second)
  assert.equal(service.ticket(second).status, 'ready')
})

test('checkout enforces discount authorization and preserves split totals and daily receipt numbering', async t => {
  const { db, service } = await setup(t)
  const id = service.createOrder({ type: 'parcel', tableId: null, items: [{ id: 1, quantity: 1 }, { id: 2, quantity: 1 }] }, 1)
  const edit = { orderId: id, revision: 0, guestName: '', guestCount: null, quantities: [], discount: { kind: 'percent', value: 20 } }
  assert.throws(() => service.editBill(edit, 1), /Manager PIN required/)
  assert.equal(service.activeOrder(id).discount_amount, 0)
  service.editBill({ ...edit, pin: '8642' }, 1, pin => assert.equal(pin, '8642'))
  const order = service.activeOrder(id)
  const itemGroups = service.lines(id).map(row => [row.id])
  for (const split of [{ kind: 'items', groups: itemGroups }, { kind: 'equal', count: 7 }]) {
    const parts = service.receiptParts(order, split)
    assert.equal(parts.reduce((sum, part) => sum + part.total, 0), Math.round(order.grand_total * 100))
    assert.ok(parts.every(part => part.total === part.net + part.tax - part.discount))
  }
  const pay = { orderId: id, mode: 'Cash', revision: 1, tendered: 0, split: { kind: 'items', groups: itemGroups } }
  assert.throws(() => service.settle(pay, 1, JSON.stringify), /Cash tendered/)
  service.settle({ ...pay, tendered: 1000 }, 1, (snapshot, parts) => JSON.stringify({ snapshot, parts }))
  const paid = service.paidBill(id)
  assert.match(paid.bill_number, /^SVX-\d{8}-0001$/)
  assert.equal(Math.round(paid.change_returned * 100), 100000 - Math.round(order.grand_total * 100))
  assert.equal(JSON.parse(paid.receipt_json).parts.length, 2)
  const newId = service.createOrder({ type: 'parcel', tableId: null, items: [{ id: 1, quantity: 1 }] }, 1)
  service.settle({ orderId: newId, mode: 'UPI', revision: 0, split: { kind: 'none' } }, 1, order => JSON.stringify(order))
  assert.match(service.paidBill(newId).bill_number, /-0002$/)
  service.voidReceipt(id, 1)
  assert.deepEqual(service.pastBills().map(row => row.id), [newId])
  assert.equal(db.all("SELECT count(*) AS n FROM audit_logs WHERE action = 'MANAGER_DISCOUNT'")[0].n, 1)
})

test('UPI links carry an exact INR amount and escape merchant details', () => {
  const { upiUri } = require('../dist-electron/src/types/settlement')
  const url = new URL(upiUri('shop@upi', 'Spice & Tea', 42.1))
  assert.equal(url.href, 'upi://pay?pa=shop%40upi&pn=Spice%20%26%20Tea&am=42.10&cu=INR')
  assert.equal(url.searchParams.get('pn'), 'Spice & Tea')
})

test('bulk layout saves a pastel zone and its individual capacities atomically', async t => {
  const { db, service } = await setup(t)
  const zone = { id: -1, name: 'Poolside', color: 'rose' }
  const first = { x_pos: 40, y_pos: 40, width: 160, height: 120, zoneId: zone.id, label: 'POOL-01', type: 'table', capacity: 4 }
  const second = { ...first, x_pos: 220, label: 'POOL-02', capacity: 7 }
  assert.throws(() => service.saveLayout([first, { ...second, label: first.label }], [zone]), /already exists/)
  assert.equal(db.all("SELECT id FROM zones WHERE name='Poolside'").length, 0)
  assert.equal(db.all("SELECT id FROM tables WHERE label LIKE 'POOL-%'").length, 0)
  assert.throws(() => service.saveLayout([first], [{ ...zone, color: 'black' }]), /Invalid new zone/)
  service.saveLayout([first, second], [zone])
  db.restore(db.bytes(), () => {})
  assert.deepEqual(db.all("SELECT color, label, capacity FROM zones JOIN tables ON zones.id=zone_id WHERE zones.name='Poolside' ORDER BY label"), [
    { color: 'rose', label: 'POOL-01', capacity: 4 }, { color: 'rose', label: 'POOL-02', capacity: 7 },
  ])
})
