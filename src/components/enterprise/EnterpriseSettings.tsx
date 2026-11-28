import { useState } from 'react'
import { Plus, Printer } from 'lucide-react'
import { Field,Modal } from '../ManagementControls'
import { usePosStore } from '../../store/usePosStore'
import { enterpriseAction,useEnterprise } from './useEnterprise'
import type { PricingRule,PrinterSetting } from '../../types/enterprise'

const roles = {receipt:'Front Receipt',kitchen:'Kitchen KOT',bar:'Bar KOT'} as const

export default function EnterpriseSettings(){
  const data=usePosStore(state=>state.data)
  const printers=useEnterprise('printers')
  const [rule,setRule]=useState<PricingRule|'new'|null>(null)
  const [printer,setPrinter]=useState<PrinterSetting['role']>()
  const [busy,setBusy]=useState(false)
  const edit=rule==='new'?null:rule
  const device=printers?.find(row=>row.role===printer)
  const [days,setDays]=useState<string[]>([])
  const [connection,setConnection]=useState<PrinterSetting['connection_type']>('os')
  return <>
    <section className="panel space-y-3 p-5">
      <div className="flex items-center justify-between"><h2>Scheduled Pricing</h2><button className="primary" onClick={()=>{setDays(['0','1','2','3','4','5','6']);setRule('new')}}><Plus size={16}/>Add Rule</button></div>
      <p className="subtitle">Category rules take priority over all-item rules. The newest matching rule applies to new cart items.</p>
      {data?.pricing.map(row=><div className="flex items-center justify-between gap-3 border-t py-2 text-sm" key={row.id}>
        <div><strong>{row.name}</strong><p className="caption">{row.value}% {row.rule_type==='discount_percent'?'discount':'surcharge'} · {row.start_time}–{row.end_time} · {row.is_active?'Active':'Disabled'}</p></div>
        <button className="secondary" onClick={()=>{setDays(row.days_of_week.split(','));setRule(row)}}>Edit</button>
      </div>)}
    </section>
    <section className="panel space-y-3 p-5"><h2 className="flex items-center gap-2"><Printer size={17}/>Station Printers</h2>
      <div className="grid grid-cols-3 gap-3">{Object.entries(roles).map(([key,label])=>{
        const row=printers?.find(item=>item.role===key)
        return <button className="secondary flex-col items-start p-3 text-left" key={key} onClick={()=>{setConnection(row?.connection_type??'os');setPrinter(key as PrinterSetting['role'])}}>
          <strong>{label}</strong><span className="caption">{row?.is_active?row.address||'System default':'Not routed'}</span>
        </button>
      })}</div>
    </section>
    <form className="panel flex items-end gap-3 p-5" onSubmit={async e=>{
      e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true)
      await enterpriseAction({type:'earnRate',value:Number(form.get('rate'))},'Loyalty earn rate saved.');setBusy(false)
    }}><Field label="Loyalty earn (%)"><input className="field" name="rate" type="number" step=".01" min={0} max={100} required defaultValue={data?.settings.loyalty_earn_percent??2}/></Field><button className="secondary" disabled={busy}>Save Earn Rate</button></form>
    {rule&&<Modal wide title="Scheduled Pricing Rule" dismissDisabled={busy} onClose={()=>setRule(null)}>
      <form className="space-y-3" onSubmit={async e=>{
        e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true)
        if(await enterpriseAction({type:'pricing',value:{id:edit?.id,name:String(form.get('name')),rule_type:String(form.get('type')) as PricingRule['rule_type'],
          value:Number(form.get('value')),category_id:Number(form.get('category'))||null,start_time:String(form.get('start')),end_time:String(form.get('end')),
          days_of_week:days.join(','),is_active:Number(form.has('active'))}}))setRule(null)
        setBusy(false)
      }}>
        <Field label="Rule name"><input className="field" name="name" required defaultValue={edit?.name}/></Field>
        <div className="grid grid-cols-3 gap-3"><Field label="Type"><select className="field" name="type" defaultValue={edit?.rule_type}><option value="discount_percent">Discount</option><option value="surcharge_percent">Surcharge</option></select></Field>
          <Field label="Percent"><input className="field" name="value" type="number" required min=".01" max={100} step=".01" defaultValue={edit?.value??20}/></Field>
          <Field label="Category"><select className="field" name="category" defaultValue={edit?.category_id??0}><option value={0}>All categories</option>{data?.categories.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Starts"><input className="field" name="start" type="time" required defaultValue={edit?.start_time??'16:00'}/></Field>
          <Field label="Ends"><input className="field" name="end" type="time" required defaultValue={edit?.end_time??'19:00'}/></Field></div>
        <div className="flex flex-wrap gap-2">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=><button type="button" key={day}
          aria-pressed={days.includes(String(i))} className={days.includes(String(i))?'primary':'secondary'} onClick={()=>setDays(previous=>previous.includes(String(i))?previous.filter(x=>x!==String(i)):[...previous,String(i)])}>{day}</button>)}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={edit?Boolean(edit.is_active):true}/>Active</label>
        <button className="primary" disabled={busy||!days.length}>Save Rule</button>
      </form>
    </Modal>}
    {printer&&<Modal title={roles[printer]} dismissDisabled={busy} onClose={()=>setPrinter(undefined)}>
      <form className="space-y-3" onSubmit={async e=>{
        e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true)
        if(await enterpriseAction({type:'printer',value:{role:printer,name:String(form.get('name')),connection_type:connection,
          address:String(form.get('address')).trim()||null,paper_width:String(form.get('width')) as PrinterSetting['paper_width'],is_active:Number(form.has('active'))}}))setPrinter(undefined)
        setBusy(false)
      }}>
        <Field label="Name"><input className="field" name="name" required defaultValue={device?.name??roles[printer]}/></Field>
        <Field label="Connection"><select className="field" value={connection} onChange={e=>setConnection(e.target.value as PrinterSetting['connection_type'])}>
          <option value="os">Operating system printer</option><option value="usb">USB via Windows printer queue</option><option value="lan">LAN ESC/POS</option></select></Field>
        <Field label={connection==='lan'?'Private IP:port':'System queue name'}><input className="field" name="address" defaultValue={device?.address??''}
          placeholder={connection==='lan'?'192.168.1.50:9100':'Leave blank for system default (OS only)'}/></Field>
        <Field label="Paper width"><select className="field" name="width" defaultValue={device?.paper_width??'80mm'}><option>80mm</option><option>58mm</option></select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={Boolean(device?.is_active)}/>Use this printer</label>
        <button className="primary" disabled={busy}>Save Printer</button>
      </form>
    </Modal>}
  </>
}
