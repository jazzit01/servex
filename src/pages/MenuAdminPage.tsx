import { useState } from 'react'
import { runAction, usePosStore } from '../store/usePosStore'

export default function MenuAdminPage() {
  const { data, cashier } = usePosStore()
  const [busy, setBusy] = useState(false)
  if (!data) return null
  return <div className="workspace"><div><h1>Menu Manager</h1><p className="subtitle">Review prices and manage item availability at the till.</p></div>
    <div className="panel overflow-hidden"><table className="w-full text-left text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Item', 'Category', 'Price', 'Tax', 'Availability'].map(label => <th scope="col" key={label} className="px-5 py-3">{label}</th>)}</tr></thead>
      <tbody className="divide-y">{data.menu.map(item => <tr key={item.id}>
        <th scope="row" className="px-5 py-3 font-semibold">{item.name}</th>
        <td className="px-5 text-slate-600">{data.categories.find(category => category.id === item.category_id)?.name}</td>
        <td className="px-5">{data.settings.currency_symbol}{item.price.toFixed(2)}</td><td className="px-5">{item.tax_slab}%</td>
        <td className="px-5"><button className={`secondary ${item.is_available ? 'text-teal-700' : ''}`} aria-label={`${item.name} availability`} aria-pressed={Boolean(item.is_available)} disabled={busy || cashier?.role === 'cashier'} onClick={async () => {
          setBusy(true)
          await runAction(() => window.servexApi.toggleItem(item.id), 'Availability updated.')
          setBusy(false)
        }}>{item.is_available ? 'Available' : 'Unavailable'}</button></td>
      </tr>)}</tbody>
    </table></div>
  </div>
}
