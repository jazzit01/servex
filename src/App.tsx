import { useEffect, useState } from 'react'
import { ArrowRight, LockKeyhole } from 'lucide-react'
import SetupWizard from './components/onboarding/SetupWizard'
import LicenseModal from './components/licensing/LicenseModal'
import type { StartupState } from './types/pos'
import AppShell from './components/layout/AppShell'
import FloorMapPage from './pages/FloorMapPage'
import PrintPreview from './components/billing/PrintPreview'
import BillingPage from './pages/BillingPage'
import OrdersKotPage from './pages/OrdersKotPage'
import MenuAdminPage from './pages/MenuAdminPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import { usePosStore } from './store/usePosStore'

const pages = { floor: FloorMapPage, billing: BillingPage, orders: OrdersKotPage, menu: MenuAdminPage, reports: ReportsPage, settings: SettingsPage }

function SignIn() {
  const signIn = usePosStore(state => state.signIn)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="grid h-screen place-items-center bg-slate-50">
    <div className="panel w-[390px] p-8">
      <div className="mb-5 grid size-12 place-items-center rounded-xl bg-teal-600 font-bold text-white">SX</div>
      <h1>Sign in to ServeX</h1><p className="subtitle">Enter your staff PIN to open the till.</p>
      <form className="mt-6 space-y-4" onSubmit={async event => {
        event.preventDefault()
        setBusy(true)
        setError('')
        try {
          if (await signIn(pin)) setPin('')
          else setError('The PIN was not recognized.')
        } catch (error) {
          setError(window.servexApi ? String(error) : 'Open ServeX in the Electron desktop window.')
        } finally { setBusy(false) }
      }}>
        <label className="block space-y-2 text-sm font-semibold"><span className="flex items-center gap-2"><LockKeyhole size={15} /> Staff PIN</span><input autoFocus required type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,12}" maxLength={12} className="field" value={pin} onChange={event => setPin(event.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="primary w-full" disabled={busy}>Sign in <ArrowRight size={16} /></button>
      </form>
    </div>
  </div>
}

export default function App() {
  const { cashier, route, startOrder, navigate, billingSession, toast } = usePosStore()
  const [startup, setStartup] = useState<StartupState>()
  const [activation, setActivation] = useState(false)
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
  if (!startup) return <div className="grid h-screen place-items-center text-sm text-slate-600">{startupError || 'Opening ServeX…'}</div>
  if (startup.onboarding) return <SetupWizard complete={refreshStartup} />
  const expired = startup.license.mode === 'expired'
  const Page = pages[route]
  return <>
    {!expired && (cashier ? <AppShell license={startup.license} activate={() => setActivation(true)}><Page key={route === 'billing' ? billingSession : route} /></AppShell>
      : <><SignIn />{startup.license.mode === 'trial' && <button className="secondary fixed right-5 top-5" onClick={() => setActivation(true)}>7-Day Full Trial · {startup.license.daysLeft} days left</button>}</>)}
    {expired && <div className="grid h-screen place-items-center bg-slate-50"><h1>ServeX POS</h1></div>}
    {!expired && cashier && <PrintPreview />}
    {(expired || activation) && <LicenseModal state={startup.license} close={() => setActivation(false)} activated={license => {
      setStartup({ ...startup, license }); setActivation(false)
    }} />}
    {toast && <div role={toast.error ? 'alert' : 'status'} className={`fixed bottom-6 right-6 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.error ? 'bg-red-700' : 'bg-teal-800'}`}>{toast.message}</div>}
  </>
}
