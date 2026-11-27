import { useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, Check, ImagePlus, Upload } from 'lucide-react'
import { Field, Modal } from '../ManagementControls'
import type { PickedMedia, SetupInput, SetupProfile } from '../../types/pos'

const presets = { dinein: 'Dine-In Only', garden: 'Restaurant + Garden', lodging: 'Restaurant + Lodging Rooms' } as const
const labels = ['Brand Identity', 'Floor & Tax Setup', 'Ready to Sell']

export default function SetupWizard({ complete, cancel, profile }: { complete: () => Promise<void>; cancel: () => void; profile?: SetupProfile }) {
  const [step, setStep] = useState(0)
  const [input, setInput] = useState<SetupInput>(profile?.input ?? { name: '', phone: '', address: '', gstin: '', logo: null, preset: 'dinein', tax: 5, upi: 'servex@upi', pin: '' })
  const [logo, setLogo] = useState<PickedMedia | null | undefined>(profile?.logo ?? undefined)
  const [restoring, restore] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const change = <K extends keyof SetupInput>(key: K, value: SetupInput[K]) => setInput(previous => ({ ...previous, [key]: value }))
  async function work(action: () => Promise<void>) {
    setError(''); setBusy(true)
    try { await action() } catch (cause) { setError((cause as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) }
    finally { setBusy(false) }
  }
  return <div className="grid h-screen place-items-center bg-slate-50">
    <Modal wide title="Set up ServeX POS" dismissDisabled={busy} dismissLabel={restoring ? 'Back' : 'Cancel'}
      onClose={() => { if (restoring) { restore(false); setError('') } else cancel() }}>
      <ol className="mb-5 grid grid-cols-3 gap-2" aria-label="Setup steps">{labels.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}
        className={`flex items-center gap-2 rounded-lg p-2 text-xs font-semibold ${step === index ? 'bg-teal-50 text-teal-800' : 'bg-slate-50 text-slate-500'}`}>
        {step > index ? <Check size={15} /> : <span>{index + 1}</span>}{label}</li>)}</ol>
      {!restoring ? <form className="space-y-4" onSubmit={event => {
        event.preventDefault()
        if (busy) return
        if (step < 2) { setError(''); setStep(step + 1) }
        else void work(async () => { await window.servexApi.finishSetup({ ...input, logo: logo === undefined ? input.logo : logo?.name ?? null }); await complete() })
      }}>
        {step === 0 && <>
          <h2>Brand Identity</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Restaurant name"><input className="field" required maxLength={80} value={input.name} onChange={e => change('name', e.target.value)} /></Field>
            <Field label="Phone"><input className="field" type="tel" maxLength={40} value={input.phone} onChange={e => change('phone', e.target.value)} /></Field>
            <Field label="Address"><input className="field" maxLength={250} value={input.address} onChange={e => change('address', e.target.value)} /></Field>
            <Field label="GSTIN"><input className="field" maxLength={80} value={input.gstin} onChange={e => change('gstin', e.target.value)} /></Field>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-slate-50 p-3">
            <img className="size-12 rounded-lg object-contain" alt="Logo preview" src={logo?.preview ?? import.meta.env.BASE_URL + 'servex-logo.png'} />
            <button className="secondary" type="button" disabled={busy} onClick={() => void work(async () => {
              const picked = await window.servexApi.setupLogo(); if (picked) setLogo(picked)
            })}><ImagePlus size={17} /> Upload optional logo</button>
            {logo && <button className="secondary" type="button" onClick={() => setLogo(null)}>Use Default</button>}
          </div>
        </>}
        {step === 1 && <>
          <h2>Floor &amp; Tax Setup</h2>
          {profile ? <p className="subtitle">Your existing zones, tables, menu, and sales history stay in place.</p> : <div className="grid grid-cols-3 gap-2">{Object.entries(presets).map(([key, label]) => <button key={key} type="button"
            className={input.preset === key ? 'primary' : 'secondary'} aria-pressed={input.preset === key} onClick={() => change('preset', key as SetupInput['preset'])}>
            <Building2 size={16} />{label}</button>)}</div>}
          <div className="grid grid-cols-3 gap-2">
            <Field label="Tax rate (%)"><input className="field" type="number" required min={0} max={100} step=".01" value={input.tax} onChange={e => change('tax', Number(e.target.value))} /></Field>
            <Field label="UPI ID"><input className="field" required maxLength={185} value={input.upi} onChange={e => change('upi', e.target.value)} /></Field>
            <Field label={profile ? "New admin PIN (optional)" : "New admin PIN"}><input className="field" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}"
              maxLength={4} required={!profile} value={input.pin} onChange={e => change('pin', e.target.value)} /></Field>
          </div>
        </>}
        {step === 2 && <section className="rounded-xl border bg-teal-50 p-5">
          <h2>Ready to Sell</h2><div className="mt-3 text-xl font-bold">{input.name}</div>
          <p className="subtitle">{profile ? 'Existing floor layout' : presets[input.preset]} · {input.tax}% tax · {input.upi}</p>
          <p className="mt-2 text-sm text-teal-900">Sign in with your administrator PIN to open the till.</p>
        </section>}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {step > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => { setError(''); setStep(step - 1) }}><ArrowLeft size={16} /> Back</button>}
          <button type="button" className="secondary mr-auto" disabled={busy} onClick={() => { setError(''); restore(true) }}><Upload size={16} /> Restore Existing .svxbak Backup</button>
          <button className="primary" disabled={busy}>{step === 2 ? 'Launch ServeX POS' : 'Continue'}<ArrowRight size={16} /></button>
        </div>
      </form> : <form className="space-y-4" onSubmit={event => {
        event.preventDefault()
        const secret = String(new FormData(event.currentTarget).get('secret'))
        void work(async () => { if (await window.servexApi.restoreSetup(secret)) await complete() })
      }}>
        <h2>Restore a migration backup</h2><p className="subtitle">Enter the full backup’s passphrase. {profile && 'Leave it blank only for a backup encrypted on this PC.'}</p>
        <Field label="Backup passphrase"><input className="field" name="secret" type="password" autoComplete="off" minLength={12} maxLength={256} required={!profile} /></Field>
        <button className="primary" disabled={busy}>Choose Backup</button>
      </form>}
      {error && <p role="alert" className="mt-3 rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    </Modal>
  </div>
}
