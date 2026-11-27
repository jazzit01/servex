import { useEffect, useState, type ReactNode } from 'react'
import { BarChart3, ChefHat, ChevronsLeft, ChevronsRight, LayoutGrid, Lock, Plus, Receipt, Settings, UserRound, UtensilsCrossed } from 'lucide-react'
import { usePosStore } from '../../store/usePosStore'
import type { Route } from '../../types/pos'

const links = [
  { route: 'floor', label: 'Floors & Rooms', icon: LayoutGrid },
  { route: 'billing', label: 'Quick Billing', icon: Receipt },
  { route: 'orders', label: 'Orders & KOT', icon: ChefHat },
  { route: 'menu', label: 'Menu Manager', icon: UtensilsCrossed },
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

export default function AppShell({ children }: { children: ReactNode }) {
  const { route, cashier, data, navigate, startOrder, lock } = usePosStore()
  const [collapsed, setCollapsed] = useState(false)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  function nav(label: string, Icon: typeof Settings, target: Route) {
    return <button key={target} title={label} aria-label={label} aria-current={route === target ? 'page' : undefined}
      onClick={() => navigate(target)} className={`nav ${collapsed ? 'justify-center' : ''} ${route === target ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100'}`}>
      <Icon size={20} strokeWidth={1.75} className="shrink-0" />{!collapsed && label}
    </button>
  }
  return <div className="flex h-screen min-w-[1000px] overflow-hidden">
    <aside className={`flex shrink-0 flex-col border-r border-slate-200 bg-white ${collapsed ? 'w-[72px]' : 'w-56'}`}>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b px-[17px]">
        <Brand key={data?.logo ?? 'default'} custom={data?.logo ?? null} name={data?.settings.restaurant_name ?? 'ServeX POS'} collapsed={collapsed} />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {links.slice(0, 5).map(({ route, label, icon }) => nav(label, icon, route))}
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
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-white px-6">
        <div className="flex items-center gap-4">
          <strong className="text-sm">{links.find(link => link.route === route)?.label}</strong>
          <span className="border-l pl-4 text-xs text-slate-500">{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-xs font-semibold"><UserRound size={15} /> {cashier?.name} <span className="capitalize text-slate-500">{cashier?.role}</span></span>
          {route !== 'floor' && <button className="primary h-9" onClick={() => startOrder('parcel')}><Plus size={17} /> New Takeaway <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-[11px]">F1</kbd></button>}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto bg-slate-50 px-6 py-6">{children}</main>
    </div>
  </div>
}
