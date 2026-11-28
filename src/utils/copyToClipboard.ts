export async function copyToClipboard(text: string): Promise<void> {
  if (window.api?.copyText) {
    try {
      await window.api.copyText(text)
      return
    } catch { /* Try the browser clipboard next. */ }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch { /* Fall back to copying a selected text field. */ }
  }
  const focused = document.activeElement
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  const parent = focused?.closest('dialog[open]') ?? document.body
  parent.appendChild(field)
  try {
    field.select()
    if (!document.execCommand('copy')) throw new Error('Clipboard copy failed.')
  } finally {
    field.remove()
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
  }
}
