import { useState } from 'react'
import { Armchair, BedDouble, ChefHat, CircleCheck, LayoutGrid, Leaf, Users } from 'lucide-react'
import { usePosStore } from '../store/usePosStore'
import type { TableStatus } from '../types/pos'

const statuses: Record<TableStatus, { label: string; style: string; dot: string }> = {
  vacant: { label: 'Vacant', style: 'border-teal-200 bg-white text-teal-800 hover:border-teal-500', dot: 'bg-teal-500' },
  occupied: { label: 'Occupied', style: 'border-amber-200 bg-amber-50 text-amber-900', dot: 'bg-amber-500' },
  billed: { label: 'Billed', style: 'border-blue-200 bg-blue-50 text-blue-900', dot: 'bg-blue-500' },
  cleaning: { label: 'Cleaning', style: 'border-slate-200 bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
}
export default function FloorMapPage() {
  const { data, startOrder, navigate } = usePosStore()
  const [activeZone, setActiveZone] = useState<number>()
  if (!data) return null
  const zone = data.zones.find(item => item.id === activeZone) ?? data.zones[0]
  const tables = data.tables.filter(table => table.zone_id === zone?.id)
  const stats = [
    { label: 'Tables & rooms', value: data.tables.length, icon: LayoutGrid, color: 'bg-slate-100 text-slate-600' },
    { label: 'Available', value: data.tables.filter(table => table.status === 'vacant').length, icon: CircleCheck, color: 'bg-teal-50 text-teal-700' },
    { label: 'Occupied', value: data.tables.filter(table => table.status === 'occupied').length, icon: Users, color: 'bg-amber-50 text-amber-700' },
    { label: 'Open orders', value: data.orders.filter(order => order.status === 'open' || order.status === 'billed').length, icon: ChefHat, color: 'bg-blue-50 text-blue-700' },
  ]
  return <div className="workspace">
    <div><h1>Floors & Rooms</h1><p className="subtitle">Select an available table or room to start a bill.</p></div>
    <div className="grid grid-cols-4 gap-4">
      {stats.map(({ label, value, icon: Icon, color }) => <div key={label} className="panel flex items-center gap-4 p-4"><span className={`grid size-11 place-items-center rounded-xl ${color}`}><Icon size={21} strokeWidth={1.75} /></span><div><div className="text-xs font-medium text-slate-500">{label}</div><div className="text-2xl font-bold">{value}</div></div></div>)}
    </div>
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4"><div className="flex gap-2" aria-label="Zones">
        {data.zones.map(item => <button key={item.id} className={`rounded-lg px-4 py-2 text-sm font-semibold ${zone?.id === item.id ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100'}`} aria-pressed={zone?.id === item.id} onClick={() => setActiveZone(item.id)}>{item.name}</button>)}
      </div><div className="flex gap-4 text-xs text-slate-500">{Object.entries(statuses).map(([key, status]) => <span key={key} className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${status.dot}`} />{status.label}</span>)}</div></div>
      <div className="relative min-h-[355px] overflow-auto bg-slate-50/70" style={{ backgroundImage: 'radial-gradient(#dbe3eb 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        <div className="relative" style={{ minHeight: Math.max(355, ...tables.map(t => t.y_pos + t.height + 40)), minWidth: Math.max(0, ...tables.map(t => t.x_pos + t.width + 40)) }}>
          {tables.map(table => {
            const status = statuses[table.status]
            const Icon = table.type === 'room' ? BedDouble : table.type === 'garden' ? Leaf : Armchair
            return <button key={table.id} style={{ left: table.x_pos, top: table.y_pos, width: table.width, height: table.height }}
              className={`absolute grid content-center justify-items-center gap-1 rounded-xl border shadow-sm ${status.style}`}
              disabled={table.status === 'cleaning'} aria-label={`${table.label}, ${status.label}`} onClick={() => table.status === 'vacant' ? startOrder(table.type === 'room' ? 'room' : 'dinein', table.id) : navigate('orders')}>
              <Icon size={22} strokeWidth={1.75} /><strong className="text-sm">{table.label}</strong><span className="text-xs opacity-80">{table.capacity} {table.type === 'room' ? 'guests' : 'seats'}</span>
            </button>
          })}
          {!tables.length && <p className="p-6 text-sm text-slate-500">No tables or rooms in this zone.</p>}
        </div>
      </div>
      <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-slate-500"><span>{zone?.name}</span><span>{tables.length} locations in this zone</span></div>
    </section>
  </div>
}
