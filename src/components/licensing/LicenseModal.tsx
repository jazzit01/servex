import { useState } from 'react'
import { CheckCircle2, Copy, KeyRound } from 'lucide-react'
import { Field, Modal } from '../ManagementControls'
import type { LicenseState } from '../../types/pos'

export default function LicenseModal({ state, close, activated }: {
  state: LicenseState; close: () => void; activated: (state: LicenseState) => void
}) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [clipboardError, setClipboardError] = useState(false)
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
        ? 'Your 7-day trial has ended. Enter the key issued for this device.'
        : `Full trial · ${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left. Send your Device ID to the license issuer.`}</p>}
      <div className="space-y-2 rounded-lg border bg-slate-50 p-3">
        <Field label="Device ID"><input readOnly value={state.machine} onFocus={event => event.currentTarget.select()}
          className="field select-all font-mono text-lg font-semibold tracking-wide tabular-nums"/></Field>
        <button className="secondary" type="button" onClick={async () => {
          setCopied(false)
          setClipboardError(false)
          try { await navigator.clipboard.writeText(state.machine); setCopied(true) }
          catch { setClipboardError(true) }
        }}><Copy size={15}/> Copy Device ID</button>
        {copied && <span role="status" className="ml-2 caption">Copied</span>}
        {clipboardError && <p role="alert" className="caption">Select and copy the Device ID manually.</p>}
      </div>
      <Field label="Enter License Key"><textarea data-modal-focus className="field font-mono text-sm" rows={3} required maxLength={256}
        spellCheck={false} autoComplete="off" disabled={busy} value={key}
        onChange={event => { setKey(event.target.value); setError('') }} placeholder="SVX-…" /></Field>
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <button className="primary" disabled={busy || !key.trim()}><KeyRound size={16}/> Activate Offline</button>
    </form>
  </Modal>
}
