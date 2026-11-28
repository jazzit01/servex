export function calculate(expression: string) {
  const input = expression.replace(/\s/g, '')
  const tokens = input.match(/(?:\d+\.?\d*|\.\d+)|[-+*/]/g) ?? []
  if (!input || input.length > 120 || tokens.join('') !== input) throw new Error('Enter a complete equation.')
  let index = 0
  function number() {
    const sign = tokens[index] === '-' ? -1 : 1
    if (tokens[index] === '-' || tokens[index] === '+') index++
    const token = tokens[index++]
    if (!token || !/^[\d.]/.test(token)) throw new Error('Enter a complete equation.')
    return sign * Number(token)
  }
  function product() {
    let value = number()
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++]
      const next = number()
      if (operator === '/' && next === 0) throw new Error('Cannot divide by zero.')
      value = operator === '*' ? value * next : value / next
    }
    return value
  }
  let result = product()
  while (tokens[index] === '+' || tokens[index] === '-') {
    const operator = tokens[index++]
    const next = product()
    result += operator === '+' ? next : -next
  }
  if (index !== tokens.length) throw new Error('Enter a complete equation.')
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER / 100) throw new Error('Result is too large.')
  return Math.sign(result) * Math.round(Math.abs(result) * 100 * (1 + Number.EPSILON)) / 100 || 0
}
