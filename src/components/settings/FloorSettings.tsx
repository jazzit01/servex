import { useState } from 'react'
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { Field, Modal } from '../ManagementControls'
import { runAction, usePosStore } from '../../store/usePosStore'
import type { FloorTable, LocationInput, Zone } from '../../types/pos'

export default function FloorSettings() {
  const data = usePosStore(state => state.data)!
  const [zoneId, setZone] = useState(0)
  const [zoneEditor, setZoneEditor] = useState<Zone | 'new' | null>(null)
  const [locationEditor, setLocationEditor] = useState<FloorTable | 'bulk' | null>(null)
  const [busy, setBusy] = useState(false)
  const zone = data.zones.find(item => item.id === zoneId) ?? data.zones[0]
  const locations = data.tables.filter(item => item.zone_id === zone?.id)
  async function act(action: () => Promise<void>, message: string) {
    setBusy(true)
    const saved = await runAction(action, message)
    setBusy(false)
    if (saved) { setZoneEditor(null); setLocationEditor(null) }
  }
  const editZone = zoneEditor && zoneEditor !== 'new' ? zoneEditor : null
  const editLocation = locationEditor && locationEditor !== 'bulk' ? locationEditor : null
  return <section className="panel overflow-hidden">
    <div className="flex items-center justify-between border-b p-5">
      <div><h2 className="flex items-center gap-2"><Layers size={18} className="text-teal-700" /> Zones & locations</h2><p className="subtitle">Configure the tables, garden seating, and rooms shown on the floor map.</p></div>
      <button className="primary" disabled={busy} onClick={() => setZoneEditor('new')}><Plus size={16} /> Add zone</button>
    </div>
    <div className="flex flex-wrap gap-2 border-b p-4">{data.zones.map(item => <button className={`secondary ${zone?.id === item.id ? 'border-teal-300 bg-teal-50 text-teal-800' : ''}`} aria-pressed={item.id === zone?.id} key={item.id} onClick={() => setZone(item.id)}>{item.name}</button>)}</div>
    {zone ? <>
      <div className="flex items-center gap-2 px-5 py-4">
        <h2 className="mr-auto">{zone.name}</h2>
        <button className="secondary" disabled={busy} onClick={() => setZoneEditor(zone)}><Pencil size={15} /> Rename</button>
        <button className="secondary text-red-700" disabled={busy || locations.length > 0} onClick={() => {
          if (window.confirm(`Delete "${zone.name}"?`)) void act(() => window.servexApi.deleteZone(zone.id), 'Zone deleted.')
        }}><Trash2 size={15} /> Delete zone</button>
        <button className="primary" disabled={busy} onClick={() => setLocationEditor('bulk')}><Plus size={15} /> Add locations</button>
      </div>
      {locations.length ? <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr>{['Label', 'Type', 'Capacity', 'Status', 'Actions'].map(name => <th scope="col" key={name} className="px-5 py-3">{name}</th>)}</tr></thead>
        <tbody className="divide-y">{locations.map(location => <tr key={location.id}><th scope="row" className="px-5 py-3">{location.label}</th>
          <td className="px-5 capitalize">{location.type}</td><td className="px-5">{location.capacity}</td><td className="px-5 capitalize">{location.status}</td>
          <td className="space-x-2 px-5"><button className="secondary" disabled={busy} onClick={() => setLocationEditor(location)}>Edit</button>
            <button type="button" className="secondary text-red-700" disabled={busy || ['occupied', 'billed'].includes(location.status)} onClick={() => {
              if (window.confirm(`Delete "${location.label}"?`)) void act(() => window.servexApi.deleteLocation(location.id), 'Location deleted.')
            }}>Delete</button></td></tr>)}</tbody>
      </table> : <p className="px-5 pb-5 text-sm text-slate-500">Add locations to make this zone available for billing.</p>}
    </> : <p className="p-5 text-sm text-slate-500">Create a zone to configure its locations.</p>}
    {zoneEditor && <Modal title={editZone ? 'Rename zone' : 'Add zone'} onClose={() => { if (!busy) setZoneEditor(null) }}>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault()
        const name = String(new FormData(event.currentTarget).get('name'))
        void act(() => window.servexApi.saveZone({ id: editZone?.id, name }), 'Zone saved.')
      }}><Field label="Zone name"><input className="field" name="name" required maxLength={80} defaultValue={editZone?.name} /></Field>
        <button className="primary" disabled={busy}>Save zone</button></form>
    </Modal>}
    {locationEditor && <Modal title={editLocation ? 'Edit location' : 'Add tables, garden seating, or rooms'} onClose={() => { if (!busy) setLocationEditor(null) }}>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const labels = String(form.get('labels')).split('\n').map(item => item.trim()).filter(Boolean)
        const rows: LocationInput[] = labels.map(label => ({
          id: editLocation?.id, zoneId: Number(form.get('zone')), label,
          type: String(form.get('type')) as FloorTable['type'], capacity: Number(form.get('capacity')),
        }))
        void act(() => window.servexApi.saveLocations(rows), rows.length > 1 ? 'Locations added.' : 'Location saved.')
      }}>
        <Field label="Zone"><select className="field" name="zone" defaultValue={editLocation?.zone_id ?? zone?.id}>{data.zones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label={editLocation ? 'Label' : 'Labels (one per line)'}>{editLocation
          ? <input name="labels" className="field" required maxLength={40} defaultValue={editLocation.label} />
          : <textarea name="labels" className="field" required rows={4} placeholder={'T-01\nT-02\nT-03'} />}</Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Type"><select className="field" name="type" defaultValue={editLocation?.type ?? 'table'}>
          <option value="table">Table</option><option value="garden">Garden</option><option value="room">Room</option></select></Field>
          <Field label="Seat / guest capacity"><input className="field" name="capacity" type="number" min={1} max={100} required defaultValue={editLocation?.capacity ?? 4} /></Field></div>
        <button className="primary" disabled={busy}>Save {editLocation ? 'location' : 'locations'}</button>
      </form>
    </Modal>}
  </section>
}
