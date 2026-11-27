import { useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import { Field, Modal } from '../ManagementControls'
import type { LicenseState } from '../../types/pos'

export default function LicenseModal({ state, close, activated }: {
  state: LicenseState; close: () => void; activated: (state: LicenseState) => void
}) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  return <Modal compact title="Activate ServeX" onClose={() => { if (!busy && state.mode !== 'expired') close() }}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('')
      try { activated(await window.servexApi.activateLicense(key)); setKey('') }
      catch (cause) { setError((cause as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) }
      finally { setBusy(false) }
    }}>
      <p className="text-sm text-slate-600">{state.mode === 'expired'
        ? 'Your 7-day trial has ended. Enter an activation key issued for this machine.'
        : `Full trial · ${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left. Send your machine ID to the license issuer.`}</p>
      <div className="rounded-lg border bg-slate-50 p-3">
        <p className="caption">Machine ID</p><div className="mt-1 flex flex-wrap items-center gap-2"><code className="break-all text-sm">{state.machine}</code>
          <button className="secondary p-1.5" type="button" aria-label="Copy machine ID" onClick={() => {
            void navigator.clipboard.writeText(state.machine).then(() => setCopied(true)).catch(() => setError('Select and copy the machine ID manually.'))
          }}><Copy size={15} />{copied && 'Copied'}</button>
        </div>
      </div>
      <Field label="Activation key"><textarea className="field font-mono text-xs" rows={4} required maxLength={256}
        value={key} onChange={event => setKey(event.target.value)} placeholder="SVX-…" /></Field>
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <button className="primary" disabled={busy}><KeyRound size={16} /> Activate Offline</button>
    </form>
  </Modal>
}
