export function lineAmounts(price: number, quantity: number, rate: number, inclusive: boolean) {
  const gross = Math.round(price * quantity * 100)
  const tax = Math.round(inclusive ? gross * rate / (100 + rate) : gross * rate / 100)
  return { gross, tax }
}

export function orderAmounts(lines: { gross: number; tax: number }[], inclusive: boolean) {
  const gross = lines.reduce((sum, line) => sum + line.gross, 0)
  const tax = lines.reduce((sum, line) => sum + line.tax, 0)
  return { subtotal: (gross - (inclusive ? tax : 0)) / 100, tax: tax / 100, total: (gross + (inclusive ? 0 : tax)) / 100 }
}
