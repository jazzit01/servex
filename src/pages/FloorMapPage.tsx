import ReservationsDrawer from '../components/enterprise/ReservationsDrawer'
import { useEffect, useRef, useState } from 'react'
import { Move, Plus, Save } from 'lucide-react'
import LocationCard, { statusVisuals } from '../components/floor/LocationCard'
import TableActions from '../components/floor/TableActions'
import { Field, Modal, Switch } from '../components/ManagementControls'
import { runAction, usePosStore } from '../store/usePosStore'
import { GRID, MAX_CANVAS } from '../types/floorLayout'
import type { FloorTable, LayoutRect, LayoutUpdate } from '../types/pos'

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
  if (!data) return null
  const zones = zoneId === null ? data.zones : data.zones.filter(zone => zone.id === zoneId)
  const draftRows = Object.values(drafts)
  const locations = [...data.tables.map(table => drafts[table.id] ?? table), ...draftRows.filter(table => table.id < 0)]
  const activeOrders = new Map(data.orders.filter(order => order.table_id !== null && (order.status === 'open' || order.status === 'billed'))
    .map(order => [order.table_id, order]))
  const activeLocations = locations.filter(table => activeOrders.has(table.id))
  const current = actionId === null ? undefined : data.tables.find(table => table.id === actionId)
  const editable = cashier?.role === 'admin' || cashier?.role === 'manager'

  function changeEdit(next: boolean) {
    if (!next && draftRows.length && !window.confirm('Discard unsaved layout changes?')) return
    if (!next) setDrafts({})
    setEditing(next)
    setAdding(false)
  }

  async function save() {
    const updates: LayoutUpdate[] = draftRows.map(row => {
      const rect = { x_pos: row.x_pos, y_pos: row.y_pos, width: row.width, height: row.height, zoneId: row.zone_id }
      return row.id > 0 ? { ...rect, id: row.id } : { ...rect, label: row.label, type: row.type, capacity: row.capacity }
    })
    setBusy(true)
    const ok = await runAction(() => window.servexApi.saveLayout(updates), 'Floor layout saved.')
    setBusy(false)
    if (ok) setDrafts({})
  }

  return <div className="workspace">
    <div className="flex items-end justify-between gap-4">
      <div><h1>Floors &amp; Rooms</h1><p className="subtitle">{activeLocations.length} active · {locations.length} locations</p></div>
      {!editing&&<button className="secondary h-9" onClick={()=>setReservations(true)}>Reservations &amp; Waitlist</button>}
      {editing && <div className="flex items-center gap-2">
        <button className="secondary h-9" disabled={busy || !data.zones.length} onClick={() => setAdding(true)}><Plus size={16} /> Add Table / Room</button>
        <button className="primary h-9" disabled={busy || !draftRows.length} onClick={() => void save()}><Save size={16} /> Save Layout</button>
      </div>}
    </div>
    <div className="panel overflow-hidden">
      <div className="flex h-14 items-center justify-between gap-3 border-b bg-white px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <nav aria-label="Floor zones" className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:thin]">
            {[{ id: null, name: 'All Zones' }, ...data.zones].map(zone => {
              const count = zone.id === null ? activeLocations.length : activeLocations.filter(table => table.zone_id === zone.id).length
              return <button type="button" key={zone.id ?? 'all'} aria-pressed={zone.id === zoneId}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold ${zone.id === zoneId ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100'}`}
                onClick={() => selectZone(zone.id)}>{zone.name}<span className="rounded-full bg-slate-100 px-1.5 text-xs" aria-label={`${count} active`}>{count}</span></button>
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
        return <section key={zone.id} className="border-b last:border-0">
          <div className="flex items-center justify-between border-b bg-white px-5 py-3"><h2>{zone.name}</h2><span className="caption">{rows.length} locations</span></div>
          <div data-floor-scroll className="max-h-[65vh] overflow-auto bg-slate-50">
            <div className="relative" style={{
              backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: `${GRID}px ${GRID}px`,
              minHeight: Math.max(editing ? 420 : 200, ...rows.map(row => row.y_pos + row.height + extent)),
              minWidth: Math.max(0, ...rows.map(row => row.x_pos + row.width + extent)),
            }}>
              {rows.map(table => <LocationCard key={table.id} location={table} order={activeOrders.get(table.id)}
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
      {!zones.length && <p className="p-6 text-sm text-slate-500">Create a zone in Settings to start placing locations.</p>}
    </div>
    {reservations && <ReservationsDrawer close={()=>setReservations(false)}/>}
    {current && <TableActions key={current.id} location={current} order={activeOrders.get(current.id)} data={data} onClose={() => setActionId(null)} />}
    {adding && <Modal compact title="Add Table / Room" onClose={() => setAdding(false)}>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault()
        const values = new FormData(event.currentTarget)
        const targetZone = Number(values.get('zone'))
        const label = String(values.get('label')).trim()
        const rows = locations.filter(table => table.zone_id === targetZone)
        const key = (name: string) => name.normalize('NFC').trim().toLowerCase()
        if (!label || rows.some(row => key(row.label) === key(label))) { notify('Enter a unique location label for the zone.', true); return }
        const rect = placement(rows)
        if (!rect) { notify('There is no room to place another location in this zone.', true); return }
        const id = nextDraft.current--
        const table: FloorTable = { ...rect, id, zone_id: targetZone, label, status: 'vacant',
          type: String(values.get('type')) as FloorTable['type'], capacity: Number(values.get('capacity')) }
        setDrafts(previous => ({ ...previous, [id]: table }))
        selectZone(targetZone)
        setAdding(false)
      }}>
        <Field label="Zone"><select name="zone" className="field" defaultValue={zoneId ?? data.zones[0]?.id}>
          {data.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></Field>
        <Field label="Location label"><input name="label" className="field" required maxLength={40} placeholder="Room 101" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><select className="field" name="type"><option value="table">Table</option><option value="garden">Garden</option><option value="room">Room</option></select></Field>
          <Field label="Capacity"><input className="field" name="capacity" type="number" min={1} max={100} required defaultValue={4} /></Field>
        </div>
        <button className="primary"><Plus size={16} /> Place on map</button>
      </form>
    </Modal>}
  </div>
}
