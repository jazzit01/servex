import { useState } from 'react'
import { CloudUpload, Download, HardDrive, Upload } from 'lucide-react'
import { Field, Switch } from '../ManagementControls'
import { runAction, usePosStore } from '../../store/usePosStore'

export default function BackupSettings() {
  const { data, lock, refresh, notify } = usePosStore()
  const [passphrase, setPassphrase] = useState('')
  const [enabled, setEnabled] = useState(Boolean(data?.settings.cloud_sync_enabled))
  const [busy, setBusy] = useState(false)
  if (!data?.cloud) return null
  const cloud = data.cloud
  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    const result = await runAction(action, message)
    setBusy(false)
    return result
  }
  async function restore() {
    setBusy(true)
    try {
      const result = await window.servexApi.importBackup(passphrase)
      if (result === 'locked') { await lock(); notify('Backup restored. Sign in using the restored staff PIN.') }
      else if (result === 'restored') {
        await refresh()
        setPassphrase('')
        notify('Backup restored.')
        usePosStore.getState().navigate('floor')
      }
    } catch (error) { notify((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true) }
    finally { setBusy(false) }
  }
  return <div className="grid grid-cols-2 items-start gap-6">
    <section className="panel space-y-4 p-5">
      <div><h2 className="flex items-center gap-2"><HardDrive size={19} className="text-teal-700" /> Local backup & PC migration</h2>
        <p className="subtitle">Full backups encrypt your database, logo, and dish photos in one file.</p></div>
      <Field label="Backup passphrase"><input className="field" type="password" autoComplete="off" maxLength={256} value={passphrase}
        onChange={event => setPassphrase(event.target.value)} placeholder="At least 12 characters" /></Field>
      <p className="text-xs leading-relaxed text-slate-600">Keep the passphrase for restores on another PC. Leave it blank to restore an automatic backup on this Windows account.</p>
      <div className="flex flex-wrap gap-2">
        <button className="primary" disabled={busy || passphrase.length < 12} onClick={async () => {
          if (await act(() => window.servexApi.exportBackup(passphrase), 'Encrypted backup saved.')) setPassphrase('')
        }}><Download size={16} /> Create Full Backup</button>
        <button className="secondary" disabled={busy || (passphrase.length > 0 && passphrase.length < 12)} onClick={() => void restore()}><Upload size={16} /> Restore Backup</button>
      </div>
      <p className="border-t pt-3 text-xs leading-relaxed text-slate-600">ServeX keeps the five most recent encrypted exit backups on this PC and creates a recovery snapshot before each restore.</p>
    </section>
    <form className="panel space-y-4 p-5" onSubmit={async event => {
      event.preventDefault()
      const target = event.currentTarget
      const form = new FormData(target)
      const saved = await act(() => window.servexApi.updateCloud({
        enabled, endpoint: String(form.get('endpoint')).trim(),
        token: String(form.get('token') || '') || undefined,
        passphrase: String(form.get('passphrase') || '') || undefined,
      }), 'Cloud backup settings saved.')
      if (saved) {
        for (const name of ['token', 'passphrase']) {
          const input = target.elements.namedItem(name) as HTMLInputElement
          input.value = ''
        }
      }
    }}>
      <div><h2 className="flex items-center gap-2"><CloudUpload size={19} className="text-teal-700" /> Cloud Backup <span className="rounded bg-teal-50 px-1.5 text-xs text-teal-800">Pro</span></h2>
        <p className="subtitle">Upload an encrypted backup to your restaurant’s backup service.</p></div>
      <div className="flex items-center justify-between gap-3 text-sm font-semibold">Enable Automated Cloud Backup
        <Switch checked={enabled} onChange={setEnabled} disabled={busy} label="Enable Automated Cloud Backup" /></div>
      <Field label="Cloud API Endpoint URL"><input className="field" name="endpoint" type="url" placeholder="https://backup.example.com/servex"
        maxLength={2048} defaultValue={data.settings.cloud_endpoint ?? ''} /></Field>
      <Field label="Restaurant Cloud Token"><input className="field" name="token" type="password" autoComplete="off" maxLength={4096}
        placeholder={cloud.tokenConfigured ? 'Saved · enter to replace' : 'Enter token'} /></Field>
      <Field label="Cloud backup passphrase"><input className="field" name="passphrase" type="password" autoComplete="off" minLength={12} maxLength={256}
        placeholder={cloud.passphraseConfigured ? 'Saved · enter to replace' : 'At least 12 characters'} /></Field>
      <p className="text-xs text-slate-600">Keep this passphrase to restore a cloud backup on another PC.</p>
      <div className="flex flex-wrap items-center gap-2"><button className="primary" disabled={busy}>Save cloud settings</button>
        <button type="button" className="secondary" disabled={busy || !cloud.tokenConfigured || !cloud.passphraseConfigured}
          onClick={() => void act(() => window.servexApi.syncCloud(), 'Encrypted backup uploaded.')}>Sync Now</button></div>
      <p className="text-sm text-slate-600">Last Synced: {cloud.lastSynced ? new Date(cloud.lastSynced).toLocaleString() : 'Never'}</p>
    </form>
  </div>
}
