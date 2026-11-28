import EnterpriseSettings from '../components/enterprise/EnterpriseSettings'
import { useState } from 'react'
import { ArrowLeft, Building2, CloudUpload, Eye, EyeOff, ImagePlus, Layers, ShieldCheck, Trash2, Users } from 'lucide-react'
import { Field, Switch } from '../components/ManagementControls'
import MobileWaiterSettings from '../components/settings/MobileWaiterSettings'
import BackupSettings from '../components/settings/BackupSettings'
import FloorSettings from '../components/settings/FloorSettings'
import StaffSettings from '../components/settings/StaffSettings'
import { runAction, usePosStore } from '../store/usePosStore'

const identityFields = [
  ['restaurant_name', 'Restaurant Name', 80], ['tagline', 'Tagline', 250],
  ['phone', 'Phone', 40], ['gstin', 'GSTIN / Tax ID', 80],
  ['address', 'Address', 250], ['receipt_footer', 'Receipt Footer Message', 250],
] as const

function ProfileSettings() {
  const { data, cashier } = usePosStore()
  const [busy, setBusy] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [printPreview, setPrintPreview] = useState(Boolean(data?.settings.print_preview))
  const [autoCleaning, setAutoCleaning] = useState(Boolean(data?.settings.auto_cleaning))
  const [inclusive, setInclusive] = useState(Boolean(data?.settings.tax_inclusive))
  if (!data || !cashier) return null
  const admin = cashier.role === 'admin'
  const disabled = busy || cashier.role === 'cashier'
  const settings = data.settings
  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    const saved = await runAction(action, message)
    setBusy(false)
    return saved
  }
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(target)
    const string = (field: string) => String(form.get(field) ?? '').trim()
    const saved = await act(() => window.servexApi.updateSettings({
      restaurant_name: string('restaurant_name'), tagline: string('tagline') || null, phone: string('phone') || null,
      address: string('address') || null, gstin: string('gstin') || null, receipt_footer: string('receipt_footer') || null,
      currency_symbol: string('currency_symbol'), tax_rate: Number(form.get('tax_rate')), tax_inclusive: Number(inclusive), auto_cleaning: Number(autoCleaning),
      upi_id: string('upi_id'), receipt_width: Number(form.get('receipt_width')), print_preview: Number(printPreview), printer_name: string('printer_name'),
      managerPin: string('managerPin') || undefined, licenseKey: string('licenseKey') || undefined,
    }), 'Settings saved.')
    if (saved) {
      for (const field of ['managerPin', 'licenseKey']) {
        const input = target.elements.namedItem(field) as HTMLInputElement | null
        if (input) input.value = ''
      }
    }
  }}>
    <div className="grid grid-cols-2 items-start gap-6">
      <section className="panel space-y-4 p-5">
        <h2 className="flex items-center gap-2"><Building2 className="text-teal-700" size={19} /> Restaurant Identity & Branding</h2>
        <div className="flex items-center gap-3 rounded-xl border bg-slate-50 p-3">
          {data.logo ? <img className="size-14 rounded-lg bg-white object-contain" src={data.logo} alt="Restaurant logo" />
            : <span className="grid size-14 place-items-center rounded-lg bg-teal-600 font-bold text-white">SX</span>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="secondary" disabled={disabled} onClick={() => void act(() => window.servexApi.pickLogo(), 'Logo updated.')}><ImagePlus size={16} /> Change Logo</button>
            <button type="button" className="secondary" disabled={disabled || !settings.logo_path}
              onClick={() => void act(() => window.servexApi.removeLogo(), 'Logo removed.')}><Trash2 size={16} /> Remove Logo</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {identityFields.map(([key, label, max]) => <div key={key} className={key === 'address' || key === 'receipt_footer' ? 'col-span-2' : ''}>
            <Field label={label}>{key === 'address' || key === 'receipt_footer'
              ? <textarea className="field" rows={2} name={key} disabled={disabled} maxLength={max} defaultValue={settings[key] ?? ''} />
              : <input className="field" name={key} disabled={disabled} maxLength={max} required={key === 'restaurant_name'} defaultValue={settings[key] ?? ''} />}</Field>
          </div>)}
        </div>
      </section>
      <section className="panel space-y-4 p-5">
        <h2 className="flex items-center gap-2"><ShieldCheck className="text-teal-700" size={19} /> Billing, Tax & Security Rules</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency Symbol"><input className="field" name="currency_symbol" maxLength={6} required disabled={disabled} defaultValue={settings.currency_symbol ?? '₹'} /></Field>
          <Field label="Default Tax Rate %"><input className="field" name="tax_rate" type="number" min={0} max={100} step="0.01" required disabled={disabled} defaultValue={settings.tax_rate} /></Field>
        </div>
        <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium">
          Tax Inclusive Pricing <Switch checked={inclusive} onChange={setInclusive} label="Tax Inclusive Pricing" disabled={disabled} />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm font-medium">
          Auto-mark tables as Cleaning after payment
          <Switch checked={autoCleaning} onChange={setAutoCleaning} label="Auto-mark tables as Cleaning after payment" disabled={disabled} />
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="UPI ID"><input className="field" name="upi_id" maxLength={185} required disabled={disabled} defaultValue={settings.upi_id} /></Field>
          <Field label="Thermal width"><select className="field" name="receipt_width" disabled={disabled} defaultValue={settings.receipt_width}>
            <option value={80}>80 mm</option><option value={58}>58 mm</option>
          </select></Field>
        </div>
        <Field label="OS printer name (optional)"><input className="field" name="printer_name" maxLength={250} disabled={disabled}
          defaultValue={settings.printer_name ?? ''} placeholder="System default printer" /></Field>
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm font-medium">
          Receipt Print Preview <Switch label="Receipt Print Preview" checked={printPreview} onChange={setPrintPreview} disabled={disabled} />
        </div>
        {admin && <div className="relative">
          <Field label="Manager Override PIN"><input className="field pr-10" name="managerPin" type={showPin ? 'text' : 'password'}
            inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} disabled={disabled} placeholder="Enter a new four-digit PIN" /></Field>
          <button type="button" aria-label={showPin ? 'Hide manager PIN' : 'Show manager PIN'} onClick={() => setShowPin(!showPin)} className="absolute bottom-1.5 right-2 rounded p-1 text-slate-600">{showPin ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          <p className="mt-2 text-xs text-slate-500">Authorizes a cashier to close the business day.</p>
        </div>}
        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">License Key</span>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${settings.licenseActive ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
              {settings.licenseActive ? 'Active Commercial License' : settings.licenseConfigured ? 'License verification required' : 'No license configured'}
            </span></div>
          {admin && <input className="field" name="licenseKey" aria-label="New commercial license key" type="password" autoComplete="off"
            maxLength={2048} disabled={disabled} placeholder={settings.licenseConfigured ? 'Enter a key to replace the current key' : 'Enter commercial license key'} />}
        </div>
      </section>
    </div>
    <div className="sticky bottom-0 z-10 flex justify-end rounded-xl border bg-white/95 p-3 shadow-sm">
      <button className="primary h-11" disabled={disabled}>Save Settings</button>
    </div>
  </form>
}

const tabs = [
  { id: 'profile', label: 'Restaurant settings', icon: Building2 },
  { id: 'staff', label: 'Staff & PINs', icon: Users },
  { id: 'floor', label: 'Zones & locations', icon: Layers },
  { id: 'backup', label: 'Backup & cloud', icon: CloudUpload },
  { id: 'enterprise', label: 'Pricing & Printers', icon: Layers },
  { id: 'mobile', label: 'Mobile Waiter Sync', icon: Layers },
] as const

export default function SettingsPage() {
  const cashier = usePosStore(state => state.cashier)
  const [tab, setTab] = useState<typeof tabs[number]['id']>('profile')
  const allowed = cashier?.role === 'admin' ? tabs : tabs.slice(0, 1)
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><h1>Settings</h1><p className="subtitle">Customize the restaurant, manage staff and locations, and protect your local data.</p></div>
    <nav aria-label="Settings sections" className="flex flex-wrap gap-2 border-b pb-3">
      {allowed.map(({ id, label, icon: Icon }) => <button className={`secondary ${tab === id ? 'border-teal-300 bg-teal-50 text-teal-800' : ''}`}
        key={id} aria-pressed={tab === id} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}
    </nav>
    {tab !== 'profile' && <button className="secondary h-10" onClick={() => setTab('profile')}><ArrowLeft size={16} /> Back to Restaurant Settings</button>}
    {tab === 'profile' || cashier?.role !== 'admin' ? <ProfileSettings /> :
      tab === 'staff' ? <StaffSettings /> : tab === 'floor' ? <FloorSettings /> : tab === 'enterprise' ? <EnterpriseSettings /> : tab === 'mobile' ? <MobileWaiterSettings /> : <BackupSettings />}
  </div>
}
