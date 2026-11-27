import { useState } from 'react'
import { Search } from 'lucide-react'
import { foodLibrary, foodReference } from '../types/foodLibrary'
import { Modal } from './ManagementControls'

const groups = ['All', ...new Set(foodLibrary.map(item => item.group))]

export default function FoodLibraryPicker({ close, choose }: { close: () => void; choose: (reference: string) => void }) {
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('All')
  const term = search.toLowerCase().trim()
  const choices = foodLibrary.filter(row => (group === 'All' || row.group === group) && row.name.toLowerCase().includes(term))
  return <Modal wide title="Menu Photo Library" onClose={close} dismissLabel="Back">
    <label className="relative block">
      <Search size={16} className="absolute left-3 top-2.5 text-slate-500" />
      <input autoFocus aria-label="Search food photos" className="field pl-9" placeholder="Search food photos" value={search} onChange={event => setSearch(event.target.value)} />
    </label>
    <div className="my-3 flex flex-wrap gap-2">{groups.map(value => <button key={value} className={group === value ? 'primary' : 'secondary'}
      type="button" aria-pressed={group === value} onClick={() => setGroup(value)}>{value}</button>)}</div>
    <div className="grid max-h-[42vh] grid-cols-3 gap-3 overflow-y-auto p-1 sm:grid-cols-4">
      {choices.map(row => <button key={row.id} type="button" className="overflow-hidden rounded-lg border bg-white text-left hover:border-teal-500"
        onClick={() => choose(foodReference(row.id))}>
        <img loading="lazy" alt="" className="aspect-[3/2] w-full object-cover" src={import.meta.env.BASE_URL + 'food-library/' + row.id + '.svg'} />
        <span className="block px-2 py-1.5 text-xs font-semibold">{row.name}</span>
      </button>)}
    </div>
    {!choices.length && <p className="p-3 text-sm text-slate-600">No photos match your search.</p>}
  </Modal>
}
