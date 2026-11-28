import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyToClipboard } from '../../utils/copyToClipboard'
import { Field } from '../ManagementControls'

export default function DeviceId({ value }: { value: string }) {
  const [feedback, setFeedback] = useState<'copied' | 'error'>()
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    clearTimeout(timer.current)
    try {
      await copyToClipboard(value)
      clearTimeout(timer.current)
      setFeedback('copied')
      timer.current = setTimeout(() => setFeedback(undefined), 2000)
    } catch {
      setFeedback('error')
    }
  }

  return <div className="space-y-2 rounded-lg border bg-slate-50 p-3">
    <Field label="Device ID"><input readOnly value={value} onFocus={event => event.currentTarget.select()}
      className="field select-all font-mono text-lg font-semibold tracking-wide tabular-nums"/></Field>
    <div className="flex flex-wrap items-center gap-2">
      <button className="secondary" type="button" onClick={() => void copy()}><Copy size={15}/> Copy Device ID</button>
      {feedback === 'copied' && <span role="status" className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800"><Check size={14}/> Copied!</span>}
    </div>
    {feedback === 'error' && <p role="alert" className="caption">Select and copy the Device ID manually.</p>}
  </div>
}
