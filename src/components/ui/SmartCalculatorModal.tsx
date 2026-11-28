import { useState, type KeyboardEvent } from 'react'
import { Copy, Delete } from 'lucide-react'
import { Field, Modal } from '../ManagementControls'
import { useCalculatorBridge } from './calculatorBridge'
import { calculate } from './calculatorMath'

export type CalculatorEntry = { equation: string; result: number }
const keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '=', '+']
const symbol = (key: string) => key === '/' ? '÷' : key === '*' ? '×' : key
const defaultLabel = 'Misc / Open Charge'

export default function SmartCalculatorModal({ close, tape, record, besideCart }: {
  close: () => void; tape: CalculatorEntry[]; besideCart: boolean; record: (entry: CalculatorEntry) => void
}) {
  const apply = useCalculatorBridge(state => state.apply)
  const [expression, setExpression] = useState('')
  const [evaluated, setEvaluated] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [charge, setCharge] = useState<number | null>(null)
  const [label, setLabel] = useState(defaultLabel)

  function resolve(helper?: { label: string; suffix: string }) {
    try {
      const base = expression || '0'
      const equation = helper ? base + ' ' + helper.label : base
      const result = helper ? calculate(String(calculate(base)) + helper.suffix) : calculate(base)
      if (helper || (!evaluated && /[+*/-]/.test(base.slice(1)))) record({ equation, result })
      setExpression(String(result))
      setEvaluated(true)
      setError('')
      return result
    } catch (failure) {
      setError((failure as Error).message)
      return null
    }
  }

  function press(key: string) {
    setError('')
    setStatus('')
    if (key === '=') { resolve(); return }
    if (key === 'clear') { setExpression(''); setEvaluated(false); return }
    if (key === 'Backspace') { setExpression(value => value.slice(0, -1)); setEvaluated(false); return }
    setExpression(value => ((evaluated && /[\d.]/.test(key) ? '' : value) + key).slice(0, 120))
    setEvaluated(false)
  }

  function keyboard(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing ||
        event.target instanceof HTMLInputElement) return
    const key = event.key
    if (key === 'Enter' && event.code !== 'NumpadEnter' && event.target instanceof HTMLButtonElement) return
    if (key === 'Enter' || key === '=' || key === 'Backspace' || /^[\d.+*/-]$/.test(key)) {
      event.preventDefault()
      event.stopPropagation()
      press(key === 'Enter' ? '=' : key)
    }
  }

  function bridge(kind: 'charge' | 'discount' | 'tender') {
    const amount = resolve()
    if (amount === null) return
    if (amount < 0 || (kind === 'charge' && (amount < 0.01 || amount > 9999999.99))) {
      setError('Enter a valid amount for this action.')
      return
    }
    if (kind === 'charge') { setLabel(defaultLabel); setCharge(amount); return }
    apply?.({ kind, amount })
    close()
  }

  return <Modal title="Smart Calculator" onClose={close} dismissLabel="Close" calculator={besideCart ? 'beside-cart' : 'right'} onKeyDown={keyboard}>
    <div className="space-y-3 outline-none" tabIndex={-1} data-modal-focus>
      {tape.length > 0 && <ol aria-label="Calculation tape" className="space-y-1 rounded-lg border bg-slate-50 p-2 text-xs dark:bg-slate-900">
        {tape.map((entry, index) => <li className="flex items-center gap-1" key={index}>
          <button className="min-w-0 flex-1 truncate rounded p-1 text-left hover:bg-slate-100" title="Reuse result" onClick={() => {
            setExpression(String(entry.result)); setEvaluated(true); setError('')
          }}>{entry.equation} = {entry.result.toFixed(2)}</button>
          <button className="secondary p-1" type="button" aria-label={`Copy ${entry.result.toFixed(2)}`} onClick={() =>
            void navigator.clipboard.writeText(entry.result.toFixed(2)).then(() => setStatus('Result copied.'), () => setError('Could not copy the result.'))}><Copy size={13}/></button>
        </li>)}
      </ol>}
      <output aria-label="Calculator display" aria-live="polite" className="block break-all rounded-lg border bg-slate-50 p-3 text-right text-2xl font-semibold dark:bg-slate-900">
        {evaluated && expression ? Number(expression).toFixed(2) : expression || '0'}
      </output>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      {status && <p className="caption" role="status">{status}</p>}
      <div className="flex flex-wrap gap-1" aria-label="Tax and split shortcuts">
        {[[ '+5% GST', '*1.05' ], [ '+18% GST', '*1.18' ], [ '÷ 2', '/2' ], [ '÷ 3', '/3' ], [ '÷ 4', '/4' ]].map(([label, suffix]) =>
          <button key={label} className="rounded-full bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800" onClick={() => resolve({ label, suffix })}>{label}</button>)}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <button className="secondary col-span-3 justify-center" onClick={() => press('clear')}>Clear</button>
        <button className="secondary justify-center" aria-label="Backspace" onClick={() => press('Backspace')}><Delete size={17}/></button>
        {keys.map(key => <button key={key} className={`h-9 justify-center ${key === '=' ? 'primary' : 'secondary'}`} onClick={() => press(key)}>{symbol(key)}</button>)}
      </div>
      {apply && (charge === null ? <div className="grid gap-1.5 border-t pt-3">
        <button className="secondary justify-center" onClick={() => bridge('charge')}>Add to Cart as Custom Item</button>
        <button className="secondary justify-center" onClick={() => bridge('discount')}>Apply as Flat Discount</button>
        <button className="secondary justify-center" onClick={() => bridge('tender')}>Set Cash Tendered</button>
      </div> : <form className="space-y-2 border-t pt-3" onSubmit={event => {
        event.preventDefault()
        if (!label.trim() || /[\x00-\x1f\x7f]/.test(label)) {
          setError('Enter a valid custom item label.')
          return
        }
        apply({ kind: 'charge', name: label.trim(), amount: charge })
        close()
      }}>
        <Field label="Custom item label"><input autoFocus className="field" value={label} maxLength={120} required onChange={event => setLabel(event.target.value)}/></Field>
        <div className="flex gap-2">
          <button type="button" className="secondary" onClick={() => setCharge(null)}>Back</button>
          <button className="primary" type="submit">Add {charge.toFixed(2)}</button>
        </div>
      </form>)}
    </div>
  </Modal>
}
