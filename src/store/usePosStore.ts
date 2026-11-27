import { create } from 'zustand'
import type { Cashier, Order, OrderType, PrintResult, Route, Snapshot } from '../types/pos'

interface PosState {
  route: Route
  cashier: Cashier | null
  data: Snapshot | null
  orderType: OrderType
  tableId: number | null
  billingSession: number
  orderId: number | null
  print: PrintResult | null
  setPrint(print: PrintResult | null): void
  openCheckout: boolean
  floorLayoutDirty: boolean
  toast: { message: string; error: boolean } | null
  navigate(route: Route): void
  setFloorLayoutDirty(dirty: boolean): void
  startOrder(type: OrderType, tableId?: number): void
  resumeOrder(order: Order, checkout?: boolean): void
  notify(message: string, error?: boolean): void
  refresh(): Promise<void>
  signIn(pin: string, staffId?: number): Promise<boolean>
  lock(): Promise<void>
}
let toastTimer: ReturnType<typeof setTimeout>
export const usePosStore = create<PosState>((set, get) => ({
  route: 'floor', print: null, setPrint: print => set({ print }), cashier: null, data: null, orderType: 'parcel', tableId: null, orderId: null, openCheckout: false, floorLayoutDirty: false, billingSession: 0, toast: null,
  setFloorLayoutDirty: floorLayoutDirty => set({ floorLayoutDirty }),
  navigate: route => {
    if (route !== 'floor' && get().floorLayoutDirty && !window.confirm('Leave and discard unsaved layout changes?')) return
    set({ route })
  },
  startOrder: (orderType, tableId) => {
    if (get().floorLayoutDirty && !window.confirm('Leave and discard unsaved layout changes?')) return
    set(state => ({ route: 'billing', orderType, tableId: tableId ?? null, orderId: null, openCheckout: false, billingSession: state.billingSession + 1 }))
  },
  resumeOrder: (order, openCheckout = false) => set(state => ({
    route: 'billing', orderType: order.order_type, tableId: order.table_id, orderId: order.id, openCheckout,
    billingSession: state.billingSession + 1,
  })),
  notify: (message, error = false) => {
    clearTimeout(toastTimer)
    set({ toast: { message, error } })
    toastTimer = setTimeout(() => set({ toast: null }), 4500)
  },
  refresh: async () => {
    const data = await window.servexApi.snapshot()
    set(state => ({ data, cashier: state.cashier ? data.actor : null }))
  },
  signIn: async (pin, staffId) => {
    const cashier = await window.servexApi.signIn(pin, staffId)
    if (!cashier) return false
    await get().refresh()
    set({ cashier, route: 'floor', orderId: null, tableId: null, orderType: 'parcel', openCheckout: false })
    return true
  },
  lock: async () => {
    set({ cashier: null, data: null, route: 'floor', toast: null, print: null })
    await window.servexApi.lock()
  },
}))

export async function runAction(action: () => Promise<unknown>, message: string) {
  const store = usePosStore.getState()
  try {
    const result = await action()
    if (result === false) return false
    await store.refresh()
    store.notify(message)
    return true
  } catch (error) {
    store.notify(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error), true)
    return false
  }
}
