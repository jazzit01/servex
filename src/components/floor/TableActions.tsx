import { useEffect, useState } from 'react'
import { ArrowLeftRight, CheckCircle2, Combine, Printer, ReceiptText } from 'lucide-react'
import { Field, Modal } from '../ManagementControls'
import { runAction, usePosStore } from '../../store/usePosStore'
import type { FloorTable, Order, Snapshot } from '../../types/pos'
import { statusVisuals } from './LocationCard'

export default function TableActions({ location, order, data, onClose }: {
  location: FloorTable; order?: Order; data: Snapshot; onClose: () => void
}) {
  const resume = usePosStore(state => state.resumeOrder)
  const [action, setAction] = useState<'transfer' | 'merge' | null>(null)
  const [busy, setBusy] = useState(false)
  const active = data.orders.filter(row => row.status === 'open' || row.status === 'billed')
  const byLocation = new Map(active.map(row => [row.table_id, row]))
  const zones = new Map(data.zones.map(zone => [zone.id, zone.name]))
  const vacant = data.tables.filter(table => table.status === 'vacant' && !byLocation.has(table.id) && !data.seated.some(row=>row.table_id===table.id))
  const sources = data.tables.filter(table => table.id !== location.id && table.status === 'occupied' && byLocation.get(table.id)?.status === 'open')
  const choices = action === 'transfer' ? vacant : sources
  const checkoutAllowed = Boolean(order && !action && !busy)
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key !== 'F4' || event.repeat || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || !checkoutAllowed || !order) return
      event.preventDefault()
      resume(order, true)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [checkoutAllowed, order, resume])

  async function act(work: () => Promise<void>, message: string) {
    setBusy(true)
    const ok = await runAction(work, message)
    setBusy(false)
    if (ok) onClose()
  }

  return <Modal compact title={location.label} onClose={() => { if (!busy) onClose() }}>
    <div className="space-y-4">
      <div className="rounded-lg border bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2 text-sm font-semibold">
          <span className="flex items-center gap-2"><span className={`size-2.5 rounded-full ${statusVisuals[location.status].dot}`} />{statusVisuals[location.status].title}</span>
          <span>{zones.get(location.zone_id)}</span>
        </div>
        {order && <p className="mt-2 text-sm text-slate-600">{order.bill_number} · {data.settings.currency_symbol}{order.grand_total.toFixed(2)}
          {order.customer_name && ` · ${order.customer_name}`}{order.guest_count !== null && ` · ${order.guest_count} guests`}</p>}
      </div>
      {location.status === 'cleaning' && <button className="primary w-full" disabled={busy} onClick={() => void act(
        () => window.servexApi.updateStatus({ tableId: location.id, status: 'vacant' }), 'Location is clean and available.',
      )}><CheckCircle2 size={17} /> Mark Clean &amp; Available</button>}
      {order && !action && <>
        <button className="secondary w-full justify-start" disabled={busy} onClick={() => resume(order)}><ReceiptText size={17} /> Open / Add Items</button>
        <button className="secondary w-full justify-start" disabled={busy || !vacant.length} onClick={() => setAction('transfer')}><ArrowLeftRight size={17} /> Transfer Table / Room</button>
        <button className="secondary w-full justify-start" disabled={busy || !sources.length} onClick={() => setAction('merge')}><Combine size={17} /> Merge Tables</button>
        <button className="primary w-full" disabled={busy} onClick={() => resume(order, true)}><Printer size={17} /> Checkout / Print Bill <kbd className="rounded bg-white/20 px-1.5 text-xs">F4</kbd></button>
      </>}
      {order && action && <form className="space-y-3" onSubmit={event => {
        event.preventDefault()
        const id = Number(new FormData(event.currentTarget).get('location'))
        if (action === 'transfer') {
          void act(() => window.servexApi.transfer({ orderId: order.id, fromTableId: location.id, toTableId: id }), 'Order transferred.')
        } else {
          const source = byLocation.get(id)
          if (source) void act(() => window.servexApi.merge({ targetOrderId: order.id, sourceOrderId: source.id, sourceTableId: id }), 'Orders merged.')
        }
      }}>
        <Field label={action === 'transfer' ? 'Move to a vacant location' : `Add another order to ${location.label}`}>
          <select className="field" name="location" required defaultValue="" disabled={busy}>
            <option value="" disabled>Select a location</option>
            {choices.map(table => <option key={table.id} value={table.id}>{zones.get(table.zone_id)} · {table.label}</option>)}
          </select>
        </Field>
        {action === 'merge' && <p className="text-sm text-slate-600">The source location becomes available. Its items move to this order.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="secondary" disabled={busy} onClick={() => setAction(null)}>Back</button>
          <button className="primary" disabled={busy || !choices.length}>{action === 'transfer' ? 'Transfer order' : 'Merge orders'}</button>
        </div>
      </form>}
      {!order && location.status !== 'cleaning' && <p className="text-sm text-slate-600">There is no active order at this location.</p>}
    </div>
  </Modal>
}
