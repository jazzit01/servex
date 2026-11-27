import { useState } from 'react'
import { Field, Modal } from '../ManagementControls'

export default function ManagerPin({ title, onClose, onVerify }: {
  title: string; onClose: () => void; onVerify: (pin: string) => Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  return <Modal compact title={title} onClose={() => { if (!busy) onClose() }}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault()
      const form = event.currentTarget
      const pin = String(new FormData(form).get('pin'))
      setBusy(true)
      try { if (await onVerify(pin)) onClose(); else form.reset() }
      finally { setBusy(false) }
    }}>
      <Field label="Manager override PIN"><input className="field" name="pin" type="password" inputMode="numeric"
        autoFocus autoComplete="off" maxLength={4} pattern="[0-9]{4}" required /></Field>
      <button className="primary" disabled={busy}>Authorize</button>
    </form>
  </Modal>
}
