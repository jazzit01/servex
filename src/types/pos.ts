export type Route = 'floor' | 'billing' | 'orders' | 'menu' | 'reports' | 'settings'
export type Role = 'admin' | 'manager' | 'cashier'
export type OrderType = 'dinein' | 'parcel' | 'room'
export type TableStatus = 'vacant' | 'occupied' | 'billed' | 'cleaning'
export interface Cashier { id: number; name: string; role: Role }
export interface Settings {
  restaurant_name: string
  tagline: string | null
  logo_path: string | null
  address: string | null
  phone: string | null
  gstin: string | null
  currency_symbol: string
  tax_rate: number
  tax_inclusive: number
  receipt_footer: string | null
  cloud_sync_enabled: number
  cloud_endpoint: string | null
  licenseConfigured: boolean
  licenseActive: boolean
}
export type SettingsInput = Pick<Settings, 'restaurant_name' | 'tagline' | 'address' | 'phone' | 'gstin' | 'currency_symbol' | 'tax_rate' | 'tax_inclusive' | 'receipt_footer'> & { managerPin?: string; licenseKey?: string }
export interface Zone { id: number; name: string; sort_order: number }
export interface FloorTable {
  id: number; zone_id: number; label: string; type: 'table' | 'garden' | 'room'
  x_pos: number; y_pos: number; width: number; height: number; capacity: number; status: TableStatus
}
export interface Category { id: number; name: string; sort_order: number; is_active: number }
export interface MenuItem {
  id: number; category_id: number; name: string; price: number; tax_slab: number
  is_veg: number; image_path: string | null; is_available: number
}
export interface Order {
  id: number; bill_number: string; table_id: number | null; order_type: OrderType
  status: 'open' | 'billed' | 'paid' | 'void'; subtotal: number; tax_amount: number
  grand_total: number; created_at: string; closed_at: string | null; payment_mode: string | null
}
export interface OrderItem {
  id: number; order_id: number; menu_item_id: number; item_name: string
  unit_price: number; quantity: number; notes: string | null; kot_printed: number; line_total: number
}
export interface Snapshot {
  settings: Settings; logo: string | null; zones: Zone[]; tables: FloorTable[]
  categories: Category[]; menu: MenuItem[]; orders: Order[]; orderItems: OrderItem[]
  businessDate: string; lastClose: string | null; actor: Cashier; cloud: CloudStatus | null
}
export interface OrderInput {
  type: OrderType; tableId: number | null; items: { id: number; quantity: number }[]
}
export interface ServexApi {
  signIn(pin: string): Promise<Cashier | null>
  lock(): Promise<void>
  snapshot(): Promise<Snapshot>
  createOrder(order: OrderInput): Promise<void>
  payOrder(id: number, mode: 'Cash' | 'Card' | 'UPI'): Promise<void>
  printKot(id: number): Promise<void>
  toggleItem(id: number): Promise<void>
  closeDay(overridePin?: string): Promise<void>
  updateSettings(input: SettingsInput): Promise<void>
  pickLogo(): Promise<boolean>
  removeLogo(): Promise<void>
  pickMedia(): Promise<PickedMedia | null>
  readMedia(name: string): Promise<string | null>
  listStaff(): Promise<StaffUser[]>
  saveStaff(input: StaffInput): Promise<void>
  saveCategory(input: CategoryInput): Promise<void>
  moveCategory(id: number, direction: -1 | 1): Promise<void>
  saveMenuItem(input: MenuInput): Promise<void>
  deleteMenuItem(id: number): Promise<void>
  importMenuCsv(): Promise<number | null>
  exportMenuCsv(template: boolean): Promise<boolean>
  saveZone(input: ZoneInput): Promise<void>
  deleteZone(id: number): Promise<void>
  saveLocations(input: LocationInput[]): Promise<void>
  deleteLocation(id: number): Promise<void>
  exportBackup(passphrase: string): Promise<boolean>
  importBackup(passphrase: string): Promise<false | 'restored' | 'locked'>
  updateCloud(input: CloudInput): Promise<void>
  syncCloud(): Promise<void>
}
declare global { interface Window { servexApi: ServexApi } }

export interface StaffUser extends Cashier { is_active: number }
export interface StaffInput { id?: number; name: string; role: Role; pin?: string; active: boolean }
export interface CategoryInput { id?: number; name: string; active: boolean }
export interface MenuInput {
  id?: number; categoryId: number; name: string; price: number; tax: number
  veg: boolean; available: boolean; imagePath: string | null
}
export interface ZoneInput { id?: number; name: string }
export interface LocationInput {
  id?: number; zoneId: number; label: string; type: FloorTable['type']; capacity: number
}
export interface CloudInput { enabled: boolean; endpoint: string; token?: string; passphrase?: string }
export interface CloudStatus { tokenConfigured: boolean; passphraseConfigured: boolean; lastSynced: string | null }
export interface PickedMedia { name: string; preview: string }
