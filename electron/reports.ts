import type { PosDatabase } from './db'
import type { Analytics, AuditEntry, AuditQuery, CloseDayInput, DateRange, OrderType, PaymentMode, ZReport } from '../src/types/pos'

export const denominations = [2000, 500, 200, 100, 50, 20, 10]
export const closedDay = "lower(replace(action, '_', '-')) = 'z-close'"

function rangeOf(range: DateRange) {
  const parse = (value: string) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose valid report dates.')
    const time = Date.parse(value + 'T00:00:00Z')
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Choose valid report dates.')
    return time
  }
  const from = parse(range.from)
  const to = parse(range.to)
  if (to < from || to - from > 365 * 86400000) throw new Error('Select an ordered date range of at most 366 days.')
  return { from, to }
}

const events = `
SELECT id AS order_id, closed_at AS stamp, 1 AS sign
FROM orders WHERE status = 'paid' OR (status = 'void' AND payment_mode IS NOT NULL)
UNION ALL
SELECT entity_id, created_at, -1 FROM audit_logs WHERE action IN ('VOID_RECEIPT','BILL_VOID') AND entity_type = 'order'
`

export class Reports {
  constructor(private db: PosDatabase) {}

  day() { return this.db.all<{ day: string }>("SELECT date('now','localtime') AS day")[0].day }

  analytics(range: DateRange): Analytics {
    const { from, to } = rangeOf(range)
    const today = from === to
    const buckets = (today ? Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')) :
      Array.from({ length: (to - from) / 86400000 + 1 }, (_, i) => new Date(from + i * 86400000).toISOString().slice(0, 10)))
    const args = [range.from, range.to]
    const rows = this.db.all<{ hour: string; day: string; mode: PaymentMode; type: OrderType; sign: number; n: number; sales: number; tax: number; cgst: number }>(`
      WITH events AS (${events})
      SELECT strftime('%H', e.stamp,'localtime') AS hour, date(e.stamp,'localtime') AS day,
        o.payment_mode AS mode, o.order_type AS type, e.sign, count(*) AS n,
        SUM(ROUND(o.grand_total*100)) AS sales, SUM(ROUND(o.tax_amount*100)) AS tax,
        SUM(CAST(ROUND(o.tax_amount*100)/2 AS INTEGER)) AS cgst
      FROM events e JOIN orders o ON o.id = e.order_id
      WHERE date(e.stamp,'localtime') BETWEEN ? AND ?
      GROUP BY day, hour, mode, type, e.sign`, args)
    const totals = { sales: 0, tax: 0, cgst: 0, count: 0 }
    const orders = { dinein: 0, parcel: 0, room: 0 }
    const payments = { Cash: 0, UPI: 0, Card: 0, 'Room Folio': 0 }
    const trend = new Map<string, number>()
    for (const row of rows) {
      totals.sales += row.sales * row.sign; totals.tax += row.tax * row.sign; totals.cgst += row.cgst * row.sign
      if (row.sign > 0) { totals.count += row.n; orders[row.type] += row.n }
      if (Object.hasOwn(payments, row.mode)) payments[row.mode] += row.sales * row.sign
      const bucket = today ? row.hour : row.day
      trend.set(bucket, (trend.get(bucket) ?? 0) + row.sales * row.sign)
    }
    const items = this.db.all<{ name: string; qty: number; cents: number }>(`
      WITH events AS (${events})
      SELECT i.item_name AS name, SUM(i.quantity * e.sign) AS qty,
        SUM(ROUND((i.net_minor+i.tax_minor) * CASE WHEN o.subtotal+o.tax_amount > 0
          THEN o.grand_total/(o.subtotal+o.tax_amount) ELSE 0 END) * e.sign) AS cents
      FROM events e JOIN order_items i ON i.order_id=e.order_id JOIN orders o ON o.id=e.order_id
      WHERE date(e.stamp,'localtime') BETWEEN ? AND ?
      GROUP BY i.item_name HAVING qty > 0 ORDER BY qty DESC, cents DESC, name LIMIT 10`, args)
    return { sales: totals.sales / 100, tax: totals.tax / 100, cgst: totals.cgst / 100, sgst: (totals.tax - totals.cgst) / 100,
      count: totals.count, average: totals.count ? totals.sales / 100 / totals.count : 0, orders,
      payments: { Cash: payments.Cash / 100, UPI: payments.UPI / 100, Card: payments.Card / 100, 'Room Folio': payments['Room Folio'] / 100 },
      trend: buckets.map(label => ({ label: today ? label + ':00' : label, amount: (trend.get(label) ?? 0) / 100 })),
      items: items.map(row => ({ name: row.name, qty: row.qty, amount: row.cents / 100 })) }
  }

  zState() {
    const day = this.day()
    const cash = this.db.all<{ sales: number; refunds: number }>(`
      WITH events AS (${events})
      SELECT COALESCE(SUM(CASE WHEN e.sign = 1 THEN ROUND(o.grand_total*100) ELSE 0 END),0) AS sales,
        COALESCE(SUM(CASE WHEN e.sign = -1 THEN ROUND(o.grand_total*100) ELSE 0 END),0) AS refunds
      FROM events e JOIN orders o ON o.id=e.order_id WHERE o.payment_mode = 'Cash' AND date(e.stamp,'localtime') = ?`, [day])[0]
    const saved = this.db.all<{ content: string }>('SELECT content FROM z_reports WHERE day = ?', [day])[0]
    const cashExpenses = this.db.all<{ amount:number }>("SELECT COALESCE(SUM(amount),0) AS amount FROM expenses WHERE payment_mode='Cash' AND date(created_at,'localtime')=?",[day])[0].amount
    return { day, cashExpenses, cashSales: cash.sales / 100, refunds: cash.refunds / 100,
      report: saved ? JSON.parse(saved.content) as ZReport : null,
      legacyClosed: Boolean(this.db.all(`SELECT id FROM audit_logs WHERE ${closedDay} AND details = ?`, [day]).length) }
  }

  close(input: CloseDayInput, actor: { id: number; name: string }) {
    const current = this.zState()
    if (current.report) return current.report
    if (current.legacyClosed) throw new Error('This business day was already closed.')
    if (this.db.all("SELECT id FROM orders WHERE status IN ('open','billed') AND COALESCE(is_parked,0)=0 LIMIT 1").length) throw new Error('Settle open orders before closing the day.')
    const cents = (amount: number) => {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 100000000) throw new Error('Enter valid cash amounts.')
      return Math.round(amount * 100)
    }
    if (!Array.isArray(input.counts) || input.counts.length !== denominations.length ||
      input.counts.some(count => !Number.isInteger(count) || count < 0 || count > 100000)) throw new Error('Enter valid whole denomination counts.')
    const opening = cents(input.opening)
    const coins = cents(input.coins)
    const actual = coins + input.counts.reduce((sum, value, i) => sum + value * denominations[i] * 100, 0)
    const expected = opening + Math.round(current.cashSales * 100) - Math.round(current.refunds * 100) - Math.round(current.cashExpenses * 100)
    const analytics = this.analytics({ from: current.day, to: current.day })
    const brand = this.db.all<{ currency_symbol: string; restaurant_name: string }>('SELECT currency_symbol, restaurant_name FROM settings WHERE id=1')[0]
    const report: ZReport = { day: current.day, actor: actor.name, opening: opening / 100, cashSales: current.cashSales,
      refunds: current.refunds, cashExpenses: current.cashExpenses, actual: actual / 100, expected: expected / 100, variance: (actual - expected) / 100,
      counts: input.counts, coins: coins / 100, currency: brand.currency_symbol, restaurant: brand.restaurant_name,
      payments: analytics.payments, orderCount: analytics.count, sales: analytics.sales, tax: analytics.tax }
    this.db.transaction(sql => {
      sql.run('INSERT INTO z_reports (day, actor, content) VALUES (?, ?, ?)', [report.day, actor.id, JSON.stringify(report)])
      sql.run("INSERT INTO audit_logs (user_id, action, entity_type, details) VALUES (?, 'Z_CLOSE', 'business-day', ?)", [actor.id, report.day])
    })
    return report
  }

  audit(query: AuditQuery, exportAll = false) {
    rangeOf(query)
    const action = query.action?.trim().toUpperCase() ?? ''
    if (action && !/^[A-Z_]{1,40}$/.test(action)) throw new Error('Choose a valid audit action.')
    const limit = exportAll ? 100001 : 100
    const rows = this.db.all<AuditEntry>(`
      WITH entries AS (
        SELECT a.id, a.created_at AS timestamp, COALESCE(u.name,'System') AS actor,
          CASE a.action WHEN 'VOID_RECEIPT' THEN 'BILL_VOID' WHEN 'MANAGER_DISCOUNT' THEN 'HIGH_DISCOUNT'
            ELSE upper(replace(a.action,'-','_')) END AS action, a.details
        FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
        WHERE date(a.created_at,'localtime') BETWEEN ? AND ? AND a.id < ?
      ) SELECT * FROM entries WHERE (? = '' OR action = ?) ORDER BY id DESC LIMIT ?`,
      [query.from, query.to, exportAll ? Number.MAX_SAFE_INTEGER : query.before ?? Number.MAX_SAFE_INTEGER, action, action, limit])
    if (exportAll && rows.length === limit) throw new Error('Export a smaller date range.')
    return rows
  }

  csv(query: AuditQuery) {
    const cell = (value: string) => '"' + (/^\s*[=+\-@]/.test(value) ? "'" + value : value).replace(/"/g, '""') + '"'
    return '\uFEFF' + [['Timestamp (UTC)', 'Staff', 'Action', 'Details'],
      ...this.audit(query, true).map(row => [row.timestamp, row.actor, row.action, row.details ?? ''])]
      .map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
  }
}
