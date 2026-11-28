import ReservationsDrawer from '../components/enterprise/ReservationsDrawer'
import { useEffect, useRef, useState } from 'react'
import { Move, Plus, Save, X } from 'lucide-react'
import LocationCard, { statusVisuals } from '../components/floor/LocationCard'
import TableActions from '../components/floor/TableActions'
import { Switch } from '../components/ManagementControls'
import { runAction, usePosStore } from '../store/usePosStore'
import { GRID, MAX_CANVAS } from '../types/floorLayout'
import BulkLocationsModal from '../components/floor/BulkLocationsModal'
import { zoneAppearance } from '../components/floor/zoneAppearance'
import type { FloorTable, LayoutRect, LayoutUpdate, LayoutZone } from '../types/pos'

function placement(locations: FloorTable[]): LayoutRect | null {
  const width = 160
  const height = 120
  const columns = Array.from({ length: Math.floor((MAX_CANVAS - width - 40) / 180) + 1 }, (_, index) => 40 + index * 180)
  for (const group of [columns.slice(0, 4), columns.slice(4)]) {
    for (let y = 40; y + height <= MAX_CANVAS; y += 160) {
      for (const x of group) {
        if (!locations.some(row => x < row.x_pos + row.width && x + width > row.x_pos && y < row.y_pos + row.height && y + height > row.y_pos)) {
          return { x_pos: x, y_pos: y, width, height }
        }
      }
    }
  }
  return null
}

export default function FloorMapPage() {
  const { data, cashier, startOrder, notify, setFloorLayoutDirty } = usePosStore()
  const [zoneId, selectZone] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionId, setActionId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, FloorTable>>({})
  const [newZones, setNewZones] = useState<LayoutZone[]>([])
  const [snapshot, setSnapshot] = useState<Record<number, LayoutRect>>({})
  const originalZone = useRef<number | null>(null)
  const [reservations,setReservations]=useState(false)
  const nextDraft = useRef(-1)
  const [clock, setClock] = useState(Date.now)
  const dirty = Object.keys(drafts).length > 0
  useEffect(() => {
    setFloorLayoutDirty(dirty)
    return () => setFloorLayoutDirty(false)
  }, [dirty, setFloorLayoutDirty])
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 10000)
    return () => clearInterval(timer)
  }, [])
  useEffect(()=>{
    const focus=()=>{
      const target=usePosStore.getState().floorTarget
      if(target!==null){setActionId(target);usePosStore.setState({floorTarget:null})}
    }
    focus()
    window.addEventListener('servex:focus-location',focus)
    return()=>window.removeEventListener('servex:focus-location',focus)
  },[])
  function discard() {
    setDrafts({})
    setNewZones([])
    setSnapshot({})
    selectZone(originalZone.current)
    setEditing(false)
    setAdding(false)
  }
  useEffect(() => {
    if (!editing || busy) return
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented || document.querySelector('dialog[open]')) return
      event.preventDefault()
      discard()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [editing, busy])
  if (!data) return null
  const allZones = [...data.zones, ...newZones.map((zone, index) => ({ ...zone, sort_order: data.zones.length + index }))]
  const zones = zoneId === null ? allZones : allZones.filter(zone => zone.id === zoneId)
  const draftRows = Object.values(drafts)
  const locations = [...data.tables.map(table => {
    const { x_pos, y_pos, width, height } = drafts[table.id] ?? snapshot[table.id] ?? table
    return { ...table, x_pos, y_pos, width, height }
  }), ...draftRows.filter(table => table.id < 0)]
  const activeOrders = new Map(data.orders.filter(order => order.table_id !== null && (order.status === 'open' || order.status === 'billed'))
    .map(order => [order.table_id, order]))
  const activeLocations = locations.filter(table => activeOrders.has(table.id))
  const current = actionId === null ? undefined : data.tables.find(table => table.id === actionId)
  const editable = cashier?.role === 'admin' || cashier?.role === 'manager'

  function changeEdit(next: boolean) {
    if (!next) { discard(); return }
    originalZone.current = zoneId
    setSnapshot(Object.fromEntries(data!.tables.map(({ id, x_pos, y_pos, width, height }) =>
      [id, { x_pos, y_pos, width, height }])))
    setEditing(true)
  }

  async function save() {
    const updates: LayoutUpdate[] = draftRows.map(row => {
      const rect = { x_pos: row.x_pos, y_pos: row.y_pos, width: row.width, height: row.height, zoneId: row.zone_id }
      return row.id > 0 ? { ...rect, id: row.id } : { ...rect, label: row.label, type: row.type, capacity: row.capacity }
    })
    setBusy(true)
    const stagedZone = newZones.find(zone => zone.id === zoneId)
    const ok = await runAction(() => window.servexApi.saveLayout(updates, newZones), 'Floor layout saved.')
    setBusy(false)
    if (ok) {
      if (stagedZone) selectZone(usePosStore.getState().data?.zones.find(zone => zone.name === stagedZone.name.normalize('NFC'))?.id ?? null)
      setDrafts({})
      setNewZones([])
      setSnapshot({})
      setEditing(false)
    }
  }

  return <div className="workspace">
    <div className="flex items-end justify-between gap-4">
      <div><h1>Floors &amp; Rooms</h1><p className="subtitle">{activeLocations.length} active · {locations.length} locations</p></div>
      {!editing&&<button className="secondary h-9" onClick={()=>setReservations(true)}>Reservations &amp; Waitlist</button>}
      {editing && <div className="flex items-center gap-2">
        <button className="secondary h-9" disabled={busy} onClick={() => setAdding(true)}><Plus size={16} /> Add Tables / Rooms</button>
        <button className="secondary h-9 border-slate-300 text-slate-700 hover:bg-rose-50 hover:text-rose-700" disabled={busy} onClick={discard}><X size={16}/> Cancel / Discard (Esc)</button>
        <button className="primary h-9" disabled={busy || !draftRows.length} onClick={() => void save()}><Save size={16} /> Save Layout</button>
      </div>}
    </div>
    <div className="panel overflow-hidden">
      <div className="flex h-14 items-center justify-between gap-3 border-b bg-white px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <nav aria-label="Floor zones" className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:thin]">
            {[{ id: null, name: 'All Zones' }, ...allZones].map((zone, index) => {
              const count = zone.id === null ? activeLocations.length : activeLocations.filter(table => table.zone_id === zone.id).length
              const appearance = 'color' in zone ? zoneAppearance(zone.name, zone.color, allZones.slice(0, index - 1)) : null
              return <button type="button" key={zone.id ?? 'all'} aria-pressed={zone.id === zoneId}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold ${zone.id === zoneId ? (appearance?.badge ?? 'bg-teal-50 text-teal-800') : 'text-slate-600 hover:bg-slate-100'}`}
                onClick={() => selectZone(zone.id)}>{appearance && <appearance.Icon size={14} className="shrink-0"/>}{zone.name}<span className="rounded-full bg-slate-100 px-1.5 text-xs" aria-label={`${count} active`}>{count}</span></button>
            })}
          </nav>
          {editable && <div className="flex shrink-0 items-center gap-1.5 border-l pl-3 text-xs font-semibold text-slate-600">
            <Move size={15} /> <span>Edit Layout</span><Switch checked={editing} onChange={changeEdit} label="Edit Layout" disabled={busy} />
          </div>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-700">
          {Object.values(statusVisuals).map(status => <span key={status.title} className="flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1">
            <span className={`size-2 rounded-full ${status.dot}`} />{status.title}</span>)}
        </div>
        <button className="primary h-9 shrink-0 whitespace-nowrap px-4" onClick={() => startOrder('parcel')}><Plus size={17} /> Quick Takeaway <kbd className="rounded bg-white/20 px-1.5 text-[11px]">F1</kbd></button>
      </div>
      {editing && <p className="border-b bg-teal-50 px-6 py-2.5 text-xs text-teal-900">Drag to move or use the corner to resize. Arrow keys move the focused card. Hold Shift to resize.</p>}
      {zones.map(zone => {
        const rows = locations.filter(table => table.zone_id === zone.id)
        const extent = editing ? 140 : 32
        const appearance = zoneAppearance(zone.name, zone.color, allZones.slice(0, allZones.findIndex(row => row.id === zone.id)))
        return <section key={zone.id} className={`border-b last:border-0 ${appearance.surface}`}>
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="flex items-center gap-2"><span className={`h-5 w-1 rounded-full ${appearance.accent}`}/><appearance.Icon size={17}/>{zone.name}</h2>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${appearance.badge}`}>{rows.length} locations</span>
          </div>
          <div data-floor-scroll className="max-h-[65vh] overflow-auto">
            <div className="relative [--floor-dot:#cbd5e1] dark:[--floor-dot:#334155]" style={{
              backgroundImage: 'radial-gradient(var(--floor-dot) 1px, transparent 1px)', backgroundSize: `${GRID}px ${GRID}px`,
              minHeight: Math.max(editing ? 420 : 200, ...rows.map(row => row.y_pos + row.height + extent)),
              minWidth: Math.max(0, ...rows.map(row => row.x_pos + row.width + extent)),
            }}>
              {rows.map(table => <LocationCard key={table.id + (editing ? '-edit' : '-live')} location={table} appearance={appearance} order={activeOrders.get(table.id)}
                editing={editing} disabled={busy} now={clock} currency={data.settings.currency_symbol}
                onClick={() => table.status === 'vacant' && !activeOrders.has(table.id)
                  ? startOrder(table.type === 'room' ? 'room' : 'dinein', table.id,data.seated.find(row=>row.table_id===table.id))
                  : setActionId(table.id)}
                onLayout={rect => setDrafts(previous => ({ ...previous, [table.id]: { ...table, ...rect } }))} />)}
              {!rows.length && <p className="p-6 text-sm text-slate-500">No locations in this zone.</p>}
            </div>
          </div>
        </section>
      })}
      {!zones.length && <p className="p-6 text-sm text-slate-500">Turn on layout editing to add a zone and its locations.</p>}
    </div>
    {reservations && <ReservationsDrawer close={()=>setReservations(false)}/>}
    {current && <TableActions key={current.id} location={current} order={activeOrders.get(current.id)} data={data} onClose={() => setActionId(null)} />}
    {adding && <BulkLocationsModal zones={allZones} locations={locations} selected={zoneId} close={() => setAdding(false)}
      place={(target, newZone, proposed) => {
        if ((newZone && newZones.length >= 30) || draftRows.length + proposed.length > 1000) return 'Save the current layout before adding more locations.'
        const targetZone = target ?? nextDraft.current--
        const occupied = locations.filter(row => row.zone_id === targetZone)
        const additions: FloorTable[] = []
        for (const row of proposed) {
          const rect = placement([...occupied, ...additions])
          if (!rect) return 'There is not enough space in this zone for all the locations.'
          additions.push({ ...row, ...rect, id: nextDraft.current--, zone_id: targetZone, status: 'vacant' })
        }
        if (newZone) setNewZones(previous => [...previous, { ...newZone, id: targetZone }])
        setDrafts(previous => ({ ...previous, ...Object.fromEntries(additions.map(row => [row.id, row])) }))
        selectZone(targetZone)
        setAdding(false)
      }}/>}
  </div>
}
