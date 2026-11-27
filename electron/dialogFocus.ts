import type { BrowserWindow } from 'electron'

export async function withDialogFocus<T>(parent: BrowserWindow, open: (window: BrowserWindow) => Promise<T>): Promise<T> {
  try { return await open(parent) }
  finally {
    if (!parent.isDestroyed()) {
      parent.focus()
      if (!parent.webContents.isDestroyed()) parent.webContents.focus()
    }
  }
}
