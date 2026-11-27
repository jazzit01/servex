import { useEffect, useRef, useState } from 'react'
import { ChefHat, Minus, Plus, ReceiptText, Search, Split, Trash2, UserRound } from 'lucide-react'
import CheckoutModal from '../components/billing/CheckoutModal'
import ManagerPin from '../components/billing/ManagerPin'
import { publishPrint } from '../components/billing/PrintPreview'
import { Field, MediaThumbnail, Modal } from '../components/ManagementControls'
import { runAction, usePosStore } from '../store/usePosStore'
import { lineAmounts, orderAmounts } from '../types/pricing'
import type { BillEdit, CartItem, OrderItem, OrderType } from '../types/pos'

const types = { dinein: 'Dine-In', parcel: 'Takeaway / Parcel', room: 'Room Service' } as const

function fuzzy(name: string, search: string) {
  const haystack = name.toLowerCase()
  return search.toLowerCase().trim().split(/\s+/).every(word => {
    if (haystack.includes(word)) return true
    let at = -1
    for (const letter of word) {
      at = haystack.indexOf(letter, at + 1)
      if (at < 0) return false
    }
    return true
  })
}

function Quantity({ value, decrease, increase, disabled }: { value: number; decrease: () => void; increase: () => void; disabled: boolean }) {
  return <div className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
    <button className="grid size-7 place-items-center rounded-md border bg-white hover:bg-slate-100" aria-label="Decrease quantity" onClick={decrease} disabled={disabled}><Minus size={14} /></button>
    <span className="min-w-4 text-center">{value}</span>
    <button className="grid size-7 place-items-center rounded-md border bg-white hover:bg-slate-100" aria-label="Increase quantity" onClick={increase} disabled={disabled || value >= 99}><Plus size={14} /></button>
  </div>
}

export default function BillingPage() {
  const { data, orderType, tableId, orderId, openCheckout, navigate, notify } = usePosStore()
  const [cart, setCart] = useState<Record<number, CartItem>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'veg' | 'nonveg'>('all')
  const [category, setCategory] = useState(0)
  const [type, setType] = useState(orderType)
  const [table, setTable] = useState(tableId)
  const [activeId, setActiveId] = useState(orderId)
  const [openCustomer, setOpenCustomer] = useState(false)
  const initial = data?.orders.find(row => row.id === orderId)
  const [guest, setGuest] = useState(initial?.customer_name ?? '')
  const [phone, setPhone] = useState(initial?.customer_phone ?? '')
  const [guestCount, setGuestCount] = useState(initial?.guest_count ? String(initial.guest_count) : '')
  const [busy, setBusy] = useState(false)
  const [checkout, setCheckout] = useState(openCheckout)
  const [splitFirst, setSplitFirst] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState<BillEdit['quantities'][number]>()
  const [note, setNote] = useState<{ id: number; value: string; stored: boolean }>()
  const searchBox = useRef<HTMLInputElement>(null)
  const launch = useRef<(intent: 'kot' | 'bill' | 'split') => void>(() => {})
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (event.repeat || event.isComposing || document.querySelector('dialog[open]')) return
      if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); searchBox.current?.focus(); return }
      if (event.key === 'Escape') { setSearch(''); return }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key === 'F2' || event.key === 'F4') { event.preventDefault(); launch.current(event.key === 'F2' ? 'kot' : 'bill') }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])
  if (!data) return null
  const order = data.orders.find(row => row.id === activeId && (row.status === 'open' || row.status === 'billed'))
  const lines = order ? data.orderItems.filter(row => row.order_id === order.id) : []
  const choices = data.tables.filter(row => row.status === 'vacant' && (row.type === 'room') === (type === 'room'))
  const context = order?.order_type ?? type
  const locationId = order ? order.table_id : table
  const location = data.tables.find(row => row.id === locationId)
  const reference = location ? `${location.label} · ${types[context]}` : order ? `Takeaway #${order.id}` : types[context]
  const activeCategories = data.categories.filter(row => row.is_active)
  const available = data.menu.filter(row => row.is_available && activeCategories.some(group => group.id === row.category_id))
  const visible = available.filter(row => (!category || row.category_id === category) &&
    (filter === 'all' || Boolean(row.is_veg) === (filter === 'veg')) && fuzzy(row.name, search))
  const inclusive = Boolean(data.settings.tax_inclusive)
  const draft = Object.values(cart).filter(row => row.quantity > 0)
  const draftRows = draft.flatMap(row => {
    const item = available.find(choice => choice.id === row.id)
    return item ? [{ row, item, ...lineAmounts(item.price, row.quantity, item.tax_slab ?? data.settings.tax_rate ?? 5, inclusive) }] : []
  })
  const amount = orderAmounts(draftRows, inclusive)
  const tax = Math.round(((order?.tax_amount ?? 0) + amount.tax) * 100)
  const discount = order?.discount_amount ?? 0
  const money = (value: number) => data.settings.currency_symbol + value.toFixed(2)
  const canSave = Boolean(order || draft.length) && (context === 'parcel' || locationId !== null)
  const customerChanged = !!order && (guest.trim() !== (order.customer_name ?? '') || phone.trim() !== (order.customer_phone ?? '') ||
    (guestCount ? Number(guestCount) : null) !== order.guest_count)

  function adjust(id: number, change: number) {
    setCart(previous => ({ ...previous, [id]: { id, quantity: Math.max(0, Math.min(99, (previous[id]?.quantity ?? 0) + change)), notes: previous[id]?.notes } }))
  }
  function editSeed() {
    return { orderId: order!.id, revision: order!.revision, guestName: guest, phone, guestCount: guestCount ? Number(guestCount) : null }
  }
  async function editLine(change: BillEdit['quantities'][number], pin?: string) {
    if (!order) return false
    setBusy(true)
    try {
      return await runAction(() => window.servexApi.editBill({ ...editSeed(), quantities: [change], pin }), 'Order updated.')
    } finally { setBusy(false) }
  }
  function decrease(line: OrderItem) {
    const change = { id: line.id, quantity: line.quantity - 1 }
    if (line.kot_printed) setConfirmVoid(change)
    else void editLine(change)
  }

  async function start(intent: 'kot' | 'bill' | 'split') {
    if (busy || !canSave) return
    if (intent === 'kot' && !draft.length && !lines.some(row => !row.kot_printed)) {
      notify('There are no unsent kitchen items.', true); return
    }
    setBusy(true)
    try {
      let id = order?.id
      if (!order) {
        const ok = await runAction(async () => {
          id = await window.servexApi.createOrder({ type, tableId: type === 'parcel' ? null : table, items: draft,
            guestName: guest, phone, guestCount: guestCount ? Number(guestCount) : undefined })
        }, 'Order saved.')
        if (!ok || id === undefined) return
        setActiveId(id); setCart({})
      } else if (draft.length || customerChanged) {
        const ok = await runAction(() => customerChanged
          ? window.servexApi.editBill({ ...editSeed(), quantities: [], added: draft })
          : window.servexApi.addOrderItems(order.id, order.revision, draft), 'Order updated.')
        if (!ok) return
        setCart({})
      }
      if (intent === 'kot') {
        const next = usePosStore.getState().data?.orders.find(row => row.id === id)
        if (!next) return
        await runAction(async () => {
          publishPrint(await window.servexApi.sendKot(next.id, next.revision))
        }, 'Kitchen ticket sent.')
      } else { setSplitFirst(intent === 'split'); setCheckout(true) }
    } finally { setBusy(false) }
  }
  launch.current = intent => void start(intent)

  async function clear() {
    if (busy || !window.confirm('Clear all unsent items?')) return
    if (order && lines.some(row => !row.kot_printed)) {
      setBusy(true)
      const ok = await runAction(() => window.servexApi.clearUnsent(order.id, order.revision), 'Unsent items cleared.')
      setBusy(false)
      if (!ok) return
      if (!lines.some(row => row.kot_printed)) setActiveId(null)
    }
    setCart({})
  }

  if (activeId !== null && !order) return <div className="workspace"><h1>Order closed</h1><button className="secondary" onClick={() => navigate('floor')}>Back to floor map</button></div>
  return <div className="workspace flex h-full min-h-[520px] flex-col gap-3 !space-y-0">
    <h1 className="shrink-0">Quick Billing</h1>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_420px] gap-4">
      <section className="panel flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center gap-1.5 border-b px-2">
          <label className="relative min-w-20 flex-1"><Search size={15} className="absolute left-2 top-2.5 text-slate-500" />
            <input ref={searchBox} aria-label="Search menu" className="field pl-7" placeholder="Search (Ctrl+K)" value={search} onChange={event => setSearch(event.target.value)} /></label>
          {(['all', 'veg', 'nonveg'] as const).map(value => <button key={value} aria-pressed={filter === value} className={`rounded-full px-2 py-1.5 text-xs font-semibold ${filter === value ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'veg' ? 'Veg' : 'Non-Veg'}</button>)}
          {!order && tableId === null && <select className="field w-auto max-w-36 px-1.5 text-xs" aria-label="Order type" value={type} onChange={event => { setType(event.target.value as OrderType); setTable(null) }}>
            {Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
        </div>
        <div className="flex h-11 shrink-0 items-center gap-1 overflow-auto border-b px-2">
          {[{ id: 0, name: 'All' }, ...activeCategories].map(row => <button key={row.id}
            aria-pressed={row.id === category} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${row.id === category ? 'bg-teal-50 text-teal-800' : 'hover:bg-slate-100'}`}
            onClick={() => setCategory(row.id)}>{row.name}</button>)}
        </div>
        {!order && type !== 'parcel' && tableId === null && <div className="border-b p-2"><Field label="Vacant location"><select className="field" value={table ?? ''} onChange={event => setTable(event.target.value ? Number(event.target.value) : null)}>
          <option value="">Choose a location</option>{choices.map(row => <option key={row.id} value={row.id}>{data.zones.find(zone => zone.id === row.zone_id)?.name} · {row.label}</option>)}
        </select></Field></div>}
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-2.5">
          <div className="grid grid-cols-3 gap-3 min-[1460px]:grid-cols-4">{visible.map(item => <button key={item.id} disabled={busy}
            aria-label={`Add ${item.name}`} onClick={() => adjust(item.id, 1)}
            className="flex min-w-0 flex-col justify-between overflow-hidden rounded-xl border bg-white text-left transition hover:border-teal-500">
            <span className="relative block w-full"><MediaThumbnail name={item.image_path} alt="" banner />
              <span className="absolute right-2 top-2 grid size-5 place-items-center rounded border bg-white" title={item.is_veg ? 'Veg' : 'Non-Veg'}>
                <span className={`size-2.5 rounded-sm ${item.is_veg ? 'bg-emerald-600' : 'bg-rose-600'}`} /></span></span>
            <span className="line-clamp-2 min-h-11 px-2.5 pt-1.5 text-sm font-semibold text-slate-800">{item.name}</span>
            <span className="flex w-full items-center justify-between p-2.5 pt-0 text-sm font-bold tabular-nums">{money(item.price)}
              <span className="grid size-7 place-items-center rounded-lg bg-teal-50 text-teal-700"><Plus size={17} /></span></span>
          </button>)}</div>
          {!visible.length && <p className="p-6 text-center text-sm text-slate-500">No menu items match.</p>}
        </div>
      </section>
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4">
          <span className="truncate rounded-lg bg-teal-50 px-2 py-1 text-sm font-semibold text-teal-900" title={reference}>{reference}</span>
          <div className="flex shrink-0 gap-1">
            <button className="secondary p-1.5" title="Customer details" aria-label="Customer details" onClick={() => setOpenCustomer(!openCustomer)}><UserRound size={16} /></button>
            <button className="secondary p-1.5" title="Split Bill" aria-label="Split Bill" disabled={busy || !canSave} onClick={() => void start('split')}><Split size={16} /></button>
            <button className="secondary p-1.5 text-red-700" title="Clear Unsent" aria-label="Clear Unsent" disabled={busy || (!draft.length && !lines.some(line => !line.kot_printed))} onClick={() => void clear()}><Trash2 size={16} /></button>
          </div>
        </header>
        {openCustomer && <div className="grid shrink-0 grid-cols-[1fr_1fr_68px] gap-2 border-b p-3">
          <Field label="Customer name"><input className="field" maxLength={120} value={guest} onChange={event => setGuest(event.target.value)} /></Field>
          <Field label="Phone"><input className="field" type="tel" maxLength={32} value={phone} onChange={event => setPhone(event.target.value)} /></Field>
          <Field label="Guests"><input className="field" type="number" min={1} max={1000} value={guestCount} onChange={event => setGuestCount(event.target.value)} /></Field>
        </div>}
        <div className="min-h-0 flex-1 divide-y overflow-y-auto">
          {lines.map(line => <div key={line.id} className="grid grid-cols-[1fr_auto_78px] items-center gap-2 px-4 py-2.5 text-sm">
            <span><strong>{line.item_name}</strong>{Boolean(line.kot_printed) && <small className="ml-1 rounded bg-emerald-50 px-1 text-emerald-800">KOT Sent</small>}
              {line.kot_printed ? (line.notes && <small className="block text-amber-800">{line.notes}</small>) :
                <button className="block text-left text-xs text-teal-800 underline" disabled={busy} onClick={() => setNote({ id: line.id, value: line.notes ?? '', stored: true })}>{line.notes || 'Add Note'}</button>}</span>
            <Quantity value={line.quantity} disabled={busy} decrease={() => decrease(line)}
              increase={() => line.kot_printed ? adjust(line.menu_item_id, 1) : void editLine({ id: line.id, quantity: line.quantity + 1 })} />
            <span className="text-right font-semibold">{money(line.line_total)}</span>
          </div>)}
          {draftRows.map(({ row, item, gross }) => <div key={row.id} className="grid grid-cols-[1fr_auto_78px] items-center gap-2 px-4 py-2.5 text-sm">
            <span><strong>{item.name}</strong><button className="block text-left text-xs text-teal-800 underline" disabled={busy}
              onClick={() => setNote({ id: row.id, value: row.notes ?? '', stored: false })}>{row.notes || 'Add Note'}</button></span>
            <Quantity value={row.quantity} disabled={busy} decrease={() => adjust(row.id, -1)} increase={() => adjust(row.id, 1)} />
            <span className="text-right font-semibold">{money(gross / 100)}</span>
          </div>)}
          {!lines.length && !draftRows.length && <p className="p-8 text-center text-sm text-slate-500">Select a menu item to start the order.</p>}
        </div>
        <footer className="shrink-0 space-y-1 border-t bg-slate-50 p-4 text-sm tabular-nums">
          <div className="flex justify-between"><span>Subtotal</span><span>{money((order?.subtotal ?? 0) + amount.subtotal)}</span></div>
          <div className="flex justify-between"><span>Tax (CGST / SGST)</span><span>{money(Math.floor(tax / 2) / 100)} / {money(Math.ceil(tax / 2) / 100)}</span></div>
          <div className="flex justify-between"><span>Discount</span><span>{money(discount)}</span></div>
          <div className="flex justify-between border-t pt-1 text-xl font-bold"><span>Grand Total</span><span>{money((order?.grand_total ?? 0) + amount.total)}</span></div>
          <div className="grid grid-cols-2 gap-2.5 pt-2">
            <button className="secondary h-12 rounded-xl border-2 border-teal-600 text-teal-700" disabled={busy || !canSave} onClick={() => void start('kot')}><ChefHat size={17} /> Send KOT (F2)</button>
            <button className="primary h-12 rounded-xl" disabled={busy || !canSave} onClick={() => void start('bill')}><ReceiptText size={17} /> Checkout / Bill (F4)</button>
          </div>
        </footer>
      </section>
    </div>
    {note && <Modal compact title="Item note" onClose={() => { if (!busy) setNote(undefined) }}>
      <form className="space-y-3" onSubmit={async event => {
        event.preventDefault()
        const value = String(new FormData(event.currentTarget).get('note'))
        if (note.stored) { const saved = lines.find(line => line.id === note.id); if (!saved || !(await editLine({ id: saved.id, quantity: saved.quantity, notes: value }))) return }
        else setCart(previous => ({ ...previous, [note.id]: { ...previous[note.id], notes: value } }))
        setNote(undefined)
      }}>
        <Field label="Kitchen instructions"><input className="field" name="note" defaultValue={note.value} maxLength={240} placeholder="Extra spicy, no onion…" /></Field>
        <button className="primary" disabled={busy}>Save note</button>
      </form>
    </Modal>}
    {confirmVoid && <ManagerPin title="Authorize removal of a sent item" onClose={() => setConfirmVoid(undefined)}
      onVerify={pin => editLine(confirmVoid, pin)} />}
    {checkout && order && <CheckoutModal order={order} lines={lines} label={reference} data={data} initialSplit={splitFirst}
      onClose={() => { setCheckout(false); usePosStore.setState({ openCheckout: false }); setGuest(order.customer_name ?? ''); setPhone(order.customer_phone ?? '') }}
      onPaid={() => { usePosStore.setState({ openCheckout: false }); navigate(order.table_id === null ? 'orders' : 'floor') }} />}
  </div>
}
