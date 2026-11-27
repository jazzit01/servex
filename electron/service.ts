import type { Database } from 'sql.js'
import { nameOf } from './catalog'
import type { PosDatabase } from './db'
import { GRID, MAX_CANVAS, MIN_HEIGHT, MIN_WIDTH } from '../src/types/floorLayout'
import { lineAmounts } from '../src/types/pricing'
import type {
  BillEdit, CartItem, FloorTable, LayoutUpdate, MenuItem, Order, OrderInput, OrderItem,
  PaymentMode, TableMerge, TableStatusUpdate, TableTransfer,
} from '../src/types/pos'

const active = "status IN ('open','billed')"
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

export class FloorService {
  constructor(private db: PosDatabase) {}

  table(id: number) {
    return this.db.all<FloorTable>('SELECT * FROM tables WHERE id = ?', [id])[0]
  }

  activeOrder(id: number, revision?: number) {
    const order = this.db.all<Order>(`SELECT * FROM orders WHERE id = ? AND ${active}`, [id])[0]
    if (!order) throw new Error('This order is closed or unavailable.')
    if (revision !== undefined && order.revision !== revision) throw new Error('The order changed. Refresh before continuing.')
    return order
  }

  lines(orderId: number) {
    return this.db.all<StoredLine>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [orderId])
  }

  private atLocation(tableId: number) {
    return this.db.all<Order>(`SELECT * FROM orders WHERE table_id = ? AND ${active}`, [tableId])
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
    return items.map(row => {
      if (!row || !Number.isInteger(row.id) || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 99 || seen.has(row.id)) {
        throw new Error('An item or quantity is invalid.')
      }
      seen.add(row.id)
      const item = this.db.all<MenuItem>(`SELECT m.* FROM menu_items m JOIN categories c ON c.id = m.category_id
        WHERE m.id = ? AND m.is_available = 1 AND c.is_active = 1 AND m.archived = 0`, [row.id])[0]
      if (!item) throw new Error('A menu item is no longer available.')
      const rate = item.tax_slab ?? config.tax_rate ?? 5
      const { gross, tax } = lineAmounts(item.price, row.quantity, rate, inclusive)
      return { item, quantity: row.quantity, gross, tax, net: inclusive ? gross - tax : gross, rate, inclusive }
    })
  }

  private insertLines(sql: Database, orderId: number, lines: ReturnType<FloorService['menuLines']>) {
    for (const { item, quantity, gross, tax, net, rate, inclusive } of lines) {
      sql.run(`INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, line_total, net_minor, tax_minor, tax_rate_snapshot, tax_inclusive_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [orderId, item.id, item.name, item.price, quantity, gross / 100, net, tax, rate, Number(inclusive)])
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

  createOrder(input: OrderInput, actor: number) {
    if (!input || !['dinein', 'parcel', 'room'].includes(input.type)) throw new Error('Choose a valid order type.')
    const tableId = input.type === 'parcel' ? null : input.tableId
    if (input.type !== 'parcel') {
      const table = tableId === null ? null : this.table(tableId)
      if (!table || table.status !== 'vacant' || this.atLocation(table.id).length ||
          (table.type === 'room') !== (input.type === 'room')) throw new Error('This table or room is unavailable.')
    }
    if (this.db.all("SELECT id FROM audit_logs WHERE action = 'z-close' AND details = date('now','localtime')").length) {
      throw new Error('The business day is closed.')
    }
    const lines = this.menuLines(input.items)
    const guest = guestDetails(input.guestName ?? '', input.guestCount ?? null)
    return this.db.transaction(sql => {
      sql.run('INSERT INTO orders (table_id, order_type, created_by, customer_name, guest_count) VALUES (?, ?, ?, ?, ?)',
        [tableId, input.type, actor, guest.name, guest.count])
      const id = Number(sql.exec('SELECT last_insert_rowid()')[0].values[0][0])
      sql.run('UPDATE orders SET bill_number = ? WHERE id = ?', [`SX-${String(id).padStart(5, '0')}`, id])
      this.insertLines(sql, id, lines)
      this.recalculate(sql, { id, discount_amount: 0 })
      if (tableId !== null) sql.run("UPDATE tables SET status = 'occupied' WHERE id = ?", [tableId])
      return id
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
      this.reopen(sql, order)
      audit(sql, actor, 'order-items-added', 'order', id, { items: items.map(({ id, quantity }) => ({ id, quantity })) })
    })
  }

  editBill(input: BillEdit, actor: number) {
    const order = this.activeOrder(input.orderId, input.revision)
    if (order.table_id !== null) this.requireLocation(order, order.table_id)
    const guest = guestDetails(input.guestName, input.guestCount)
    if (!Array.isArray(input.quantities) || input.quantities.length > 500) throw new Error('Edit up to 500 order lines at a time.')
    const lines = this.lines(order.id)
    const byId = new Map(lines.map(line => [line.id, line]))
    const quantities = new Map<number, number>()
    for (const row of input.quantities) {
      const line = row && byId.get(row.id)
      if (!line || quantities.has(row.id) || !Number.isInteger(row.quantity) || row.quantity < 0 || row.quantity > 99) {
        throw new Error('Choose valid order lines and quantities from 0 to 99.')
      }
      if (line.kot_printed && line.quantity !== row.quantity) throw new Error('Items already sent to the kitchen cannot be changed here.')
      quantities.set(row.id, row.quantity)
    }
    if (!lines.some(line => (quantities.get(line.id) ?? line.quantity) > 0)) throw new Error('Keep at least one item on the bill.')
    const changed = lines.filter(line => quantities.has(line.id) && line.quantity !== quantities.get(line.id))
    if (!changed.length && order.customer_name === guest.name && order.guest_count === guest.count) return
    this.db.transaction(sql => {
      for (const line of changed) {
        const quantity = quantities.get(line.id)!
        if (!quantity) sql.run('DELETE FROM order_items WHERE id = ?', [line.id])
        else {
          const inclusive = Boolean(line.tax_inclusive_snapshot)
          const { gross, tax } = lineAmounts(line.unit_price, quantity, line.tax_rate_snapshot ?? 0, inclusive)
          const ratio = quantity / line.quantity
          const net = line.tax_rate_snapshot === null ? Math.round(line.net_minor * ratio) : gross - (inclusive ? tax : 0)
          const savedTax = line.tax_rate_snapshot === null ? Math.round(line.tax_minor * ratio) : tax
          sql.run('UPDATE order_items SET quantity = ?, line_total = ?, net_minor = ?, tax_minor = ? WHERE id = ?',
            [quantity, gross / 100, net, savedTax, line.id])
        }
      }
      sql.run('UPDATE orders SET customer_name = ?, guest_count = ? WHERE id = ?', [guest.name, guest.count, order.id])
      this.recalculate(sql, order)
      this.reopen(sql, order)
      audit(sql, actor, 'bill-edited', 'order', order.id, { lines: changed.map(line => ({ id: line.id, from: line.quantity, to: quantities.get(line.id) })) })
    })
  }

  transfer(input: TableTransfer, actor: number) {
    const order = this.activeOrder(input.orderId)
    const from = this.requireLocation(order, input.fromTableId)
    const to = this.table(input.toTableId)
    if (!to || to.status !== 'vacant' || this.atLocation(to.id).length) throw new Error('The destination is no longer vacant.')
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

  payOrder(id: number, mode: PaymentMode, revision?: number) {
    const order = this.activeOrder(id, revision)
    if (!['Cash', 'Card', 'UPI'].includes(mode)) throw new Error('Choose a valid payment method.')
    if (order.table_id !== null) this.requireLocation(order, order.table_id)
    const config = this.db.all<{ auto_cleaning: number }>('SELECT auto_cleaning FROM settings WHERE id = 1')[0]
    this.db.transaction(sql => {
      sql.run(`UPDATE orders SET status = 'paid', payment_mode = ?, cash_tendered = ?, closed_at = CURRENT_TIMESTAMP,
        revision = revision + 1 WHERE id = ?`, [mode, mode === 'Cash' ? order.grand_total : 0, id])
      if (order.table_id !== null) sql.run('UPDATE tables SET status = ? WHERE id = ?', [config.auto_cleaning ? 'cleaning' : 'vacant', order.table_id])
    })
  }
}
