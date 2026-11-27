import { useState } from 'react'
import { runAction, usePosStore } from '../store/usePosStore'

export default function ReportsPage() {
  const { data, cashier } = usePosStore()
  const [busy, setBusy] = useState(false)
  const [overridePin, setOverridePin] = useState('')
  if (!data) return null
  const paid = data.orders.filter(order => order.status === 'paid')
  const money = (value: number) => data.settings.currency_symbol + value.toFixed(2)
  const stats = [
    { label: 'Net sales including tax', value: money(paid.reduce((total, order) => total + order.grand_total, 0)) },
    { label: 'Tax collected', value: money(paid.reduce((total, order) => total + order.tax_amount, 0)) },
    { label: 'Paid orders', value: paid.length },
  ]
  return <div className="workspace"><div><h1>Reports & Z-Close</h1><p className="subtitle">Paid orders for {data.businessDate}.</p></div>
    <div className="grid grid-cols-3 gap-4">{stats.map(({ label, value }) => <div className="panel p-5" key={label}><div className="caption">{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>)}</div>
    <section className="panel p-5"><h2>Payment breakdown</h2><ul className="mt-3 divide-y">{['Cash', 'Card', 'UPI'].map(mode => <li className="flex justify-between py-3 text-sm" key={mode}><span>{mode}</span><strong>{money(paid.filter(order => order.payment_mode === mode).reduce((total, order) => total + order.grand_total, 0))}</strong></li>)}</ul></section>
    <section className="panel flex items-center justify-between p-5"><div><h2>Close business day</h2><p className="subtitle">{data.lastClose ? 'Today’s close has been recorded.' : 'Settle open orders before recording the daily close.'}</p></div>
      <div className="flex items-center gap-2">
      {cashier?.role === 'cashier' && !data.lastClose && <input className="field w-44" aria-label="Manager override PIN"
        placeholder="Manager override PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={4}
        value={overridePin} onChange={event => setOverridePin(event.target.value)} />}
      <button className="primary" disabled={busy || Boolean(data.lastClose) || (cashier?.role === 'cashier' && !/^\d{4}$/.test(overridePin))} onClick={async () => {
        setBusy(true)
        await runAction(() => window.servexApi.closeDay(overridePin || undefined), 'Business day closed.')
        setOverridePin('')
        setBusy(false)
      }}>Record Z-close</button></div>
    </section>
  </div>
}
