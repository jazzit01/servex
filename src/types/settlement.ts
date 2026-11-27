import type { BillSplit } from './pos'

export function upiUri(id: string, restaurant: string, amount: number) {
  return 'upi://pay?' + new URLSearchParams({ pa: id, pn: restaurant, am: amount.toFixed(2), cu: 'INR' }).toString().replace(/\+/g, '%20')
}

export interface ReceiptLine { id: number; name: string; quantity: number; notes: string | null; net: number; tax: number }
export interface ReceiptPart { lines: ReceiptLine[]; net: number; tax: number; discount: number; total: number }

// Allocate cents using cumulative weights so all parts add up to the original bill.
function allocate(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0)
  let previous = 0
  let running = 0
  return weights.map((weight, i) => {
    running += weight
    const through = Math.round(total * (sum ? running / sum : (i + 1) / weights.length))
    const value = through - previous
    previous = through
    return value
  })
}

export function splitReceipt(lines: ReceiptLine[], net: number, tax: number, discount: number, split: BillSplit): ReceiptPart[] {
  if (!split || !['none', 'equal', 'items'].includes(split.kind)) throw new Error('Choose a valid split.')
  if (split.kind === 'equal') {
    if (!Number.isInteger(split.count) || split.count < 2 || split.count > 20) throw new Error('Split between 2 and 20 guests.')
    const weights = Array<number>(split.count).fill(1)
    const totals = allocate(net + tax - discount, weights)
    const discounts = allocate(discount, weights)
    const gross = totals.map((total, i) => total + discounts[i])
    const taxes = allocate(tax, gross)
    return totals.map((total, i) => ({ lines: [], net: gross[i] - taxes[i], tax: taxes[i], discount: discounts[i], total }))
  }
  if (split.kind === 'none') return [{ lines, net, tax, discount, total: net + tax - discount }]
  if (!Array.isArray(split.groups) || split.groups.length < 2 || split.groups.length > 20) throw new Error('Choose 2 to 20 item groups.')
  const available = new Map(lines.map(line => [line.id, line]))
  const groups = split.groups.map(group => {
    if (!Array.isArray(group) || !group.length || group.length > lines.length) throw new Error('Each split must contain at least one item.')
    return group.map(id => {
      const line = available.get(id)
      if (!line) throw new Error('Assign every item once.')
      available.delete(id)
      return line
    })
  })
  if (available.size) throw new Error('Assign every item once.')
  const nets = allocate(net, groups.map(group => group.reduce((sum, line) => sum + line.net, 0)))
  const taxes = allocate(tax, groups.map(group => group.reduce((sum, line) => sum + line.tax, 0)))
  const discounts = allocate(discount, nets.map((value, i) => value + taxes[i]))
  return groups.map((items, i) => ({ lines: items, net: nets[i], tax: taxes[i], discount: discounts[i], total: nets[i] + taxes[i] - discounts[i] }))
}
