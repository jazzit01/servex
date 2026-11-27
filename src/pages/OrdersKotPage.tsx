import { useState } from 'react'
import { ChefHat, Printer } from 'lucide-react'
import { runAction, usePosStore } from '../store/usePosStore'
import type { Order } from '../types/pos'

function OrderCard({ order }: { order: Order }) {
  const { data, resumeOrder } = usePosStore()
  const [mode, setMode] = useState<'Cash' | 'Card' | 'UPI'>('Cash')
  const [busy, setBusy] = useState(false)
  if (!data) return null
  const items = data.orderItems.filter(item => item.order_id === order.id)
  async function act(action: () => Promise<void>, message: string) {
    setBusy(true)
    await runAction(action, message)
    setBusy(false)
  }
  return <article className="panel p-5">
    <div className="flex items-start justify-between"><div><h2>{order.bill_number}</h2><p className="subtitle">{data.tables.find(table => table.id === order.table_id)?.label ?? 'Takeaway'}</p></div><strong>{data.settings.currency_symbol}{order.grand_total.toFixed(2)}</strong></div>
    <ul className="my-4 divide-y border-y text-sm">{items.map(item => <li className="flex justify-between gap-3 py-2" key={item.id}><span>{item.quantity} × {item.item_name}</span><span className="text-xs text-slate-500">{item.kot_printed ? 'Printed' : 'Pending'}</span></li>)}</ul>
    <div className="flex flex-wrap items-center gap-2">
      <button className="secondary mr-auto" disabled={busy || items.every(item => item.kot_printed)} onClick={() => void act(() => window.servexApi.printKot(order.id), 'Kitchen ticket printed.')}><Printer size={16} /> Print KOT</button>
      <button className="secondary" disabled={busy} onClick={() => resumeOrder(order, true)}>Checkout</button>
      <select className="field w-auto" aria-label="Payment method" value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
        <option>Cash</option><option>Card</option><option>UPI</option>
      </select>
      <button className="primary" disabled={busy} onClick={() => void act(() => window.servexApi.payOrder(order.id, mode, order.revision), 'Payment recorded.')}>Mark paid</button>
    </div>
  </article>
}
export default function OrdersKotPage() {
  const data = usePosStore(state => state.data)
  const orders = data?.orders.filter(order => order.status === 'open' || order.status === 'billed')
  return <div className="workspace"><div><h1>Orders & KOT</h1><p className="subtitle">Print kitchen tickets and record payments for open orders.</p></div>
    {orders?.length ? <div className="grid grid-cols-2 gap-4">{orders.map(order => <OrderCard key={order.id} order={order} />)}</div>
      : <div className="panel grid justify-items-center gap-2 p-14 text-center"><ChefHat className="text-teal-700" size={28} /><h2>No open orders</h2><p className="caption">Orders appear here after you save them in Quick Billing.</p></div>}
  </div>
}
