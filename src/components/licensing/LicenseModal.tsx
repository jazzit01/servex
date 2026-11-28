import { useState } from 'react'
import { CheckCircle2, KeyRound } from 'lucide-react'
import DeviceId from './DeviceId'
import { Field, Modal } from '../ManagementControls'
import type { LicenseState } from '../../types/pos'

export default function LicenseModal({ state, close, activated }: {
  state: LicenseState; close: () => void; activated: (state: LicenseState) => void
}) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const active = state.mode === 'active'
  return <Modal title="Activate ServeX" onClose={close} dismissLabel="Close" dismissDisabled={busy}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault()
      if (!key.trim() || busy) return
      setBusy(true)
      setError('')
      try {
        activated(await window.servexApi.activateLicense(key))
        setKey('')
        setConfirmed(true)
      } catch (cause) { setError((cause as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) }
      finally { setBusy(false) }
    }}>
      {active ? <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
        <CheckCircle2 size={18}/> {confirmed ? 'ServeX activated offline.' : 'Active Commercial License'}
      </p> : <p className="text-sm text-slate-600">{state.mode === 'expired'
        ? 'Your 7-day trial has ended. Enter the Activation Key issued for this device.'
        : `Full trial · ${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left. Send your Device ID to the license issuer.`}</p>}
      <DeviceId value={state.machine}/>
      <Field label="Activation Key"><textarea data-modal-focus className="field font-mono text-sm" rows={3} required maxLength={256}
        spellCheck={false} autoComplete="off" disabled={busy} value={key}
        onChange={event => { setKey(event.target.value); setError('') }} placeholder="SVX-…" /></Field>
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <button className="primary" disabled={busy || !key.trim()}><KeyRound size={16}/> Activate Offline</button>
    </form>
  </Modal>
}
