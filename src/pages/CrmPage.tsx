import { useState } from 'react'
import { ArrowLeft, Plus, Search } from 'lucide-react'
import { Field,Modal } from '../components/ManagementControls'
import { enterpriseAction,useEnterprise } from '../components/enterprise/useEnterprise'
import { usePosStore } from '../store/usePosStore'
import type { Customer } from '../types/enterprise'

export default function CrmPage(){
  const {data,navigate}=usePosStore()
  const [search,setSearch]=useState('')
  const [edit,setEdit]=useState<Customer|'new'|null>(null)
  const [busy,setBusy]=useState(false)
  const rows=useEnterprise('customers',search.trim())
  const current=edit==='new'?null:edit
  return <div className="workspace">
    <header className="flex items-end justify-between"><div><button className="secondary" onClick={()=>navigate('floor')}><ArrowLeft size={16}/>Back to Floors</button><h1 className="mt-2">Customers &amp; Loyalty</h1></div>
      <button className="primary" onClick={()=>setEdit('new')}><Plus size={16}/>Add Customer</button></header>
    <label className="relative block max-w-sm"><Search className="absolute left-3 top-2.5" size={16}/><input className="field pl-9" aria-label="Search customers" placeholder="Name or phone" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <div className="panel overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>
      {['Name','Phone','Birthday','Visits','Spent','Points','Favorite Dish',''].map((value,i)=><th className="p-3" key={i}>{value}</th>)}</tr></thead>
      <tbody className="divide-y">{rows?.map(row=><tr key={row.id}><th className="p-3">{row.name}</th><td className="p-3">{row.phone}</td><td className="p-3">{row.birthday??'—'}</td>
        <td className="p-3">{row.total_visits}</td><td className="p-3">{data?.settings.currency_symbol}{row.total_spent.toFixed(2)}</td><td className="p-3">{row.loyalty_points.toFixed(2)}</td>
        <td className="p-3">{row.favorite_item??'—'}</td><td className="p-3"><button className="secondary" onClick={()=>setEdit(row)}>Edit</button></td></tr>)}</tbody></table>
      {!rows?.length && <p className="p-4 text-sm text-slate-500">{rows?'No matching customers.':'Loading customers…'}</p>}
    </div>
    {edit && <Modal title={current?'Edit customer':'Add customer'} dismissDisabled={busy} onClose={()=>setEdit(null)}>
      <form className="space-y-3" onSubmit={async e=>{
        e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true)
        if(await enterpriseAction({type:'customer',name:String(form.get('name')),phone:String(form.get('phone')),birthday:String(form.get('birthday'))}))setEdit(null)
        setBusy(false)
      }}>
        <Field label="Name"><input name="name" className="field" required maxLength={80} defaultValue={current?.name}/></Field>
        <Field label="Phone"><input name="phone" type="tel" className="field" required maxLength={32} readOnly={Boolean(current)} defaultValue={current?.phone}/></Field>
        <Field label="Birthday"><input name="birthday" type="date" className="field" defaultValue={current?.birthday??''}/></Field>
        <button className="primary" disabled={busy}>Save Customer</button>
      </form>
    </Modal>}
  </div>
}
