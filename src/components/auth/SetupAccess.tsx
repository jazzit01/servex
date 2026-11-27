import { useState } from 'react'
import { Field, Modal } from '../ManagementControls'
import type { SetupProfile } from '../../types/pos'

export default function SetupAccess({ close, authorized }: { close: () => void; authorized: (profile: SetupProfile) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal compact title="Verify Administrator" onClose={close} dismissDisabled={busy}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault()
      const pin = String(new FormData(event.currentTarget).get('pin'))
      setBusy(true); setError('')
      try { authorized(await window.servexApi.authorizeSetup(pin)) }
      catch (cause) { setError((cause as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) }
      finally { setBusy(false) }
    }}>
      <p className="text-sm text-slate-600">Enter an administrator PIN to reopen the setup wizard or replace this restaurant’s data with a backup.</p>
      <Field label="Administrator PIN"><input autoFocus name="pin" className="field" required type="password" inputMode="numeric"
        autoComplete="off" pattern="[0-9]{4}" maxLength={4} /></Field>
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <button className="primary" disabled={busy}>Continue to Setup</button>
    </form>
  </Modal>
}
