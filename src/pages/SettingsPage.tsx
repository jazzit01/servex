import { useState } from 'react'
import { Download, ImagePlus, Upload } from 'lucide-react'
import { runAction, usePosStore } from '../store/usePosStore'
import type { SettingsInput } from '../types/pos'

const fields = [
  ['restaurant_name', 'Restaurant name', 80], ['tagline', 'Tagline', 250],
  ['address', 'Address', 250], ['phone', 'Phone', 250], ['gstin', 'GSTIN', 250],
  ['currency_symbol', 'Currency symbol', 6], ['receipt_footer', 'Receipt footer', 250],
] as const

export default function SettingsPage() {
  const { data, cashier, lock, notify } = usePosStore()
  const [busy, setBusy] = useState(false)
  if (!data) return null
  const disabled = busy || cashier?.role === 'cashier'
  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    await runAction(action, message)
    setBusy(false)
  }
  return <div className="workspace"><div><h1>Settings</h1><p className="subtitle">Manage restaurant details, branding, and local backups.</p></div>
    <form className="panel space-y-4 p-5" onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const input = Object.fromEntries(fields.map(([key]) => [key, String(form.get(key) ?? '')])) as unknown as SettingsInput
      input.tax_rate = Number(form.get('tax_rate'))
      input.tax_inclusive = form.has('tax_inclusive') ? 1 : 0
      void act(() => window.servexApi.updateSettings(input), 'Settings saved.')
    }}>
      <h2>Restaurant profile</h2><div className="grid grid-cols-2 gap-4">{fields.map(([key, label, max]) => <label className="space-y-1 text-sm font-medium" key={key}>
        <span>{label}</span><input className="field" maxLength={max} required={['restaurant_name', 'currency_symbol'].includes(key)} disabled={disabled} name={key} defaultValue={data.settings[key] ?? ''} />
      </label>)}
      <label className="space-y-1 text-sm font-medium"><span>Fallback tax rate (%)</span><input className="field" type="number" required min="0" max="100" step="0.01" name="tax_rate" disabled={disabled} defaultValue={data.settings.tax_rate} /></label></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-teal-600" name="tax_inclusive" disabled={disabled} defaultChecked={Boolean(data.settings.tax_inclusive)} /> Menu prices include tax</label>
      <div className="flex gap-2"><button className="primary" disabled={disabled}>Save settings</button><button type="button" className="secondary" disabled={disabled} onClick={() => void act(() => window.servexApi.pickLogo(), 'Restaurant logo updated.')}><ImagePlus size={16} /> Upload logo</button></div>
    </form>
    <section className="panel space-y-3 p-5"><div><h2>Local database backups</h2><p className="subtitle">Export a .svxbak file or restore an existing backup. Uploaded logos are stored separately.</p></div>
      <div className="flex gap-2"><button className="secondary" disabled={disabled} onClick={() => void act(() => window.servexApi.exportBackup(), 'Backup exported.')}><Download size={16} /> Export backup</button>
        <button className="secondary" disabled={disabled} onClick={async () => {
          setBusy(true)
          try { if (await window.servexApi.importBackup()) { await lock(); notify('Backup restored. Sign in to continue.') } }
          catch (error) { notify(String(error), true) }
          finally { setBusy(false) }
        }}><Upload size={16} /> Restore backup</button>
      </div>
    </section>
  </div>
}
