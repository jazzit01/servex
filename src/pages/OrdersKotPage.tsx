import { useEffect, useState } from 'react'
import { ChefHat, CheckCircle2, Printer, ReceiptText } from 'lucide-react'
import ManagerPin from '../components/billing/ManagerPin'
import { publishPrint } from '../components/billing/PrintPreview'
import { runAction, usePosStore } from '../store/usePosStore'
import type { KitchenTicket, Order } from '../types/pos'

export default function OrdersKotPage() {
  const { data, resumeOrder, notify } = usePosStore()
  const [tab, setTab] = useState<'kitchen' | 'past'>('kitchen')
  const [past, setPast] = useState<Order[]>([])
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [voiding, setVoiding] = useState<Order>()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])

  async function load(cursor?: number) {
    setBusy(true)
    try {
      const rows = await window.servexApi.pastBills(cursor)
      setPast(previous => cursor ? [...previous, ...rows] : rows)
      setMore(rows.length === 50)
    } catch (error) { notify((error as Error).message, true) }
    finally { setBusy(false) }
  }

  function ticketCard(ticket: KitchenTicket) {
    const order = data?.orders.find(row => row.id === ticket.order_id && ['open', 'billed'].includes(row.status))
    const elapsed = Math.max(0, Math.floor((now - Date.parse(ticket.created_at.replace(' ', 'T') + 'Z')) / 60000))
    return <article className="panel space-y-3 p-4" key={ticket.id}>
      <div className="flex items-center justify-between"><div><h2>{ticket.reference}</h2><p className="caption">KOT #{ticket.id} · {elapsed}m</p></div>
        {ticket.status === 'ready' && <CheckCircle2 size={19} className="text-emerald-700" />}</div>
      <ul className="divide-y border-y text-sm">{ticket.lines.map((item, index) => <li key={index} className="py-2">
        <p>{item.quantity} × {item.name}</p>
        {item.notes && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{item.notes}</p>}
      </li>)}</ul>
      <div className="flex flex-wrap gap-2">
        {ticket.status === 'preparing' && <button className="primary" disabled={busy} onClick={async () => {
          setBusy(true); await runAction(() => window.servexApi.readyTicket(ticket.id), 'Ticket is ready.'); setBusy(false)
        }}>Mark Ready</button>}
        <button className="secondary" disabled={busy} onClick={() => void print(() => window.servexApi.printTicket(ticket.id))}><Printer size={15} /> Reprint</button>
        {order && <button className="secondary" disabled={busy} onClick={() => resumeOrder(order)}>Open order</button>}
      </div>
    </article>
  }
  async function print(action: () => ReturnType<typeof window.servexApi.printTicket>) {
    setBusy(true)
    try { publishPrint(await action()) }
    catch (error) { notify((error as Error).message, true) }
    finally { setBusy(false) }
  }

  return <div className="workspace">
    <div><h1>Orders &amp; KOT</h1><p className="subtitle">Track kitchen tickets and look up paid bills.</p></div>
    <nav className="flex gap-2" aria-label="Order views">
      <button className={tab === 'kitchen' ? 'primary' : 'secondary'} onClick={() => setTab('kitchen')}><ChefHat size={16} /> Kitchen Queue</button>
      <button className={tab === 'past' ? 'primary' : 'secondary'} disabled={busy} onClick={() => { setTab('past'); void load() }}><ReceiptText size={16} /> Past Bills / Reprint</button>
    </nav>
    {tab === 'kitchen' ? <>
      <div className="grid grid-cols-2 gap-4">
        {(['preparing', 'ready'] as const).map(status => {
          const cards = data?.kitchen.filter(ticket => ticket.status === status) ?? []
          return <section key={status} className="min-w-0 space-y-3 rounded-xl border bg-slate-100 p-4">
            <h2>{status === 'preparing' ? 'Preparing' : 'Ready to Serve'} <span className="caption">({cards.length})</span></h2>
            {cards.length ? cards.map(ticketCard) : <p className="rounded-lg bg-white p-4 text-sm text-slate-500">No tickets.</p>}
          </section>
        })}
      </div>
      <section className="panel space-y-2 p-4"><h2>Open bills</h2>
        {data?.orders.filter(row => row.status === 'open' || row.status === 'billed').map(order => <div key={order.id} className="flex items-center justify-between gap-2 border-t pt-2 text-sm">
          <strong>{order.bill_number} · {data.tables.find(table => table.id === order.table_id)?.label ?? 'Takeaway'}</strong>
          <button className="secondary" onClick={() => resumeOrder(order, true)}>Checkout</button>
        </div>)}
      </section>
    </> : <section className="panel divide-y overflow-hidden">
      {!past.length && <p className="p-5 text-sm text-slate-500">{busy ? 'Loading bills…' : 'No paid bills.'}</p>}
      {past.map(order => <div key={order.id} className="flex items-center gap-3 px-5 py-3 text-sm">
        <div className="mr-auto"><strong>{order.bill_number}</strong><p className="caption">{order.closed_at?.slice(0, 10)} · {order.customer_name ?? order.payment_mode}</p></div>
        <strong>{data?.settings.currency_symbol}{order.grand_total.toFixed(2)}</strong>
        <button className="secondary" disabled={busy} onClick={() => void print(() => window.servexApi.reprintReceipt(order.id))}><Printer size={15} /> Reprint</button>
        <button className="secondary text-red-700" disabled={busy} onClick={() => setVoiding(order)}>Void</button>
      </div>)}
      {more && <div className="p-4"><button className="secondary" disabled={busy} onClick={() => void load(past.at(-1)?.id)}>Load older bills</button></div>}
    </section>}
    {voiding && <ManagerPin title={`Void ${voiding.bill_number}`} onClose={() => setVoiding(undefined)} onVerify={async pin => {
      const ok = await runAction(() => window.servexApi.voidReceipt(voiding.id, pin), 'Receipt voided in ServeX.')
      if (ok) setPast(rows => rows.filter(row => row.id !== voiding.id))
      return ok
    }} />}
  </div>
}
