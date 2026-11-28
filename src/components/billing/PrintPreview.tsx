import { useState } from 'react'
import { Printer } from 'lucide-react'
import { Modal } from '../ManagementControls'
import { usePosStore } from '../../store/usePosStore'
import type { PrintResult } from '../../types/pos'

export function publishPrint(result: PrintResult) {
  const store = usePosStore.getState()
  if (result.html) store.setPrint(result)
  else if (result.error) store.notify(result.error, true)
}

export default function PrintPreview() {
  const { print, setPrint } = usePosStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!print?.html) return null
  const job = print.jobId
  const advance=()=>{
    const [next,...remaining]=print.next??[]
    setPrint(next?{...next,next:remaining}:null);setError('')
  }
  return <Modal title="Print preview" dismissLabel="Back" dismissDisabled={busy} onClose={() => { if (!busy) {setPrint(null);setError('')} }}>
    {print.error && <p className="mb-3 rounded bg-amber-50 p-3 text-sm text-amber-950">{print.error}</p>}
    <div className="rounded-lg border bg-slate-100 p-2">
      <iframe title="Thermal print preview" sandbox="" srcDoc={print.html} className="block h-[55vh] w-full bg-white" />
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <div className="mt-3 flex justify-end gap-2">
      {!!print.next?.length&&<button className="secondary" disabled={busy} onClick={advance}>Next Ticket</button>}
      <button className="primary" disabled={busy || !job} onClick={async () => {
        if (!job) return
        setBusy(true); setError('')
        try { await window.servexApi.printPreview(job); advance() }
        catch (cause) { setError((cause as Error).message) }
        finally { setBusy(false) }
      }}><Printer size={16} /> Print</button>
    </div>
  </Modal>
}
