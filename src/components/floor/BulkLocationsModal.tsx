import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Field, Modal } from '../ManagementControls'
import { zoneColors, type FloorTable, type Zone, type ZoneColor } from '../../types/pos'
import { nextLocationLabels, zoneAppearance, zoneThemes } from './zoneAppearance'

type LocationDraft = Pick<FloorTable, 'label' | 'capacity' | 'type'>
type ZoneDraft = { name: string; color: ZoneColor }

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return <div role="group" aria-label={label} className="inline-flex items-center gap-2 tabular-nums">
    <button type="button" className="secondary p-1.5" aria-label={`Decrease ${label}`} disabled={value <= 1} onClick={() => onChange(value - 1)}><Minus size={14}/></button>
    <output className="w-5 text-center text-sm font-semibold">{value}</output>
    <button type="button" className="secondary p-1.5" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus size={14}/></button>
  </div>
}

export default function BulkLocationsModal({ zones, locations, selected, close, place }: {
  zones: Zone[]; locations: FloorTable[]; selected: number | null; close: () => void
  place: (zoneId: number | null, zone: ZoneDraft | null, locations: LocationDraft[]) => string | undefined
}) {
  const [selection, select] = useState<number | null>(selected ?? zones[0]?.id ?? null)
  const [name, setName] = useState('')
  const [color, setColor] = useState<ZoneColor | null>(null)
  const [count, setCount] = useState(4)
  const [seats, setSeats] = useState(4)
  const [type, setType] = useState<FloorTable['type']>()
  const [capacities, setCapacities] = useState<Record<number, number>>({})
  const [labels, setLabels] = useState<Record<number, string>>({})
  const [error, setError] = useState('')
  const index = zones.findIndex(zone => zone.id === selection)
  const zone = zones[index]
  const appearance = zoneAppearance(zone?.name ?? name, zone?.color ?? color, index < 0 ? zones : zones.slice(0, index))
  const kind = type ?? appearance.type
  const existing = locations.filter(row => row.zone_id === selection)
  const preview = nextLocationLabels(existing, appearance.prefix, count, kind).map((label, i) => ({
    label: labels[i] ?? label, capacity: capacities[i] ?? seats, type: kind,
  }))

  return <Modal title="Add Tables / Rooms" onClose={close}>
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault()
      const key = (value: string) => value.normalize('NFC').trim().toLowerCase()
      if (!zone && (!name.trim() || zones.some(row => key(row.name) === key(name)))) {
        setError('Enter a unique zone name.'); return
      }
      const used = new Set(existing.map(row => key(row.label)))
      for (const row of preview) {
        const label = key(row.label)
        if (!label || used.has(label)) { setError('Enter a unique label for every location in the zone.'); return }
        used.add(label)
      }
      const failure = place(zone?.id ?? null, zone ? null : { name: name.trim(), color: appearance.color }, preview)
      if (failure) setError(failure)
    }}>
      <Field label="Select Zone"><select className="field" value={selection ?? 'new'} onChange={event => {
        select(event.target.value === 'new' ? null : Number(event.target.value))
        setType(undefined); setLabels({}); setError('')
      }}>
        {zones.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        <option value="new">+ New Zone</option>
      </select></Field>
      {!zone && <div className="space-y-2 rounded-lg border bg-slate-50 p-3">
        <Field label="Zone name"><input className="field" required maxLength={80} value={name} onChange={event => { setName(event.target.value); setLabels({}) }}/></Field>
        <div role="group" aria-label="Zone color" className="flex flex-wrap gap-2">
          {zoneColors.map(swatch => <button key={swatch} type="button" aria-label={swatch} title={swatch}
            aria-pressed={appearance.color === swatch}
            className={`h-6 w-7 rounded-full ${zoneThemes[swatch].accent} ${appearance.color === swatch ? 'ring-2 ring-slate-500 ring-offset-2 dark:ring-offset-slate-900' : ''}`}
            onClick={() => setColor(swatch)}/>)}
        </div>
      </div>}
      <Field label="Type"><select className="field" value={kind} onChange={event => { setType(event.target.value as FloorTable['type']); setLabels({}) }}>
        <option value="table">Table</option><option value="garden">Garden table</option><option value="room">Room</option>
      </select></Field>
      <div className="grid grid-cols-2 gap-3 text-sm font-medium">
        <div className="space-y-1"><p>Number of Tables / Rooms</p><Stepper label="location count" max={30} value={count} onChange={setCount}/></div>
        <div className="space-y-1"><p>Default Seats per Table</p><Stepper label="default seats" max={20} value={seats} onChange={setSeats}/></div>
      </div>
      <ol aria-label="Location preview" className="max-h-48 divide-y overflow-auto rounded-lg border">
        {preview.map((row, i) => <li key={i} className="flex items-center justify-between gap-3 px-2 py-1.5">
          <input className="field max-w-40 py-1" aria-label={`Location ${i + 1} label`} required maxLength={40} value={row.label}
            onChange={event => setLabels({ ...labels, [i]: event.target.value })}/>
          <Stepper label={`seats for location ${i + 1}`} max={20} value={row.capacity} onChange={value => setCapacities({ ...capacities, [i]: value })}/>
        </li>)}
      </ol>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <button className="primary"><Plus size={16}/> Create All Tables</button>
    </form>
  </Modal>
}
