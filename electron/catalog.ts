import type { Database } from 'sql.js'
import { hashPin, PosDatabase } from './db'
import type { MediaLibrary } from './media'
import type { Category, CategoryInput, FloorTable, LocationInput, MenuInput, StaffInput, StaffUser, Zone, ZoneInput } from '../src/types/pos'

export function nameOf(value: string, label: string, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`Enter a valid ${label} (up to ${max} characters).`)
  return value.trim()
}

function flag(value: boolean) {
  if (typeof value !== 'boolean') throw new Error('Choose a valid status.')
  return Number(value)
}

export function validPin(pin: string) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw new Error('Enter a four-digit PIN.')
  return pin
}

export function pinDigest(db: PosDatabase, pin: string) {
  return hashPin(pin, db.all<{ pin_salt: string }>('SELECT pin_salt FROM settings WHERE id = 1')[0].pin_salt)
}

const insertId = (sql: Database) => Number(sql.exec('SELECT last_insert_rowid()')[0].values[0][0])
const key = (name: string) => name.trim().normalize('NFC').toLowerCase()
const menuHeader = ['Category', 'Name', 'Price', 'Tax Slab %', 'Veg', 'In Stock']

function parseCsv(source: string) {
  const text = source.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let state: 'plain' | 'quoted' | 'closed' = 'plain'
  const saveField = () => { row.push(field); field = ''; state = 'plain' }
  const saveRow = () => {
    saveField()
    if (row.some(value => value.trim())) rows.push(row)
    if (rows.length > 5001) throw new Error('Import up to 5,000 menu items at a time.')
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (state === 'quoted') {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') state = 'closed'
      else field += ch
    } else if (ch === ',') saveField()
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      saveRow()
    } else if (ch === '"' && state === 'plain' && !field) state = 'quoted'
    else if (ch === '"' || state === 'closed') throw new Error('The CSV contains malformed quotes.')
    else field += ch
  }
  if (state === 'quoted') throw new Error('The CSV contains an unclosed quoted field.')
  if (field || row.length) saveRow()
  return rows
}

function csvCell(value: unknown) {
  let cell = String(value)
  if (typeof value === 'string' && /^[\s\u0000]*[=+\-@]/.test(cell)) cell = "'" + cell
  return '"' + cell.replace(/"/g, '""') + '"'
}

function menuValues(input: MenuInput) {
  const name = nameOf(input.name, 'dish name', 120)
  if (!Number.isFinite(input.price) || input.price < 0 || input.price > 1000000 ||
      !Number.isFinite(input.tax) || input.tax < 0 || input.tax > 100) throw new Error('Enter a valid price and tax rate.')
  return [name, Math.round(input.price * 100) / 100, Math.round(input.tax * 100) / 100, flag(input.veg), flag(input.available)]
}

export class Catalog {
  constructor(private db: PosDatabase, private media: MediaLibrary) {}

  staff() {
    return this.db.all<StaffUser>('SELECT id, name, role, is_active FROM users ORDER BY is_active DESC, id')
  }

  saveStaff(input: StaffInput, actor: number) {
    const name = nameOf(input.name, 'staff name')
    if (!['admin', 'manager', 'cashier'].includes(input.role)) throw new Error('Choose a staff role.')
    const active = flag(input.active)
    const users = this.staff()
    const previous = users.find(user => user.id === input.id)
    if (input.id !== undefined && !previous) throw new Error('Staff member no longer exists.')
    if (input.id === actor && (!active || input.role !== 'admin')) throw new Error('Your own administrator account must remain active.')
    if (previous?.role === 'admin' && (!active || input.role !== 'admin') &&
      !users.some(user => user.id !== input.id && user.role === 'admin' && user.is_active)) throw new Error('Keep at least one active administrator.')
    const old = previous && this.db.all<{ pin: string }>('SELECT pin FROM users WHERE id = ?', [previous.id])[0].pin
    const pin = input.pin === undefined && old ? old : pinDigest(this.db, validPin(input.pin ?? ''))
    if (active && this.db.all('SELECT id FROM users WHERE pin = ? AND is_active = 1 AND id != ?', [pin, input.id ?? 0]).length) {
      throw new Error('This PIN belongs to another active staff member.')
    }
    this.db.transaction(sql => {
      if (previous) sql.run('UPDATE users SET name = ?, role = ?, is_active = ?, pin = ? WHERE id = ?', [name, input.role, active, pin, previous.id])
      else sql.run('INSERT INTO users (name, role, is_active, pin) VALUES (?, ?, ?, ?)', [name, input.role, active, pin])
      const action = !previous ? 'staff-added' : previous.is_active && !active ? 'staff-deactivated' : 'staff-updated'
      sql.run("INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'user', ?, ?)",
        [actor, action, previous?.id ?? insertId(sql), JSON.stringify({ name, role: input.role, active: Boolean(active), pinChanged: pin !== old })])
    })
  }

  category(input: CategoryInput) {
    const name = nameOf(input.name, 'category name')
    const active = flag(input.active)
    const categories = this.db.all<Category>('SELECT * FROM categories')
    if (categories.some(row => row.id !== input.id && key(row.name) === key(name))) throw new Error('This category already exists.')
    if (input.id !== undefined) {
      if (!categories.some(row => row.id === input.id)) throw new Error('Category no longer exists.')
      this.db.write('UPDATE categories SET name = ?, is_active = ? WHERE id = ?', [name, active, input.id])
    } else {
      this.db.write('INSERT INTO categories (name, is_active, sort_order) SELECT ?, ?, COALESCE(MAX(sort_order), -1) + 1 FROM categories', [name, active])
    }
  }

  moveCategory(id: number, direction: -1 | 1) {
    if (direction !== -1 && direction !== 1) throw new Error('Choose a valid direction.')
    const rows = this.db.all<Category>('SELECT * FROM categories ORDER BY sort_order, id')
    const index = rows.findIndex(row => row.id === id)
    if (index < 0 || !rows[index + direction]) return
    const [row] = rows.splice(index, 1)
    rows.splice(index + direction, 0, row)
    this.db.transaction(sql => rows.forEach((category, order) => sql.run('UPDATE categories SET sort_order = ? WHERE id = ?', [order, category.id])))
  }

  menuItem(input: MenuInput) {
    const values = menuValues(input)
    if (!this.db.all('SELECT id FROM categories WHERE id = ?', [input.categoryId]).length) throw new Error('Choose an existing category.')
    if (input.imagePath !== null && !this.media.read(input.imagePath)) throw new Error('Choose an existing dish photo.')
    const duplicate = this.db.all<{ id: number; name: string }>('SELECT id, name FROM menu_items WHERE category_id = ? AND archived = 0', [input.categoryId])
      .some(row => row.id !== input.id && key(row.name) === key(input.name))
    if (duplicate) throw new Error('This dish already exists in the category.')
    const params = [input.categoryId, ...values, input.imagePath]
    if (input.id !== undefined) {
      if (!this.db.all('SELECT id FROM menu_items WHERE id = ? AND archived = 0', [input.id]).length) throw new Error('Dish no longer exists.')
      this.db.write('UPDATE menu_items SET category_id = ?, name = ?, price = ?, tax_slab = ?, is_veg = ?, is_available = ?, image_path = ? WHERE id = ?', [...params, input.id])
    } else {
      this.db.write('INSERT INTO menu_items (category_id, name, price, tax_slab, is_veg, is_available, image_path) VALUES (?, ?, ?, ?, ?, ?, ?)', params)
    }
  }

  deleteMenuItem(id: number) {
    if (this.db.all('SELECT id FROM order_items WHERE menu_item_id = ? LIMIT 1', [id]).length) {
      this.db.write('UPDATE menu_items SET archived = 1, is_available = 0 WHERE id = ?', [id])
    } else this.db.write('DELETE FROM menu_items WHERE id = ?', [id])
  }

  exportCsv(template: boolean) {
    const rows: unknown[][] = template ? [['Starters', 'Paneer Tikka', 280, 5, 1, 1]] :
      this.db.all<{ category: string; name: string; price: number; tax_slab: number; is_veg: number; is_available: number }>(
        'SELECT c.name AS category, m.name, m.price, m.tax_slab, m.is_veg, m.is_available FROM menu_items m JOIN categories c ON c.id = m.category_id WHERE m.archived = 0 ORDER BY c.sort_order, m.id',
      ).map(row => [row.category, row.name, row.price, row.tax_slab, row.is_veg, row.is_available])
    return '\uFEFF' + [menuHeader, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  }

  importCsv(text: string) {
    const [header, ...rows] = parseCsv(text)
    if (!header || header.length !== menuHeader.length || !menuHeader.every((name, index) => key(name) === key(header[index]))) {
      throw new Error('The CSV header does not match the ServeX sample template.')
    }
    if (!rows.length) throw new Error('The CSV has no menu items.')
    const seen = new Set<string>()
    const items = rows.map(([categoryRaw, name, price, tax, veg, available, ...extra], index) => {
      try {
        const unescape = (value: string) => value.replace(/^'(?=\s*[=+\-@])/, '')
        const category = nameOf(unescape(categoryRaw), 'category name')
        const number = (value: string) => {
          if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('Use a decimal number for price and tax.')
          return Number(value)
        }
        const boolean = (value: string) => {
          if (!/^[01]$/.test(value.trim())) throw new Error('Use 1 or 0 for Veg and In Stock.')
          return value.trim() === '1'
        }
        if (extra.length || available === undefined) throw new Error('Use six columns.')
        const values = menuValues({ name: unescape(name), price: number(price), tax: number(tax), veg: boolean(veg),
          available: boolean(available), categoryId: 0, imagePath: null })
        const identity = JSON.stringify([key(category), key(String(values[0]))])
        if (seen.has(identity)) throw new Error('This dish appears twice in the same category.')
        seen.add(identity)
        return { category, values }
      } catch (error) { throw new Error(`CSV data row ${index + 1}: ${(error as Error).message}`) }
    })
    const categories = new Map(this.db.all<Category>('SELECT * FROM categories').map(row => [key(row.name), row.id]))
    const existing = new Map(this.db.all<{ id: number; category_id: number; name: string }>('SELECT id, category_id, name FROM menu_items WHERE archived = 0')
      .map(row => [JSON.stringify([row.category_id, key(row.name)]), row.id]))
    this.db.transaction(sql => {
      for (const { category, values } of items) {
        const categoryName = key(category)
        let id = categories.get(categoryName)
        if (id === undefined) {
          sql.run('INSERT INTO categories (name, sort_order) SELECT ?, COALESCE(MAX(sort_order), -1) + 1 FROM categories', [category])
          id = insertId(sql)
          categories.set(categoryName, id)
        }
        const dish = existing.get(JSON.stringify([id, key(String(values[0]))]))
        if (dish) sql.run('UPDATE menu_items SET name = ?, price = ?, tax_slab = ?, is_veg = ?, is_available = ? WHERE id = ?', [...values, dish])
        else sql.run('INSERT INTO menu_items (category_id, name, price, tax_slab, is_veg, is_available) VALUES (?, ?, ?, ?, ?, ?)', [id, ...values])
      }
    })
    return items.length
  }

  zone(input: ZoneInput) {
    const name = nameOf(input.name, 'zone name')
    const rows = this.db.all<Zone>('SELECT * FROM zones')
    if (rows.some(row => row.id !== input.id && key(row.name) === key(name))) throw new Error('This zone already exists.')
    if (input.id !== undefined) {
      if (!rows.some(row => row.id === input.id)) throw new Error('Zone no longer exists.')
      this.db.write('UPDATE zones SET name = ? WHERE id = ?', [name, input.id])
    } else this.db.write('INSERT INTO zones (name, sort_order) SELECT ?, COALESCE(MAX(sort_order), -1) + 1 FROM zones', [name])
  }

  deleteZone(id: number) {
    if (this.db.all('SELECT id FROM tables WHERE zone_id = ? LIMIT 1', [id]).length) throw new Error('Move or delete the zone’s locations before deleting it.')
    this.db.write('DELETE FROM zones WHERE id = ?', [id])
  }

  saveLocations(input: LocationInput[]) {
    if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('Save between 1 and 100 locations at a time.')
    const zones = new Set(this.db.all<Zone>('SELECT id FROM zones').map(zone => zone.id))
    const locations = this.db.all<FloorTable>('SELECT * FROM tables')
    const edits = new Set<number>()
    const prepared = input.map(row => {
      const label = nameOf(row.label, 'location label', 40)
      if (!zones.has(row.zoneId) || !['table', 'garden', 'room'].includes(row.type) ||
        !Number.isInteger(row.capacity) || row.capacity < 1 || row.capacity > 100) throw new Error('Choose a zone, type, and capacity from 1 to 100.')
      const previous = locations.find(location => location.id === row.id)
      if (row.id !== undefined) {
        if (!previous || edits.has(row.id)) throw new Error('A location is missing or duplicated.')
        if ((previous.zone_id !== row.zoneId || previous.type !== row.type) && this.locationBusy(previous.id)) {
          throw new Error('Settle an open order before moving or changing its location type.')
        }
        edits.add(row.id)
      }
      return { ...row, label, previous }
    })
    const identity = (id: number, label: string) => JSON.stringify([id, key(label)])
    const labels = new Set(locations.filter(row => !edits.has(row.id)).map(row => identity(row.zone_id, row.label)))
    const used = new Map<number, Pick<FloorTable, 'x_pos' | 'y_pos' | 'width' | 'height'>[]>()
    for (const row of locations) {
      if (prepared.some(item => item.id === row.id && item.zoneId !== row.zone_id)) continue
      const entries = used.get(row.zone_id) ?? []
      entries.push(row)
      used.set(row.zone_id, entries)
    }
    this.db.transaction(sql => {
      for (const row of prepared) {
        const unique = identity(row.zoneId, row.label)
        if (labels.has(unique)) throw new Error(`Location "${row.label}" already exists in the zone.`)
        labels.add(unique)
        const entries = used.get(row.zoneId) ?? []
        const width = row.previous?.width ?? 120
        const height = row.previous?.height ?? 110
        let x = row.previous?.x_pos ?? 40
        let y = row.previous?.y_pos ?? 40
        if (row.previous?.zone_id !== row.zoneId) {
          let slot = 0
          do {
            x = 40 + (slot % 4) * 168
            y = 40 + Math.floor(slot++ / 4) * 144
          } while (entries.some(item => x < item.x_pos + item.width && x + width > item.x_pos && y < item.y_pos + item.height && y + height > item.y_pos))
          entries.push({ x_pos: x, y_pos: y, width, height })
          used.set(row.zoneId, entries)
        }
        const values = [row.zoneId, row.label, row.type, row.capacity, x, y]
        if (row.previous) sql.run('UPDATE tables SET zone_id = ?, label = ?, type = ?, capacity = ?, x_pos = ?, y_pos = ? WHERE id = ?', [...values, row.previous.id])
        else sql.run('INSERT INTO tables (zone_id, label, type, capacity, x_pos, y_pos) VALUES (?, ?, ?, ?, ?, ?)', values)
      }
    })
  }

  private locationBusy(id: number) {
    return this.db.all("SELECT id FROM orders WHERE table_id = ? AND status IN ('open', 'billed') LIMIT 1", [id]).length > 0
  }

  deleteLocation(id: number) {
    if (this.locationBusy(id)) throw new Error('Settle this location’s open order before deleting it.')
    this.db.write('DELETE FROM tables WHERE id = ?', [id])
  }
}
