import SmartCalculatorModal, { type CalculatorEntry } from '../ui/SmartCalculatorModal'
import QuickBackup from '../enterprise/QuickBackup'
import CommandPalette from '../ui/CommandPalette'
import { enterpriseAction } from '../enterprise/useEnterprise'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Boxes, Calculator, Monitor, Moon, Search, Sun, Users, Volume2, VolumeX, BarChart3, ChefHat, ChevronsLeft, ChevronsRight, LayoutGrid, Lock, Plus, Receipt, Settings, UserRound, UtensilsCrossed } from 'lucide-react'
import { usePosStore } from '../../store/usePosStore'
import type { LicenseState, Route } from '../../types/pos'

const links = [
  { route: 'floor', label: 'Floors & Rooms', icon: LayoutGrid },
  { route: 'billing', label: 'Quick Billing', icon: Receipt },
  { route: 'orders', label: 'Orders & KOT', icon: ChefHat },
  { route: 'menu', label: 'Menu Manager', icon: UtensilsCrossed },
  { route: 'crm', label: 'Customers & Loyalty', icon: Users },
  { route: 'inventory', label: 'Inventory & Recipes', icon: Boxes },
  { route: 'reports', label: 'Reports & Z-Close', icon: BarChart3 },
  { route: 'settings', label: 'Settings', icon: Settings },
] as const

function Brand({ custom, name, collapsed }: { custom: string | null; name: string; collapsed: boolean }) {
  const fallback = import.meta.env.BASE_URL + 'servex-logo.png'
  const [failed, setFailed] = useState<string[]>([])
  const source = [custom, fallback].find(url => url && !failed.includes(url))
  return <>
    {source ? <img className="size-9 shrink-0 rounded-lg object-contain" alt="" src={source} onError={() => setFailed(current => [...current, source])} />
      : <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-600 text-sm font-bold text-white">SX</span>}
    {!collapsed && <div className="min-w-0"><div className="truncate text-sm font-bold" title={name}>{name}</div><div className="text-xs text-slate-500">ServeX POS</div></div>}
  </>
}

export default function AppShell({ children, license, activate }: { children: ReactNode; license: LicenseState; activate: () => void }) {
  const { route, cashier, data, navigate, startOrder, lock } = usePosStore()
  const [collapsed, setCollapsed] = useState(false)
  const [palette,setPalette]=useState(false)
  const [backup,setBackup]=useState(false)
  const [calculator, setCalculator] = useState(false)
  const [tape, setTape] = useState<CalculatorEntry[]>([])
  const dark=data?.settings.theme_mode==='dark'
  useEffect(()=>{document.documentElement.classList.toggle('dark',dark)},[dark])
  useEffect(()=>{
    function shortcut(event:KeyboardEvent){
      if (event.key === 'F9' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        const dialogs = document.querySelectorAll('dialog[open]')
        if (calculator || !dialogs.length || (dialogs.length === 1 && dialogs[0].querySelector('[data-calculator-checkout]'))) {
          event.preventDefault()
          setCalculator(open => !open)
        }
        return
      }
      if(!((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k')||event.repeat||document.querySelector('dialog[open]'))return
      event.preventDefault();setPalette(true)
    }
    window.addEventListener('keydown',shortcut,true)
    return()=>window.removeEventListener('keydown',shortcut,true)
  },[calculator])
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  function nav(label: string, Icon: typeof Settings, target: Route) {
    return <button key={target} title={label} aria-label={label} aria-current={route === target ? 'page' : undefined}
      onClick={() => {if(target==='reports')usePosStore.setState({reportTab:'analytics'}); navigate(target)}} className={`nav ${collapsed ? 'justify-center' : ''} ${route === target ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100'}`}>
      <Icon size={20} strokeWidth={1.75} className="shrink-0" />{!collapsed && label}
    </button>
  }
  return <div className="flex h-screen min-w-[1000px] overflow-hidden">
    <aside className={`flex shrink-0 flex-col border-r border-slate-200 bg-white ${collapsed ? 'w-[72px]' : 'w-56'}`}>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b px-[17px]">
        <Brand key={data?.logo ?? 'default'} custom={data?.logo ?? null} name={data?.settings.restaurant_name ?? 'ServeX POS'} collapsed={collapsed} />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {links.filter(link=>link.route!=='settings'&&(link.route!=='inventory'||cashier?.role!=='cashier')).map(({ route, label, icon }) => nav(label, icon, route))}
        <button className={`nav mt-2 text-slate-500 hover:bg-slate-100 ${collapsed ? 'justify-center' : ''}`} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(value => !value)}>
          {collapsed ? <ChevronsRight size={20} /> : <><ChevronsLeft size={20} /> Collapse</>}
        </button>
      </div>
      <div className="space-y-1 border-t p-3">
        <div title="ServeX DB Ready" className={`flex h-9 items-center gap-2 px-3 text-xs font-medium text-slate-600 ${collapsed ? 'justify-center' : ''}`}><span className="size-2 shrink-0 rounded-full bg-emerald-500" />{!collapsed && 'ServeX DB Ready'}</div>
        {nav('Settings', Settings, 'settings')}
        <button title="Lock Screen" className={`nav text-slate-600 hover:bg-slate-100 ${collapsed ? 'justify-center' : ''}`} onClick={() => void lock()}>
          <Lock size={20} strokeWidth={1.75} />{!collapsed && 'Lock Screen'}
        </button>
      </div>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-white px-4 dark:bg-slate-950">
        <div className="flex items-center gap-4">
          <strong className="text-sm">{links.find(link => link.route === route)?.label}</strong>
          <span className="hidden whitespace-nowrap border-l pl-4 text-xs text-slate-500 2xl:inline">{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="secondary h-9 px-2.5" title="Smart Calculator (F9)" aria-label="Open Smart Calculator" aria-keyshortcuts="F9"
            onClick={() => setCalculator(true)} disabled={calculator}><Calculator size={17}/></button>
          <button className="secondary h-9 whitespace-nowrap" onClick={()=>setPalette(true)}><Search size={16}/>Commands <kbd className="caption">Ctrl+K</kbd></button>
          <button className="secondary h-9 whitespace-nowrap" onClick={()=>void window.servexApi.openCustomerDisplay().catch(error=>usePosStore.getState().notify(error.message,true))}><Monitor size={16}/>Customer Screen</button>
          <button className="secondary h-9 px-2.5" aria-label={dark?'Switch to light mode':'Switch to dark mode'} onClick={()=>void enterpriseAction({type:'preferences',theme:dark?'light':'dark'})}>{dark?<Sun size={16}/>:<Moon size={16}/>}</button>
          <button className="secondary h-9 px-2.5" aria-label={data?.settings.sound_enabled?'Mute sounds':'Unmute sounds'} onClick={()=>void enterpriseAction({type:'preferences',sound:!data?.settings.sound_enabled})}>
            {data?.settings.sound_enabled?<Volume2 size={16}/>:<VolumeX size={16}/>}</button>
          {license.mode === 'trial' && <button className="rounded-lg bg-teal-50 px-2.5 py-2 text-xs font-semibold text-teal-800"
            onClick={activate}>7-Day Full Trial · {license.daysLeft} days left</button>}
          <span className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-xs font-semibold"><UserRound size={15} /> {cashier?.name} <span className="capitalize text-slate-500">{cashier?.role}</span></span>
          {route !== 'floor' && <button className="primary hidden h-9 2xl:inline-flex" onClick={() => startOrder('parcel')}><Plus size={17} /> New Takeaway <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-[11px]">F1</kbd></button>}
        </div>
      </header>
      {!!data?.lowStock&&<div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-semibold text-amber-950" role="status">
        <AlertTriangle size={15}/> {data.lowStock} ingredient{data.lowStock===1?'':'s'} below minimum stock
        {cashier?.role!=='cashier'&&<button className="underline" onClick={()=>navigate('inventory')}>View Inventory</button>}
      </div>}
      <main className="min-h-0 flex-1 overflow-auto bg-slate-50 px-6 py-6">{children}</main>
    </div>
    {backup&&<QuickBackup close={()=>setBackup(false)}/>}
    {palette&&<CommandPalette close={()=>setPalette(false)} backup={()=>setBackup(true)} calculator={() => setCalculator(true)}/>}
    {calculator && <SmartCalculatorModal close={() => setCalculator(false)} tape={tape} besideCart={route === 'billing'}
      record={entry => setTape(current => [entry, ...current].slice(0, 5))}/>}
  </div>
}
