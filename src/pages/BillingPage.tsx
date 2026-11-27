import { useState } from 'react'
import { Check, Minus, Plus, Receipt, Search } from 'lucide-react'
import { runAction, usePosStore } from '../store/usePosStore'
import { lineAmounts, orderAmounts } from '../types/pricing'
import type { MenuItem } from '../types/pos'

export default function BillingPage() {
  const { data, orderType, tableId, navigate } = usePosStore()
  const [cart, setCart] = useState<Record<number, number>>({})
  const [category, setCategory] = useState(0)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  if (!data) return null
  const money = (value: number) => data.settings.currency_symbol + value.toFixed(2)
  const active = data.categories.filter(group => group.is_active)
  const available = data.menu.filter(item => item.is_available && active.some(group => group.id === item.category_id))
  const visible = available.filter(item => (!category || item.category_id === category) && item.name.toLowerCase().includes(search.trim().toLowerCase()))
  const inclusive = Boolean(data.settings.tax_inclusive)
  const rows = available.filter(item => cart[item.id]).map(item => {
    const quantity = cart[item.id]
    return { item, quantity, ...lineAmounts(item.price, quantity, item.tax_slab ?? data.settings.tax_rate, inclusive) }
  })
  const totals = orderAmounts(rows, inclusive)
  const label = orderType === 'parcel' ? 'Takeaway' : data.tables.find(table => table.id === tableId)?.label
  const adjust = (item: MenuItem, delta: number) => setCart(previous => ({ ...previous, [item.id]: Math.min(99, Math.max(0, (previous[item.id] ?? 0) + delta)) }))
  async function save() {
    setBusy(true)
    const saved = await runAction(() => window.servexApi.createOrder({ type: orderType, tableId, items: rows.map(({ item, quantity }) => ({ id: item.id, quantity })) }), 'Order saved.')
    setBusy(false)
    if (saved) { setCart({}); navigate('orders') }
  }
  return <div className="workspace">
    <div><h1>Quick Billing</h1><p className="subtitle">{label} · Choose items to start an order.</p></div>
    <div className="grid grid-cols-[minmax(0,1fr)_330px] items-start gap-5">
      <section className="panel space-y-4 p-5">
        <label className="relative block"><Search size={17} className="absolute left-3 top-2.5 text-slate-400" /><input className="field pl-9" placeholder="Search menu" aria-label="Search menu" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          {[{ id: 0, name: 'All items' }, ...active].map(group => <button key={group.id} aria-pressed={group.id === category} className={`secondary ${group.id === category ? 'border-teal-300 bg-teal-50 text-teal-800' : ''}`} onClick={() => setCategory(group.id)}>{group.name}</button>)}
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {visible.map(item => <button key={item.id} disabled={busy} onClick={() => adjust(item, 1)} className="rounded-xl border p-4 text-left hover:border-teal-300 hover:bg-teal-50/50">
            <div className="flex items-center justify-between gap-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${item.is_veg ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>{item.is_veg ? 'Veg' : 'Non-veg'}</span><Plus size={16} className="text-teal-700" /></div>
            <div className="mt-3 text-sm font-semibold">{item.name}</div><div className="mt-1 text-sm text-slate-600">{money(item.price)}</div>
          </button>)}
          {!visible.length && <p className="text-sm text-slate-500">No menu items match.</p>}
        </div>
      </section>
      <section className="panel overflow-hidden">
        <h2 className="flex items-center gap-2 border-b px-5 py-4"><Receipt size={18} className="text-teal-700" /> Current order</h2>
        <div className="divide-y px-5">
          {!rows.length && <p className="py-8 text-center text-sm text-slate-500">Add an item from the menu.</p>}
          {rows.map(({ item, quantity, gross }) => <div key={item.id} className="py-3">
            <div className="flex justify-between gap-3 text-sm font-medium"><span>{item.name}</span><span>{money(gross / 100)}</span></div>
            <div className="mt-2 flex items-center gap-3 text-sm">
              <button className="secondary p-1" disabled={busy} aria-label={`Remove one ${item.name}`} onClick={() => adjust(item, -1)}><Minus size={15} /></button>{quantity}
              <button className="secondary p-1" disabled={busy || quantity === 99} aria-label={`Add one ${item.name}`} onClick={() => adjust(item, 1)}><Plus size={15} /></button>
            </div>
          </div>)}
        </div>
        <div className="space-y-2 border-t bg-slate-50 p-5 text-sm">
          <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
          <div className="flex justify-between text-slate-600"><span>Tax</span><span>{money(totals.tax)}</span></div>
          <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total</span><span>{money(totals.total)}</span></div>
          <button className="primary mt-3 w-full" disabled={!rows.length || busy} onClick={() => void save()}><Check size={17} /> Save order</button>
        </div>
      </section>
    </div>
  </div>
}
