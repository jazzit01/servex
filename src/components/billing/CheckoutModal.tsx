import { useCalculatorActions, type CalculatorAction } from '../ui/calculatorBridge'
import { useCustomer } from '../enterprise/useEnterprise'
import { soundFx } from '../../utils/soundFx'
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { CreditCard, Printer, Split } from 'lucide-react'
import { Field, Modal } from '../ManagementControls'
import { runAction, usePosStore } from '../../store/usePosStore'
import { splitReceipt, upiUri } from '../../types/settlement'
import type { BillSplit, CartItem, Order, OrderItem, PaymentMode, PrintResult, Snapshot } from '../../types/pos'
import ManagerPin from './ManagerPin'
import { publishPrint } from './PrintPreview'

export default function CheckoutModal({ order, lines, data, label, initialSplit, calculatorPayment, onClose, onPaid }: {
  order: Order; lines: OrderItem[]; data: Snapshot; label: string; initialSplit: boolean; calculatorPayment?: Exclude<CalculatorAction, { kind: 'charge' }>; onClose: () => void; onPaid: () => void
}) {
  const [mode, setMode] = useState<PaymentMode>('Cash')
  const [cash, setCash] = useState(calculatorPayment?.kind === 'tender' ? calculatorPayment.amount.toFixed(2) : '')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(order.customer_name ?? '')
  const [phone, setPhone] = useState(order.customer_phone ?? '')
  const customer=useCustomer(phone)
  const [redeem,setRedeem]=useState('')
  const maximum=Math.max(0,Math.min(customer?.loyalty_points??0,order.grand_total))
  const confirmedPhone=phone.trim()===(order.customer_phone??'')
  const redemption=confirmedPhone?Math.min(maximum,Math.max(0,Math.round((Number(redeem)||0)*100)/100)):0
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [added, setAdded] = useState<Record<number, number>>({})
  const [custom, setCustom] = useState<CartItem[]>([])
  const nextCustomId = useRef(0)
  const [search, setSearch] = useState('')
  const [inclusive, setInclusive] = useState<boolean>()
  const [discountKind, setDiscountKind] = useState<'flat' | 'percent'>(order.discount_percent > 0 ? 'percent' : 'flat')
  const [discount, setDiscount] = useState(String(order.discount_percent || order.discount_amount))
  const [discountTouched, touchDiscount] = useState(false)
  const [splitKind, setSplit] = useState<BillSplit['kind']>('none')
  const [count, setCount] = useState(2)
  const [assignments, assign] = useState<Record<number, number>>({})
  const [showSplit, toggleSplit] = useState(initialSplit)
  const [pin, requestPin] = useState(false)
  const [qr, setQr] = useState('')
  const completeButton = useRef<HTMLButtonElement>(null)
  const toast = usePosStore(state => state.notify)
  const changed = lines.filter(line => edits[line.id] !== undefined && edits[line.id] !== String(line.quantity))
  const pendingItems = Object.entries(added).filter(([, qty]) => qty > 0).map(([id, quantity]) => ({ id: Number(id), quantity }))
  const dirty = name !== (order.customer_name ?? '') || phone !== (order.customer_phone ?? '') ||
    changed.length > 0 || pendingItems.length > 0 || custom.length > 0 || inclusive !== undefined || discountTouched
  const split: BillSplit = splitKind === 'equal' ? { kind: 'equal', count } : splitKind === 'items'
    ? { kind: 'items', groups: Array.from({ length: Number.isInteger(count) && count >= 2 && count <= 20 ? count : 0 }, (_, group) =>
      lines.filter(line => (assignments[line.id] ?? 0) === group).map(line => line.id)) } : { kind: 'none' }
  let shares: number[] = []
  try {
    shares = splitReceipt(lines.map(line => ({ id: line.id, name: line.item_name, quantity: line.quantity, notes: line.notes,
      net: line.net_minor, tax: line.tax_minor })), Math.round(order.subtotal * 100), Math.round(order.tax_amount * 100),
      Math.round((order.discount_amount+redemption) * 100), split).map(part => part.total)
  } catch { /* Incomplete split assignments stay editable. */ }
  const money = (value: number) => data.settings.currency_symbol + value.toFixed(2)
  const due = Math.round((order.grand_total-redemption) * 100)
  const tender = cash === '' ? due : Math.round(Number(cash) * 100)
  const completeDisabled = busy || dirty || !shares.length || (mode === 'Cash' && (!Number.isSafeInteger(tender) || tender < due)) ||
    (mode === 'Room Folio' && (!order.customer_name || !order.customer_phone))
  const uri = upiUri(data.settings.upi_id, data.settings.restaurant_name, due/100)
  const customerDisplay=JSON.stringify({checkout:true,total:due/100,
    items:lines.map(row=>({name:row.item_name,qty:row.quantity,amount:row.line_total}))})
  useEffect(()=>{
    void window.servexApi.publishDisplay(JSON.parse(customerDisplay)).catch(()=>{})
  },[customerDisplay])
  useEffect(() => {
    let current = true
    setQr('')
    if (mode === 'UPI' && due > 0) void QRCode.toDataURL(uri, { width: 240, margin: 4 }).then(value => { if (current) setQr(value) }).catch(() => {})
    return () => { current = false }
  }, [uri, mode, due])
  useEffect(() => {
    function enter(event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.repeat || event.isComposing || event.defaultPrevented ||
          document.querySelectorAll('dialog[open]').length !== 1 ||
          (event.target instanceof Element && event.target.closest('input:not([name=cash]),select,textarea,button'))) return
      event.preventDefault()
      completeButton.current?.click()
    }
    window.addEventListener('keydown', enter)
    return () => window.removeEventListener('keydown', enter)
  }, [])

  function applyCalculator(action: CalculatorAction) {
    if (action.kind === 'tender') { setMode('Cash'); setCash(action.amount.toFixed(2)); return }
    toggleSplit(false)
    if (action.kind === 'charge') {
      const id = --nextCustomId.current
      setCustom(previous => [...previous, { id, quantity: 1, custom: { name: action.name, price: action.amount } }])
      return
    }
    setDiscountKind('flat')
    setDiscount(action.amount.toFixed(2))
    touchDiscount(true)
    if (!dirty) void save(undefined, action.amount)
  }
  useCalculatorActions(!busy && !pin, applyCalculator)
  const initialPayment = useRef(calculatorPayment)
  useEffect(() => {
    const action = initialPayment.current
    initialPayment.current = undefined
    if (action?.kind === 'discount') applyCalculator(action)
  }, [])

  async function save(override?: string, flat?: number) {
    setBusy(true)
    const ok = await runAction(() => window.servexApi.editBill({
      orderId: order.id, revision: order.revision, guestName: name, guestCount: order.guest_count, phone,
      quantities: changed.map(line => ({ id: line.id, quantity: edits[line.id] === '' ? NaN : Number(edits[line.id]) })),
      added: [...pendingItems, ...custom], inclusive, discount: flat !== undefined ? { kind: 'flat', value: flat } : discountTouched ? { kind: discountKind, value: Number(discount) } : undefined, pin: override,
    }), 'Bill updated.')
    setBusy(false)
    if (ok) {
      const next = usePosStore.getState().data?.orders.find(row => row.id === order.id)
      setName(next?.customer_name ?? ''); setPhone(next?.customer_phone ?? '')
      setEdits({}); setAdded({}); setCustom([]); touchDiscount(false); setInclusive(undefined)
      if (next) { setDiscountKind(next.discount_percent > 0 ? 'percent' : 'flat'); setDiscount(String(next.discount_percent || next.discount_amount)) }
    } else if (!override && usePosStore.getState().toast?.message.includes('Manager PIN required')) requestPin(true)
    return ok
  }

  async function print(action: () => Promise<PrintResult>, paid: boolean) {
    setBusy(true)
    let result: PrintResult | undefined
    const ok = await runAction(async () => { result = await action() }, paid ? 'Payment recorded.' : 'Pre-bill prepared.')
    setBusy(false)
    if (ok && result) {
      if (paid) {soundFx('paid');onPaid()}
      publishPrint(result)
    }
  }

  const menu = data.menu.filter(item => item.is_available && data.categories.some(category => category.id === item.category_id && category.is_active))
  return <>
    <Modal wide dismissLabel="Back" dismissDisabled={busy} title={`Checkout · ${label}`} onClose={() => {
      if (!busy && (!dirty || window.confirm('Discard unsaved bill edits?'))) onClose()
    }}>
      <div className="grid grid-cols-2 gap-5" data-calculator-checkout>
        <section className="min-w-0 space-y-3">
          <div className="flex gap-2">
            <button className={showSplit ? 'secondary' : 'primary'} onClick={() => toggleSplit(false)}>Edit bill</button>
            <button className={showSplit ? 'primary' : 'secondary'} onClick={() => toggleSplit(true)}><Split size={15} /> Split Bill</button>
          </div>
          {showSplit ? <div className="space-y-3">
            <Field label="Split method"><select className="field" value={splitKind} onChange={event => setSplit(event.target.value as BillSplit['kind'])}>
              <option value="none">Whole bill</option><option value="equal">Equal split by guests</option><option value="items">Split by selected items</option>
            </select></Field>
            {splitKind !== 'none' && <Field label="Number of guests / groups"><input className="field" type="number" min={2} max={20} value={count} onChange={event => setCount(Number(event.target.value))} /></Field>}
            {splitKind === 'items' && Number.isInteger(count) && count >= 2 && count <= 20 && <div className="max-h-48 space-y-2 overflow-auto">
              {lines.map(line => <label key={line.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{line.quantity} × {line.item_name}</span><select className="field w-28" value={assignments[line.id] ?? 0}
                  onChange={event => assign(values => ({ ...values, [line.id]: Number(event.target.value) }))}>
                  {Array.from({ length: count }, (_, index) => <option key={index} value={index}>Group {index + 1}</option>)}
                </select>
              </label>)}
            </div>}
            {splitKind !== 'none' && <div className="text-sm text-slate-600">{shares.length
              ? shares.map((share, i) => <p className="flex justify-between" key={i}><span>Receipt {i + 1}</span><strong>{money(share / 100)}</strong></p>)
              : 'Assign items to every group or enter a valid guest count.'}</div>}
          </div> : <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Guest"><input className="field" value={name} maxLength={120} onChange={event => setName(event.target.value)} /></Field>
              <Field label="Phone"><input className="field" type="tel" value={phone} maxLength={32} onChange={event => setPhone(event.target.value)} /></Field>
            </div>
            <Field label="Find an item to add"><input className="field" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search menu" /></Field>
            {search.trim() && <div className="max-h-28 overflow-auto rounded border">
              {menu.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 10).map(item =>
                <button key={item.id} className="block w-full px-2 py-1.5 text-left text-sm hover:bg-teal-50" onClick={() => {
                  setAdded(previous => ({ ...previous, [item.id]: Math.min(99, (previous[item.id] ?? 0) + 1) })); setSearch('')
                }}>+ {item.name}</button>)}
            </div>}
            <div className="max-h-44 divide-y overflow-auto rounded border">
              {lines.map(line => <label className="flex items-center justify-between gap-2 p-2 text-sm" key={line.id}>
                <span>{line.item_name}{Boolean(line.kot_printed) && <small className="ml-1 text-teal-700">KOT sent</small>}</span>
                <input className="field w-20" aria-label={`Quantity for ${line.item_name}`} type="number" min={0} max={line.kot_printed ? line.quantity : 99}
                  value={edits[line.id] ?? line.quantity} disabled={busy}
                  onChange={event => setEdits(previous => ({ ...previous, [line.id]: event.target.value }))} />
              </label>)}
              {custom.map(item => <div className="flex items-center justify-between gap-2 p-2 text-sm" key={item.id}>
                <span>{item.custom?.name} · {money(item.custom?.price ?? 0)} · New</span>
                <button className="secondary" onClick={() => setCustom(previous => previous.filter(row => row.id !== item.id))}>Remove</button>
              </div>)}
              {pendingItems.map(item => <label className="flex items-center justify-between gap-2 p-2 text-sm" key={item.id}>
                <span>{menu.find(row => row.id === item.id)?.name} · New</span>
                <input className="field w-20" type="number" min={0} max={99} value={item.quantity} onChange={event =>
                  setAdded(previous => ({ ...previous, [item.id]: Number(event.target.value) }))} />
              </label>)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Tax pricing"><select className="field" value={inclusive === undefined ? '' : String(inclusive)} onChange={event =>
                setInclusive(event.target.value === '' ? undefined : event.target.value === 'true')}>
                <option value="">Keep recorded rates</option><option value="true">Tax Inclusive</option><option value="false">Tax Exclusive</option>
              </select></Field>
              <Field label="Discount type"><select className="field" value={discountKind} onChange={event => {
                setDiscountKind(event.target.value as typeof discountKind); setDiscount('0'); touchDiscount(true)
              }}><option value="flat">Flat amount</option><option value="percent">Percent</option></select></Field>
            </div>
            <Field label="Discount"><input className="field" type="number" min={0} step="0.01" max={discountKind === 'percent' ? 100 : undefined}
              value={discount} onChange={event => { setDiscount(event.target.value); touchDiscount(true) }} /></Field>
          </>}
          {dirty && <button className="secondary" disabled={busy} onClick={() => void save()}>Save bill edits</button>}
        </section>
        <section className="min-w-0 space-y-4 rounded-xl border bg-slate-50 p-4">
          <div><h2>Payment</h2><div className="mt-1 flex justify-between"><span>Total due</span><strong className="text-xl">{money(due/100)}</strong></div></div>
          <div className="flex flex-wrap gap-2">{(['Cash', 'UPI', 'Card', 'Room Folio'] as const).map(payment =>
            <button key={payment} className={mode === payment ? 'primary' : 'secondary'} aria-pressed={mode === payment}
              disabled={busy || (payment === 'Room Folio' && order.order_type !== 'room')} onClick={() => setMode(payment)}>
              {payment === 'UPI' ? 'UPI QR' : payment}</button>)}</div>
          {customer&&<div className="space-y-2 rounded-lg border p-2 text-xs">
            <div className="flex justify-between gap-2"><span>{customer.name} · {customer.total_visits} visits</span>
              <button className="underline" onClick={()=>setName(customer.name)}>Use Name</button></div>
            {customer.favorite_item&&<p>Favorite Dish · {customer.favorite_item}</p>}
            <p>{customer.loyalty_points.toFixed(2)} available points</p>
            <div className="flex items-end gap-2"><Field label="Redeem Points"><input className="field" type="number" min={0} max={maximum} step=".01"
              value={redeem} disabled={dirty||!confirmedPhone||maximum<=0} onChange={e=>setRedeem(e.target.value)}/></Field>
              <button className="secondary shrink-0" disabled={dirty||!confirmedPhone||maximum<=0} onClick={()=>setRedeem(maximum.toFixed(2))}>Redeem Points</button></div>
          </div>}
          {mode === 'Cash' && <>
            <Field label="Cash tendered"><input className="field" name="cash" type="number" inputMode="decimal" min={0} step="0.01"
              value={cash === '' ? (due/100).toFixed(2) : cash} onChange={event => setCash(event.target.value)} /></Field>
            <div className="flex flex-wrap gap-1.5">{[null, 500, 1000, 2000].map(amount => <button key={amount ?? 'exact'} className="secondary px-2"
              onClick={() => setCash(amount === null ? '' : String(amount))}>{amount === null ? 'Exact' : data.settings.currency_symbol + amount}</button>)}</div>
            <div className="flex justify-between text-sm font-bold text-emerald-800"><span>Change to return</span><span>{money(Number.isFinite(tender) ? Math.max(0, tender - due) / 100 : 0)}</span></div>
          </>}
          {mode === 'UPI' && <div className="text-center text-sm">
            {qr && <img className="mx-auto size-44 rounded border bg-white [image-rendering:pixelated]" src={qr} alt="Scan to pay the exact bill amount by UPI" />}
            <p className="mt-2 break-all">{data.settings.upi_id}</p><p className="text-xs text-slate-600">Confirm payment in your UPI app before completing.</p>
          </div>}
          {mode === 'Room Folio' && <p className="text-sm text-slate-600">{order.customer_name && order.customer_phone ? `Record a room charge for ${order.customer_name}.` : 'Save the guest name and phone before charging the room.'}</p>}
          {dirty && <p className="text-xs text-amber-800">Save bill edits before printing or taking payment.</p>}
          <button className="secondary w-full" disabled={busy || dirty || !shares.length}
            onClick={() => void print(() => window.servexApi.prebill(order.id, order.revision, split, redemption), false)}><Printer size={16} /> Print Pre-Bill</button>
          <button ref={completeButton} autoFocus={!completeDisabled} className="primary h-12 w-full font-bold" disabled={completeDisabled}
            onClick={() => {
              if (mode === 'Cash' && tender < due) { toast('Cash tendered must cover the bill.', true); return }
              void print(() => window.servexApi.completePayment({ orderId: order.id, revision: order.revision, mode, tendered: tender / 100, split, redeem:redemption }), true)
            }}><CreditCard size={16} /> Complete &amp; Print Receipt <kbd className="text-xs">Enter</kbd></button>
        </section>
      </div>
    </Modal>
    {pin && <ManagerPin title="Authorize bill changes" onClose={() => requestPin(false)} onVerify={save} />}
  </>
}
