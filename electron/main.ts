import { app, BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent } from 'electron'
import { createPublicKey, verify } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PosDatabase, atomicWrite } from './db'
import { BackupEngine, backupFilename, validatePassphrase } from './backup'
import { Catalog, nameOf, pinDigest, validPin } from './catalog'
import { CloudBackup, DeviceSecrets } from './cloud'
import { MediaLibrary } from './media'
import { lineAmounts, orderAmounts } from '../src/types/pricing'
import type { Cashier, Category, FloorTable, MenuItem, Order, OrderInput, OrderItem, Settings, SettingsInput, Snapshot, Zone, ServexApi } from '../src/types/pos'

const dev = !app.isPackaged && process.env.SERVEX_DEV === '1'
const homePage = dev ? 'http://127.0.0.1:5173/' : pathToFileURL(path.join(app.getAppPath(), 'dist/index.html')).href
app.setName('ServeX POS')
app.setAppUserModelId('com.servex.pos')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1536')
let window: BrowserWindow | null = null
let cashier: Cashier | null = null

function activeLicense(value: string | null) {
  const publicKey = process.env.SERVEX_LICENSE_PUBLIC_KEY
  if (!value || !publicKey) return false
  try {
    const [payload, signature, extra] = value.split('.')
    if (!payload || !signature || extra) return false
    const key = createPublicKey(publicKey)
    if (key.asymmetricKeyType !== 'ed25519' ||
        !verify(null, Buffer.from(payload, 'ascii'), key, Buffer.from(signature, 'base64url'))) return false
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return claims.plan === 'commercial' && Number.isFinite(claims.exp) && claims.exp * 1000 > Date.now()
  } catch { return false }
}

function createWindow() {
  const icon = app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(app.getAppPath(), 'build/icon.ico')
  window = new BrowserWindow({
    minWidth: 1280, minHeight: 720, show: false,
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false))
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) cashier = null
  })
  window.once('ready-to-show', () => { window?.maximize(); window?.show() })
  window.on('closed', () => { window = null; cashier = null })
  void window.loadURL(homePage)
}

function handlers(db: PosDatabase, media: MediaLibrary, backup: BackupEngine, cloud: CloudBackup, secrets: DeviceSecrets) {
  const catalog = new Catalog(db, media)
  function register<K extends keyof ServexApi>(
    name: K, access: 'public' | 'staff' | 'manager' | 'admin',
    handle: (...args: Parameters<ServexApi[K]>) => ReturnType<ServexApi[K]> | Awaited<ReturnType<ServexApi[K]>>,
  ) {
    ipcMain.handle(`pos:${name}`, (event: IpcMainInvokeEvent, ...args: Parameters<ServexApi[K]>) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== homePage) throw new Error('Invalid request origin.')
      if (access !== 'public' && !cashier) throw new Error('Sign in to continue.')
      if (access === 'manager' && cashier?.role === 'cashier') throw new Error('Manager access is required.')
      if (access === 'admin' && cashier?.role !== 'admin') throw new Error('Administrator access is required.')
      return handle(...args)
    })
  }
  const settings = (): Settings => {
    const { license_key, ...config } = db.all<Omit<Settings, 'licenseConfigured' | 'licenseActive'> & { license_key: string | null }>(
      `SELECT restaurant_name, tagline, logo_path, address, phone, gstin, currency_symbol, tax_rate,
        tax_inclusive, receipt_footer, cloud_sync_enabled, cloud_endpoint, license_key FROM settings`,
    )[0]
    return { ...config, licenseConfigured: Boolean(license_key), licenseActive: activeLicense(license_key) }
  }
  const localDay = () => db.all<{ date: string }>("SELECT date('now','localtime') AS date")[0].date
  const orderById = (id: number) => db.all<Order>('SELECT * FROM orders WHERE id = ?', [id])[0]
  let nextSignIn = 0
  let nextOverride = 0
  register('signIn', 'public', (pin: string) => {
    if (Date.now() < nextSignIn) throw new Error('Wait a moment before trying again.')
    nextSignIn = Date.now() + 750
    if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) return null
    cashier = db.all<Cashier>('SELECT id, name, role FROM users WHERE pin = ? AND is_active = 1 ORDER BY id LIMIT 1', [pinDigest(db, pin)])[0] ?? null
    return cashier
  })
  register('lock', 'public', () => { cashier = null })
  register('snapshot', 'staff', (): Snapshot => {
    const config = settings()
    return {
      settings: config, logo: media.preview(config.logo_path), actor: cashier!, cloud: cashier?.role === 'admin' ? cloud.status() : null,
      zones: db.all<Zone>('SELECT * FROM zones ORDER BY sort_order, id'),
      tables: db.all<FloorTable>('SELECT * FROM tables ORDER BY id'),
      categories: db.all<Category>('SELECT * FROM categories ORDER BY sort_order, id'),
      menu: db.all<MenuItem>('SELECT * FROM menu_items WHERE archived = 0 ORDER BY id'),
      orders: db.all<Order>("SELECT * FROM orders WHERE status IN ('open','billed') OR date(closed_at,'localtime') = ? ORDER BY id DESC", [localDay()]),
      orderItems: db.all<OrderItem>("SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status IN ('open','billed') ORDER BY i.id"),
      businessDate: localDay(),
      lastClose: db.all<{ created_at: string }>("SELECT created_at FROM audit_logs WHERE action = 'z-close' AND details = ? ORDER BY id DESC LIMIT 1", [localDay()])[0]?.created_at ?? null,
    }
  })
  register('createOrder', 'staff', (input: OrderInput) => {
    if (!input || !['dinein', 'parcel', 'room'].includes(input.type) || !Array.isArray(input.items) ||
        input.items.length < 1 || input.items.length > 100) throw new Error('Add valid items to the order.')
    if (input.type !== 'parcel') {
      const table = db.all<FloorTable>('SELECT * FROM tables WHERE id = ?', [input.tableId])[0]
      if (!table || table.status !== 'vacant' || (table.type === 'room') !== (input.type === 'room')) throw new Error('This table or room is unavailable.')
    }
    if (db.all("SELECT id FROM audit_logs WHERE action = 'z-close' AND details = ?", [localDay()]).length) {
      throw new Error('The business day is closed.')
    }
    const config = settings()
    const inclusive = Boolean(config.tax_inclusive)
    const lines = input.items.map(({ id, quantity }) => {
      const item = db.all<MenuItem>(`SELECT m.* FROM menu_items m JOIN categories c ON c.id = m.category_id
        WHERE m.id = ? AND m.is_available = 1 AND c.is_active = 1 AND m.archived = 0`, [id])[0]
      if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error('An item or quantity is unavailable.')
      return { item, quantity, ...lineAmounts(item.price, quantity, item.tax_slab ?? config.tax_rate, inclusive) }
    })
    const totals = orderAmounts(lines, inclusive)
    const table = input.type === 'parcel' ? null : input.tableId
    db.transaction(sql => {
      sql.run(`INSERT INTO orders (table_id, order_type, subtotal, tax_amount, grand_total, created_by)
        VALUES (?, ?, ?, ?, ?, ?)`, [table, input.type, totals.subtotal, totals.tax, totals.total, cashier!.id])
      const id = Number(sql.exec('SELECT last_insert_rowid()')[0].values[0][0])
      sql.run('UPDATE orders SET bill_number = ? WHERE id = ?', [`SX-${String(id).padStart(5, '0')}`, id])
      for (const { item, quantity, gross } of lines) {
        sql.run(`INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, line_total)
          VALUES (?, ?, ?, ?, ?, ?)`, [id, item.id, item.name, item.price, quantity, gross / 100])
      }
      if (table !== null) sql.run("UPDATE tables SET status = 'occupied' WHERE id = ?", [table])
    })
  })
  register('payOrder', 'staff', (id: number, mode: string) => {
    const order = orderById(id)
    if (!order || !['open', 'billed'].includes(order.status) || !['Cash', 'Card', 'UPI'].includes(mode)) throw new Error('This payment cannot be recorded.')
    db.transaction(sql => {
      sql.run("UPDATE orders SET status = 'paid', payment_mode = ?, cash_tendered = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?", [mode, mode === 'Cash' ? order.grand_total : 0, id])
      if (order.table_id !== null) sql.run("UPDATE tables SET status = 'vacant' WHERE id = ?", [order.table_id])
    })
  })
  register('printKot', 'staff', async (id: number) => {
    const order = orderById(id)
    if (!order || !['open', 'billed'].includes(order.status)) throw new Error('This order is closed.')
    const rows = db.all<OrderItem>('SELECT * FROM order_items WHERE order_id = ? AND kot_printed = 0', [id])
    if (!rows.length) throw new Error('All items have already been sent to the printer.')
    const actor = cashier
    const ticket = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      const body = [order.bill_number, order.order_type.toUpperCase(), ...rows.map(row => `${row.quantity} × ${row.item_name}`)].join('\n')
      const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      await ticket.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><title>Kitchen order ticket</title><h1>Kitchen order ticket</h1><pre>${escaped}</pre>`))
      await new Promise<void>((resolve, reject) => ticket.webContents.print({ silent: false }, (ok, reason) => ok ? resolve() : reject(new Error(reason || 'Printing cancelled.'))))
      if (cashier === actor) db.write('UPDATE order_items SET kot_printed = 1 WHERE order_id = ?', [id])
    } finally { ticket.destroy() }
  })
  register('toggleItem', 'manager', (id: number) => db.write('UPDATE menu_items SET is_available = 1 - is_available WHERE id = ? AND archived = 0', [id]))
  register('closeDay', 'staff', (overridePin?: string) => {
    if (cashier?.role === 'cashier') {
      if (Date.now() < nextOverride) throw new Error('Wait a moment before trying another manager PIN.')
      nextOverride = Date.now() + 2000
      const digest = pinDigest(db, validPin(overridePin ?? ''))
      const configured = db.all<{ manager_pin: string }>('SELECT manager_pin FROM settings WHERE id = 1')[0].manager_pin
      if (configured === pinDigest(db, '1234')) throw new Error('An administrator must replace the demo override PIN first.')
      if (configured !== digest) throw new Error('Incorrect manager override PIN.')
    }
    const date = localDay()
    if (db.all("SELECT id FROM orders WHERE status IN ('open','billed') LIMIT 1").length) throw new Error('Settle open orders before closing the day.')
    if (db.all("SELECT id FROM audit_logs WHERE action = 'z-close' AND details = ?", [date]).length) throw new Error('Today has already been closed.')
    db.transaction(sql => {
      sql.run("INSERT INTO audit_logs (user_id, action, entity_type, details) VALUES (?, 'z-close', 'business-day', ?)", [cashier!.id, date])
      if (cashier?.role === 'cashier') {
        sql.run("INSERT INTO audit_logs (user_id, action, entity_type, details) VALUES (?, 'manager-override', 'business-day', ?)", [cashier.id, date])
      }
    })
  })
  register('updateSettings', 'manager', (input: SettingsInput) => {
    const clean = (value: string | null) => {
      if (value === null) return null
      if (typeof value !== 'string' || value.length > 250) throw new Error('A settings field is invalid.')
      return value.trim()
    }
    const name = nameOf(input.restaurant_name, 'restaurant name')
    const currency = nameOf(input.currency_symbol, 'currency symbol', 6)
    if (!Number.isFinite(input.tax_rate) || input.tax_rate < 0 || input.tax_rate > 100 ||
        ![0, 1].includes(input.tax_inclusive)) throw new Error('Enter valid restaurant and tax settings.')
    if (cashier?.role !== 'admin' && (input.managerPin !== undefined || input.licenseKey !== undefined)) {
      throw new Error('Administrator access is required for security and license settings.')
    }
    const digest = input.managerPin === undefined ? null : pinDigest(db, validPin(input.managerPin))
    if (input.licenseKey !== undefined && (typeof input.licenseKey !== 'string' || input.licenseKey.length > 2048)) throw new Error('Enter a valid license key.')
    db.transaction(sql => {
      sql.run(`UPDATE settings SET restaurant_name = ?, tagline = ?, address = ?, phone = ?, gstin = ?,
        currency_symbol = ?, tax_rate = ?, tax_inclusive = ?, receipt_footer = ?,
        manager_pin = COALESCE(?, manager_pin), license_key = COALESCE(?, license_key) WHERE id = 1`,
      [name, clean(input.tagline), clean(input.address), clean(input.phone), clean(input.gstin), currency, input.tax_rate,
        input.tax_inclusive, clean(input.receipt_footer), digest, input.licenseKey?.trim() ?? null])
      sql.run("INSERT INTO audit_logs (user_id, action, entity_type, details) VALUES (?, 'settings-updated', 'settings', ?)",
        [cashier!.id, JSON.stringify({ managerPinChanged: digest !== null, licenseChanged: input.licenseKey !== undefined })])
    })
  })
  const pickImage = async () => {
    const actor = cashier
    return media.pick(window!, () => cashier === actor)
  }
  register('pickLogo', 'manager', async () => {
    const actor = cashier
    const image = await pickImage()
    if (!image || cashier !== actor) return false
    db.write('UPDATE settings SET logo_path = ? WHERE id = 1', [image.name])
    return true
  })
  register('removeLogo', 'manager', () => db.write('UPDATE settings SET logo_path = NULL WHERE id = 1'))
  register('pickMedia', 'manager', pickImage)
  register('readMedia', 'staff', name => media.preview(name))
  register('listStaff', 'admin', () => catalog.staff())
  register('saveStaff', 'admin', input => {
    catalog.saveStaff(input, cashier!.id)
    const actor = catalog.staff().find(user => user.id === cashier!.id)!
    cashier = { id: actor.id, name: actor.name, role: actor.role }
  })
  register('saveCategory', 'manager', input => catalog.category(input))
  register('moveCategory', 'manager', (id, direction) => catalog.moveCategory(id, direction))
  register('saveMenuItem', 'manager', input => catalog.menuItem(input))
  register('deleteMenuItem', 'manager', id => catalog.deleteMenuItem(id))
  register('saveZone', 'admin', input => catalog.zone(input))
  register('deleteZone', 'admin', id => catalog.deleteZone(id))
  register('saveLocations', 'admin', input => catalog.saveLocations(input))
  register('deleteLocation', 'admin', id => catalog.deleteLocation(id))

  const csvFilter = [{ name: 'CSV file', extensions: ['csv'] }]
  const backupFilter = [{ name: 'ServeX backup', extensions: ['svxbak'] }]
  async function saveFile(bytes: () => Uint8Array, defaultPath: string, filters: Electron.FileFilter[]) {
    const actor = cashier
    const result = await dialog.showSaveDialog(window!, { defaultPath, filters })
    if (result.canceled || !result.filePath || cashier !== actor) return false
    const extension = '.' + filters[0].extensions[0]
    const file = result.filePath.toLowerCase().endsWith(extension) ? result.filePath : result.filePath + extension
    atomicWrite(file, bytes())
    return true
  }
  register('importMenuCsv', 'manager', async () => {
    const actor = cashier
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: csvFilter })
    if (result.canceled || cashier !== actor) return null
    const file = result.filePaths[0]
    if (fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('Choose a CSV smaller than 4 MB.')
    return catalog.importCsv(fs.readFileSync(file, 'utf8'))
  })
  register('exportMenuCsv', 'manager', template => saveFile(
    () => Buffer.from(catalog.exportCsv(template)), template ? 'ServeX_Menu_Template.csv' : 'ServeX_Menu.csv', csvFilter,
  ))
  register('exportBackup', 'admin', passphrase => {
    validatePassphrase(passphrase)
    return saveFile(() => backup.archive(passphrase), backupFilename(), backupFilter)
  })
  register('importBackup', 'admin', async passphrase => {
    validatePassphrase(passphrase, Boolean(passphrase))
    const actor = cashier!
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: backupFilter })
    if (result.canceled || cashier !== actor) return false
    const confirm = await dialog.showMessageBox(window!, {
      type: 'warning', buttons: ['Cancel', 'Restore backup'], defaultId: 0, cancelId: 0,
      message: 'Replace the current ServeX database with this backup?',
      detail: 'ServeX creates an encrypted recovery snapshot before replacing the database.',
    })
    if (confirm.response !== 1 || cashier !== actor) return false
    let localKey: string | undefined
    try { localKey = secrets.localKey() } catch { if (!passphrase) throw new Error('Enter a backup passphrase to continue without OS credential storage.') }
    const previous = db.all<{ pin: string }>('SELECT pin FROM users WHERE id = ?', [actor.id])[0].pin
    backup.restore(result.filePaths[0], passphrase, localKey, localKey ?? passphrase)
    cloud.invalidate()
    const restored = db.all<Cashier>(
      "SELECT id, name, role FROM users WHERE id = ? AND role = 'admin' AND is_active = 1 AND pin = ?", [actor.id, previous],
    )[0]
    cashier = restored ?? null
    return restored ? 'restored' : 'locked'
  })
  register('updateCloud', 'admin', input => cloud.update(input))
  register('syncCloud', 'admin', () => cloud.sync())

}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus() })
  app.whenReady().then(async () => {
    const file = dev ? path.join(app.getAppPath(), 'data', 'servex-dev.db') : path.join(app.getPath('userData'), 'servex-prod.db')
    const db = await PosDatabase.open(file)
    const storage = dev ? path.dirname(file) : path.join(app.getPath('appData'), 'ServeX')
    const media = new MediaLibrary(path.join(storage, 'media'), path.join(path.dirname(file), 'logos'))
    const backup = new BackupEngine(db, media, path.join(storage, 'auto-backups'))
    const secrets = new DeviceSecrets(path.join(storage, 'device-secrets'))
    const cloud = new CloudBackup(db, backup, secrets)
    handlers(db, media, backup, cloud, secrets)
    const scheduled = () => void cloud.sync(true).catch(() => console.warn('Scheduled ServeX cloud backup did not complete.'))
    scheduled()
    const timer = setInterval(scheduled, 15 * 60 * 1000)
    app.once('will-quit', () => {
      clearInterval(timer)
      try { backup.rolling(secrets.localKey()) } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.warn('ServeX automatic backup failed: ' + message)
        if (process.platform === 'win32') dialog.showErrorBox('ServeX automatic backup failed', message)
      }
    })
    createWindow()
    app.on('activate', () => { if (!window) createWindow() })
  }).catch(error => {
    dialog.showErrorBox('ServeX could not start', String(error))
    app.exit(1)
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
