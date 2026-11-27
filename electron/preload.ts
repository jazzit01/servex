import { contextBridge, ipcRenderer } from 'electron'
import type { ServexApi } from '../src/types/pos'

function channel<K extends keyof ServexApi>(name: K, namespace: 'pos' | 'tables' = 'pos') {
  return (...args: Parameters<ServexApi[K]>): ReturnType<ServexApi[K]> =>
    ipcRenderer.invoke(`${namespace}:${name}`, ...args) as ReturnType<ServexApi[K]>
}

const api: ServexApi = {
  signIn: channel('signIn'),
  lock: channel('lock'),
  snapshot: channel('snapshot'),
  createOrder: channel('createOrder'),
  saveLayout: channel('saveLayout', 'tables'),
  transfer: channel('transfer', 'tables'),
  merge: channel('merge', 'tables'),
  updateStatus: channel('updateStatus', 'tables'),
  addOrderItems: channel('addOrderItems'),
  clearUnsent: channel('clearUnsent'),
  editBill: channel('editBill'),
  sendKot: channel('sendKot'),
  printTicket: channel('printTicket'),
  readyTicket: channel('readyTicket'),
  prebill: channel('prebill'),
  completePayment: channel('completePayment'),
  pastBills: channel('pastBills'),
  reprintReceipt: channel('reprintReceipt'),
  voidReceipt: channel('voidReceipt'),
  printPreview: channel('printPreview'),
  toggleItem: channel('toggleItem'),
  closeDay: channel('closeDay'),
  updateSettings: channel('updateSettings'),
  pickLogo: channel('pickLogo'),
  removeLogo: channel('removeLogo'),
  pickMedia: channel('pickMedia'),
  readMedia: channel('readMedia'),
  listStaff: channel('listStaff'),
  saveStaff: channel('saveStaff'),
  saveCategory: channel('saveCategory'),
  moveCategory: channel('moveCategory'),
  saveMenuItem: channel('saveMenuItem'),
  deleteMenuItem: channel('deleteMenuItem'),
  importMenuCsv: channel('importMenuCsv'),
  exportMenuCsv: channel('exportMenuCsv'),
  saveZone: channel('saveZone'),
  deleteZone: channel('deleteZone'),
  saveLocations: channel('saveLocations'),
  deleteLocation: channel('deleteLocation'),
  exportBackup: channel('exportBackup'),
  importBackup: channel('importBackup'),
  updateCloud: channel('updateCloud'),
  syncCloud: channel('syncCloud'),
}
contextBridge.exposeInMainWorld('servexApi', api)
