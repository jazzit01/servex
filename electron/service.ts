import { Enterprise, postPayment, redeemAmount, reversePayment } from './enterprise'
import { priceAt } from '../src/types/scheduledPricing'
import type { Database } from 'sql.js'
import { closedDay } from './reports'
import { nameOf } from './catalog'
import type { PosDatabase } from './db'
import { GRID, MAX_CANVAS, MIN_HEIGHT, MIN_WIDTH } from '../src/types/floorLayout'
import { splitReceipt } from '../src/types/settlement'
import { lineAmounts } from '../src/types/pricing'
import type {
  BillEdit, CartItem, FloorTable, LayoutUpdate, MenuItem, Order, OrderInput, OrderItem,
  BillSplit, CheckoutPayment, KitchenTicket, TableMerge, TableStatusUpdate, TableTransfer,
} from '../src/types/pos'

export const orderColumns = 'id, bill_number, table_id, order_type, status, subtotal, tax_amount, grand_total, revision, customer_name, customer_phone, guest_count, discount_amount, discount_percent, created_at, closed_at, payment_mode, cash_tendered, change_returned, is_parked, loyalty_redeemed, customer_id'
const active = "status IN ('open','billed') AND COALESCE(is_parked,0)=0"
type StoredLine = OrderItem & { net_minor: number; tax_minor: number; tax_rate_snapshot: number | null; tax_inclusive_snapshot: number | null }

function audit(sql: Database, actor: number, action: string, entity: 'table' | 'order', id: number, details: object) {
  sql.run('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [actor, action, entity, id, JSON.stringify(details)])
}

function guestDetails(name: string, count: number | null) {
  if (typeof name !== 'string' || name.trim().length > 120 ||
      (count !== null && (!Number.isInteger(count) || count < 1 || count > 1000))) {
    throw new Error('Enter a guest name up to 120 characters and a guest count from 1 to 1,000.')
  }
  return { name: name.trim() || null, count }
}

function optionalText(value: string, max: number) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Enter text up to ${max} characters.`)
  return value.trim() || null
}

export class FloorService {
  constructor(private db: PosDatabase) {}

  table(id: number) {
    return this.db.all<FloorTable>('SELECT * FROM tables WHERE id = ?', [id])[0]
  }

  activeOrder(id: number, revision?: number) {
    const order = this.db.all<Order>(`SELECT ${orderColumns} FROM orders WHERE id = ? AND ${active}`, [id])[0]
    if (!order) throw new Error('This order is closed or unavailable.')
    if (revision !== undefined && order.revision !== revision) throw new Error('The order changed. Refresh before continuing.')
    return order
  }

  lines(orderId: number) {
    return this.db.all<StoredLine>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [orderId])
  }

  private atLocation(tableId: number) {
    return this.db.all<Order>(`SELECT ${orderColumns} FROM orders WHERE table_id = ? AND ${active}`, [tableId])
  }

  private requireLocation(order: Order, id: number) {
    const table = this.table(id)
    const orders = this.atLocation(id)
    const expected = order.status === 'billed' ? 'billed' : 'occupied'
    if (!table || order.table_id !== id || orders.length !== 1 || orders[0].id !== order.id || table.status !== expected) {
      throw new Error('This order is no longer active at the selected location.')
    }
    return table
  }

  saveLayout(updates: LayoutUpdate[]) {
    if (!Array.isArray(updates) || updates.length < 1 || updates.length > 1000) throw new Error('Save 1 to 1,000 layout changes at a time.')
    const rows = this.db.all<FloorTable>('SELECT * FROM tables')
    const byId = new Map(rows.map(row => [row.id, row]))
    const zoneIds = new Set(this.db.all<{ id: number }>('SELECT id FROM zones').map(row => row.id))
    const labelKey = (zone: number, label: string) => JSON.stringify([zone, label.normalize('NFC').trim().toLowerCase()])
    const labels = new Set(rows.map(row => labelKey(row.zone_id, row.label)))
    const seen = new Set<number>()
    this.db.transaction(sql => {
      for (const row of updates) {
        if (!row || !zoneIds.has(row.zoneId)) throw new Error('The layout includes an unavailable zone.')
        const rect = [row.x_pos, row.y_pos, row.width, row.height]
        if (rect.some(value => !Number.isInteger(value) || value < 0 || value % GRID !== 0) ||
            row.width < MIN_WIDTH || row.height < MIN_HEIGHT ||
            row.x_pos + row.width > MAX_CANVAS || row.y_pos + row.height > MAX_CANVAS) {
          throw new Error('Each location must fit inside the floor canvas and align to the 20 px grid.')
        }
        if (row.id !== undefined) {
          if (byId.get(row.id)?.zone_id !== row.zoneId || seen.has(row.id)) throw new Error('A location moved, disappeared, or appears twice.')
          seen.add(row.id)
          sql.run('UPDATE tables SET x_pos = ?, y_pos = ?, width = ?, height = ? WHERE id = ?', [...rect, row.id])
        } else {
          const label = nameOf(row.label, 'location label', 40)
          if (!['table', 'garden', 'room'].includes(row.type) ||
              !Number.isInteger(row.capacity) || row.capacity < 1 || row.capacity > 100) throw new Error('Choose a location type and a capacity from 1 to 100.')
          const unique = labelKey(row.zoneId, label)
          if (labels.has(unique)) throw new Error(`Location "${label}" already exists in this zone.`)
          labels.add(unique)
          sql.run('INSERT INTO tables (zone_id, label, type, capacity, x_pos, y_pos, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [row.zoneId, label, row.type, row.capacity, ...rect])
        }
      }
    })
  }

  private menuLines(items: CartItem[]) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new Error('Choose 1 to 100 menu items.')
    const config = this.db.all<{ tax_inclusive: number; tax_rate: number }>('SELECT tax_inclusive, tax_rate FROM settings WHERE id = 1')[0]
    const inclusive = Boolean(config.tax_inclusive)
    const seen = new Set<number>()
    const rules = new Enterprise(this.db).pricing()
    const now = new Date()
    return items.map(row => {
      if (!row || !Number.isInteger(row.id) || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 99 || seen.has(row.id)) {
        throw new Error('An item or quantity is invalid.')
      }
      seen.add(row.id)
      if (row.custom !== undefined) {
        const name = typeof row.custom?.name === 'string' ? row.custom.name.trim() : ''
        const price = row.custom?.price
        if (row.id >= 0 || !name || name.length > 120 || /[\x00-\x1f\x7f]/.test(name) ||
            !Number.isFinite(price) || price < 0.01 || price > 9999999.99 || price !== Number(price.toFixed(2))) {
          throw new Error('Enter a label and a valid custom charge.')
        }
        const rate = config.tax_rate ?? 5
        const { gross, tax } = lineAmounts(price, row.quantity, rate, inclusive)
        return { item: { id: null, name, station: 'none' as const }, priced: { price, label: null },
          quantity: row.quantity, gross, tax, net: inclusive ? gross - tax : gross, rate, inclusive, notes: optionalText(row.notes ?? '', 240) }
      }
      const item = this.db.all<MenuItem>(`SELECT m.* FROM menu_items m JOIN categories c ON c.id = m.category_id
        WHERE m.id = ? AND m.is_available = 1 AND c.is_active = 1 AND m.archived = 0`, [row.id])[0]
      if (!item) throw new Error('A menu item is no longer available.')
      const rate = item.tax_slab ?? config.tax_rate ?? 5
      const priced = priceAt(item.price, item.category_id, rules, now)
      const { gross, tax } = lineAmounts(priced.price, row.quantity, rate, inclusive)
      return { item, priced, quantity: row.quantity, gross, tax, net: inclusive ? gross - tax : gross, rate, inclusive, notes: optionalText(row.notes ?? '', 240) }
    })
  }

  private insertLines(sql: Database, orderId: number, lines: ReturnType<FloorService['menuLines']>) {
    for (const { item, priced, quantity, gross, tax, net, rate, inclusive, notes } of lines) {
      sql.run(`INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, notes, line_total, net_minor, tax_minor, tax_rate_snapshot, tax_inclusive_snapshot, station, pricing_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [orderId, item.id, item.name, priced.price, quantity, notes, gross / 100, net, tax, rate, Number(inclusive), item.station ?? 'kitchen', priced.label])
    }
  }

  private recalculate(sql: Database, order: Pick<Order, 'id' | 'discount_amount'>) {
    const [[net, tax]] = sql.exec(
      'SELECT COALESCE(SUM(net_minor), 0), COALESCE(SUM(tax_minor), 0) FROM order_items WHERE order_id = ?', [order.id],
    )[0].values as number[][]
    const discount = Math.min(net + tax, Math.max(0, Math.round((order.discount_amount ?? 0) * 100)))
    sql.run(`UPDATE orders SET subtotal = ?, tax_amount = ?, discount_amount = ?, grand_total = ? WHERE id = ?`,
      [net / 100, tax / 100, discount / 100, (net + tax - discount) / 100, order.id])
  }

  createOrder(input: OrderInput, actor: number, mobile?: { key: string; hash: string }) {
    if (!input || !['dinein', 'parcel', 'room'].includes(input.type)) throw new Error('Choose a valid order type.')
    if (mobile && (input.parked || input.reservationId !== undefined)) throw new Error('Hold and reservation actions are available at the till.')
    const tableId = input.type === 'parcel' ? null : input.tableId
    if (input.type !== 'parcel') {
      const table = tableId === null ? null : this.table(tableId)
      if (!table || table.status !== 'vacant' || this.atLocation(table.id).length ||
          (table.type === 'room') !== (input.type === 'room')) throw new Error('This table or room is unavailable.')
    }
    if (this.db.all(`SELECT id FROM audit_logs WHERE ${closedDay} AND details = date('now','localtime')`).length) {
      throw new Error('The business day is closed.')
    }
    const reserved = tableId === null ? undefined : this.db.all<{id:number}>("SELECT id FROM reservations WHERE table_id=? AND status='seated' AND order_id IS NULL",[tableId])[0]
    if (reserved?.id !== input.reservationId) throw new Error('Open this guest’s seated reservation before starting the order.')
    const lines = this.menuLines(input.items)
    if (mobile && lines.some(line => line.item.id === null)) throw new Error('Custom charges are available at the till.')
    const guest = guestDetails(input.guestName ?? '', input.guestCount ?? null)
    if (input.parked !== undefined && typeof input.parked !== 'boolean') throw new Error('Invalid hold request.')
    return this.db.transaction(sql => {
      sql.run('INSERT INTO orders (table_id, order_type, created_by, customer_name, guest_count, customer_phone, is_parked) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [tableId, input.type, actor, guest.name, guest.count, optionalText(input.phone ?? '', 32), Number(Boolean(input.parked))])
      const id = Number(sql.exec('SELECT last_insert_rowid()')[0].values[0][0])
      sql.run('UPDATE orders SET bill_number = ? WHERE id = ?', [`SX-${String(id).padStart(5, '0')}`, id])
      this.insertLines(sql, id, lines)
      this.recalculate(sql, { id, discount_amount: 0 })
      if (!input.parked && tableId !== null) {
        sql.run("UPDATE tables SET status = 'occupied' WHERE id = ?", [tableId])
      }
      if (reserved) sql.run('UPDATE reservations SET order_id=? WHERE id=?',[id,reserved.id])
      const customCharges = lines.filter(line => line.item.id === null)
        .map(line => ({ name: line.item.name, price: line.priced.price, quantity: line.quantity }))
      if (customCharges.length) audit(sql, actor, 'custom-charges-added', 'order', id, { customCharges })
      if (mobile) {
        sql.run('INSERT INTO lan_requests (request_id,payload,order_id) VALUES (?,?,?)', [mobile.key, mobile.hash, id])
        audit(sql, actor, 'MOBILE_ORDER', 'order', id, { channel: 'LAN' })
      }
      return id
    })
  }

  parkOrder(id: number, revision: number, actor: number) {
    const order = this.activeOrder(id,revision)
    if (order.status !== 'open' || this.lines(id).some(line=>line.kot_printed)) throw new Error('Only unsent open orders can be parked.')
    if (order.table_id !== null) this.requireLocation(order,order.table_id)
    this.db.transaction(sql=>{
      sql.run('UPDATE orders SET is_parked=1,revision=revision+1 WHERE id=?',[id])
      if (order.table_id !== null) sql.run("UPDATE tables SET status='vacant' WHERE id=?",[order.table_id])
      audit(sql,actor,'PARK_ORDER','order',id,{})
    })
  }

  private reopen(sql: Database, order: Order) {
    sql.run("UPDATE orders SET status = 'open', revision = revision + 1 WHERE id = ?", [order.id])
    if (order.table_id !== null) sql.run("UPDATE tables SET status = 'occupied' WHERE id = ?", [order.table_id])
  }

  addItems(id: number, revision: number, items: CartItem[], actor: number) {
    const order = this.activeOrder(id, revision)
    if (order.table_id !== null) this.requireLocation(order, order.table_id)
    const lines = this.menuLines(items)
    this.db.transaction(sql => {
      this.insertLines(sql, id, lines)
      this.recalculate(sql, order)
      sql.run('UPDATE orders SET discount_percent = 0 WHERE id = ?', [order.id])
      this.reopen(sql, order)
      audit(sql, actor, 'order-items-added', 'order', id, { items: items.map(({ id, quantity, custom }) => ({ id, quantity, custom })) })
    })
  }

  editBill(input: BillEdit, actor: number, authorize: (pin?: string) => void = () => { throw new Error('Manager PIN required.') }) {
    const order = this.activeOrder(input.orderId, input.revision)
    if (order.table_id !== null) this.requireLocation(order, order.table_id)
    const guest = guestDetails(input.guestName, input.guestCount)
    const phone = input.phone === undefined ? order.customer_phone : optionalText(input.phone, 32)
    if (input.inclusive !== undefined && typeof input.inclusive !== 'boolean') throw new Error('Choose a valid tax mode.')
    if (!Array.isArray(input.quantities) || input.quantities.length > 500) throw new Error('Edit up to 500 order lines at a time.')
    const lines = this.lines(order.id)
    const byId = new Map(lines.map(line => [line.id, line]))
    const changes = new Map<number, { quantity: number; notes: string | null }>()
    for (const row of input.quantities) {
      const line = row && byId.get(row.id)
      if (!line || changes.has(row.id) || !Number.isInteger(row.quantity) || row.quantity < 0 || row.quantity > 99) throw new Error('Choose valid order quantities.')
      const notes = row.notes === undefined ? line.notes : optionalText(row.notes, 240)
      if (line.kot_printed && (row.quantity > line.quantity || (row.quantity && notes !== line.notes))) {
        throw new Error('Add a new unsent line for extra portions or notes on an item already sent.')
      }
      changes.set(row.id, { quantity: row.quantity, notes })
    }
    const added = input.added?.length ? this.menuLines(input.added) : []
    const voids = lines.filter(line => line.kot_printed && (changes.get(line.id)?.quantity ?? line.quantity) < line.quantity)
    const empty = !added.length && !lines.some(line => (changes.get(line.id)?.quantity ?? line.quantity) > 0)
    if (empty && !voids.length) throw new Error('Use Clear Unsent to remove every unsent item.')
    const discount = input.discount
    if (discount && (!['flat', 'percent'].includes(discount.kind) || !Number.isFinite(discount.value) || discount.value < 0 ||
       (discount.kind === 'percent' && discount.value > 100))) throw new Error('Enter a valid discount.')
    this.db.transaction(sql => {
      for (const line of lines) {
        const edit = changes.get(line.id)
        if (!edit && input.inclusive === undefined) continue
        const quantity = edit?.quantity ?? line.quantity
        if (!quantity) {
          sql.run('DELETE FROM order_items WHERE id = ?', [line.id])
          continue
        }
        const inclusive = input.inclusive ?? Boolean(line.tax_inclusive_snapshot)
        const rate = line.tax_rate_snapshot ?? (line.net_minor > 0 ? 100 * line.tax_minor / line.net_minor : 0)
        const { gross, tax } = lineAmounts(line.unit_price, quantity, rate, inclusive)
        const useLegacy = line.tax_rate_snapshot === null && input.inclusive === undefined
        const ratio = quantity / line.quantity
        sql.run(`UPDATE order_items SET quantity = ?, notes = ?, line_total = ?, net_minor = ?, tax_minor = ?,
          tax_rate_snapshot = ?, tax_inclusive_snapshot = ? WHERE id = ?`,
        [quantity, edit ? edit.notes : line.notes, gross / 100, useLegacy ? Math.round(line.net_minor * ratio) : gross - (inclusive ? tax : 0),
          useLegacy ? Math.round(line.tax_minor * ratio) : tax, useLegacy ? null : rate, useLegacy ? null : Number(inclusive), line.id])
      }
      if (input.inclusive !== undefined) for (const line of added) {
        const { gross, tax } = lineAmounts(line.priced.price, line.quantity, line.rate, input.inclusive)
        Object.assign(line, { gross, tax, inclusive: input.inclusive, net: gross - (input.inclusive ? tax : 0) })
      }
      this.insertLines(sql, order.id, added)
      const grossMinor = Number(sql.exec('SELECT COALESCE(SUM(net_minor + tax_minor),0) FROM order_items WHERE order_id = ?', [order.id])[0].values[0][0])
      const oldDiscount = Math.round((order.discount_amount ?? 0) * 100)
      const amount = discount?.kind === 'percent' ? Math.round(grossMinor * discount.value / 100) :
        discount?.kind === 'flat' ? Math.round(discount.value * 100) : Math.min(oldDiscount, grossMinor)
      if (amount > grossMinor) throw new Error('The discount exceeds the bill total.')
      const high = amount > grossMinor / 10 && (amount !== oldDiscount ||
        amount / grossMinor > oldDiscount / Math.max(1, Math.round((order.subtotal + order.tax_amount) * 100)))
      if (voids.length || high) authorize(input.pin)
      for (const line of voids) audit(sql, actor, 'VOID_KOT_ITEM', 'order', order.id,
        { lineId: line.id, item: line.item_name, from: line.quantity, to: changes.get(line.id)!.quantity })
      if (high) audit(sql, actor, 'MANAGER_DISCOUNT', 'order', order.id, { amount: amount / 100 })
      sql.run('UPDATE orders SET customer_name = ?, guest_count = ?, customer_phone = ?, discount_percent = ? WHERE id = ?',
        [guest.name, guest.count, phone, discount ? (discount.kind === 'percent' ? discount.value : 0) : (grossMinor === Math.round((order.subtotal + order.tax_amount) * 100) ? order.discount_percent ?? 0 : 0), order.id])
      this.recalculate(sql, { id: order.id, discount_amount: amount / 100 })
      if (empty) {
        sql.run("UPDATE orders SET status = 'void', closed_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE id = ?", [order.id])
        if (order.table_id !== null) sql.run("UPDATE tables SET status = 'vacant' WHERE id = ?", [order.table_id])
      } else this.reopen(sql, order)
      audit(sql, actor, 'bill-edited', 'order', order.id, { lines: [...changes.keys()], added: added.length, customCharges: added.filter(line => line.item.id === null).map(line => ({ name: line.item.name, price: line.priced.price, quantity: line.quantity })) })
    })
  }

  clearUnsent(id: number, revision: number, actor: number) {
    const order = this.activeOrder(id, revision)
    if (order.table_id !== null) this.requireLocation(order, order.table_id)
    const lines = this.lines(id)
    const unsent = lines.filter(row => !row.kot_printed)
    if (!unsent.length) return
    this.db.transaction(sql => {
      sql.run('DELETE FROM order_items WHERE order_id = ? AND COALESCE(kot_printed, 0) = 0', [id])
      if (unsent.length === lines.length) {
        sql.run("UPDATE orders SET status = 'void', closed_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE id = ?", [id])
        if (order.table_id !== null) sql.run("UPDATE tables SET status = 'vacant' WHERE id = ?", [order.table_id])
      } else {
        this.recalculate(sql, { ...order, discount_amount: 0 })
        sql.run('UPDATE orders SET discount_percent = 0 WHERE id = ?', [id])
        this.reopen(sql, order)
      }
      audit(sql, actor, 'CLEAR_UNSENT', 'order', id, { lineIds: unsent.map(row => row.id) })
    })
  }

  kitchen() {
    const rows = this.db.all<Omit<KitchenTicket, 'lines'> & { lines: string }>(
      `SELECT k.* FROM kitchen_tickets k JOIN orders o ON o.id = k.order_id
       WHERE o.status != 'void' AND (k.status = 'preparing' OR date(k.created_at,'localtime') = date('now','localtime')) ORDER BY k.id DESC`)
    return rows.map(row => ({ ...row, lines: JSON.parse(row.lines) as KitchenTicket['lines'] }))
  }

  ticket(id: number) {
    const row = this.db.all<Omit<KitchenTicket, 'lines'> & { lines: string }>('SELECT * FROM kitchen_tickets WHERE id = ?', [id])[0]
    if (!row) throw new Error('Kitchen ticket not found.')
    return { ...row, lines: JSON.parse(row.lines) as KitchenTicket['lines'] }
  }

  sendKot(id: number, revision: number, actor: number) {
    const order = this.activeOrder(id, revision)
    const table = order.table_id === null ? null : this.requireLocation(order, order.table_id)
    const pending = this.lines(id).filter(line => !line.kot_printed && line.station !== 'none')
    if (!pending.length) throw new Error('There are no unsent kitchen or bar items.')
    return this.db.transaction(sql => {
      const tickets: number[] = []
      for (const station of ['kitchen','bar'] as const) {
        const rows = pending.filter(line => (line.station ?? 'kitchen') === station)
        if (!rows.length) continue
        const lines = rows.map(line => ({ name: line.item_name, quantity: line.quantity, notes: line.notes }))
        sql.run('INSERT INTO kitchen_tickets (order_id, reference, lines, station) VALUES (?, ?, ?, ?)',
          [id, table?.label ?? order.bill_number, JSON.stringify(lines),station])
        tickets.push(Number(sql.exec('SELECT last_insert_rowid()')[0].values[0][0]))
      }
      for (const line of pending) sql.run('UPDATE order_items SET kot_printed = 1 WHERE id = ?', [line.id])
      this.reopen(sql, order)
      audit(sql, actor, 'SEND_KOT', 'order', id, { tickets, lineIds: pending.map(line => line.id) })
      return tickets
    })
  }

  readyTicket(id: number) {
    this.ticket(id)
    this.db.write("UPDATE kitchen_tickets SET status = 'ready' WHERE id = ?", [id])
  }

  receiptParts(order: Order, split: BillSplit, redeemed = 0) {
    return splitReceipt(this.lines(order.id).map(line => ({ id: line.id, name: line.item_name, quantity: line.quantity,
      notes: line.notes, net: line.net_minor, tax: line.tax_minor })), Math.round(order.subtotal * 100),
      Math.round(order.tax_amount * 100), Math.round((order.discount_amount + redeemed) * 100), split)
  }

  settle(input: CheckoutPayment, actor: number, receipt: (order: Order, parts: ReturnType<FloorService['receiptParts']>) => string) {
    const order = this.activeOrder(input.orderId, input.revision)
    if (!['Cash', 'Card', 'UPI', 'Room Folio'].includes(input.mode) ||
        (input.mode === 'Room Folio' && (order.order_type !== 'room' || !order.customer_name || !order.customer_phone))) throw new Error('Choose a valid payment method. Room folios require the guest name and phone.')
    if (order.table_id !== null) this.requireLocation(order, order.table_id)
    const redeemed = redeemAmount(this.db,order.customer_phone,input.redeem,order.grand_total)
    const due = Math.round((order.grand_total - redeemed) * 100)
    const tender = input.mode === 'Cash' ? Math.round(Number(input.tendered) * 100) : 0
    if (!Number.isSafeInteger(tender) || (input.mode === 'Cash' && (tender < due || tender > 100000000000))) throw new Error('Cash tendered must cover the amount due.')
    const parts = this.receiptParts(order, input.split, redeemed)
    const config = this.db.all<{ auto_cleaning: number }>('SELECT auto_cleaning FROM settings WHERE id = 1')[0]
    return this.db.transaction(sql => {
      const day = String(sql.exec("SELECT strftime('%Y%m%d','now','localtime')")[0].values[0][0])
      sql.run('INSERT INTO bill_sequences (day, last_number) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET last_number = last_number + 1', [day])
      const number = Number(sql.exec('SELECT last_number FROM bill_sequences WHERE day = ?', [day])[0].values[0][0])
      const paid = { ...order, grand_total: due / 100, loyalty_redeemed: redeemed, discount_amount: Math.round((order.discount_amount + redeemed)*100)/100, bill_number: `SVX-${day}-${String(number).padStart(4, '0')}`, payment_mode: input.mode,
        cash_tendered: tender / 100, change_returned: input.mode === 'Cash' ? (tender - due) / 100 : 0 }
      const document = receipt(paid, parts)
      sql.run(`UPDATE orders SET status = 'paid', payment_mode = ?, cash_tendered = ?, change_returned = ?, bill_number = ?,
        receipt_json = ?, grand_total=?, discount_amount=?, loyalty_redeemed=?, closed_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE id = ?`,
      [input.mode, paid.cash_tendered, paid.change_returned, paid.bill_number, document, paid.grand_total, paid.discount_amount, redeemed, order.id])
      postPayment(sql,paid,redeemed,actor)
      if (order.table_id !== null) sql.run('UPDATE tables SET status = ? WHERE id = ?', [config.auto_cleaning ? 'cleaning' : 'vacant', order.table_id])
      audit(sql, actor, 'COMPLETE_PAYMENT', 'order', order.id, { bill: paid.bill_number, mode: input.mode, splits: parts.length })
      return document
    })
  }

  pastBills(beforeId?: number) {
    return this.db.all<Order>(`SELECT ${orderColumns} FROM orders WHERE status = 'paid' AND id < ? ORDER BY id DESC LIMIT 50`, [beforeId ?? Number.MAX_SAFE_INTEGER])
  }

  paidBill(id: number) {
    const order = this.db.all<Order & { receipt_json: string | null }>(`SELECT ${orderColumns}, receipt_json FROM orders WHERE id = ? AND status = 'paid'`, [id])[0]
    if (!order) throw new Error('Paid bill not found.')
    return order
  }

  voidReceipt(id: number, actor: number) {
    const order = this.paidBill(id)
    if (this.db.all(`SELECT id FROM audit_logs WHERE ${closedDay} AND details=date('now','localtime')`).length) {
      throw new Error('The current business day is closed. Record the reversal in the next business day.')
    }
    this.db.transaction(sql => {
      sql.run("UPDATE orders SET status = 'void', revision = revision + 1 WHERE id = ?", [id])
      reversePayment(sql,id,actor)
      audit(sql, actor, 'VOID_RECEIPT', 'order', id, { bill: order.bill_number, amount: order.grand_total, mode: order.payment_mode })
    })
  }

  transfer(input: TableTransfer, actor: number) {
    const order = this.activeOrder(input.orderId)
    const from = this.requireLocation(order, input.fromTableId)
    const to = this.table(input.toTableId)
    if (!to || to.status !== 'vacant' || this.atLocation(to.id).length || this.db.all("SELECT id FROM reservations WHERE table_id=? AND status='seated' AND order_id IS NULL",[to.id]).length) throw new Error('The destination is no longer vacant.')
    this.db.transaction(sql => {
      sql.run('UPDATE orders SET table_id = ?, order_type = ?, revision = revision + 1 WHERE id = ?',
        [to.id, to.type === 'room' ? 'room' : 'dinein', order.id])
      sql.run("UPDATE tables SET status = 'vacant' WHERE id = ?", [from.id])
      sql.run('UPDATE tables SET status = ? WHERE id = ?', [from.status, to.id])
      audit(sql, actor, 'table-transfer', 'order', order.id, { from: { id: from.id, label: from.label }, to: { id: to.id, label: to.label } })
    })
  }

  merge(input: TableMerge, actor: number) {
    const target = this.activeOrder(input.targetOrderId)
    const source = this.activeOrder(input.sourceOrderId)
    if (target.id === source.id || target.table_id === null || source.status !== 'open') {
      throw new Error('Choose a different occupied source location.')
    }
    const to = this.requireLocation(target, target.table_id)
    const from = this.requireLocation(source, input.sourceTableId)
    const count = target.guest_count === null && source.guest_count === null ? null : (target.guest_count ?? 0) + (source.guest_count ?? 0)
    if (count !== null && count > 1000) throw new Error('The combined guest count exceeds 1,000.')
    this.db.transaction(sql => {
      sql.run('UPDATE order_items SET order_id = ? WHERE order_id = ?', [target.id, source.id])
      sql.run('UPDATE kitchen_tickets SET order_id = ? WHERE order_id = ?', [target.id, source.id])
      sql.run("UPDATE orders SET status = 'void', closed_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE id = ?", [source.id])
      sql.run("UPDATE tables SET status = 'vacant' WHERE id = ?", [from.id])
      sql.run('UPDATE orders SET customer_name = COALESCE(customer_name, ?), guest_count = ?, discount_percent = 0 WHERE id = ?',
        [source.customer_name, count, target.id])
      this.recalculate(sql, { id: target.id, discount_amount: (target.discount_amount ?? 0) + (source.discount_amount ?? 0) })
      this.reopen(sql, target)
      audit(sql, actor, 'table-merge', 'order', target.id, { sourceOrderId: source.id, from: from.label, to: to.label, sourceTableId: from.id, targetTableId: to.id })
    })
  }

  updateStatus(input: TableStatusUpdate, actor: number) {
    const table = this.table(input.tableId)
    if (!table || !['vacant', 'cleaning'].includes(input.status) ||
        !['vacant', 'cleaning'].includes(table.status) || this.atLocation(input.tableId).length) {
      throw new Error('Only idle locations can be marked clean or set to cleaning.')
    }
    if (table.status === input.status) return
    this.db.transaction(sql => {
      sql.run('UPDATE tables SET status = ? WHERE id = ?', [input.status, table.id])
      audit(sql, actor, 'table-status-override', 'table', table.id, { label: table.label, from: table.status, to: input.status })
    })
  }

  markPrinted(id: number, revision: number, actor: number) {
    const order = this.activeOrder(id, revision)
    if (order.table_id !== null) this.requireLocation(order, order.table_id)
    this.db.transaction(sql => {
      sql.run("UPDATE orders SET status = 'billed', revision = revision + 1 WHERE id = ?", [order.id])
      if (order.table_id !== null) sql.run("UPDATE tables SET status = 'billed' WHERE id = ?", [order.table_id])
      audit(sql, actor, 'bill-printed', 'order', id, { bill: order.bill_number })
    })
  }

}
