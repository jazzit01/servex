import { create } from 'zustand'
import type { Cashier, OrderType, Route, Snapshot } from '../types/pos'

interface PosState {
  route: Route
  cashier: Cashier | null
  data: Snapshot | null
  orderType: OrderType
  tableId: number | null
  billingSession: number
  toast: { message: string; error: boolean } | null
  navigate(route: Route): void
  startOrder(type: OrderType, tableId?: number): void
  notify(message: string, error?: boolean): void
  refresh(): Promise<void>
  signIn(pin: string): Promise<boolean>
  lock(): Promise<void>
}
let toastTimer: ReturnType<typeof setTimeout>
export const usePosStore = create<PosState>((set, get) => ({
  route: 'floor', cashier: null, data: null, orderType: 'parcel', tableId: null, billingSession: 0, toast: null,
  navigate: route => set({ route }),
  startOrder: (orderType, tableId) => set(state => ({ route: 'billing', orderType, tableId: tableId ?? null, billingSession: state.billingSession + 1 })),
  notify: (message, error = false) => {
    clearTimeout(toastTimer)
    set({ toast: { message, error } })
    toastTimer = setTimeout(() => set({ toast: null }), 4500)
  },
  refresh: async () => set({ data: await window.servexApi.snapshot() }),
  signIn: async pin => {
    const cashier = await window.servexApi.signIn(pin)
    if (!cashier) return false
    await get().refresh()
    set({ cashier, route: 'floor' })
    return true
  },
  lock: async () => {
    set({ cashier: null, data: null, route: 'floor', toast: null })
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
