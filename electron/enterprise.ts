import type { Database } from 'sql.js'
import type { PosDatabase } from './db'
import { closedDay } from './reports'
import { nameOf } from './catalog'
import type { Customer, EnterpriseAction, EnterpriseData, Ingredient, PricingRule, Reservation } from '../src/types/enterprise'

export const normalizePhone = (value: string) => typeof value === 'string' ? value.replace(/[\s()+-]/g, '').replace(/^91(?=\d{10}$)/, '') : ''
export const money = (amount: number) => Math.round(amount * 100) / 100
const quantity = (value: number, minimum = 0, maximum = 1e8) => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error('Enter a valid amount or quantity.')
  return value
}
const phoneOf = (value: string) => {
  const phone = normalizePhone(value)
  if (!/^\d{7,15}$/.test(phone)) throw new Error('Enter a phone number with 7–15 digits.')
  return phone
}
const noteOf = (value?: string | null) => {
  if (!value) return null
  return nameOf(value, 'notes', 500)
}
export const businessOpen = (db: PosDatabase) => {
  if (db.all(`SELECT id FROM audit_logs WHERE ${closedDay} AND details=date('now','localtime')`).length) {
    throw new Error('The business day is closed.')
  }
}
const one = (sql: Database, query: string, id: number) => sql.exec(query, [id])[0]?.values[0]
const favorite = (sql: Database, id: number) => sql.run(`UPDATE customers SET favorite_item=(
  SELECT i.item_name FROM order_items i JOIN orders o ON i.order_id=o.id JOIN loyalty_ledger l ON o.id=l.order_id
  WHERE l.customer_id=? AND o.status='paid' GROUP BY i.item_name ORDER BY SUM(i.quantity) DESC,i.item_name LIMIT 1) WHERE id=?`, [id,id])

export function redeemAmount(db: PosDatabase, phone: string | null, amount: number | undefined, total: number) {
  if (amount === undefined || amount === 0) return 0
  quantity(amount, .01, total)
  const rounded = money(amount)
  const row = db.all<Customer>('SELECT * FROM customers WHERE phone=?', [phoneOf(phone ?? '')])[0]
  if (!row || rounded > row.loyalty_points || rounded > total) throw new Error('There are not enough loyalty points.')
  return rounded
}
export function postPayment(sql: Database, order: { id: number; customer_phone: string | null; customer_name: string | null; grand_total: number }, redeemed: number, actor: number) {
  const usage = sql.exec(`SELECT r.ingredient_id,SUM(i.quantity*r.quantity_required) FROM order_items i
    JOIN menu_recipes r ON r.menu_item_id=i.menu_item_id WHERE i.order_id=? GROUP BY r.ingredient_id`, [order.id])[0]?.values ?? []
  for (const [ingredient, used] of usage) {
    sql.run('UPDATE ingredients SET current_stock=ROUND(current_stock-?,6),updated_at=CURRENT_TIMESTAMP WHERE id=?', [used,ingredient])
    sql.run("INSERT INTO ingredient_movements(ingredient_id,order_id,quantity,reason,actor) VALUES(?,?,?,'sale',?)", [ingredient,order.id,-Number(used),actor])
  }
  const phone = normalizePhone(order.customer_phone ?? '')
  if (!/^\d{7,15}$/.test(phone)) return
  sql.run(`INSERT INTO customers(name,phone) VALUES(?,?) ON CONFLICT(phone) DO UPDATE SET
    name=CASE WHEN ? IS NULL THEN customers.name ELSE excluded.name END`, [order.customer_name || 'Guest',phone,order.customer_name])
  const id = Number(sql.exec('SELECT id FROM customers WHERE phone=?', [phone])[0].values[0][0])
  const rate = Number(sql.exec('SELECT loyalty_earn_percent FROM settings WHERE id=1')[0].values[0][0])
  const earned = money(order.grand_total * rate / 100)
  sql.run('INSERT INTO loyalty_ledger(order_id,customer_id,earned,redeemed,spent) VALUES(?,?,?,?,?)', [order.id,id,earned,redeemed,order.grand_total])
  sql.run('UPDATE customers SET loyalty_points=ROUND(loyalty_points+?-?,2),total_visits=total_visits+1,total_spent=ROUND(total_spent+?,2) WHERE id=?',
    [earned,redeemed,order.grand_total,id])
  sql.run('UPDATE orders SET customer_id=?,loyalty_redeemed=? WHERE id=?', [id,redeemed,order.id])
  favorite(sql,id)
}
export function reversePayment(sql: Database, id: number, actor: number) {
  for (const [ingredient, used] of sql.exec("SELECT ingredient_id,quantity FROM ingredient_movements WHERE order_id=? AND reason='sale'", [id])[0]?.values ?? []) {
    sql.run('UPDATE ingredients SET current_stock=ROUND(current_stock-?,6),updated_at=CURRENT_TIMESTAMP WHERE id=?', [used,ingredient])
    sql.run("INSERT INTO ingredient_movements(ingredient_id,order_id,quantity,reason,actor) VALUES(?,?,?,'void',?)", [ingredient,id,-Number(used),actor])
  }
  const ledger = one(sql,'SELECT customer_id,earned,redeemed,spent FROM loyalty_ledger WHERE order_id=?',id)
  if (!ledger) return
  const [customer, earned, redeemed, spent] = ledger
  sql.run('UPDATE customers SET loyalty_points=ROUND(loyalty_points-?+?,2),total_visits=MAX(0,total_visits-1),total_spent=ROUND(total_spent-?,2) WHERE id=?',
    [earned,redeemed,spent,customer])
  favorite(sql,Number(customer))
}

export class Enterprise {
  constructor(private db: PosDatabase) {}
  customer(value: string) {
    const phone = normalizePhone(value)
    return /^\d{7,15}$/.test(phone) ? this.db.all<Customer>('SELECT * FROM customers WHERE phone=?',[phone])[0] ?? null : null
  }
  pricing() { return this.db.all<PricingRule>('SELECT * FROM pricing_rules ORDER BY category_id IS NULL,id DESC') }
  data(section: keyof EnterpriseData, filter = ''): EnterpriseData {
    const output: EnterpriseData = { ingredients: [], recipes: [], customers: [], reservations: [], expenses: [], printers: [], parked: [] }
    switch (section) {
      case 'ingredients': output.ingredients = this.db.all('SELECT * FROM ingredients ORDER BY name'); break
      case 'recipes': output.recipes = this.db.all('SELECT * FROM menu_recipes WHERE menu_item_id=? ORDER BY ingredient_id',[Number(filter)]); break
      case 'customers': output.customers = this.db.all('SELECT * FROM customers WHERE instr(lower(name),lower(?))>0 OR instr(phone,?)>0 OR ?=\'\' ORDER BY total_visits DESC,id DESC LIMIT 100',[filter,filter,filter]); break
      case 'reservations': output.reservations = this.db.all(`SELECT * FROM reservations WHERE status IN ('booked','waitlist')
        OR (status='seated' AND order_id IS NULL) ORDER BY reservation_time,id`); break
      case 'expenses': output.expenses = this.db.all("SELECT * FROM expenses WHERE date(created_at,'localtime')=date('now','localtime') ORDER BY id DESC LIMIT 200"); break
      case 'printers': output.printers = this.db.all('SELECT * FROM printers ORDER BY role'); break
      case 'parked': output.parked = this.db.all("SELECT * FROM orders WHERE is_parked=1 AND status='open' ORDER BY id DESC"); break
      default: throw new Error('Unknown workspace.')
    }
    return output
  }

  private tableSlot(table: number, guests: number, time: string, except = 0) {
    if (!this.db.all('SELECT id FROM tables WHERE id=? AND capacity>=?',[table,guests]).length) throw new Error('Choose a location with enough seats.')
    if (this.db.all(`SELECT id FROM reservations WHERE table_id=? AND id!=? AND
      ((status='booked' AND ABS(unixepoch(reservation_time)-unixepoch(?))<5400)
        OR (status='seated' AND order_id IS NULL)) LIMIT 1`, [table,except,time]).length) {
      throw new Error('This location overlaps a 90-minute booking or an unclaimed seated reservation.')
    }
  }

  action(action: EnterpriseAction, actor: number) {
    const db = this.db
    switch (action.type) {
      case 'preferences': {
        if (action.theme !== undefined && !['light','dark'].includes(action.theme) || action.sound !== undefined && typeof action.sound !== 'boolean') throw new Error('Invalid preferences.')
        db.write('UPDATE settings SET theme_mode=COALESCE(?,theme_mode),sound_enabled=COALESCE(?,sound_enabled) WHERE id=1',
          [action.theme ?? null, action.sound === undefined ? null : Number(action.sound)]); break
      }
      case 'earnRate': db.write('UPDATE settings SET loyalty_earn_percent=? WHERE id=1',[quantity(action.value,0,100)]); break
      case 'ingredient': {
        const v = action.value
        if (!['g','ml','pcs','kg','L'].includes(v.unit)) throw new Error('Choose a unit.')
        const values = [nameOf(v.name,'ingredient'),v.unit,quantity(v.low_stock_threshold),quantity(v.cost_per_unit)]
        if (v.id) {
          const old = db.all<Ingredient>('SELECT * FROM ingredients WHERE id=?',[v.id])[0]
          if (!old) throw new Error('Ingredient no longer exists.')
          if (old.unit !== v.unit && (old.current_stock !== 0 || db.all('SELECT id FROM menu_recipes WHERE ingredient_id=?',[v.id]).length)) throw new Error('Use a new ingredient to change units while stock or recipes exist.')
          db.write('UPDATE ingredients SET name=?,unit=?,low_stock_threshold=?,cost_per_unit=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[...values,v.id])
        } else db.write('INSERT INTO ingredients(name,unit,low_stock_threshold,cost_per_unit) VALUES(?,?,?,?)',values)
        break
      }
      case 'stock': {
        const units = quantity(action.quantity,.000001)
        const cost = quantity(action.cost)
        const row = db.all<Ingredient>('SELECT * FROM ingredients WHERE id=?',[action.id])[0]
        if (!row) throw new Error('Ingredient no longer exists.')
        const oldStock = Math.max(0,row.current_stock)
        const weighted = (oldStock*row.cost_per_unit + units*cost)/(oldStock+units)
        db.transaction(sql => {
          sql.run('UPDATE ingredients SET current_stock=ROUND(current_stock+?,6),cost_per_unit=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[units,weighted,action.id])
          sql.run("INSERT INTO ingredient_movements(ingredient_id,quantity,reason,actor) VALUES(?,?,'purchase',?)",[action.id,units,actor])
        })
        break
      }
      case 'recipe': {
        if (!Array.isArray(action.rows) || action.rows.length>100 || !db.all('SELECT id FROM menu_items WHERE id=? AND archived=0',[action.menu]).length) throw new Error('Choose a menu item and up to 100 ingredients.')
        db.transaction(sql => {
          sql.run('DELETE FROM menu_recipes WHERE menu_item_id=?',[action.menu])
          for (const row of action.rows) sql.run('INSERT INTO menu_recipes(menu_item_id,ingredient_id,quantity_required) VALUES(?,?,?)',
            [action.menu,row.ingredient_id,quantity(row.quantity_required,.000001)])
        }); break
      }
      case 'customer': {
        if (action.birthday && (!/^\d{4}-\d{2}-\d{2}$/.test(action.birthday) || Number.isNaN(Date.parse(action.birthday)) ||
          new Date(action.birthday).toISOString().slice(0,10)!==action.birthday)) throw new Error('Enter a valid birthday.')
        db.write(`INSERT INTO customers(name,phone,birthday) VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name,birthday=excluded.birthday`,
          [nameOf(action.name,'customer'),phoneOf(action.phone),action.birthday || null]); break
      }
      case 'reservation': {
        const v = action.value
        const date = new Date(v.reservation_time)
        if (!['booked','waitlist'].includes(v.status) || !Number.isInteger(v.guest_count) || v.guest_count<1 || v.guest_count>100 ||
            !Number.isFinite(date.getTime()) || (v.status==='booked' && (!v.table_id || date.getTime()<Date.now()))) throw new Error('Choose a table, a future slot, and a valid party size.')
        if (v.status==='booked') this.tableSlot(v.table_id!,v.guest_count,date.toISOString())
        db.write('INSERT INTO reservations(table_id,customer_name,customer_phone,guest_count,reservation_time,status,notes) VALUES(?,?,?,?,?,?,?)',
          [v.status==='booked'?v.table_id:null,nameOf(v.customer_name,'guest'),phoneOf(v.customer_phone),v.guest_count,date.toISOString(),v.status,noteOf(v.notes)]); break
      }
      case 'seat': {
        businessOpen(db)
        const row=db.all<Reservation>("SELECT * FROM reservations WHERE id=? AND status IN ('booked','waitlist')",[action.id])[0]
        if (!row || !db.all("SELECT id FROM tables WHERE id=? AND status='vacant'",[action.table]).length) throw new Error('Choose a vacant location and waiting guest.')
        this.tableSlot(action.table,row.guest_count,new Date().toISOString(),row.id)
        db.write("UPDATE reservations SET status='seated',table_id=? WHERE id=?",[action.table,row.id]); break
      }
      case 'cancelReservation': db.write("UPDATE reservations SET status='cancelled' WHERE id=? AND order_id IS NULL AND status!='cancelled'",[action.id]); break
      case 'pricing': {
        const v=action.value
        if (!['discount_percent','surcharge_percent'].includes(v.rule_type) || !/^([0-6],)*[0-6]$/.test(v.days_of_week) ||
          ![v.start_time,v.end_time].every(time=>/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || v.start_time===v.end_time || ![0,1].includes(v.is_active)) throw new Error('Choose valid days, a time window and rule.')
        const args=[nameOf(v.name,'rule name'),v.rule_type,quantity(v.value,.01,100),v.category_id,v.days_of_week,v.start_time,v.end_time,v.is_active]
        if(v.id) db.write('UPDATE pricing_rules SET name=?,rule_type=?,value=?,category_id=?,days_of_week=?,start_time=?,end_time=?,is_active=? WHERE id=?',[...args,v.id])
        else db.write('INSERT INTO pricing_rules(name,rule_type,value,category_id,days_of_week,start_time,end_time,is_active) VALUES(?,?,?,?,?,?,?,?)',args)
        break
      }
      case 'expense': {
        businessOpen(db)
        const v=action.value
        if (!['Cash','UPI','Card'].includes(v.payment_mode)) throw new Error('Choose cash, card or UPI.')
        db.write('INSERT INTO expenses(title,category,amount,payment_mode,notes,recorded_by) VALUES(?,?,?,?,?,?)',
          [nameOf(v.title,'expense'),nameOf(v.category,'expense category'),money(quantity(v.amount,.01)),v.payment_mode,noteOf(v.notes),actor]); break
      }
      case 'printer': {
        const v=action.value
        if (!['receipt','kitchen','bar'].includes(v.role)||!['os','usb','lan'].includes(v.connection_type)||!['58mm','80mm'].includes(v.paper_width)||![0,1].includes(v.is_active)) throw new Error('Choose valid printer settings.')
        if (v.connection_type==='lan' && !privatePrinter(v.address)) throw new Error('Use a private IPv4 address and port, such as 192.168.1.50:9100.')
        if (v.connection_type==='usb' && v.is_active && !v.address?.trim()) throw new Error('Enter the Windows USB printer queue name.')
        db.write(`INSERT INTO printers(name,role,connection_type,address,paper_width,is_active) VALUES(?,?,?,?,?,?) ON CONFLICT(role)
          DO UPDATE SET name=excluded.name,connection_type=excluded.connection_type,address=excluded.address,paper_width=excluded.paper_width,is_active=excluded.is_active`,
          [nameOf(v.name,'printer'),v.role,v.connection_type,noteOf(v.address),v.paper_width,v.is_active]); break
      }
      case 'station': {
        if (!['kitchen','bar','none'].includes(action.value) || !['category','menu'].includes(action.target)) throw new Error('Choose a prep station.')
        db.write(`UPDATE ${action.target==='category'?'categories':'menu_items'} SET station=? WHERE id=?`,[action.value,action.id]); break
      }
      case 'resume':
      case 'deleteParked': {
        const row = db.all<{ table_id:number|null }>("SELECT table_id FROM orders WHERE id=? AND is_parked=1 AND status='open'",[action.id])[0]
        if (!row) throw new Error('Parked order not found.')
        if (action.type==='resume') {
          businessOpen(db)
          if (row.table_id!==null && (!db.all("SELECT id FROM tables WHERE id=? AND status='vacant'",[row.table_id]).length ||
            db.all("SELECT id FROM reservations WHERE table_id=? AND status='seated' AND order_id IS NULL",[row.table_id]).length)) throw new Error('The order’s location is no longer vacant.')
        }
        db.transaction(sql=>{
          if (action.type==='resume') {
            sql.run('UPDATE orders SET is_parked=0,revision=revision+1 WHERE id=?',[action.id])
            if(row.table_id!==null) sql.run("UPDATE tables SET status='occupied' WHERE id=?",[row.table_id])
          } else sql.run("UPDATE orders SET status='void',is_parked=0,closed_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=?",[action.id])
          sql.run("INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES(?,?,'order',?)",[actor,action.type==='resume'?'RESUME_ORDER':'DELETE_PARKED',action.id])
        }); break
      }
      default: throw new Error('Unknown operation.')
    }
  }
}

export function privatePrinter(address: string | null) {
  const parts = typeof address === 'string' && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(address.trim())
  if (!parts) return null
  const [a,b,c,d,port] = parts.slice(1).map(Number)
  if (c>255 || d>255 || b>255 || port<1 || port>65535 || !(a===10 || a===192 && b===168 || a===172 && b>=16 && b<=31)) return null
  return { host: [a,b,c,d].join('.'), port }
}
