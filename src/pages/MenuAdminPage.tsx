import type { Station } from '../types/enterprise'
import { useState } from 'react'
import { ArrowDown, ArrowUp, Download, Images, ImagePlus, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import FoodLibraryPicker from '../components/FoodLibraryPicker'
import { Field, MediaThumbnail, Modal, Switch } from '../components/ManagementControls'
import { runAction, usePosStore } from '../store/usePosStore'
import type { Category, MenuInput, MenuItem, PickedMedia } from '../types/pos'

function ItemEditor({ item, categories, selected, defaultTax, onClose, onSave, busy }: {
  item: MenuItem | null; categories: Category[]; selected: number; defaultTax: number
  onClose: () => void; onSave: (input: MenuInput) => Promise<void>; busy: boolean
}) {
  const notify = usePosStore(state => state.notify)
  const [photo, setPhoto] = useState<PickedMedia | null>()
  const [library, setLibrary] = useState(false)
  const [picking, setPicking] = useState(false)
  const [veg, setVeg] = useState(item ? Boolean(item.is_veg) : true)
  const [available, setAvailable] = useState(item ? Boolean(item.is_available) : true)
  const imagePath = photo === undefined ? item?.image_path ?? null : photo?.name ?? null
  const isBusy = busy || picking
  return <><Modal title={item ? 'Edit menu item' : 'Add menu item'} onClose={onClose} dismissDisabled={isBusy}>
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault()
      if (isBusy) return
      const form = new FormData(event.currentTarget)
      void onSave({ id: item?.id, categoryId: Number(form.get('category')), name: String(form.get('name')),
        price: Number(form.get('price')), tax: Number(form.get('tax')), veg, available, imagePath, station:(String(form.get('station'))||undefined) as Station|undefined })
    }}>
      <Field label="Item Name"><input name="name" className="field" required maxLength={120} defaultValue={item?.name} /></Field>
      <Field label="Category"><select className="field" name="category" required defaultValue={item?.category_id ?? (selected || categories[0]?.id)}>
        {categories.map(category => <option key={category.id} value={category.id}>{category.name}{!category.is_active && ' (inactive)'}</option>)}
      </select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price"><input className="field" name="price" type="number" min={0} max={1000000} step="0.01" required defaultValue={item?.price} /></Field>
        <Field label="Tax Slab %"><input className="field" name="tax" type="number" min={0} max={100} step="0.01" required defaultValue={item?.tax_slab ?? defaultTax} /></Field>
      </div>
      <Field label="Prep station"><select className="field" name="station" defaultValue={item?.station??''}>
        {!item&&<option value="">Use category station</option>}<option value="kitchen">Kitchen</option><option value="bar">Bar</option><option value="none">No ticket</option>
      </select></Field>
      <div className="flex gap-4 text-sm">
        <span className="flex items-center gap-2"><Switch checked={veg} onChange={setVeg} label="Vegetarian" disabled={isBusy} /> {veg ? 'Vegetarian' : 'Non-vegetarian'}</span>
        <span className="flex items-center gap-2"><Switch checked={available} onChange={setAvailable} label="In stock" disabled={isBusy} /> In stock</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-slate-50 p-3">
        <MediaThumbnail name={imagePath} preview={photo?.preview || undefined} alt="Dish photo" />
        <button className="secondary" type="button" disabled={isBusy} onClick={() => setLibrary(true)}><Images size={16} /> Choose from Built-in Library</button>
        <button className="secondary" type="button" disabled={isBusy} onClick={async () => {
          setPicking(true)
          try {
            const picked = await window.servexApi.pickMedia()
            if (picked) setPhoto(picked)
          } catch (error) { notify((error as Error).message, true) }
          finally { setPicking(false) }
        }}><ImagePlus size={16} /> Upload Custom Photo</button>
        {imagePath && <button className="secondary" type="button" disabled={isBusy} onClick={() => setPhoto(null)}>Remove Photo</button>}
      </div>
      <div className="flex justify-end gap-2">
        <button className="primary" disabled={isBusy || !categories.length}>Save item</button></div>
    </form>
  </Modal>
  {library && <FoodLibraryPicker close={() => setLibrary(false)} choose={reference => {
    setPhoto({ name: reference, preview: '' })
    setLibrary(false)
  }} />}
  </>
}

const pageSize = 40

export default function MenuAdminPage() {
  const { data, cashier } = usePosStore()
  const [busy, setBusy] = useState(false)
  const [categoryId, select] = useState(0)
  const [categoryEditor, editCategory] = useState<Category | 'new' | null>(null)
  const [itemEditor, editItem] = useState<MenuItem | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [vegFilter, setVegFilter] = useState<'all' | 'veg' | 'nonveg'>('all')
  const [page, setPage] = useState(0)
  if (!data) return null
  const canEdit = cashier?.role === 'admin' || cashier?.role === 'manager'
  const disabled = busy || !canEdit
  const categories = data.categories
  const category = categories.find(row => row.id === categoryId)
  const categoryForm = categoryEditor && categoryEditor !== 'new' ? categoryEditor : null
  const items = data.menu.filter(item => (!categoryId || item.category_id === categoryId) &&
    item.name.toLowerCase().includes(search.trim().toLowerCase()) &&
    (vegFilter === 'all' || Boolean(item.is_veg) === (vegFilter === 'veg')))
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const index = Math.min(page, pages - 1)
  const visible = items.slice(index * pageSize, (index + 1) * pageSize)
  const names = new Map(categories.map(row => [row.id, row.name]))
  const counts = new Map<number, number>()
  for (const item of data.menu) counts.set(item.category_id, (counts.get(item.category_id) ?? 0) + 1)
  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    const saved = await runAction(action, message)
    setBusy(false)
    return saved
  }
  function choose(id: number) { select(id); setPage(0) }
  return <div className="workspace">
    <div><h1>Menu Manager</h1><p className="subtitle">Organize categories, update dishes, and control availability at the till.</p></div>
    <div className="flex items-start gap-5">
      <aside className="panel w-64 shrink-0 overflow-hidden">
        <div className="flex items-center justify-between border-b p-4"><h2>Categories</h2><span className="caption">{categories.length}</span></div>
        <div className="space-y-1 p-2">
          <button className={`nav justify-between ${categoryId === 0 ? 'bg-teal-50 text-teal-800' : 'hover:bg-slate-50'}`}
            aria-pressed={categoryId === 0} onClick={() => choose(0)}>All items <span className="text-xs">{data.menu.length}</span></button>
          {categories.map((row, position) => <div key={row.id} className={`flex items-center gap-1 rounded-lg px-1 ${row.id === categoryId ? 'bg-teal-50 text-teal-800' : 'hover:bg-slate-50'}`}>
            <button className="min-w-0 flex-1 px-2 py-2 text-left text-sm font-medium" aria-pressed={row.id === categoryId} onClick={() => choose(row.id)}>
              <span className="block truncate" title={row.name}>{row.name}</span>
              <span className="text-xs text-slate-500">{counts.get(row.id) ?? 0} items{!row.is_active && ' · Inactive'}</span>
            </button>
            {canEdit && <div className="flex items-center">
              <button className="rounded p-1 text-slate-600 hover:bg-white" title="Rename category" aria-label={`Rename ${row.name}`} disabled={busy} onClick={() => editCategory(row)}><Pencil size={14} /></button>
              <button className="rounded p-1 text-slate-600 hover:bg-white" aria-label={`Move ${row.name} up`} disabled={busy || position === 0}
                onClick={() => void act(() => window.servexApi.moveCategory(row.id, -1), 'Category moved.')}><ArrowUp size={14} /></button>
              <button className="rounded p-1 text-slate-600 hover:bg-white" aria-label={`Move ${row.name} down`} disabled={busy || position === categories.length - 1}
                onClick={() => void act(() => window.servexApi.moveCategory(row.id, 1), 'Category moved.')}><ArrowDown size={14} /></button>
            </div>}
          </div>)}
        </div>
        {canEdit && <div className="border-t p-3">
          {!categoryEditor ? <button className="secondary w-full" disabled={busy} onClick={() => editCategory('new')}><Plus size={16} /> Add Category</button>
            : <form className="space-y-3" key={categoryForm?.id ?? 'new'} onSubmit={async event => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              if (await act(() => window.servexApi.saveCategory({
                id: categoryForm?.id, name: String(form.get('name')), active: form.has('active'), station:String(form.get('station')) as Station,
              }), 'Category saved.')) editCategory(null)
            }}><Field label={categoryForm ? 'Edit category' : 'New category'}><input className="field" autoFocus name="name" required maxLength={80} defaultValue={categoryForm?.name} /></Field>
              <Field label="Default prep station"><select className="field" name="station" defaultValue={categoryForm?.station??'kitchen'}>
                <option value="kitchen">Kitchen</option><option value="bar">Bar</option><option value="none">No ticket</option>
              </select></Field>
              <label className="flex items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={!categoryForm || Boolean(categoryForm.is_active)} /> Active</label>
              <div className="flex gap-2"><button className="primary" disabled={busy}>Save</button>
                <button className="secondary" type="button" disabled={busy} onClick={() => editCategory(null)}>Cancel</button></div>
            </form>}
        </div>}
      </aside>
      <section className="panel min-w-0 flex-1 overflow-hidden">
        <div className="space-y-3 border-b p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2>{category?.name ?? 'All menu items'}</h2>
            <button className="primary" disabled={disabled || !categories.length} onClick={() => editItem('new')}><Plus size={16} /> Add Menu Item</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-40 flex-1"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
              <input className="field pl-9" aria-label="Search menu items" placeholder="Search menu items" value={search}
                onChange={event => { setSearch(event.target.value); setPage(0) }} /></label>
            {([['all', 'All'], ['veg', 'Veg'], ['nonveg', 'Non-Veg']] as const).map(([id, label]) => <button
              key={id} aria-pressed={vegFilter === id} className={`secondary rounded-full ${vegFilter === id ? 'border-teal-300 bg-teal-50 text-teal-800' : ''}`}
              onClick={() => { setVegFilter(id); setPage(0) }}>{label}</button>)}
          </div>
          {canEdit && <div className="flex flex-wrap gap-2">
            <button className="secondary" disabled={busy} onClick={async () => {
              setBusy(true)
              const store = usePosStore.getState()
              try {
                const count = await window.servexApi.importMenuCsv()
                if (count !== null) { await store.refresh(); store.notify(`${count} menu items imported.`) }
              } catch (error) { store.notify((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true) }
              finally { setBusy(false) }
            }}><Upload size={15} /> Import CSV</button>
            <button className="secondary" disabled={busy} onClick={() => void act(() => window.servexApi.exportMenuCsv(false), 'Menu CSV exported.')}><Download size={15} /> Export CSV</button>
            <button className="secondary" disabled={busy} onClick={() => void act(() => window.servexApi.exportMenuCsv(true), 'CSV template saved.')}>Download sample CSV</button>
          </div>}
        </div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums">
          <thead className="bg-slate-50 text-xs text-slate-600"><tr>{['Item', 'Type', 'Price', 'Tax slab', 'In Stock', 'Actions'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead>
          <tbody className="divide-y">{visible.map(item => <tr key={item.id}>
            <th scope="row" className="px-3 py-2 font-semibold"><div className="flex items-center gap-2">
              <MediaThumbnail name={item.image_path} alt="" /><div>{item.name}{!category && <span className="block text-xs font-normal text-slate-500">{names.get(item.category_id)}</span>}</div></div></th>
            <td className="whitespace-nowrap px-3"><span className={`mr-1.5 inline-block size-2.5 rounded-sm ${item.is_veg ? 'bg-emerald-600' : 'bg-red-600'}`} />{item.is_veg ? 'Veg' : 'Non-Veg'}</td>
            <td className="whitespace-nowrap px-3">{data.settings.currency_symbol}{item.price.toFixed(2)}</td>
            <td className="px-3">{item.tax_slab ?? data.settings.tax_rate}%</td>
            <td className="px-3"><Switch checked={Boolean(item.is_available)} label={`${item.name} in stock`} disabled={disabled}
              onChange={() => void act(() => window.servexApi.toggleItem(item.id), 'Availability updated.')} /></td>
            <td className="whitespace-nowrap px-3"><button className="rounded p-2 text-slate-600 hover:bg-slate-100" title="Edit item" aria-label={`Edit ${item.name}`}
              disabled={disabled} onClick={() => editItem(item)}><Pencil size={16} /></button>
              <button className="rounded p-2 text-red-700 hover:bg-red-50" title="Delete item" aria-label={`Delete ${item.name}`} disabled={disabled} onClick={() => {
                if (window.confirm(`Delete "${item.name}" from the menu?`)) void act(() => window.servexApi.deleteMenuItem(item.id), 'Item removed from the menu.')
              }}><Trash2 size={16} /></button></td>
          </tr>)}</tbody>
        </table></div>
        {!visible.length && <p className="p-8 text-center text-sm text-slate-500">No menu items match.</p>}
        {pages > 1 && <div className="flex items-center justify-between border-t p-3 text-sm text-slate-600">
          <span>{index * pageSize + 1}–{Math.min((index + 1) * pageSize, items.length)} of {items.length}</span>
          <div className="flex gap-2"><button className="secondary" disabled={!index} onClick={() => setPage(index - 1)}>Previous</button>
            <button className="secondary" disabled={index + 1 >= pages} onClick={() => setPage(index + 1)}>Next</button></div>
        </div>}
      </section>
    </div>
    {itemEditor && <ItemEditor item={itemEditor === 'new' ? null : itemEditor} categories={categories} selected={categoryId}
      defaultTax={data.settings.tax_rate} busy={busy} onClose={() => editItem(null)} onSave={async input => {
        if (await act(() => window.servexApi.saveMenuItem(input), 'Menu item saved.')) editItem(null)
      }} />}
  </div>
}
