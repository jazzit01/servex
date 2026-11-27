const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { once } = require('node:events')
const { test } = require('node:test')
const { WebSocket } = require('ws')
const { PosDatabase } = require('../dist-electron/electron/db')
const { FloorService } = require('../dist-electron/electron/service')
const { Reports } = require('../dist-electron/electron/reports')
const { LicenseManager, validActivation } = require('../dist-electron/electron/license')
const { LocalServer } = require('../dist-electron/electron/localServer')

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'servex-day5-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('cash reconciliation records reversals and closes the drawer immutably', async t => {
  const db = await PosDatabase.open(path.join(sandbox(t), 'db'))
  const service = new FloorService(db)
  const reports = new Reports(db)
  assert.equal(db.all('SELECT onboarding_completed FROM settings')[0].onboarding_completed, 0)
  function paid(item) {
    const orderId = service.createOrder({ type: 'parcel', tableId: null, items: [{ id: item, quantity: 1 }] }, 1)
    service.settle({ orderId, revision: 0, mode: 'Cash', tendered: 1000, split: { kind: 'none' } }, 1, () => '{}')
    return orderId
  }
  const reversed = paid(1)
  paid(2)
  service.voidReceipt(reversed, 1)
  const day = reports.day()
  const range = { from: day, to: day }
  const analytics = reports.analytics(range)
  assert.equal(analytics.sales, 357)
  assert.equal(analytics.tax, 17)
  assert.deepEqual(analytics.items.map(row => row.name), ['Chicken Tikka'])
  assert.deepEqual(reports.zState(), { day, cashSales: 651, refunds: 294, report: null, legacyClosed: false })
  const input = { opening: 100, counts: [0, 0, 2, 0, 1, 0, 0], coins: 7 }
  const close = reports.close(input, { id: 1, name: 'Admin' })
  assert.equal(close.expected, 457)
  assert.equal(close.actual, 457)
  assert.equal(close.variance, 0)
  assert.equal(reports.close({ ...input, opening: 0 }, { id: 1, name: 'Other' }).actor, 'Admin')
  assert.throws(() => db.write('DELETE FROM z_reports'), /immutable/)
  assert.throws(() => service.createOrder({ type: 'parcel', tableId: null, items: [{ id: 1, quantity: 1 }] }, 1), /closed/)
  assert.equal(reports.audit({ ...range, action: 'BILL_VOID' }).length, 1)
  assert.match(reports.csv({ ...range, action: 'Z_CLOSE' }), /"Z_CLOSE"/)
  db.restore(db.bytes(), () => {})
  assert.equal(reports.zState().report.expected, 457)
})

test('issuer-generated activation verifies only on the matching device and an expired trial stays expired', t => {
  const dir = sandbox(t)
  const cli = path.resolve('scripts/generate-license.js')
  const privateKey = path.join(dir, 'issuer.pem')
  const publicKey = execFileSync(process.execPath, [cli, '--init', privateKey], { encoding: 'utf8' })
  const trialFile = path.join(dir, 'clock.json')
  const license = new LicenseManager(trialFile, publicKey)
  assert.equal(license.state(null).mode, 'trial')
  const token = execFileSync(process.execPath, [cli, license.machine, privateKey], { encoding: 'utf8' }).trim()
  assert.equal(license.state(token).mode, 'active')
  assert.equal(validActivation(token, 'F'.repeat(24), publicKey), false)
  const altered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
  assert.equal(license.accepts(altered), false)
  const now = Date.now()
  fs.writeFileSync(trialFile, JSON.stringify({ start: now - 8 * 86400000, seen: now + 1000 }))
  assert.equal(new LicenseManager(trialFile, publicKey).state(null).mode, 'expired')
})

test('LAN requires pairing, streams updates, and deduplicates order retries', async t => {
  const db = await PosDatabase.open(path.join(sandbox(t), 'db'))
  const server = new LocalServer(db, new FloorService(db), () => true)
  t.after(() => server.stop())
  const state = await server.start(1)
  if (!state.enabled) { t.skip(state.error); return }
  const { token, url } = JSON.parse(state.pairing)
  assert.equal((await fetch(url + '/api/v1/catalog')).status, 401)
  const authorization = 'Bearer ' + token
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/api/v1/events', { headers: { Authorization: authorization } })
  t.after(() => ws.terminate())
  assert.equal(JSON.parse((await once(ws, 'message'))[0]).type, 'ready')
  const catalog = await fetch(url + '/api/v1/catalog', { headers: { Authorization: authorization } }).then(r => r.json())
  assert.ok(catalog.menu.length > 0)
  assert.ok(!Object.hasOwn(catalog, 'users'))
  const request = {
    method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json', 'Idempotency-Key': 'mobile-order-00001' },
    body: JSON.stringify({ type: 'dinein', tableId: 1, items: [{ id: 1, quantity: 1 }] }),
  }
  const changed = once(ws, 'message')
  const sent = await fetch(url + '/api/v1/orders', request)
  assert.equal(sent.status, 201)
  assert.equal(JSON.parse((await changed)[0]).type, 'catalog-changed')
  const order = await sent.json()
  const again = await fetch(url + '/api/v1/orders', request)
  assert.equal(again.status, 200)
  assert.deepEqual(await again.json(), order)
  const conflict = await fetch(url + '/api/v1/orders', { ...request, body: request.body.replace('"quantity":1','"quantity":2') })
  assert.equal(conflict.status, 409)
  assert.equal(db.all('SELECT COUNT(*) AS count FROM orders')[0].count, 1)
})
