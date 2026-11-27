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
  editBill: channel('editBill'),
  printBill: channel('printBill'),
  payOrder: channel('payOrder'),
  printKot: channel('printKot'),
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
