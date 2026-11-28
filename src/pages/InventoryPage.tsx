import { useState } from 'react'
import { ArrowLeft, Boxes, Plus, Soup, Trash2 } from 'lucide-react'
import { Field,Modal } from '../components/ManagementControls'
import { enterpriseAction,useEnterprise } from '../components/enterprise/useEnterprise'
import { usePosStore } from '../store/usePosStore'
import type { Ingredient,Recipe,Unit } from '../types/enterprise'

function RecipeEditor({menu,ingredients,close}:{menu:number;ingredients:Ingredient[];close:()=>void}){
  const rows=useEnterprise('recipes',String(menu))
  if(!rows)return <Modal title="Recipe Builder" onClose={close}><p>Loading recipe…</p></Modal>
  return <RecipeForm menu={menu} initial={rows} ingredients={ingredients} close={close}/>
}
function RecipeForm({menu,initial,ingredients,close}:{menu:number;initial:Recipe[];ingredients:Ingredient[];close:()=>void}){
  const [rows,setRows]=useState(initial)
  const [busy,setBusy]=useState(false)
  return <Modal wide title="Recipe Builder" dismissDisabled={busy} onClose={close}>
    <form className="space-y-3" onSubmit={async e=>{
      e.preventDefault();setBusy(true)
      if(await enterpriseAction({type:'recipe',menu,rows}))close()
      setBusy(false)
    }}>
      <p className="subtitle">Record quantities for one portion in each ingredient’s stock unit.</p>
      {rows.map((row,i)=><div className="flex items-end gap-2" key={i}>
        <div className="flex-1"><Field label="Ingredient"><select className="field" required value={row.ingredient_id||''} onChange={e=>setRows(previous=>previous.map((entry,index)=>index===i?{...entry,ingredient_id:Number(e.target.value)}:entry))}>
          <option value="">Choose ingredient</option>{ingredients.map(item=><option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
        </select></Field></div>
        <Field label="Quantity"><input className="field w-28" type="number" required min=".000001" step="any" value={row.quantity_required||''} onChange={e=>setRows(previous=>previous.map((entry,index)=>index===i?{...entry,quantity_required:Number(e.target.value)}:entry))}/></Field>
        <button type="button" aria-label="Remove ingredient" className="secondary h-10" onClick={()=>setRows(previous=>previous.filter((_,index)=>index!==i))}><Trash2 size={16}/></button>
      </div>)}
      <div className="flex gap-2"><button type="button" className="secondary" onClick={()=>setRows(previous=>[...previous,{menu_item_id:menu,ingredient_id:0,quantity_required:0}])}><Plus size={16}/>Add Ingredient</button>
        <button className="primary" disabled={busy}>Save Recipe</button></div>
    </form>
  </Modal>
}

export default function InventoryPage(){
  const {data,navigate,cashier}=usePosStore()
  const rows=useEnterprise('ingredients')??[]
  const [edit,setEdit]=useState<Ingredient|'new'|null>(null)
  const [stock,setStock]=useState<Ingredient|null>(null)
  const [chosen,setChosen]=useState(0)
  const [recipe,setRecipe]=useState(0)
  const [busy,setBusy]=useState(false)
  if(cashier?.role==='cashier')return <div className="workspace"><h1>Inventory &amp; Recipes</h1><p>Manager access is required.</p><button className="secondary" onClick={()=>navigate('floor')}>Back to Floors</button></div>
  const row=edit==='new'?null:edit
  return <div className="workspace">
    <header className="flex items-end justify-between"><div><button className="secondary" onClick={()=>navigate('floor')}><ArrowLeft size={16}/>Back to Floors</button><h1 className="mt-2">Inventory &amp; Recipes</h1></div><button className="primary" onClick={()=>setEdit('new')}><Boxes size={16}/>Add Ingredient</button></header>
    <section className="panel flex items-end gap-3 p-4"><Field label="Menu item recipe"><select className="field" value={chosen} onChange={e=>setChosen(Number(e.target.value))}><option value={0}>Choose menu item</option>
      {data?.menu.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <button className="secondary" disabled={!chosen} onClick={()=>setRecipe(chosen)}><Soup size={16}/>Recipe Builder</button>
    </section>
    <div className="panel overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Ingredient','On Hand','Low At','Unit Cost','Actions'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead>
      <tbody className="divide-y">{rows.map(item=><tr key={item.id}><th className="p-3">{item.name}</th>
        <td className={`p-3 ${item.current_stock<item.low_stock_threshold?'font-bold text-rose-700':''}`}>{item.current_stock} {item.unit}</td>
        <td className="p-3">{item.low_stock_threshold} {item.unit}</td><td className="p-3">{data?.settings.currency_symbol}{item.cost_per_unit.toFixed(2)}</td>
        <td className="space-x-2 p-3"><button className="secondary" onClick={()=>setEdit(item)}>Edit</button><button className="secondary" onClick={()=>setStock(item)}><Plus size={15}/>Add Stock</button></td>
      </tr>)}</tbody></table>{!rows.length&&<p className="p-4 text-sm">No ingredients configured.</p>}</div>
    {edit&&<Modal title={row?'Edit Ingredient':'Add Ingredient'} onClose={()=>setEdit(null)} dismissDisabled={busy}>
      <form className="space-y-3" onSubmit={async e=>{
        e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true)
        if(await enterpriseAction({type:'ingredient',value:{id:row?.id,name:String(form.get('name')),unit:String(form.get('unit')) as Unit,low_stock_threshold:Number(form.get('low')),cost_per_unit:Number(form.get('cost'))}}))setEdit(null)
        setBusy(false)
      }}>
        <Field label="Name"><input name="name" className="field" required defaultValue={row?.name}/></Field>
        <Field label="Stock unit"><select name="unit" className="field" defaultValue={row?.unit??'kg'}>{['g','ml','pcs','kg','L'].map(unit=><option key={unit}>{unit}</option>)}</select></Field>
        <Field label="Low stock threshold"><input name="low" className="field" type="number" min={0} step="any" required defaultValue={row?.low_stock_threshold??10}/></Field>
        <Field label="Cost per unit"><input name="cost" className="field" type="number" min={0} step="any" required defaultValue={row?.cost_per_unit??0}/></Field>
        <button className="primary" disabled={busy}>Save Ingredient</button>
      </form>
    </Modal>}
    {stock&&<Modal title={'Add Stock · '+stock.name} onClose={()=>setStock(null)} dismissDisabled={busy}>
      <form className="space-y-3" onSubmit={async e=>{
        e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true)
        if(await enterpriseAction({type:'stock',id:stock.id,quantity:Number(form.get('quantity')),cost:Number(form.get('cost'))},'Stock purchase recorded.'))setStock(null)
        setBusy(false)
      }}>
        <Field label={`Quantity (${stock.unit})`}><input name="quantity" className="field" type="number" min=".000001" step="any" required/></Field>
        <Field label="Purchase cost per unit"><input name="cost" className="field" type="number" min={0} step="any" required defaultValue={stock.cost_per_unit}/></Field>
        <button className="primary" disabled={busy}>Record Purchase</button>
      </form>
    </Modal>}
    {recipe!==0&&<RecipeEditor menu={recipe} ingredients={rows} close={()=>setRecipe(0)}/>}
  </div>
}
