import { useState } from 'react'
import { Check, Printer } from 'lucide-react'
import { Field, Modal } from '../ManagementControls'
import { runAction } from '../../store/usePosStore'
import type { Order, OrderItem, PaymentMode } from '../../types/pos'

export default function Checkout({ order, lines, label, currency, onClose, onPaid }: {
  order: Order; lines: OrderItem[]; label: string; currency: string; onClose: () => void; onPaid: () => void
}) {
  const [mode, setMode] = useState<PaymentMode>('Cash')
  const [busy, setBusy] = useState(false)
  const [guestName, setGuestName] = useState(order.customer_name ?? '')
  const [guestCount, setGuestCount] = useState(order.guest_count === null ? '' : String(order.guest_count))
  const [quantities, setQuantities] = useState<Record<number, string>>({})
  const changed = lines.filter(line => quantities[line.id] !== undefined && Number(quantities[line.id]) !== line.quantity)
  const dirty = guestName.trim() !== (order.customer_name ?? '') ||
    (guestCount ? Number(guestCount) : null) !== order.guest_count ||
    lines.some(line => quantities[line.id] === '') || changed.length > 0
  const money = (value: number) => currency + value.toFixed(2)
  async function act(action: () => Promise<void>, message: string) {
    setBusy(true)
    const saved = await runAction(action, message)
    setBusy(false)
    return saved
  }
  return <Modal title={`Checkout · ${label}`} onClose={() => {
    if (busy || (dirty && !window.confirm('Discard unsaved bill edits?'))) return
    onClose()
  }}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault()
      if (!dirty || busy) return
      if (await act(() => window.servexApi.editBill({
        orderId: order.id, revision: order.revision, guestName,
        guestCount: guestCount ? Number(guestCount) : null,
        quantities: changed.map(line => ({ id: line.id, quantity: Number(quantities[line.id]) })),
      }), 'Bill edits saved.')) setQuantities({})
    }}>
      <div className="flex items-center justify-between text-sm"><strong>{order.bill_number}</strong>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${order.status === 'billed' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-950'}`}>
          {order.status === 'billed' ? 'Bill Printed' : 'Open order'}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_100px] gap-3">
        <Field label="Guest name"><input className="field" maxLength={120} value={guestName} disabled={busy} onChange={event => setGuestName(event.target.value)} /></Field>
        <Field label="Guests"><input className="field" type="number" min={1} max={1000} value={guestCount} disabled={busy} onChange={event => setGuestCount(event.target.value)} /></Field>
      </div>
      <div className="max-h-60 divide-y overflow-auto rounded-lg border">
        {lines.map(line => <div className="grid grid-cols-[1fr_64px_100px] items-center gap-2 px-3 py-2 text-sm" key={line.id}>
          <div><p className="font-medium">{line.item_name}</p>{Boolean(line.kot_printed) && <span className="text-xs text-slate-500">Sent to kitchen</span>}</div>
          <input type="number" min={0} max={99} required aria-label={`Quantity for ${line.item_name}`} className="field px-2"
            value={quantities[line.id] ?? line.quantity} disabled={busy || Boolean(line.kot_printed)}
            onChange={event => setQuantities(previous => ({ ...previous, [line.id]: event.target.value }))} />
          <span className="text-right">{money(line.line_total)}</span>
        </div>)}
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><strong>{money(order.subtotal)}</strong></div>
        <div className="flex justify-between"><span>Tax</span><strong>{money(order.tax_amount)}</strong></div>
        {order.discount_amount > 0 && <div className="flex justify-between"><span>Discount</span><strong>−{money(order.discount_amount)}</strong></div>}
        <div className="flex justify-between border-t pt-2 text-base"><strong>Total due</strong><strong>{money(order.grand_total)}</strong></div>
      </div>
      {dirty && <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-950">
        Save edits to update the bill total. <button className="secondary shrink-0" disabled={busy} type="submit">Save bill edits</button>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <button type="button" className="secondary" disabled={busy || dirty} onClick={() => {
          void act(() => window.servexApi.printBill(order.id, order.revision), 'Guest bill printed.')
        }}><Printer size={16} /> Print bill</button>
        <div className="flex items-center gap-2">
          <select className="field w-auto" aria-label="Payment method" disabled={busy} value={mode} onChange={event => setMode(event.target.value as PaymentMode)}>
            <option>Cash</option><option>Card</option><option>UPI</option>
          </select>
          <button type="button" className="primary" disabled={busy || dirty} onClick={async () => {
            if (await act(() => window.servexApi.payOrder(order.id, mode, order.revision), 'Payment recorded.')) onPaid()
          }}><Check size={16} /> Mark paid</button>
        </div>
      </div>
    </form>
  </Modal>
}
