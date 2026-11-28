import { useState } from 'react'
import { DatabaseBackup } from 'lucide-react'
import { Field,Modal } from '../ManagementControls'
import { runAction } from '../../store/usePosStore'

export default function QuickBackup({close}:{close:()=>void}){
  const [busy,setBusy]=useState(false)
  return <Modal compact title="Create Backup" onClose={close} dismissDisabled={busy}>
    <form className="space-y-3" onSubmit={async e=>{
      e.preventDefault()
      const passphrase=String(new FormData(e.currentTarget).get('passphrase'))
      setBusy(true)
      if(await runAction(()=>window.servexApi.exportBackup(passphrase),'Encrypted backup saved.'))close()
      setBusy(false)
    }}>
      <Field label="Backup passphrase"><input className="field" autoFocus name="passphrase" type="password" minLength={12} maxLength={256} required autoComplete="new-password"/></Field>
      <button className="primary" disabled={busy}><DatabaseBackup size={16}/>Choose Backup Location</button>
    </form>
  </Modal>
}
