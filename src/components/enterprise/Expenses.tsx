import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Field,Modal } from '../ManagementControls'
import { usePosStore } from '../../store/usePosStore'
import { enterpriseAction,useEnterprise } from './useEnterprise'
import type { PaymentMode } from '../../types/pos'

export default function Expenses(){
  const rows=useEnterprise('expenses')
  const currency=usePosStore(state=>state.data?.settings.currency_symbol??'₹')
  const [add,setAdd]=useState(false)
  const [busy,setBusy]=useState(false)
  return <section className="panel p-5">
    <div className="flex items-center justify-between"><div><h2>Expenses / Petty Cash</h2><p className="subtitle">Cash payouts reduce the expected drawer total.</p></div><button className="primary" onClick={()=>setAdd(true)}><Plus size={16}/>Record Expense</button></div>
    <table className="mt-4 w-full text-left text-sm"><thead><tr>{['Title','Category','Payment','Amount','Notes'].map(label=><th className="p-2" key={label}>{label}</th>)}</tr></thead>
      <tbody className="divide-y">{rows?.map(row=><tr key={row.id}><th className="p-2">{row.title}</th><td>{row.category}</td><td>{row.payment_mode}</td><td>{currency}{row.amount.toFixed(2)}</td><td>{row.notes??'—'}</td></tr>)}</tbody></table>
    {!rows?.length&&<p className="mt-3 text-sm text-slate-500">No expenses today.</p>}
    {add&&<Modal title="Record Expense" dismissDisabled={busy} onClose={()=>setAdd(false)}>
      <form className="space-y-3" onSubmit={async e=>{
        e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true)
        if(await enterpriseAction({type:'expense',value:{title:String(form.get('title')),category:String(form.get('category')),
          payment_mode:String(form.get('payment')) as PaymentMode,amount:Number(form.get('amount')),notes:String(form.get('notes'))}},'Expense recorded.'))setAdd(false)
        setBusy(false)
      }}>
        <Field label="Expense title"><input className="field" name="title" required maxLength={80}/></Field>
        <Field label="Category"><select className="field" name="category">{['Vegetables','Milk','Gas','Staff Advance','Supplies','Other'].map(label=><option key={label}>{label}</option>)}</select></Field>
        <Field label="Amount"><input className="field" name="amount" type="number" min=".01" step=".01" required/></Field>
        <Field label="Payment"><select className="field" name="payment"><option>Cash</option><option>Card</option><option>UPI</option></select></Field>
        <Field label="Notes"><textarea className="field" name="notes" maxLength={500}/></Field>
        <button className="primary" disabled={busy}>Record Expense</button>
      </form>
    </Modal>}
  </section>
}
