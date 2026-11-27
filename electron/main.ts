import { withDialogFocus } from './dialogFocus'
import { app, BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PosDatabase, atomicWrite } from './db'
import { BackupEngine, backupFilename, validatePassphrase } from './backup'
import { Catalog, nameOf, pinDigest, validPin } from './catalog'
import { CloudBackup, DeviceSecrets } from './cloud'
import { MediaLibrary } from './media'
import { FloorService, orderColumns } from './service'
import { Printer, receiptHtml, ticketHtml, zReportHtml, type ReceiptDocument } from './printer'
import { LicenseManager } from './license'
import { LocalServer } from './localServer'
import { Reports, closedDay } from './reports'
import type { Cashier, Category, FloorTable, MenuItem, Order, OrderItem, Settings, SettingsInput, Snapshot, Zone, ServexApi } from '../src/types/pos'

const dev = !app.isPackaged && process.env.SERVEX_DEV === '1'
const homePage = dev ? 'http://127.0.0.1:5173/' : pathToFileURL(path.join(app.getAppPath(), 'dist/index.html')).href
app.setName('ServeX POS')
app.setAppUserModelId('com.servex.pos')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1536')
let window: BrowserWindow | null = null
let cashier: Cashier | null = null
let rendererEpoch = 0

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
    if (mainFrame && !inPlace) { cashier = null; rendererEpoch++ }
  })
  window.once('ready-to-show', () => { window?.maximize(); window?.show() })
  window.on('closed', () => { window = null; cashier = null })
  void window.loadURL(homePage)
}

function handlers(db: PosDatabase, media: MediaLibrary, backup: BackupEngine, cloud: CloudBackup, secrets: DeviceSecrets, storage: string) {
  const catalog = new Catalog(db, media)
  const service = new FloorService(db)
  const printer = new Printer()
  const reports = new Reports(db)
  const keyFile = path.join(app.getAppPath(), 'build', 'license-public.pem')
  const license = new LicenseManager(path.join(storage, 'license-trial.json'),
    (!app.isPackaged && process.env.SERVEX_LICENSE_PUBLIC_KEY) || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : undefined))
  const licenseState = () => license.state(db.all<{ license_key: string | null }>('SELECT license_key FROM settings WHERE id=1')[0].license_key)
  const needsSetup = () => db.all<{ onboarding_completed: number }>('SELECT onboarding_completed FROM settings WHERE id=1')[0].onboarding_completed === 0
  const lan = new LocalServer(db, service, () => !needsSetup() && licenseState().mode !== 'expired',
    () => window?.webContents.send('pos:lanChanged'))
  const persistedLan = db.all<{ lan_enabled: number; lan_actor: number | null }>('SELECT lan_enabled,lan_actor FROM settings WHERE id=1')[0]
  if (persistedLan.lan_enabled && persistedLan.lan_actor && !needsSetup() && licenseState().mode !== 'expired') void lan.start(persistedLan.lan_actor)
  app.once('will-quit', () => lan.stop())
  const lanUpdates = new Set<keyof ServexApi>(['createOrder','addOrderItems','clearUnsent','editBill','completePayment',
    'saveLayout','transfer','merge','updateStatus','toggleItem','saveCategory','moveCategory','saveMenuItem',
    'deleteMenuItem','importMenuCsv','saveZone','deleteZone','saveLocations','deleteLocation','closeDay','prebill','sendKot'])
  const printing = new Set<number>()
  function ensureIdle(...ids: number[]) {
    if (ids.some(id => printing.has(id))) throw new Error('Wait for the order’s print dialog to finish.')
  }
  function register<K extends keyof ServexApi>(
    name: K, access: 'public' | 'staff' | 'manager' | 'admin',
    handle: (...args: Parameters<ServexApi[K]>) => ReturnType<ServexApi[K]> | Awaited<ReturnType<ServexApi[K]>>,
    namespace: 'pos' | 'tables' = 'pos',
  ) {
    ipcMain.handle(`${namespace}:${name}`, (event: IpcMainInvokeEvent, ...args: Parameters<ServexApi[K]>) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== homePage) throw new Error('Invalid request origin.')
      if (access !== 'public' && !cashier) throw new Error('Sign in to continue.')
      if (access === 'manager' && cashier?.role === 'cashier') throw new Error('Manager access is required.')
      if (access === 'admin' && cashier?.role !== 'admin') throw new Error('Administrator access is required.')
      if (access !== 'public' && licenseState().mode === 'expired') throw new Error('Activate ServeX to continue.')
      const result = handle(...args)
      if (lanUpdates.has(name)) return Promise.resolve(result).then(value => { lan.changed(); return value })
      return result
    })
  }
  const settings = (): Settings => {
    const { license_key, ...config } = db.all<Omit<Settings, 'licenseConfigured' | 'licenseActive'> & { license_key: string | null }>(
      `SELECT restaurant_name, tagline, logo_path, address, phone, gstin, currency_symbol, tax_rate,
        tax_inclusive, auto_cleaning, receipt_width, print_preview, printer_name, upi_id, receipt_footer, cloud_sync_enabled, cloud_endpoint, license_key FROM settings`,
    )[0]
    return { ...config, licenseConfigured: Boolean(license_key), licenseActive: Boolean(license_key && license.accepts(license_key)) }
  }
  const localDay = () => reports.day()
  let nextSignIn = 0
  let nextOverride = 0
  let setupGrant: { id: number; owner: BrowserWindow; epoch: number; until: number } | null = null
  const setupAdmin = () => {
    if (!setupGrant || setupGrant.owner !== window || setupGrant.epoch !== rendererEpoch || Date.now() >= setupGrant.until) return undefined
    return db.all<{ id: number }>("SELECT id FROM users WHERE id=? AND role='admin' AND is_active=1", [setupGrant.id])[0]
  }
  function authenticate(pin: string, staffId?: number, adminsOnly = false) {
    if (Date.now() < nextSignIn) throw new Error('Wait a moment before trying again.')
    nextSignIn = Date.now() + 750
    if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin) || (staffId !== undefined && !Number.isSafeInteger(staffId))) return null
    return db.all<Cashier>(`SELECT id, name, role FROM users WHERE pin=? AND is_active=1
      AND (? IS NULL OR id=?) AND (?=0 OR role='admin') ORDER BY id LIMIT 1`,
    [pinDigest(db, pin), staffId ?? null, staffId ?? null, Number(adminsOnly)])[0] ?? null
  }
  register('activeStaff', 'public', () => db.all<Cashier>('SELECT id, name, role FROM users WHERE is_active=1 ORDER BY id'))
  register('signIn', 'public', (pin, staffId) => {
    if (needsSetup() || licenseState().mode === 'expired') throw new Error('Finish setup or activate ServeX before signing in.')
    setupGrant = null
    cashier = authenticate(pin, staffId)
    return cashier
  })
  register('authorizeSetup', 'public', pin => {
    if (cashier || needsSetup()) throw new Error('Administrator recovery is only available from staff sign-in.')
    setupGrant = null
    const user = authenticate(pin, undefined, true)
    if (!user) throw new Error('Enter the PIN of an active administrator.')
    setupGrant = { id: user.id, owner: window!, epoch: rendererEpoch, until: Date.now() + 30 * 60 * 1000 }
    const config = settings()
    const preview = media.preview(config.logo_path)
    return { input: { name: config.restaurant_name, phone: config.phone ?? '', address: config.address ?? '', gstin: config.gstin ?? '',
      logo: config.logo_path, preset: 'dinein', tax: config.tax_rate, upi: config.upi_id, pin: '' },
      logo: preview && config.logo_path ? { name: config.logo_path, preview } : null }
  })
  register('lock', 'public', () => { cashier = null; setupGrant = null; printer.clear() })
  register('snapshot', 'staff', (): Snapshot => {
    const config = settings()
    return {
      settings: config, logo: media.preview(config.logo_path), actor: cashier!, cloud: cashier?.role === 'admin' ? cloud.status() : null,
      zones: db.all<Zone>('SELECT * FROM zones ORDER BY sort_order, id'),
      tables: db.all<FloorTable>('SELECT * FROM tables ORDER BY id'),
      categories: db.all<Category>('SELECT * FROM categories ORDER BY sort_order, id'),
      menu: db.all<MenuItem>('SELECT * FROM menu_items WHERE archived = 0 ORDER BY id'),
      orders: db.all<Order>(`SELECT ${orderColumns} FROM orders WHERE status IN ('open','billed') ORDER BY id DESC`),
      orderItems: db.all<OrderItem>("SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status IN ('open','billed') ORDER BY i.id"),
      kitchen: service.kitchen(),
      businessDate: localDay(),
      lastClose: db.all<{ created_at: string }>(`SELECT created_at FROM audit_logs WHERE ${closedDay} AND details = ? ORDER BY id DESC LIMIT 1`, [localDay()])[0]?.created_at ?? null,
    }
  })
  register('saveLayout', 'manager', updates => service.saveLayout(updates), 'tables')
  register('transfer', 'staff', input => {
    ensureIdle(input.orderId)
    service.transfer(input, cashier!.id)
  }, 'tables')
  register('merge', 'staff', input => {
    ensureIdle(input.targetOrderId, input.sourceOrderId)
    service.merge(input, cashier!.id)
  }, 'tables')
  register('updateStatus', 'staff', input => service.updateStatus(input, cashier!.id), 'tables')
  register('createOrder', 'staff', input => service.createOrder(input, cashier!.id))
  register('addOrderItems', 'staff', (id, revision, items) => {
    ensureIdle(id)
    service.addItems(id, revision, items, cashier!.id)
  })
  register('clearUnsent', 'staff', (id, revision) => { ensureIdle(id); service.clearUnsent(id, revision, cashier!.id) })
  register('editBill', 'staff', input => {
    ensureIdle(input.orderId)
    service.editBill(input, cashier!.id, requireManagerPin)
  })
  function requireManagerPin(pin?: string) {
    if (pin === undefined || pin === '') throw new Error('Manager PIN required for this change.')
    if (Date.now() < nextOverride) throw new Error('Wait a moment before trying another manager PIN.')
    const digest = pinDigest(db, validPin(pin))
    const configured = db.all<{ manager_pin: string }>('SELECT manager_pin FROM settings WHERE id = 1')[0].manager_pin
    if (configured === pinDigest(db, '1234')) throw new Error('An administrator must replace the demo override PIN first.')
    if (configured !== digest) {
      nextOverride = Date.now() + 2000
      throw new Error('Incorrect manager override PIN.')
    }
  }

  const document = (order: Order, parts: ReceiptDocument['parts'], brand: Settings): ReceiptDocument => ({
    order, parts,
    brand: { restaurant_name: brand.restaurant_name, address: brand.address, phone: brand.phone, gstin: brand.gstin,
      currency_symbol: brand.currency_symbol, receipt_footer: brand.receipt_footer, upi_id: brand.upi_id },
    logoName: brand.logo_path,
    location: (order.table_id !== null && service.table(order.table_id)?.label) || 'Takeaway',
    timestamp: order.closed_at ? order.closed_at.replace(' ', 'T') + 'Z' : new Date().toISOString(),
  })

  register('sendKot', 'staff', (id, revision) => {
    ensureIdle(id)
    const actor = cashier!.id
    const config = settings()
    const ticket = service.ticket(service.sendKot(id, revision, actor))
    return printer.submit(ticketHtml(ticket, config.receipt_width), config, actor)
  })
  register('printTicket', 'staff', id => {
    const config = settings()
    return printer.submit(ticketHtml(service.ticket(id), config.receipt_width), config, cashier!.id)
  })
  register('readyTicket', 'staff', id => service.readyTicket(id))
  register('prebill', 'staff', async (id, revision, split) => {
    ensureIdle(id)
    const order = service.activeOrder(id, revision)
    const actor = cashier!.id
    const config = settings()
    const doc = document(order, service.receiptParts(order, split), config)
    printing.add(id)
    try {
      const html = await receiptHtml(doc, config.receipt_width, true, media.preview(doc.logoName))
      const result = await printer.submit(html, config, actor)
      if (!result.error || result.html) service.markPrinted(id, revision, actor)
      return result
    } finally { printing.delete(id) }
  })
  register('completePayment', 'staff', async input => {
    ensureIdle(input.orderId)
    const actor = cashier!.id
    const config = settings()
    const stored = service.settle(input, actor, (order, parts) => JSON.stringify(document(order, parts, config)))
    const doc = JSON.parse(stored) as ReceiptDocument
    try { return await printer.submit(await receiptHtml(doc, config.receipt_width, false, media.preview(doc.logoName)), config, actor) }
    catch { return { html: null, error: 'Payment saved. Receipt rendering failed. Use Past Bills to reprint.' } }
  })
  register('pastBills', 'staff', before => service.pastBills(before))
  register('reprintReceipt', 'staff', async id => {
    const order = service.paidBill(id)
    const config = settings()
    const actor = cashier!.id
    const doc = order.receipt_json ? JSON.parse(order.receipt_json) as ReceiptDocument : document(order, service.receiptParts(order, { kind: 'none' }), config)
    return printer.submit(await receiptHtml(doc, config.receipt_width, false, media.preview(doc.logoName)), config, actor)
  })
  register('voidReceipt', 'staff', (id, pin) => {
    requireManagerPin(pin)
    service.voidReceipt(id, cashier!.id)
  })
  register('printPreview', 'staff', id => printer.preview(id, cashier!.id))

  register('toggleItem', 'manager', (id: number) => db.write('UPDATE menu_items SET is_available = 1 - is_available WHERE id = ? AND archived = 0', [id]))
  register('startup', 'public', () => ({ onboarding: needsSetup(), license: licenseState() }))
  register('setupLogo', 'public', () => {
    const grant = setupGrant
    const allowed = () => needsSetup() || Boolean(grant && setupGrant === grant && setupAdmin())
    if (!allowed()) throw new Error('Administrator verification is required.')
    return media.pick(window!, allowed)
  })
  register('finishSetup', 'public', input => {
    const fresh = needsSetup()
    const admin = setupAdmin()
    if (!fresh && !admin) throw new Error('Administrator verification is required.')
    const name = nameOf(input.name, 'restaurant name')
    const pin = fresh || input.pin ? pinDigest(db, validPin(input.pin)) : null
    if (admin && pin && db.all('SELECT id FROM users WHERE pin=? AND is_active=1 AND id!=?', [pin, admin.id]).length) {
      throw new Error('Another active staff member already uses that PIN.')
    }
    const currentLogo = settings().logo_path
    if (!['dinein','garden','lodging'].includes(input.preset) || !Number.isFinite(input.tax) || input.tax < 0 || input.tax > 100 ||
      typeof input.upi !== 'string' || !/^[\w.+-]{1,120}@[\w.-]{1,64}$/.test(input.upi) ||
      (input.logo !== null && input.logo !== currentLogo && !media.read(input.logo))) throw new Error('Check the venue preset, tax rate, UPI ID, and logo.')
    const trim = (value: string) => {
      if (typeof value !== 'string' || value.length > 250) throw new Error('A restaurant field exceeds 250 characters.')
      return value.trim() || null
    }
    db.transaction(sql => {
      sql.run(`UPDATE settings SET restaurant_name=?, phone=?, address=?, gstin=?, logo_path=?, tax_rate=?,
        upi_id=?, onboarding_completed=1, tagline=CASE WHEN ? THEN NULL ELSE tagline END WHERE id=1`,
      [name, trim(input.phone), trim(input.address), trim(input.gstin), input.logo, input.tax, input.upi, Number(fresh)])
      if (fresh) {
        sql.run('UPDATE menu_items SET tax_slab=?', [input.tax])
        sql.run("UPDATE users SET pin=? WHERE id=(SELECT id FROM users WHERE role='admin' AND is_active=1 ORDER BY id LIMIT 1)", [pin])
        if (input.preset !== 'garden') sql.run("DELETE FROM zones WHERE name='Garden Lawn'")
        if (input.preset !== 'lodging') sql.run("DELETE FROM zones WHERE name='Luxury Rooms'")
      } else {
        if (pin) sql.run('UPDATE users SET pin=? WHERE id=?', [pin, admin!.id])
        sql.run("INSERT INTO audit_logs (user_id,action,entity_type) VALUES (?,'REOPEN_SETUP','settings')", [admin!.id])
      }
    })
    setupGrant = null
  })
  register('activateLicense', 'public', key => {
    if (!license.accepts(key)) throw new Error('Activation key is invalid for this machine or the issuer key is missing.')
    db.transaction(sql => {
      sql.run('UPDATE settings SET license_key=? WHERE id=1', [key.trim()])
      sql.run("INSERT INTO audit_logs (user_id,action,entity_type) VALUES (?,'LICENSE_ACTIVATED','settings')", [cashier?.id ?? null])
    })
    return licenseState()
  })
  register('analytics', 'staff', range => reports.analytics(range))
  register('auditEntries', 'manager', query => reports.audit(query))
  register('getZReport', 'staff', () => reports.zState())
  register('closeDay', 'staff', async input => {
    const current = reports.zState()
    if (!current.report && cashier?.role === 'cashier') requireManagerPin(input.pin)
    const actor = cashier!
    const destination = (report: NonNullable<typeof current.report>) => {
      const fingerprint = createHash('sha256').update(JSON.stringify(report)).digest('hex').slice(0, 16)
      return path.join(storage, 'z-backups', `ServeX_Z_${report.day}_${fingerprint}.svxbak`)
    }
    let secret: string | undefined
    if (!current.report || !fs.existsSync(destination(current.report))) {
      try { secret = secrets.localKey() }
      catch {
        if (!input.backupPassphrase) throw new Error('OS credential storage is unavailable. Enter a backup passphrase to continue.')
        validatePassphrase(input.backupPassphrase)
        secret = input.backupPassphrase
      }
    }
    const report = current.report ?? reports.close(input, actor)
    let error: string | undefined
    try { if (secret) atomicWrite(destination(report), backup.archive(secret)) }
    catch { error = 'Day closed. The encrypted snapshot failed; retry from Z-Close to create it.' }
    const result = await printer.submit(zReportHtml(report), settings(), actor.id)
    return { ...result, error: [error, result.error].filter(Boolean).join(' ') || undefined }
  })
  register('lanStatus', 'admin', () => lan.state())
  register('configureLan', 'admin', async enabled => {
    if (typeof enabled !== 'boolean') throw new Error('Choose a valid Mobile Waiter Sync setting.')
    const actor = cashier!
    if (!enabled) {
      lan.stop()
      db.write('UPDATE settings SET lan_enabled=0,lan_actor=NULL WHERE id=1')
      return lan.state()
    }
    const state = await lan.start(actor.id)
    if (cashier !== actor) { lan.stop(); throw new Error('Sign in again to enable Mobile Waiter Sync.') }
    if (state.enabled) {
      try { db.write('UPDATE settings SET lan_enabled=1,lan_actor=? WHERE id=1', [actor.id]) }
      catch (error) { lan.stop(); throw error }
    }
    return state
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
        ![0, 1].includes(input.tax_inclusive) || (input.auto_cleaning !== undefined && ![0, 1].includes(input.auto_cleaning))) throw new Error('Enter valid restaurant and tax settings.')
    if (cashier?.role !== 'admin' && (input.managerPin !== undefined || input.licenseKey !== undefined)) {
      throw new Error('Administrator access is required for security and license settings.')
    }
    const digest = input.managerPin === undefined ? null : pinDigest(db, validPin(input.managerPin))
    if (input.licenseKey !== undefined && !license.accepts(input.licenseKey)) throw new Error('Activation key is invalid for this machine.')
    if (input.upi_id !== undefined && (typeof input.upi_id !== 'string' || !/^[\w.+-]{1,120}@[\w.-]{1,64}$/.test(input.upi_id))) throw new Error('Enter a valid UPI ID.')
    if (input.receipt_width !== undefined && ![58, 80].includes(input.receipt_width)) throw new Error('Choose a 58 mm or 80 mm roll.')
    if (input.print_preview !== undefined && ![0, 1].includes(input.print_preview)) throw new Error('Choose a valid print mode.')
    db.transaction(sql => {
      sql.run(`UPDATE settings SET restaurant_name = ?, tagline = ?, address = ?, phone = ?, gstin = ?,
        currency_symbol = ?, tax_rate = ?, tax_inclusive = ?, receipt_footer = ?,
        auto_cleaning = COALESCE(?, auto_cleaning), manager_pin = COALESCE(?, manager_pin), license_key = COALESCE(?, license_key),
        upi_id = COALESCE(?, upi_id), receipt_width = COALESCE(?, receipt_width), print_preview = COALESCE(?, print_preview), printer_name = COALESCE(?, printer_name) WHERE id = 1`,
      [name, clean(input.tagline), clean(input.address), clean(input.phone), clean(input.gstin), currency, input.tax_rate,
        input.tax_inclusive, clean(input.receipt_footer), input.auto_cleaning ?? null, digest, input.licenseKey?.trim() ?? null, input.upi_id ?? null, input.receipt_width ?? null, input.print_preview ?? null,
        input.printer_name === undefined ? null : clean(input.printer_name)])
      sql.run("INSERT INTO audit_logs (user_id, action, entity_type, details) VALUES (?, 'settings-updated', 'settings', ?)",
        [cashier!.id, JSON.stringify({ managerPinChanged: digest !== null, licenseChanged: input.licenseKey !== undefined })])
    })
  })
  const pickImage = async (dishPhoto = false) => {
    const actor = cashier
    return media.pick(window!, () => cashier === actor, dishPhoto)
  }
  register('pickLogo', 'manager', async () => {
    const actor = cashier
    const image = await pickImage()
    if (!image || cashier !== actor) return false
    db.write('UPDATE settings SET logo_path = ? WHERE id = 1', [image.name])
    return true
  })
  register('removeLogo', 'manager', () => db.write('UPDATE settings SET logo_path = NULL WHERE id = 1'))
  register('pickMedia', 'manager', () => pickImage(true))
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
    const result = await withDialogFocus(window!, parent => dialog.showSaveDialog(parent, { defaultPath, filters }))
    if (result.canceled || !result.filePath || cashier !== actor) return false
    const extension = '.' + filters[0].extensions[0]
    const file = result.filePath.toLowerCase().endsWith(extension) ? result.filePath : result.filePath + extension
    atomicWrite(file, bytes())
    return true
  }
  register('exportAudit', 'manager', query => saveFile(() => Buffer.from(reports.csv(query)),
    `ServeX_Audit_${query.from}_${query.to}.csv`, csvFilter))
  async function restoreSelectedBackup(passphrase: string, authorized: () => boolean, fresh = false) {
    validatePassphrase(passphrase, fresh || Boolean(passphrase))
    const result = await withDialogFocus(window!, parent => dialog.showOpenDialog(parent, { properties: ['openFile'], filters: backupFilter }))
    if (result.canceled || !authorized()) return false
    if (!fresh) {
      const confirm = await withDialogFocus(window!, parent => dialog.showMessageBox(parent, {
        type: 'warning', buttons: ['Cancel', 'Restore backup'], defaultId: 0, cancelId: 0,
        message: 'Replace the current ServeX database with this backup?',
        detail: 'ServeX creates an encrypted recovery snapshot before replacing the database.',
      }))
      if (confirm.response !== 1 || !authorized()) return false
    }
    let localKey: string | undefined
    if (!fresh) {
      try { localKey = secrets.localKey() }
      catch { if (!passphrase) throw new Error('Enter a backup passphrase to continue without OS credential storage.') }
    }
    if (printing.size) throw new Error('Wait for the active print dialog before restoring a backup.')
    backup.restore(result.filePaths[0], passphrase, localKey, localKey ?? passphrase)
    lan.stop()
    db.write('UPDATE settings SET onboarding_completed=1,lan_enabled=0,lan_actor=NULL WHERE id=1')
    cloud.invalidate()
    printer.clear()
    setupGrant = null
    return true
  }
  register('restoreSetup', 'public', async passphrase => {
    const fresh = needsSetup()
    const grant = setupGrant
    const allowed = () => fresh ? needsSetup() : Boolean(grant && setupGrant === grant && setupAdmin())
    if (!allowed()) throw new Error('Administrator verification is required.')
    return restoreSelectedBackup(passphrase, allowed, fresh)
  })
  register('importMenuCsv', 'manager', async () => {
    const actor = cashier
    const result = await withDialogFocus(window!, parent => dialog.showOpenDialog(parent, { properties: ['openFile'], filters: csvFilter }))
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
    const actor = cashier!
    const previous = db.all<{ pin: string }>('SELECT pin FROM users WHERE id = ?', [actor.id])[0].pin
    if (!await restoreSelectedBackup(passphrase, () => cashier === actor)) return false
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
    handlers(db, media, backup, cloud, secrets, storage)
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
