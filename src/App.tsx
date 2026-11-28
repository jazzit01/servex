import CustomerDisplayPage from './pages/CustomerDisplayPage'
import CrmPage from './pages/CrmPage'
import InventoryPage from './pages/InventoryPage'
import { useEffect, useState } from 'react'
import PinLogin from './components/auth/PinLoginModal'
import SetupAccess from './components/auth/SetupAccess'
import SetupWizard from './components/onboarding/SetupWizard'
import LicenseModal from './components/licensing/LicenseModal'
import type { SetupProfile, StartupState } from './types/pos'
import AppShell from './components/layout/AppShell'
import FloorMapPage from './pages/FloorMapPage'
import PrintPreview from './components/billing/PrintPreview'
import BillingPage from './pages/BillingPage'
import OrdersKotPage from './pages/OrdersKotPage'
import MenuAdminPage from './pages/MenuAdminPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import { usePosStore } from './store/usePosStore'

const pages = { floor: FloorMapPage, billing: BillingPage, orders: OrdersKotPage, menu: MenuAdminPage, reports: ReportsPage, crm:CrmPage, inventory:InventoryPage }

export default function App(){
  return location.hash === '#/customer-display' ? <CustomerDisplayPage/> : <PosApp/>
}

function PosApp() {
  const { cashier, data, route, startOrder, navigate, billingSession, toast } = usePosStore()
  const [startup, setStartup] = useState<StartupState>()
  const [activation, setActivation] = useState(false)
  const [dismissedActivation, setDismissedActivation] = useState(false)
  const [deferredSetup, setDeferredSetup] = useState(false)
  const [verifySetup, setVerifySetup] = useState(false)
  const [profile, setProfile] = useState<SetupProfile>()
  const openSetup = () => startup?.onboarding ? setDeferredSetup(false) : setVerifySetup(true)
  function cancelSetup() {
    setDeferredSetup(true)
    setProfile(undefined)
    void window.servexApi.lock()
  }
  async function completeSetup() {
    await refreshStartup()
    setProfile(undefined)
  }
  const [startupError, setStartupError] = useState('')
  async function refreshStartup() { setStartup(await window.servexApi.startup()) }
  useEffect(() => {
    let current = true
    const read = () => {
      if (!window.servexApi) { setStartupError('Open ServeX in the Electron desktop window.'); return }
      void window.servexApi.startup().then(value => { if (current) setStartup(value) })
        .catch(cause => { if (current) setStartupError(cause.message) })
    }
    read()
    const timer = setInterval(read, 60000)
    return () => { current = false; clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (!cashier || startup?.license.mode === 'expired') return
    return window.servexApi.onLanChange(() => {
      void usePosStore.getState().refresh().catch(() => {})
    })
  }, [cashier, startup?.license.mode])
  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (startup?.license.mode === 'expired' || !cashier || event.repeat || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return
      if (!['F1', 'F2', 'F3'].includes(event.key) || document.querySelector('dialog[open]')) return
      event.preventDefault()
      if (event.key === 'F1') startOrder('parcel')
      if (event.key === 'F2' && route !== 'billing') navigate('floor')
      if (event.key === 'F3') navigate('orders')
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  }, [cashier, navigate, startOrder, route, startup?.license.mode])
  const theme=data?.settings.theme_mode
  useEffect(()=>{
    if(theme) { setStartup(previous=>previous&&previous.theme!==theme?{...previous,theme}:previous); return }
    if(!cashier&&startup?.theme)document.documentElement.classList.toggle('dark',startup.theme==='dark')
  },[cashier,startup?.theme,theme])
  if (!startup) return <div className="grid h-screen place-items-center text-sm text-slate-600">{startupError || 'Opening ServeX…'}</div>
  if (profile || (startup.onboarding && !deferredSetup)) return <SetupWizard profile={profile} cancel={cancelSetup} complete={completeSetup} />
  const expired = startup.license.mode === 'expired'
  const Page = route === 'settings' ? null : pages[route]
  return <>
    {!expired && (cashier ? <AppShell license={startup.license} activate={() => setActivation(true)}>{Page ? <Page key={route === 'billing' ? billingSession : route} /> : <SettingsPage openLicense={() => setActivation(true)} />}</AppShell>
      : <><PinLogin openSetup={openSetup} disabled={startup.onboarding} /><button className="secondary fixed right-5 top-5" onClick={() => setActivation(true)}>
        {startup.license.mode === 'trial' ? `7-Day Full Trial · ${startup.license.daysLeft} days left` : 'License Active'}</button></>)}
    {expired && <div className="grid h-screen place-items-center bg-slate-50"><div className="panel space-y-4 p-8">
      <h1>ServeX POS</h1><p className="subtitle">Activate ServeX to open the till.</p>
      <button className="primary" onClick={() => setActivation(true)}>Activate ServeX</button>
      <button className="secondary block" onClick={openSetup}>First-Time Restaurant Setup / Restore Backup</button>
    </div></div>}
    {verifySetup && <SetupAccess close={() => setVerifySetup(false)} authorized={value => { setVerifySetup(false); setProfile(value) }} />}
    {!expired && cashier && <PrintPreview />}
    {!verifySetup && ((expired && !dismissedActivation) || activation) && <LicenseModal state={startup.license} close={() => { setActivation(false); setDismissedActivation(true) }} activated={license => {
      setStartup({ ...startup, license })
      setActivation(true)
      if (cashier) void usePosStore.getState().refresh().catch(() => {})
    }} />}
    {toast && <div role={toast.error ? 'alert' : 'status'} className={`fixed bottom-6 right-6 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.error ? 'bg-red-700' : 'bg-teal-800'}`}>{toast.message}</div>}
  </>
}
