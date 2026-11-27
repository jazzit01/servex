import { useEffect, useState } from 'react'
import { Check, Minus, Plus, Printer, Receipt, Search } from 'lucide-react'
import Checkout from '../components/floor/Checkout'
import { Field } from '../components/ManagementControls'
import { runAction, usePosStore } from '../store/usePosStore'
import { lineAmounts, orderAmounts } from '../types/pricing'
import type { MenuItem } from '../types/pos'

export default function BillingPage() {
  const { data, orderType, tableId, orderId, openCheckout, navigate, notify, resumeOrder } = usePosStore()
  const [cart, setCart] = useState<Record<number, number>>({})
  const [category, setCategory] = useState(0)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestCount, setGuestCount] = useState('')
  const [checkout, setCheckout] = useState(openCheckout)
  const order = data?.orders.find(item => item.id === orderId && (item.status === 'open' || item.status === 'billed'))
  const pending = Object.values(cart).some(quantity => quantity > 0)
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key !== 'F4' || event.repeat || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || !order || busy) return
      event.preventDefault()
      if (pending) notify('Save added items before opening checkout.', true)
      else setCheckout(true)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [order, pending, busy, notify])
  if (!data) return null
  if (orderId !== null && !order) return <div className="workspace"><h1>Order unavailable</h1>
    <p className="subtitle">This order has been paid, merged, or closed.</p>
    <button className="secondary" onClick={() => navigate('floor')}>Back to floor map</button>
  </div>
  const money = (value: number) => data.settings.currency_symbol + value.toFixed(2)
  const active = data.categories.filter(group => group.is_active)
  const available = data.menu.filter(item => item.is_available && active.some(group => group.id === item.category_id))
  const visible = available.filter(item => (!category || item.category_id === category) && item.name.toLowerCase().includes(search.trim().toLowerCase()))
  const inclusive = Boolean(data.settings.tax_inclusive)
  const rows = available.filter(item => cart[item.id]).map(item => {
    const quantity = cart[item.id]
    return { item, quantity, ...lineAmounts(item.price, quantity, item.tax_slab ?? data.settings.tax_rate ?? 5, inclusive) }
  })
  const totals = orderAmounts(rows, inclusive)
  const locationId = order ? order.table_id : tableId
  const label = locationId === null ? 'Takeaway' : data.tables.find(table => table.id === locationId)?.label ?? 'Location'
  const savedLines = order ? data.orderItems.filter(line => line.order_id === order.id) : []
  const adjust = (item: MenuItem, delta: number) => setCart(previous => ({ ...previous, [item.id]: Math.min(99, Math.max(0, (previous[item.id] ?? 0) + delta)) }))
  async function save() {
    setBusy(true)
    const items = rows.map(({ item, quantity }) => ({ id: item.id, quantity }))
    let newOrderId: number | undefined
    const saved = await runAction(async () => {
      if (order) await window.servexApi.addOrderItems(order.id, order.revision, items)
      else newOrderId = await window.servexApi.createOrder({
        type: orderType, tableId, items, guestName, guestCount: guestCount ? Number(guestCount) : undefined,
      })
    }, order ? 'Items added to the order.' : 'Order saved.')
    setBusy(false)
    if (!saved) return
    setCart({})
    if (order) return
    const created = usePosStore.getState().data?.orders.find(row => row.id === newOrderId)
    if (created && created.table_id !== null) resumeOrder(created)
    else navigate('orders')
  }
  return <div className="workspace">
    <div className="flex items-end justify-between gap-4">
      <div><h1>Quick Billing</h1><p className="subtitle">{label} · {order ? order.bill_number : 'Choose items to start an order'}</p></div>
      {order && <button className="primary" disabled={busy || pending} onClick={() => setCheckout(true)}>
        <Printer size={16} /> Checkout / Print Bill <kbd className="rounded bg-white/20 px-1.5 text-xs">F4</kbd>
      </button>}
    </div>
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
        <h2 className="flex items-center gap-2 border-b px-5 py-4"><Receipt size={18} className="text-teal-700" /> {order ? 'Open order' : 'Current order'}</h2>
        {!order && tableId !== null && <div className="grid grid-cols-[1fr_80px] gap-2 border-b p-4">
          <Field label="Guest name"><input className="field" maxLength={120} value={guestName} onChange={event => setGuestName(event.target.value)} /></Field>
          <Field label="Guests"><input className="field" type="number" min={1} max={1000} value={guestCount} onChange={event => setGuestCount(event.target.value)} /></Field>
        </div>}
        {order && <div className="divide-y border-b px-5">
          {savedLines.map(line => <div key={line.id} className="flex justify-between gap-2 py-2 text-sm">
            <span>{line.quantity} × {line.item_name}</span><span>{money(line.line_total)}</span>
          </div>)}
          <div className="flex justify-between py-2 text-sm font-bold"><span>Saved total</span><span>{money(order.grand_total)}</span></div>
        </div>}
        <div className="divide-y px-5">
          {!rows.length && <p className="py-8 text-center text-sm text-slate-500">{order ? 'Choose more items from the menu.' : 'Add an item from the menu.'}</p>}
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
          <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>{order ? 'New items total' : 'Total'}</span><span>{money(totals.total)}</span></div>
          <button className="primary mt-3 w-full" disabled={!rows.length || busy || (guestCount !== '' && (!Number.isInteger(Number(guestCount)) || Number(guestCount) < 1 || Number(guestCount) > 1000))} onClick={() => void save()}><Check size={17} /> {order ? 'Add items to order' : 'Save order'}</button>
        </div>
      </section>
    </div>
    {order && checkout && <Checkout order={order} lines={savedLines} label={label} currency={data.settings.currency_symbol}
      onClose={() => { setCheckout(false); usePosStore.setState({ openCheckout: false }) }}
      onPaid={() => { usePosStore.setState({ openCheckout: false }); navigate(order.table_id === null ? 'orders' : 'floor') }} />}
  </div>
}
