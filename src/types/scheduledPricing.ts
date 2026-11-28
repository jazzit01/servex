import type { PricingRule } from './enterprise'

export function priceAt(price: number, category: number, rules: PricingRule[], now = new Date()) {
  const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  const day = now.getDay()
  const rule = rules.find(row => {
    if (!row.is_active || (row.category_id !== null && row.category_id !== category)) return false
    const overnight = row.end_time < row.start_time
    const slot = overnight ? time >= row.start_time || time < row.end_time : time >= row.start_time && time < row.end_time
    const ruleDay = overnight && time < row.end_time ? (day + 6) % 7 : day
    return slot && row.days_of_week.split(',').includes(String(ruleDay))
  })
  if (!rule) return { price, label: null }
  const multiplier = rule.rule_type === 'discount_percent' ? 1 - rule.value / 100 : 1 + rule.value / 100
  return { price: Math.round(price * multiplier * 100) / 100, label: rule.name + ' Applied' }
}
