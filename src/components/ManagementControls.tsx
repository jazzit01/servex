import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Image, X } from 'lucide-react'
import { foodIdFromReference } from '../types/foodLibrary'
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

const modalStack: HTMLDialogElement[] = []

export function Modal({ title, onClose, children, compact, wide, drawer, palette, dismissLabel = 'Cancel', dismissDisabled = false }: { title: string; onClose: () => void; children: ReactNode; compact?: boolean; wide?: boolean; drawer?: boolean; palette?: boolean; dismissLabel?: string; dismissDisabled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const toast = usePosStore(state => state.toast)
  const dismiss = useRef({ onClose, dismissDisabled })
  dismiss.current = { onClose, dismissDisabled }
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    modalStack.push(element)
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || modalStack.at(-1) !== element) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!event.repeat && !event.isComposing && !dismiss.current.dismissDisabled) dismiss.current.onClose()
    }
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('keydown', escape, true)
      const index = modalStack.lastIndexOf(element)
      if (index >= 0) modalStack.splice(index, 1)
      if (element.open) element.close()
    }
  }, [])
  return <dialog ref={dialog} aria-label={title} onCancel={event => {
    event.preventDefault()
    event.stopPropagation()
    if (!dismissDisabled && modalStack.at(-1) === event.currentTarget) onClose()
  }}
    className={`panel max-h-[90vh] max-w-[90vw] overflow-auto p-0 backdrop:bg-slate-950/40 ${drawer ? 'fixed inset-y-3 right-3 left-auto ml-auto mr-0 h-fit w-[520px]' : palette ? 'w-[576px] max-w-xl' : wide ? 'w-[768px] max-w-3xl' : compact ? 'w-[420px]' : 'w-[480px]'}`}>
    <div className="flex items-center justify-between border-b px-5 py-4">
      <h2>{title}</h2><button className="secondary p-1.5" type="button" aria-label="Close dialog" disabled={dismissDisabled} onClick={onClose}><X size={16} /></button>
    </div>
    <div className="p-5">{children}{toast?.error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-2 text-sm text-red-800">{toast.message}</p>}</div>
    <footer className="flex justify-end border-t px-5 py-3">
      <button className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        type="button" disabled={dismissDisabled} onClick={onClose}>{dismissLabel}</button>
    </footer>
  </dialog>
}

export function MediaThumbnail({ name, preview, alt, banner }: { name: string | null; preview?: string; alt: string; banner?: boolean }) {
  const builtIn = foodIdFromReference(name)
  const placeholder = useRef<HTMLSpanElement>(null)
  const [inView, setInView] = useState(!banner)
  const [resolved, setResolved] = useState<{ name: string; url: string | null }>()
  useEffect(() => {
    if (!banner || inView || !placeholder.current) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setInView(true)
    }, { rootMargin: '120px' })
    observer.observe(placeholder.current)
    return () => observer.disconnect()
  }, [banner, inView])
  useEffect(() => {
    if (!name || preview || builtIn || !inView) return
    let current = true
    void window.servexApi.readMedia(name).then(url => { if (current) setResolved({ name, url }) }).catch(() => {})
    return () => { current = false }
  }, [name, preview, inView, builtIn])
  const source = preview ?? (builtIn ? import.meta.env.BASE_URL + 'food-library/' + builtIn + '.svg' : resolved?.name === name ? resolved?.url : null)
  return source ? <img src={source} alt={alt} loading={banner ? 'lazy' : undefined} className={banner ? "h-24 w-full object-cover" : "size-10 rounded-lg border bg-white object-cover"} />
    : <span ref={placeholder} className={banner ? "grid h-24 w-full place-items-center bg-slate-100 text-slate-400" : "grid size-10 place-items-center rounded-lg border bg-slate-50 text-slate-400"}><Image size={17} aria-hidden /></span>
}
