import { app, BrowserWindow, dialog, ipcMain, nativeImage, IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PosDatabase, atomicWrite } from './db'
import { lineAmounts, orderAmounts } from '../src/types/pricing'
import type { Cashier, Category, FloorTable, MenuItem, Order, OrderInput, OrderItem, Settings, SettingsInput, Snapshot, Zone } from '../src/types/pos'

const dev = !app.isPackaged && process.env.SERVEX_DEV === '1'
const homePage = dev ? 'http://127.0.0.1:5173/' : pathToFileURL(path.join(app.getAppPath(), 'dist/index.html')).href
app.setName('ServeX POS')
app.setAppUserModelId('com.servex.pos')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1536')
let window: BrowserWindow | null = null
let cashier: Cashier | null = null

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

function handlers(db: PosDatabase) {
  function register<T extends unknown[], R>(name: string, access: 'public' | 'staff' | 'manager', handle: (...args: T) => R) {
    ipcMain.handle(`pos:${name}`, (event: IpcMainInvokeEvent, ...args: T) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== homePage) throw new Error('Invalid request origin.')
      if (access !== 'public' && !cashier) throw new Error('Sign in to continue.')
      if (access === 'manager' && cashier?.role === 'cashier') throw new Error('Manager access is required.')
      return handle(...args)
    })
  }
  const settings = () => db.all<Settings>(`SELECT restaurant_name, tagline, logo_path, address, phone, gstin,
    currency_symbol, tax_rate, tax_inclusive, receipt_footer, cloud_sync_enabled, cloud_endpoint FROM settings`)[0]
  const localDay = () => db.all<{ date: string }>("SELECT date('now','localtime') AS date")[0].date
  const logoDir = path.join(path.dirname(dev ? path.join(app.getAppPath(), 'data/servex-dev.db') : path.join(app.getPath('userData'), 'servex-prod.db')), 'logos')
  function readLogo(logoPath: string | null) {
    if (!logoPath || !/^logo-[a-f\d-]+\.png$/.test(logoPath)) return null
    const file = path.join(logoDir, logoPath)
    if (!fs.existsSync(file)) return null
    const image = nativeImage.createFromPath(file)
    return image.isEmpty() ? null : image.toDataURL()
  }
  const orderById = (id: number) => db.all<Order>('SELECT * FROM orders WHERE id = ?', [id])[0]
  let nextSignIn = 0
  register('sign-in', 'public', (pin: string) => {
    if (Date.now() < nextSignIn) throw new Error('Wait a moment before trying again.')
    nextSignIn = Date.now() + 750
    if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) return null
    cashier = db.all<Cashier>('SELECT id, name, role FROM users WHERE pin = ? AND is_active = 1 ORDER BY id LIMIT 1', [pin])[0] ?? null
    return cashier
  })
  register('lock', 'public', () => { cashier = null })
  register('snapshot', 'staff', (): Snapshot => {
    const config = settings()
    return {
      settings: config, logo: readLogo(config.logo_path),
      zones: db.all<Zone>('SELECT * FROM zones ORDER BY sort_order, id'),
      tables: db.all<FloorTable>('SELECT * FROM tables ORDER BY id'),
      categories: db.all<Category>('SELECT * FROM categories ORDER BY sort_order, id'),
      menu: db.all<MenuItem>('SELECT * FROM menu_items ORDER BY id'),
      orders: db.all<Order>("SELECT * FROM orders WHERE status IN ('open','billed') OR date(closed_at,'localtime') = ? ORDER BY id DESC", [localDay()]),
      orderItems: db.all<OrderItem>("SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status IN ('open','billed') ORDER BY i.id"),
      businessDate: localDay(),
      lastClose: db.all<{ created_at: string }>("SELECT created_at FROM audit_logs WHERE action = 'z-close' AND details = ? ORDER BY id DESC LIMIT 1", [localDay()])[0]?.created_at ?? null,
    }
  })
  register('create-order', 'staff', (input: OrderInput) => {
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
        WHERE m.id = ? AND m.is_available = 1 AND c.is_active = 1`, [id])[0]
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
  register('pay-order', 'staff', (id: number, mode: string) => {
    const order = orderById(id)
    if (!order || !['open', 'billed'].includes(order.status) || !['Cash', 'Card', 'UPI'].includes(mode)) throw new Error('This payment cannot be recorded.')
    db.transaction(sql => {
      sql.run("UPDATE orders SET status = 'paid', payment_mode = ?, cash_tendered = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?", [mode, mode === 'Cash' ? order.grand_total : 0, id])
      if (order.table_id !== null) sql.run("UPDATE tables SET status = 'vacant' WHERE id = ?", [order.table_id])
    })
  })
  register('print-kot', 'staff', async (id: number) => {
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
  register('toggle-item', 'manager', (id: number) => db.write('UPDATE menu_items SET is_available = 1 - is_available WHERE id = ?', [id]))
  register('close-day', 'manager', () => {
    const date = localDay()
    if (db.all("SELECT id FROM orders WHERE status IN ('open','billed') LIMIT 1").length) throw new Error('Settle open orders before closing the day.')
    if (db.all("SELECT id FROM audit_logs WHERE action = 'z-close' AND details = ?", [date]).length) throw new Error('Today has already been closed.')
    db.write("INSERT INTO audit_logs (user_id, action, entity_type, details) VALUES (?, 'z-close', 'business-day', ?)", [cashier!.id, date])
  })
  register('update-settings', 'manager', (input: SettingsInput) => {
    const clean = (value: string | null, limit = 250) => {
      if (value === null) return null
      if (typeof value !== 'string' || value.length > limit) throw new Error('A settings field is invalid.')
      return value.trim()
    }
    const name = clean(input.restaurant_name, 80)
    const currency = clean(input.currency_symbol, 6)
    if (!name || !currency || !Number.isFinite(input.tax_rate) || input.tax_rate < 0 || input.tax_rate > 100 ||
        ![0, 1].includes(input.tax_inclusive)) throw new Error('Enter valid restaurant and tax settings.')
    db.write(`UPDATE settings SET restaurant_name = ?, tagline = ?, address = ?, phone = ?, gstin = ?,
      currency_symbol = ?, tax_rate = ?, tax_inclusive = ?, receipt_footer = ? WHERE id = 1`,
    [name, clean(input.tagline), clean(input.address), clean(input.phone), clean(input.gstin), currency, input.tax_rate, input.tax_inclusive, clean(input.receipt_footer)])
  })
  register('pick-logo', 'manager', async () => {
    const actor = cashier
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] })
    if (result.canceled || cashier !== actor) return false
    const file = result.filePaths[0]
    if (fs.statSync(file).size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.')
    const image = nativeImage.createFromPath(file)
    if (image.isEmpty()) throw new Error('The image could not be opened.')
    const { randomUUID } = await import('node:crypto')
    if (cashier !== actor) return false
    const name = `logo-${randomUUID()}.png`
    atomicWrite(path.join(logoDir, name), image.resize({ width: 256 }).toPNG())
    db.write('UPDATE settings SET logo_path = ? WHERE id = 1', [name])
    return true
  })
  const backupFilter = [{ name: 'ServeX backup', extensions: ['svxbak'] }]
  register('export-backup', 'manager', async () => {
    const actor = cashier
    const result = await dialog.showSaveDialog(window!, { defaultPath: `ServeX-${localDay()}.svxbak`, filters: backupFilter })
    if (result.canceled || !result.filePath || cashier !== actor) return false
    const file = result.filePath.toLowerCase().endsWith('.svxbak') ? result.filePath : result.filePath + '.svxbak'
    db.exportTo(file)
    return true
  })
  register('import-backup', 'manager', async () => {
    const actor = cashier
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: backupFilter })
    if (result.canceled || cashier !== actor) return false
    const confirm = await dialog.showMessageBox(window!, {
      type: 'warning', buttons: ['Cancel', 'Restore backup'], defaultId: 0, cancelId: 0,
      message: 'Replace the current ServeX database with this backup?',
    })
    if (confirm.response !== 1 || cashier !== actor) return false
    db.importFrom(result.filePaths[0])
    cashier = null
    return true
  })
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus() })
  app.whenReady().then(async () => {
    const file = dev ? path.join(app.getAppPath(), 'data', 'servex-dev.db') : path.join(app.getPath('userData'), 'servex-prod.db')
    handlers(await PosDatabase.open(file))
    createWindow()
    app.on('activate', () => { if (!window) createWindow() })
  }).catch(error => {
    dialog.showErrorBox('ServeX could not start', String(error))
    app.exit(1)
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
