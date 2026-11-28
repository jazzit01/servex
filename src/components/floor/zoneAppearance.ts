import { BedDouble, Building2, Trees, Utensils } from 'lucide-react'
import type { FloorTable, Zone, ZoneColor } from '../../types/pos'

export const zoneThemes = {
  sky: { surface: 'bg-sky-50/70 border-sky-200/80 dark:bg-sky-950/25 dark:border-sky-800/40', accent: 'bg-sky-500', badge: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200' },
  emerald: { surface: 'bg-emerald-50/70 border-emerald-200/80 dark:bg-emerald-950/25 dark:border-emerald-800/40', accent: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
  amber: { surface: 'bg-amber-50/[.65] border-amber-200/80 dark:bg-amber-950/25 dark:border-amber-800/40', accent: 'bg-amber-500', badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  purple: { surface: 'bg-purple-50/[.65] border-purple-200/80 dark:bg-purple-950/25 dark:border-purple-800/40', accent: 'bg-purple-500', badge: 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200' },
  rose: { surface: 'bg-rose-50/70 border-rose-200/80 dark:bg-rose-950/25 dark:border-rose-800/40', accent: 'bg-rose-500', badge: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200' },
  teal: { surface: 'bg-teal-50/70 border-teal-200/80 dark:bg-teal-950/25 dark:border-teal-800/40', accent: 'bg-teal-500', badge: 'bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200' },
  indigo: { surface: 'bg-indigo-50/70 border-indigo-200/80 dark:bg-indigo-950/25 dark:border-indigo-800/40', accent: 'bg-indigo-500', badge: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200' },
  orange: { surface: 'bg-orange-50/70 border-orange-200/80 dark:bg-orange-950/25 dark:border-orange-800/40', accent: 'bg-orange-500', badge: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200' },
} satisfies Record<ZoneColor, { surface: string; accent: string; badge: string }>

const presets = [
  [/\b(rooms?|lodg\w*|suites?)\b/i, 'RM', 'purple', BedDouble, 'room'],
  [/\b(rooftop|roof top|terrace)\b/i, 'RT', 'amber', Building2, 'table'],
  [/\b(first floor|1st floor)\b/i, 'FF', 'amber', Building2, 'table'],
  [/\b(a\/?c|air[- ]conditioned|hall)\b/i, 'AC', 'amber', Building2, 'table'],
  [/\b(gardens?|lawns?)\b/i, 'GDN', 'emerald', Trees, 'garden'],
  [/\b(outdoors?|outside|patio)\b/i, 'OUT', 'emerald', Trees, 'garden'],
  [/\b(ground floor|indoors?)\b/i, 'GF', 'sky', Utensils, 'table'],
] as const

export function zoneAppearance(name: string, color: ZoneColor | null, earlierZones: Zone[]) {
  const preset = presets.find(([pattern]) => pattern.test(name))
  const words = name.toUpperCase().match(/[A-Z]+/g) ?? []
  const initials = words.map(word => word[0]).join('')
  const prefix = preset?.[1] ?? (words[0]?.startsWith('POOL') ? 'POOL' :
    (initials.length > 1 ? initials.slice(0, 3) : words[0]?.slice(0, 3)) || 'ZN')
  const colors = ['rose', 'teal', 'indigo', 'orange'] as const
  const customIndex = earlierZones.filter(zone => !presets.some(([pattern]) => pattern.test(zone.name))).length
  const selected = color ?? preset?.[2] ?? colors[customIndex % colors.length]
  return { ...zoneThemes[selected], color: selected, prefix, Icon: preset?.[3] ?? Building2, type: preset?.[4] ?? 'table' }
}

export function nextLocationLabels(rows: FloorTable[], prefix: string, count: number, type: FloorTable['type']) {
  let highest = type === 'room' ? 100 : 0
  for (const row of rows) {
    const suffix = Number(row.label.match(/\d+$/)?.[0])
    if (Number.isSafeInteger(suffix) && suffix <= Number.MAX_SAFE_INTEGER - rows.length - count) highest = Math.max(highest, suffix)
  }
  const existing = new Set(rows.map(row => row.label.toUpperCase()))
  return Array.from({ length: count }, () => {
    let label: string
    do { label = prefix + '-' + String(++highest).padStart(2, '0') } while (existing.has(label))
    return label
  })
}
