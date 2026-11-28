import { useEffect,useRef,useState } from 'react'
import { ArrowRight, Calculator, DatabaseBackup, LayoutGrid, Monitor, Moon, ReceiptText, Search, Utensils } from 'lucide-react'
import { Modal } from '../ManagementControls'
import { enterpriseAction } from '../enterprise/useEnterprise'
import { usePosStore } from '../../store/usePosStore'
import type { Route } from '../../types/pos'

const screens: [Route,string][]=[['floor','Floors & Rooms'],['billing','Quick Billing'],['orders','Orders & KOT'],['menu','Menu Manager'],['crm','Customers & Loyalty'],['inventory','Inventory & Recipes'],['reports','Reports & Z-Close'],['settings','Settings']]
type Command={id:string;label:string;detail:string;icon:typeof Search; run:()=>void}

export default function CommandPalette({close,backup,calculator}:{close:()=>void;backup:()=>void;calculator:()=>void}){
  const store=usePosStore()
  const data=store.data
  const [search,setSearch]=useState('')
  const [selected,setSelected]=useState(0)
  const list=useRef<HTMLDivElement>(null)
  const query=search.toLowerCase().trim()
  const includes=(value:string)=>query.split(/\s+/).every(token=>value.toLowerCase().includes(token))
  const actions:Command[]=[
    {id:'calculator',label:'Open Smart Calculator',detail:'F9',icon:Calculator,run:calculator},
    {id:'display',label:'Open Customer Display',detail:'Quick action',icon:Monitor,run:()=>void window.servexApi.openCustomerDisplay().catch(error=>store.notify(error.message,true))},
    {id:'theme',label:'Toggle Dark Mode',detail:'Quick action',icon:Moon,run:()=>void enterpriseAction({type:'preferences',theme:data?.settings.theme_mode==='dark'?'light':'dark'})},
    {id:'close',label:'Run Z-Close',detail:'Quick action',icon:ReceiptText,run:()=>{usePosStore.setState({reportTab:'close'});store.navigate('reports');window.dispatchEvent(new Event('servex:open-z-close'))}},
  ]
  if(store.cashier?.role==='admin')actions.unshift({id:'backup',label:'Create Backup',detail:'Quick action',icon:DatabaseBackup,run:backup})
  const nav= screens.filter(([route])=>route!=='inventory'||store.cashier?.role!=='cashier').map(([route,label])=>({id:route,label,detail:'Navigation',icon:ArrowRight,run:()=>{
    if(route==='reports')usePosStore.setState({reportTab:'analytics'});store.navigate(route)
  }}))
  const locations=(data?.tables??[]).filter(row=>includes(row.label+' '+(data?.zones.find(z=>z.id===row.zone_id)?.name??''))).slice(0,16).map(row=>({
    id:'table'+row.id,label:row.label,detail:(data?.zones.find(z=>z.id===row.zone_id)?.name??'Location')+' · '+row.status,icon:LayoutGrid,run:()=>{
      const order=data?.orders.find(item=>item.table_id===row.id)
      if(order)store.resumeOrder(order)
      else if(row.status==='vacant')store.startOrder(row.type==='room'?'room':'dinein',row.id,data?.seated.find(item=>item.table_id===row.id))
      else {usePosStore.setState({floorTarget:row.id});store.navigate('floor');window.dispatchEvent(new Event('servex:focus-location'))}
    }
  }))
  const items=(data?.menu??[]).filter(row=>row.is_available&&data?.categories.some(c=>c.id===row.category_id&&c.is_active)&&includes(row.name)).slice(0,20).map(row=>({
    id:'menu'+row.id,label:row.name,detail:'Add to cart',icon:Utensils,run:()=>{
      if(usePosStore.getState().route!=='billing')store.startOrder('parcel')
      if(usePosStore.getState().route==='billing')store.queueItem(row.id)
    }
  }))
  const commands=query?[...items,...locations,...actions.filter(x=>includes(x.label)),...nav.filter(x=>includes(x.label))]:[...actions,...nav,...locations.slice(0,4),...items.slice(0,4)]
  const index=Math.min(selected,Math.max(0,commands.length-1))
  useEffect(()=>{list.current?.children[index]?.scrollIntoView({block:'nearest'})},[index])
  function execute(command:Command){close();command.run()}
  return <Modal title="Command Palette" onClose={close} palette>
    <label className="relative block"><Search size={17} className="absolute left-3 top-3 text-slate-500"/>
      <input data-modal-focus className="field pl-10" aria-label="Search commands" placeholder="Search dishes, locations, screens or actions" value={search}
        onChange={e=>{setSearch(e.target.value);setSelected(0)}} onKeyDown={e=>{
          if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setSelected(Math.max(0,Math.min(commands.length-1,index+(e.key==='ArrowDown'?1:-1))))}
          if(e.key==='Enter'&&commands[index]){e.preventDefault();execute(commands[index])}
        }}/></label>
    <div ref={list} className="mt-3 max-h-[48vh] overflow-auto">
      {commands.map((command,i)=><button type="button" key={command.id} onMouseEnter={()=>setSelected(i)}
        className={`flex w-full items-center gap-3 rounded-md p-2.5 text-left text-sm ${i===index?'bg-teal-50 text-teal-800':''}`}
        onClick={()=>execute(command)}><command.icon size={16}/><strong className="flex-1">{command.label}</strong><span className="caption">{command.detail}</span></button>)}
      {!commands.length&&<p className="p-3 text-sm text-slate-500">No matching commands.</p>}
    </div>
  </Modal>
}
