import { useState, useRef, type PointerEvent } from 'react'
import { BedDouble, Clock3, MoveDiagonal2, Trees, Users, Utensils } from 'lucide-react'
import { editRect, GRID } from '../../types/floorLayout'
import type { zoneAppearance } from './zoneAppearance'
import type { FloorTable, LayoutRect, Order } from '../../types/pos'

export const statusVisuals = {
  vacant: { title: 'Vacant', label: 'Available', dot: 'bg-slate-200', card: 'border-slate-300' },
  occupied: { title: 'Occupied', label: 'Occupied', dot: 'bg-amber-500', card: 'border-amber-500' },
  billed: { title: 'Bill Printed', label: 'Bill Printed', dot: 'bg-emerald-500', card: 'border-emerald-500' },
  cleaning: { title: 'Cleaning', label: 'Needs Cleaning', dot: 'bg-rose-400', card: 'border-rose-400' },
} as const

const typeIcons = { table: Utensils, garden: Trees, room: BedDouble }

interface Gesture {
  pointer: number; x: number; y: number; resize: boolean
  base: LayoutRect; next: LayoutRect | null; scroll: HTMLElement | null
  left: number; top: number
}

export default function LocationCard({ location, appearance, order, now, currency, editing, disabled, onClick, onLayout }: {
  location: FloorTable; appearance: ReturnType<typeof zoneAppearance>; order?: Order; now: number; currency: string; editing: boolean; disabled: boolean
  onClick: () => void; onLayout: (rect: LayoutRect) => void
}) {
  const [preview, setPreview] = useState<LayoutRect | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const rect = preview ?? location
  const status = statusVisuals[location.status]
  const TypeIcon = typeIcons[location.type]
  const date = order && Date.parse(order.created_at.replace(' ', 'T') + (order.created_at.includes('Z') ? '' : 'Z'))
  const minutes = date && Number.isFinite(date) ? Math.max(0, Math.floor((now - date) / 60000)) : 0
  const timer = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  const total = order && currency + order.grand_total.toLocaleString(undefined, { maximumFractionDigits: 2 })

  function begin(event: PointerEvent<HTMLElement>) {
    if (!editing || disabled || event.button !== 0 || gesture.current) return
    const scroll = event.currentTarget.closest<HTMLElement>('[data-floor-scroll]')
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, base: location, next: null,
      resize: Boolean((event.target as HTMLElement).closest('[data-resize]')), scroll, left: scroll?.scrollLeft ?? 0, top: scroll?.scrollTop ?? 0 }
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function move(event: PointerEvent<HTMLElement>) {
    const state = gesture.current
    if (!state || state.pointer !== event.pointerId) return
    const bounds = state.scroll?.getBoundingClientRect()
    if (bounds && state.scroll) {
      const horizontal = event.clientX > bounds.right - 24 ? GRID : event.clientX < bounds.left + 24 ? -GRID : 0
      const vertical = event.clientY > bounds.bottom - 24 ? GRID : event.clientY < bounds.top + 24 ? -GRID : 0
      if (horizontal || vertical) state.scroll.scrollBy(horizontal, vertical)
    }
    const dx = event.clientX - state.x + (state.scroll?.scrollLeft ?? 0) - state.left
    const dy = event.clientY - state.y + (state.scroll?.scrollTop ?? 0) - state.top
    if (!state.next && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
    state.next = editRect(state.base, dx, dy, state.resize)
    setPreview(state.next)
  }

  function finish(pointer: number, save: boolean) {
    if (gesture.current?.pointer !== pointer) return
    if (save && gesture.current.next) onLayout(gesture.current.next)
    gesture.current = null
    setPreview(null)
  }

  return <button type="button" disabled={disabled} title={location.label}
    aria-label={`${location.label}, ${status.title}${editing ? '. Use arrows to move or Shift and arrows to resize' : ''}`}
    className={`absolute flex flex-col justify-between rounded-xl border-2 bg-white py-2 pl-3 pr-2 text-left text-slate-800 shadow-sm dark:bg-slate-900 ${status.card} ${editing ? 'touch-none select-none cursor-grab active:cursor-grabbing' : 'transition hover:brightness-95 hover:shadow-md'} ${preview ? 'z-10 ring-2 ring-teal-500' : ''}`}
    style={{ left: rect.x_pos, top: rect.y_pos, width: rect.width, height: rect.height }}
    onPointerDown={begin} onPointerMove={move} onPointerUp={event => finish(event.pointerId, true)}
    onPointerCancel={event => finish(event.pointerId, false)} onLostPointerCapture={event => finish(event.pointerId, false)}
    onClick={() => { if (!editing) onClick() }}
    onKeyDown={event => {
      if (!editing || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      event.preventDefault()
      const x = event.key === 'ArrowLeft' ? -GRID : event.key === 'ArrowRight' ? GRID : 0
      const y = event.key === 'ArrowUp' ? -GRID : event.key === 'ArrowDown' ? GRID : 0
      onLayout(editRect(location, x, y, event.shiftKey))
    }}>
    <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 rounded-l-[9px] ${appearance.accent}`}/>
    <span className="flex min-w-0 items-start justify-between gap-1">
      <span className="flex min-w-0 flex-col items-start gap-0.5">
        <span className={`flex items-center gap-1 rounded px-1 text-[10px] font-bold ${appearance.badge}`}><TypeIcon size={11}/>{appearance.prefix}</span>
        <strong className="max-w-full truncate text-sm">{location.label}</strong>
      </span>
      <span className="flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums" title={`Capacity ${location.capacity}`}>
        <Users size={12} />{location.capacity}
      </span>
    </span>
    {order?.customer_name && <span className="truncate text-xs font-medium" title={order.customer_name}>{order.customer_name}</span>}
    <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-1 text-xs tabular-nums">
      {order ? <><strong className="truncate" title={total}>{total}</strong><span className="inline-flex items-center gap-1 whitespace-nowrap"><Clock3 size={12} />{timer}</span></>
        : <span className="flex items-center gap-1 font-medium"><span className={`size-2 shrink-0 rounded-full ${status.dot}`}/>{status.label}</span>}
    </span>
    {editing && <span data-resize title="Drag to resize" className="absolute bottom-0 right-0 grid size-5 cursor-nwse-resize place-items-center rounded-tl-md bg-teal-700 text-white"><MoveDiagonal2 size={13} /></span>}
  </button>
}
