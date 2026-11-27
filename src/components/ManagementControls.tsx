import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Image, X } from 'lucide-react'
import { usePosStore } from '../store/usePosStore'

export function Switch({ checked, onChange, label, disabled = false }: {
  checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-teal-600' : 'bg-slate-300'}`}>
    <span className={`size-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : ''}`} />
  </button>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-sm font-medium text-slate-700">
    <span>{label}</span>{children}
  </label>
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const toast = usePosStore(state => state.toast)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => { if (element.open) element.close() }
  }, [])
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); onClose() }}
    className="panel max-h-[90vh] w-[480px] max-w-[90vw] overflow-auto p-0 backdrop:bg-slate-950/40">
    <div className="flex items-center justify-between border-b px-5 py-4">
      <h2>{title}</h2><button className="secondary p-1.5" type="button" aria-label="Close dialog" onClick={onClose}><X size={16} /></button>
    </div>
    <div className="p-5">{children}{toast?.error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-2 text-sm text-red-800">{toast.message}</p>}</div>
  </dialog>
}

export function MediaThumbnail({ name, preview, alt }: { name: string | null; preview?: string; alt: string }) {
  const [resolved, setResolved] = useState<{ name: string; url: string | null }>()
  useEffect(() => {
    if (!name || preview) return
    let current = true
    void window.servexApi.readMedia(name).then(url => { if (current) setResolved({ name, url }) }).catch(() => {})
    return () => { current = false }
  }, [name, preview])
  const source = preview ?? (resolved?.name === name ? resolved?.url : null)
  return source ? <img src={source} alt={alt} className="size-10 rounded-lg border bg-white object-cover" />
    : <span className="grid size-10 place-items-center rounded-lg border bg-slate-50 text-slate-400"><Image size={17} aria-hidden /></span>
}
