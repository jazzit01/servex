import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Wifi } from 'lucide-react'
import { Switch } from '../ManagementControls'
import type { LanState } from '../../types/pos'

export default function MobileWaiterSettings() {
  const [state, setState] = useState<LanState>()
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    void window.servexApi.lanStatus().then(value => { if (current) setState(value) })
      .catch(cause => { if (current) setError(cause.message) })
    return () => { current = false }
  }, [])
  useEffect(() => {
    let current = true
    setQr('')
    if (state?.pairing) void QRCode.toDataURL(state.pairing, { width: 240, margin: 4 })
      .then(value => { if (current) setQr(value) }).catch(() => { if (current) setError('Could not create the pairing QR.') })
    return () => { current = false }
  }, [state?.pairing])
  return <section className="panel space-y-4 p-5">
    <div className="flex items-start justify-between"><div><h2 className="flex items-center gap-2"><Wifi size={18} /> Mobile Waiter Sync</h2>
      <p className="subtitle">Pair a waiter or owner app on the same trusted restaurant network.</p></div>
      <Switch label="Mobile Waiter Sync" checked={Boolean(state?.enabled)} disabled={busy || !state} onChange={async enabled => {
        setBusy(true); setError('')
        try { setState(await window.servexApi.configureLan(enabled)) }
        catch (cause) { setError((cause as Error).message) }
        finally { setBusy(false) }
      }} />
    </div>
    {(error || state?.error) && <p className="rounded bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error || state?.error}</p>}
    {state?.enabled && <div className="flex items-center gap-4 rounded-lg border bg-slate-50 p-4">
      {qr && <img className="size-40 rounded border bg-white" alt="Mobile Waiter pairing QR" src={qr} />}
      <div><p className="caption">Local network address</p><code className="text-sm font-bold">{state.url}</code>
        <p className="mt-2 max-w-sm text-xs text-slate-600">Pairing uses your local Wi-Fi. QR access is shared with anyone who scans it. Turning sync off revokes the pairing.</p>
      </div>
    </div>}
  </section>
}
