import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { usePosStore } from '../../store/usePosStore'
import type { Cashier } from '../../types/pos'

export default function PinLogin({ openSetup, disabled }: { openSetup: () => void; disabled: boolean }) {
  const signIn = usePosStore(state => state.signIn)
  const [staff, setStaff] = useState<Cashier[]>([])
  const [selected, setSelected] = useState<number>()
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const entry = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let current = true
    void window.servexApi.activeStaff().then(rows => { if (current) setStaff(rows) }).catch(() => {})
    return () => { current = false }
  }, [])
  return <div className="grid h-screen place-items-center bg-slate-50">
    <div className="panel w-[480px] max-w-[90vw] p-8">
      <div className="mb-5 grid size-12 place-items-center rounded-xl bg-teal-600 font-bold text-white">SX</div>
      <h1 className="text-2xl">Staff Sign-In — Enter Your 4-Digit PIN</h1>
      <p className="subtitle">{disabled ? 'Complete restaurant setup to open the till.' : 'Tap your staff profile below or type your 4-digit PIN to unlock'}</p>
      {!disabled && staff.length > 0 && <div className="mt-4 flex max-h-28 flex-wrap gap-2 overflow-y-auto" aria-label="Active staff">
        {staff.map(user => <button type="button" key={user.id} disabled={busy} aria-pressed={selected === user.id}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${selected === user.id ? 'border-teal-300 bg-teal-50 text-teal-800' : 'bg-slate-50 text-slate-700 hover:bg-white'}`}
          onClick={() => { setSelected(selected === user.id ? undefined : user.id); setPin(''); setShowPin(false); setError(''); entry.current?.focus() }}>
          {user.name} <span className="capitalize">({user.role})</span></button>)}
      </div>}
      <form className="mt-5 space-y-4" onSubmit={async event => {
        event.preventDefault()
        if (disabled || busy) return
        setBusy(true); setError('')
        try {
          if (!(await signIn(pin, selected))) { setError('The PIN was not recognized for this sign-in.'); setPin(''); entry.current?.focus() }
        } catch (cause) { setError((cause as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) }
        finally { setBusy(false) }
      }}>
        <div className="space-y-2">
          <label htmlFor="staff-pin" className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole size={15}/> Enter 4-Digit Staff PIN</label>
          <div className="relative">
            <input id="staff-pin" ref={entry} autoFocus={!disabled} required disabled={disabled} type={showPin ? 'text' : 'password'}
              inputMode="numeric" autoComplete="off" placeholder="e.g. 1234" pattern="[0-9]{4}" maxLength={4}
              className="field pr-11" value={pin} onChange={event => setPin(event.target.value.replace(/[^0-9]/g, ''))}/>
            <button type="button" aria-label={showPin ? 'Hide PIN' : 'Show PIN'} aria-controls="staff-pin" disabled={disabled}
              className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-slate-600 hover:bg-slate-100"
              onClick={() => { setShowPin(value => !value); entry.current?.focus() }}>{showPin ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="primary w-full" disabled={busy || disabled}>Sign in <ArrowRight size={16} /></button>
      </form>
      <button className="mt-5 w-full border-t pt-4 text-sm font-semibold text-teal-800 hover:underline" type="button" disabled={busy} onClick={openSetup}>
        First-Time Restaurant Setup / Restore Backup
      </button>
    </div>
  </div>
}
