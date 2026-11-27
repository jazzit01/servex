const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const initSqlJs = require('sql.js')
const { PosDatabase } = require('../dist-electron/electron/db')
const { withDialogFocus } = require('../dist-electron/electron/dialogFocus')
const { foodLibrary, foodReference, foodIdFromReference } = require('../dist-electron/src/types/foodLibrary')

test('all offline food references point at local assets and fresh menu items have photos', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'servex-food-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.ok(foodLibrary.length >= 24)
  assert.equal(new Set(foodLibrary.map(item => item.id)).size, foodLibrary.length)
  for (const item of foodLibrary) {
    const svg = fs.readFileSync(path.resolve('public/food-library', item.id + '.svg'), 'utf8')
    assert.match(svg, /^<svg /)
    assert.doesNotMatch(svg, /<script|href=/i)
    assert.equal(foodIdFromReference(foodReference(item.id)), item.id)
  }
  assert.equal(foodIdFromReference('library:../../test'), undefined)
  const file = path.join(dir, 'current.db')
  const db = await PosDatabase.open(file)
  assert.equal(db.all('SELECT image_path FROM menu_items').length, 9)
  for (const row of db.all('SELECT image_path FROM menu_items')) assert.ok(foodIdFromReference(row.image_path))
  const engine = await initSqlJs()
  const old = new engine.Database(db.bytes())
  old.run(`UPDATE menu_items SET image_path=NULL WHERE id IN (1,3);
    UPDATE menu_items SET image_path='custom.png' WHERE id=2;
    UPDATE menu_items SET name='New dish' WHERE id=3;
    PRAGMA user_version=5;`)
  const oldFile = path.join(dir, 'original.db')
  fs.writeFileSync(oldFile, old.export())
  old.close()
  const migrated = await PosDatabase.open(oldFile)
  assert.deepEqual(migrated.all('SELECT image_path FROM menu_items ORDER BY id LIMIT 3').map(row => row.image_path),
    ['library:paneer-tikka', 'custom.png', null])
  migrated.write('UPDATE menu_items SET image_path=NULL WHERE id=1')
  assert.equal((await PosDatabase.open(oldFile)).all('SELECT image_path FROM menu_items WHERE id=1')[0].image_path, null)
})

test('native dialog restores the window and renderer focus on cancel or failure', async () => {
  const focuses = []
  const win = { isDestroyed: () => false, focus: () => focuses.push('window'),
    webContents: { isDestroyed: () => false, focus: () => focuses.push('webContents') } }
  assert.deepEqual(await withDialogFocus(win, async () => ({ canceled: true })), { canceled: true })
  await assert.rejects(withDialogFocus(win, async () => { throw new Error('dialog failure') }), /dialog failure/)
  assert.deepEqual(focuses, ['window', 'webContents', 'window', 'webContents'])
  await withDialogFocus({ ...win, isDestroyed: () => true }, async () => ({ canceled: true }))
  assert.equal(focuses.length, 4)
})
