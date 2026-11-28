import type { Order, PaymentMode } from './pos'

export type Station = 'kitchen' | 'bar' | 'none'
export type Unit = 'g' | 'ml' | 'pcs' | 'kg' | 'L'
export interface Ingredient { id: number; name: string; unit: Unit; current_stock: number; low_stock_threshold: number; cost_per_unit: number }
export interface Recipe { ingredient_id: number; quantity_required: number; menu_item_id: number }
export interface Customer { id: number; name: string; phone: string; birthday: string | null; loyalty_points: number; total_visits: number; total_spent: number; favorite_item: string | null }
export interface Reservation { id: number; table_id: number | null; customer_name: string; customer_phone: string; guest_count: number; reservation_time: string; status: 'booked' | 'seated' | 'cancelled' | 'waitlist'; notes: string | null; created_at: string; order_id: number | null }
export interface PricingRule { id: number; name: string; rule_type: 'discount_percent' | 'surcharge_percent'; value: number; category_id: number | null; days_of_week: string; start_time: string; end_time: string; is_active: number }
export interface Expense { id: number; title: string; category: string; amount: number; payment_mode: PaymentMode; notes: string | null; created_at: string }
export interface PrinterSetting { id: number; name: string; role: 'receipt' | 'kitchen' | 'bar'; connection_type: 'os' | 'usb' | 'lan'; address: string | null; paper_width: '58mm' | '80mm'; is_active: number }
export interface DisplayState { name: string; logo: string | null; currency: string; upi: string; total: number; checkout: boolean; items: { name: string; qty: number; amount: number }[] }
export type DisplayCart = Omit<DisplayState, 'name' | 'logo' | 'currency' | 'upi'>
export type EnterpriseAction =
  | { type: 'preferences'; theme?: 'light' | 'dark'; sound?: boolean }
  | { type: 'earnRate'; value: number }
  | { type: 'ingredient'; value: Omit<Ingredient, 'id' | 'current_stock'> & { id?: number } }
  | { type: 'stock'; id: number; quantity: number; cost: number }
  | { type: 'recipe'; menu: number; rows: Omit<Recipe, 'menu_item_id'>[] }
  | { type: 'customer'; name: string; phone: string; birthday: string }
  | { type: 'reservation'; value: Omit<Reservation, 'id' | 'created_at' | 'order_id' | 'status'> & { status: 'booked' | 'waitlist' } }
  | { type: 'seat'; id: number; table: number }
  | { type: 'cancelReservation'; id: number }
  | { type: 'pricing'; value: Omit<PricingRule, 'id'> & { id?: number } }
  | { type: 'expense'; value: Omit<Expense, 'id' | 'created_at'> }
  | { type: 'printer'; value: Omit<PrinterSetting, 'id'> }
  | { type: 'station'; target: 'category' | 'menu'; id: number; value: Station }
  | { type: 'resume'; id: number }
  | { type: 'deleteParked'; id: number }

export interface EnterpriseData { ingredients: Ingredient[]; recipes: Recipe[]; customers: Customer[]; reservations: Reservation[]; expenses: Expense[]; printers: PrinterSetting[]; parked: Order[] }
