import Expenses from '../components/enterprise/Expenses'
import { useEffect, useState } from 'react'
import { ArrowLeft, BarChart3, CalendarDays, Download, ReceiptText, ShieldCheck } from 'lucide-react'
import { Field, Modal } from '../components/ManagementControls'
import { publishPrint } from '../components/billing/PrintPreview'
import { runAction, usePosStore } from '../store/usePosStore'
import type { Analytics, AuditEntry, DateRange, PrintResult, ZState } from '../types/pos'

const denominations = [2000, 500, 200, 100, 50, 20, 10]

function AnalyticsView({ report, money }: { report: Analytics; money: (amount: number) => string }) {
  const cards = [
    ['Net Sales', money(report.sales), 'Includes tax, less recorded reversals'],
    ['Total Orders', String(report.count), `Dine-In ${report.orders.dinein} · Parcel ${report.orders.parcel} · Room ${report.orders.room}`],
    ['Average Order Value', money(report.average), 'Net sales per order'],
    ['Total Tax Collected', money(report.tax), `CGST ${money(report.cgst)} · SGST ${money(report.sgst)}`],
  ]
  const max = Math.max(1, ...report.trend.map(row => Math.abs(row.amount)))
  const negatives = report.trend.some(row => row.amount < 0)
  const baseline = negatives ? 117 : 212
  const scale = negatives ? 100 : 196
  const band = 468 / report.trend.length
  return <>
    <div className="grid grid-cols-4 gap-4">{cards.map(([label, value, detail]) => <div className="panel p-4 tabular-nums" key={label}>
      <div className="caption">{label}</div><div className="mt-2 text-2xl font-bold">{value}</div><div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>)}</div>
    <div className="grid grid-cols-2 items-start gap-4">
      <section className="panel p-5"><h2>{report.trend.length === 24 && report.trend[0]?.label.includes(':') ? 'Hourly Sales' : 'Revenue Trend'}</h2>
        <svg viewBox="0 0 496 250" role="img" aria-label="Net sales over the selected period" className="mt-3 w-full">
          <line x1="12" x2="480" y1={baseline} y2={baseline} stroke="#cbd5e1" />
          {report.trend.map((row, i) => {
            const height = Math.abs(row.amount) / max * scale
            return <g key={row.label}>
              <rect x={12 + i * band + band * .12} y={row.amount < 0 ? baseline : baseline - height}
                width={band * .76} height={Math.max(height, .5)} rx={Math.min(2, band / 4)} fill={row.amount < 0 ? '#e11d48' : '#0d9488'}>
                <title>{row.label} · {money(row.amount)}</title></rect>
              {(i === 0 || i === report.trend.length - 1 || (report.trend.length >= 12 && i % Math.ceil(report.trend.length / 5) === 0)) &&
                <text x={12 + i * band + band / 2} y="242" textAnchor={i === 0 ? 'start' : i === report.trend.length - 1 ? 'end' : 'middle'}
                  fontSize="10" fill="#475569">{row.label.includes(':') ? row.label : row.label.slice(5)}</text>}
            </g>
          })}
        </svg>
      </section>
      <section className="panel overflow-hidden">
        <div className="p-4"><h2>Top Selling Items</h2></div>
        <table className="w-full text-left text-sm tabular-nums"><thead className="bg-slate-50 text-xs text-slate-600"><tr>
          <th className="px-4 py-2">Item Name</th><th className="px-4 py-2 text-right">Qty Sold</th><th className="px-4 py-2 text-right">Revenue</th>
        </tr></thead><tbody className="divide-y">{report.items.map(row => <tr key={row.name}><td className="px-4 py-2">{row.name}</td>
          <td className="px-4 text-right">{row.qty}</td><td className="px-4 text-right">{money(row.amount)}</td></tr>)}</tbody></table>
        {!report.items.length && <p className="p-4 text-sm text-slate-500">No items sold in this period.</p>}
        <div className="border-t p-4"><h2>Payment Mode Split</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(report.payments).map(([mode, amount]) => <div key={mode} className="flex justify-between rounded-lg bg-slate-50 p-2 text-sm">
            <span>{mode}</span><strong>{money(amount)}</strong></div>)}</div>
        </div>
      </section>
    </div>
  </>
}

function ZClose({ z, reload, money }: { z: ZState; reload: () => Promise<void>; money: (value: number) => string }) {
  const { cashier, notify } = usePosStore()
  const [opening, setOpening] = useState('')
  const [counts, setCounts] = useState(denominations.map(() => ''))
  const [coins, setCoins] = useState('')
  const [pin, setPin] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [needsPassphrase, setNeedsPassphrase] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const counted = counts.reduce((sum, count, i) => sum + Number(count) * denominations[i] * 100, Math.round(Number(coins) * 100)) / 100
  const expected = (Math.round(Number(opening) * 100) + Math.round(z.cashSales * 100) - Math.round(z.refunds * 100) - Math.round((z.cashExpenses??0)*100)) / 100
  const variance = z.report?.variance ?? Math.round((counted - expected) * 100) / 100
  const requiresPin = !z.report && cashier?.role === 'cashier'
  async function submitClose() {
    setBusy(true)
    let result: PrintResult | undefined
    const ok = await runAction(async () => {
      result = await window.servexApi.closeDay({ opening: Number(opening), counts: counts.map(Number), coins: Number(coins),
        pin: pin || undefined, backupPassphrase: passphrase || undefined })
      await reload()
    }, z.report ? 'Saved Z-report prepared.' : 'Day closed.')
    setPin(''); setPassphrase(''); setBusy(false); setConfirmClose(false)
    if (ok && result) { setNeedsPassphrase(false); publishPrint(result) }
    else if (usePosStore.getState().toast?.message.includes('Enter a backup passphrase')) setNeedsPassphrase(true)
  }
  return <><form onSubmit={event => {
    event.preventDefault()
    if (z.report) void submitClose()
    else setConfirmClose(true)
  }} className="grid grid-cols-2 items-start gap-4">
    <section className="panel space-y-4 p-5"><h2>Cash Reconciliation · {z.day}</h2>
      <Field label="Opening float"><input className="field" type="number" min={0} step="0.01" disabled={Boolean(z.report) || z.legacyClosed}
        value={z.report?.opening ?? opening} onChange={event => setOpening(event.target.value)} placeholder="0.00" /></Field>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between"><dt>Cash sales</dt><dd>{money(z.report?.cashSales ?? z.cashSales)}</dd></div>
        <div className="flex justify-between"><dt>Cash refunds</dt><dd>{money(z.report?.refunds ?? z.refunds)}</dd></div>
        <div className="flex justify-between"><dt>Cash expenses</dt><dd>{money(z.report?.cashExpenses??z.cashExpenses??0)}</dd></div>
        <div className="flex justify-between border-t pt-2 font-bold"><dt>Expected Cash in Drawer</dt><dd>{money(z.report?.expected ?? expected)}</dd></div>
        <div className="flex justify-between font-bold"><dt>Actual Cash Counted</dt><dd>{money(z.report?.actual ?? counted)}</dd></div>
        <div className={`flex justify-between rounded-lg p-3 font-bold ${variance < 0 ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
          <dt>{variance < 0 ? 'Short variance' : variance > 0 ? 'Over variance' : 'Balanced'}</dt><dd>{money(variance)}</dd></div>
      </dl>
      {z.report && <p className="text-sm text-slate-500">Closed by {z.report.actor}. This record is read-only.</p>}
      {!z.report && z.legacyClosed && <p className="text-sm text-slate-500">This day was closed before Z-report snapshots were available.</p>}
    </section>
    <section className="panel space-y-3 p-5"><h2>Denomination Counts</h2><div className="grid grid-cols-4 gap-2">
      {denominations.map((denomination, index) => <Field key={denomination} label={`₹${denomination}`}>
        <input className="field" type="number" min={0} max={100000} step="1" placeholder="0" disabled={Boolean(z.report) || z.legacyClosed}
          value={z.report?.counts[index] ?? counts[index]} onChange={event => setCounts(previous => previous.map((value, i) => i === index ? event.target.value : value))} />
      </Field>)}
      <Field label="Coins (₹ value)"><input className="field" type="number" min={0} step=".01" placeholder="0.00" disabled={Boolean(z.report) || z.legacyClosed}
        value={z.report?.coins ?? coins} onChange={event => setCoins(event.target.value)} /></Field>
    </div>
      {requiresPin && <Field label="Manager override PIN"><input className="field" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" maxLength={4} required
        value={pin} onChange={event => setPin(event.target.value)} /></Field>}
      {needsPassphrase && <Field label="Encrypted snapshot passphrase"><input className="field" type="password" autoComplete="off" minLength={12} maxLength={256} required
        value={passphrase} onChange={event => setPassphrase(event.target.value)} /></Field>}
      <button className="primary h-11" disabled={busy || (!z.report && z.legacyClosed)}><ReceiptText size={17} /> {z.report ? 'Reprint Z-Report / Retry Backup' : 'Close Day & Print Z-Report'}</button>
      <p className="text-xs text-slate-500">Settle open orders before closing. ServeX saves an encrypted snapshot after close.</p>
    </section>
  </form>
  {confirmClose && <Modal compact title="Confirm Z-Close" onClose={() => setConfirmClose(false)} dismissDisabled={busy}>
    <p className="mb-3 text-sm text-slate-600">Close {z.day} with {money(counted)} counted and a {money(variance)} variance? Closing saves the reconciliation and stops new orders for this day.</p>
    <button className="primary" disabled={busy} onClick={() => void submitClose()}>Confirm and Print Z-Report</button>
  </Modal>}
  </>
}

export default function ReportsPage() {
  const { data, cashier, notify } = usePosStore()
  const today = data?.businessDate ?? ''
  const [range, setRange] = useState<DateRange>({ from: today, to: today })
  const [active, setActive] = useState(range)
  const [tab, setTab] = useState<'analytics' | 'close' | 'audit' | 'expenses'>(()=>usePosStore.getState().reportTab)
  useEffect(()=>{
    function closeDay(){setTab('close')}
    window.addEventListener('servex:open-z-close',closeDay)
    return()=>window.removeEventListener('servex:open-z-close',closeDay)
  },[])
  const [analytics, setAnalytics] = useState<Analytics>()
  const [z, setZ] = useState<ZState>()
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [action, setAction] = useState('')
  const [auditBusy, setAuditBusy] = useState(false)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!active.from || !active.to) return
    let current = true
    setError('')
    if (tab === 'analytics') {
      setAnalytics(undefined)
      void window.servexApi.analytics(active).then(value => { if (current) setAnalytics(value) })
        .catch(cause => { if (current) setError(cause.message) })
    } else if (tab === 'close') {
      void window.servexApi.getZReport().then(value => { if (current) setZ(value) }).catch(cause => { if (current) setError(cause.message) })
    } else if(tab==='audit') {
      setAudit([])
      setMore(false)
      setAuditBusy(true)
      void window.servexApi.auditEntries({ ...active, action }).then(rows => {
        if (current) { setAudit(rows); setMore(rows.length === 100) }
      }).catch(cause => { if (current) setError(cause.message) }).finally(() => { if (current) setAuditBusy(false) })
    }
    return () => { current = false }
  }, [active, action, tab, data?.businessDate])
  const money = (value: number) => (data?.settings.currency_symbol ?? '₹') + value.toFixed(2)
  async function older() {
    setAuditBusy(true)
    try {
      const rows = await window.servexApi.auditEntries({ ...active, action, before: audit.at(-1)?.id })
      setAudit(previous => [...previous, ...rows]); setMore(rows.length === 100)
    } catch (cause) { notify((cause as Error).message, true) } finally { setAuditBusy(false) }
  }
  return <div className="workspace tabular-nums">
    <div className="flex items-end justify-between gap-4"><div><h1>Reports &amp; Z-Close</h1><p className="subtitle">Sales, cash reconciliation, and sensitive activity.</p></div></div>
    <div className="flex flex-wrap gap-2">
      <button className={tab === 'analytics' ? 'primary' : 'secondary'} onClick={() => setTab('analytics')}><BarChart3 size={16} /> Analytics</button>
      <button className={tab === 'expenses' ? 'primary' : 'secondary'} onClick={()=>setTab('expenses')}>Expenses / Petty Cash</button>
      <button className={tab === 'close' ? 'primary' : 'secondary'} onClick={() => setTab('close')}><ReceiptText size={16} /> Z-Close</button>
      {cashier?.role !== 'cashier' && <button className={tab === 'audit' ? 'primary' : 'secondary'} onClick={() => setTab('audit')}><ShieldCheck size={16} /> Audit Logs</button>}
    </div>
    {tab !== 'analytics' && <button className="secondary h-10" onClick={() => setTab('analytics')}><ArrowLeft size={16} /> Back to Analytics</button>}
    {(tab === 'analytics' || tab === 'audit') && <form className="panel flex flex-wrap items-end gap-3 p-3" onSubmit={event => { event.preventDefault(); setActive({ ...range }) }}>
      <Field label="From"><input className="field" type="date" required value={range.from} onChange={event => setRange({ ...range, from: event.target.value })} /></Field>
      <Field label="To"><input className="field" type="date" required value={range.to} onChange={event => setRange({ ...range, to: event.target.value })} /></Field>
      <button className="primary"><CalendarDays size={16} /> Apply Range</button>
      <button className="secondary" type="button" onClick={() => { const next = { from: today, to: today }; setRange(next); setActive(next) }}>Today</button>
      <button className="secondary" type="button" onClick={() => {
        const next = { from: new Date(Date.parse(today + 'T00:00Z') - 6 * 86400000).toISOString().slice(0, 10), to: today }
        setRange(next); setActive(next)
      }}>7 Days</button>
    </form>}
    {error && <p className="panel p-4 text-sm text-red-800" role="alert">{error}</p>}
    {tab === 'analytics' && (analytics ? <AnalyticsView report={analytics} money={money} /> : !error && <p className="caption">Loading sales…</p>)}
    {tab === 'close' && (z ? <ZClose z={z} reload={async () => setZ(await window.servexApi.getZReport())} money={money} /> : !error && <p className="caption">Loading drawer figures…</p>)}
    {tab === 'expenses' && <Expenses/>}
    {tab === 'audit' && <section className="panel overflow-hidden">
      <div className="flex items-end justify-between p-4"><Field label="Action"><select className="field" value={action} disabled={auditBusy} onChange={event => setAction(event.target.value)}>
        <option value="">All recorded actions</option>{['VOID_KOT_ITEM','BILL_VOID','HIGH_DISCOUNT','TABLE_MERGE','TABLE_TRANSFER','Z_CLOSE','MOBILE_ORDER'].map(value => <option key={value}>{value}</option>)}
      </select></Field><button className="secondary" disabled={auditBusy} onClick={() => void runAction(() => window.servexApi.exportAudit({ ...active, action }), 'Audit CSV saved.')}>
        <Download size={16} /> Export CSV for Excel</button></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs"><tr>{['Timestamp','Staff','Action','Details'].map(label =>
        <th className="px-4 py-2" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y">{audit.map(row => <tr key={row.id}>
        <td className="whitespace-nowrap px-4 py-2">{new Date(row.timestamp.replace(' ', 'T') + 'Z').toLocaleString()}</td>
        <td className="px-4">{row.actor}</td><td className="px-4 font-semibold">{row.action}</td><td className="break-all px-4">{row.details ?? '—'}</td>
      </tr>)}</tbody></table></div>
      {!audit.length && <p className="p-4 text-sm text-slate-500">{auditBusy ? 'Loading audit logs…' : 'No matching entries.'}</p>}
      {more && <button className="secondary m-4" disabled={auditBusy} onClick={() => void older()}>Load older entries</button>}
    </section>}
  </div>
}
