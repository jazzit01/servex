const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sign, verify, generateKeyPairSync } = require('node:crypto')
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
  assert.deepEqual(reports.zState(), { day, cashExpenses: 0, cashSales: 651, refunds: 294, report: null, legacyClosed: false })
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
  const env = { ...process.env, GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '', SERVEX_PRIVATE_KEY: '' }
  const publicKey = execFileSync(process.execPath, [cli, '--init-keys', privateKey], { encoding: 'utf8', env })
  const trialFile = path.join(dir, 'clock.json')
  const license = new LicenseManager(trialFile, publicKey)
  assert.equal(license.state(null).mode, 'trial')
  const token = execFileSync(process.execPath, [cli, ' ' + license.machine.toLowerCase() + ' '], {
    encoding: 'utf8', env: { ...env, SERVEX_LICENSE_PRIVATE_KEY_FILE: privateKey },
  }).trim()
  assert.match(token, /^SVX-[A-Za-z0-9_-]{86}$/)
  assert.equal(verify(null, Buffer.from(license.machine), publicKey, Buffer.from(token.slice(4), 'base64url')), true)
  const otherKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' })
  assert.equal(validActivation(token, license.machine, otherKey), false)
  assert.equal(validActivation(token, license.machine, fs.readFileSync(privateKey, 'utf8')), false)
  const legacySignature = sign(null, Buffer.from('ServeX commercial v1:' + license.machine), fs.readFileSync(privateKey))
  const legacyToken = 'SVX-' + legacySignature.toString('hex').match(/.{4}/g).join('-')
  assert.equal(license.accepts(legacyToken), true)
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

test('mobile license issuer reads the secret and writes a safe run summary', t => {
  const dir = sandbox(t)
  const scriptDir = path.join(dir, 'scripts')
  fs.mkdirSync(scriptDir)
  const cli = path.join(scriptDir, 'generate-license.js')
  fs.copyFileSync(path.resolve('scripts/generate-license.js'), cli)
  const env = { ...process.env, GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '', SERVEX_PRIVATE_KEY: '' }
  const generated = execFileSync(process.execPath, [cli, '--init-keys'], { encoding: 'utf8', env })
  const privatePem = generated.match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/)[0]
  const publicPem = generated.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/)[0]
  const device = '0123456789ABCDEF01234567'
  fs.writeFileSync(path.join(dir, '.env'), 'SERVEX_PRIVATE_KEY="' + privatePem + '"\n')
  const issue = (args, overrides) => execFileSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  assert.equal(validActivation(issue([device]), device, publicPem), true)
  fs.writeFileSync(path.join(dir, '.env'), 'SERVEX_PRIVATE_KEY=invalid\n')
  const summaryFile = path.join(dir, 'summary.md')
  const token = issue([device.toLowerCase(), 'Cafe [buyer](https://example.com)\n<b>'], {
    SERVEX_PRIVATE_KEY: privatePem, GITHUB_STEP_SUMMARY: summaryFile,
  })
  assert.equal(validActivation(token, device, publicPem), true)
  const wrapped = privatePem.replace(/\n/g, '\r\n')
  for (const secret of [wrapped, privatePem.replace(/\n/g, '\\n'),
    Buffer.from(privatePem).toString('base64'), '  ' + privatePem.replace(/\n/g, ' ') + '  ',
    privatePem.replace(/\n([^\n]+)\n/, (_, body) => '\n' + body.match(/.{1,19}/g).join(' \n ') + '\n')]) {
    assert.equal(issue([device], { SERVEX_PRIVATE_KEY: secret }), token)
  }
  assert.throws(() => issue([device], { GITHUB_ACTIONS: 'true', SERVEX_PRIVATE_KEY: '\n' }), /SERVEX_PRIVATE_KEY is empty/)
  assert.throws(() => issue([device], { SERVEX_PRIVATE_KEY: 'corrupt' }), /PKCS#8/)
  const summary = fs.readFileSync(summaryFile, 'utf8')
  assert.match(summary, /Customer Name\*\* Cafe &#91;buyer&#93;/)
  assert.ok(summary.includes('```text\n' + token + '\n```'))
  assert.ok(summary.includes(device))
  assert.match(summary, /Timestamp \(UTC\)\*\* \d{4}-\d{2}-\d{2}T/)
  assert.doesNotMatch(summary, /<b>|PRIVATE KEY/)
  assert.throws(() => issue(['DEV-8A4F-92B1'], { SERVEX_PRIVATE_KEY: privatePem }), /24-character hexadecimal/)
  assert.throws(() => issue(['--init-keys'], { GITHUB_ACTIONS: 'true' }), /locally/)
})
