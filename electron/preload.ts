import { contextBridge, ipcRenderer } from 'electron'
import type { ServexApi } from '../src/types/pos'

const api: ServexApi = {
  signIn: pin => ipcRenderer.invoke('pos:sign-in', pin),
  lock: () => ipcRenderer.invoke('pos:lock'),
  snapshot: () => ipcRenderer.invoke('pos:snapshot'),
  createOrder: order => ipcRenderer.invoke('pos:create-order', order),
  payOrder: (id, mode) => ipcRenderer.invoke('pos:pay-order', id, mode),
  printKot: id => ipcRenderer.invoke('pos:print-kot', id),
  toggleItem: id => ipcRenderer.invoke('pos:toggle-item', id),
  closeDay: () => ipcRenderer.invoke('pos:close-day'),
  updateSettings: input => ipcRenderer.invoke('pos:update-settings', input),
  pickLogo: () => ipcRenderer.invoke('pos:pick-logo'),
  exportBackup: () => ipcRenderer.invoke('pos:export-backup'),
  importBackup: () => ipcRenderer.invoke('pos:import-backup'),
}
contextBridge.exposeInMainWorld('servexApi', api)
