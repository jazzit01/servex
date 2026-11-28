import { createConnection } from 'node:net'
import { privatePrinter } from './enterprise'
import type { PrinterSetting } from '../src/types/enterprise'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { upiUri } from '../src/types/settlement'
import type { ReceiptPart } from '../src/types/settlement'
import type { KitchenTicket, Order, PrintResult, Settings } from '../src/types/pos'

export interface ReceiptDocument {
  order: Order
  parts: ReceiptPart[]
  brand: Pick<Settings, 'restaurant_name' | 'address' | 'phone' | 'gstin' | 'currency_symbol' | 'receipt_footer' | 'upi_id'>
  logoName: string | null
  location: string
  timestamp: string
}

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
const safeImage = (src: string | null) => src && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src) ? src : ''
const line = (label: string, value: string) => `<div class="pair"><span>${esc(label)}</span><span>${esc(value)}</span></div>`
const paragraph = (value: string | null) => value ? `<div>${esc(value)}</div>` : ''

function roll(width: number, pages: string[]) {
  const size = width === 58 ? 58 : 80
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
@page{margin:0}*{box-sizing:border-box}body{margin:0;color:#111;font:11px/1.45 system-ui,sans-serif;font-variant-numeric:tabular-nums}
article{width:${size}mm;max-width:100%;padding:3mm;margin:auto;overflow-wrap:anywhere}
article+article{border-top:1px dashed #777;break-before:page}
@media print{article+article{border:0}}header,footer{text-align:center}h2{font-size:14px;margin:4px 0}
hr{border:0;border-top:1px dashed #777;margin:7px 0}.pair{display:flex;justify-content:space-between;gap:6px}.pair span:last-child{text-align:right;white-space:nowrap}
img{display:block;max-width:100%;margin:3px auto}.logo{max-width:32mm;max-height:20mm}.qr{width:30mm;image-rendering:pixelated}small{display:block}
</style>${pages.map(page => `<article>${page}</article>`).join('')}`
}

export async function receiptHtml(doc: ReceiptDocument, width: number, prebill: boolean, logoData: string | null) {
  const { order, brand, parts } = doc
  const money = (minor: number) => brand.currency_symbol + (minor / 100).toFixed(2)
  const logo = safeImage(logoData)
  const pages = await Promise.all(parts.map(async (part, index) => {
    const qr = prebill && part.total > 0
      ? await QRCode.toDataURL(upiUri(brand.upi_id, brand.restaurant_name, part.total / 100), { margin: 4, width: 240 }) : null
    const items = part.lines.map(item => line(`${item.quantity} × ${item.name}`, money(item.net)) +
      (item.notes ? `<small>${esc(item.notes)}</small>` : '')).join('')
    const cgst = Math.floor(part.tax / 2)
    return `<header>${logo ? `<img class="logo" alt="" src="${logo}">` : ''}<h2>${esc(brand.restaurant_name)}</h2>
${paragraph(brand.address)}${paragraph(brand.phone)}${paragraph(brand.gstin && 'GSTIN: ' + brand.gstin)}
<h2>${prebill ? 'Pre-bill' : 'Receipt'}</h2>${paragraph(order.bill_number + (parts.length > 1 ? ` / ${index + 1} of ${parts.length}` : ''))}
${paragraph(doc.location)}${paragraph(new Date(doc.timestamp).toLocaleString())}${paragraph(order.customer_name)}</header><hr>
${items || paragraph('Equal share of the bill')}<hr>${line('Subtotal', money(part.net))}${line('CGST', money(cgst))}${line('SGST', money(part.tax - cgst))}
${part.discount ? line('Discount', '−' + money(part.discount)) : ''}<strong>${line('Total', money(part.total))}</strong>
${!prebill ? line('Payment', order.payment_mode ?? '') : ''}
${!prebill && index === 0 && order.payment_mode === 'Cash' ? line(parts.length > 1 ? 'Cash tendered (whole bill)' : 'Cash tendered', money(Math.round(order.cash_tendered * 100))) +
  line('Change', money(Math.round(order.change_returned * 100))) : ''}
${qr ? `<img class="qr" alt="UPI payment QR" src="${safeImage(qr)}">` : ''}<hr><footer>${paragraph(brand.receipt_footer)}</footer>`
  }))
  return roll(width, pages)
}

export function ticketHtml(ticket: KitchenTicket, width: number) {
  return roll(width, [`<header><h2>${ticket.station === 'bar' ? 'Bar' : 'Kitchen'} ticket #${esc(ticket.id)}</h2>${paragraph(ticket.reference)}</header><hr>` +
    ticket.lines.map(item => line(item.name, String(item.quantity)) + (item.notes ? `<small>${esc(item.notes)}</small>` : '')).join('')])
}

export class Printer {
  private jobs = new Map<string, { html: string; device: string | null; actor: number; route?: PrinterSetting; raw?: Buffer }>()
  clear() { this.jobs.clear() }

  async submit(html: string, config: Settings, actor: number, route?: PrinterSetting, raw?: Buffer): Promise<PrintResult> {
    let error: string | undefined
    if (!config.print_preview) {
      try { await this.print(html, config.printer_name, route, raw); return { html: null } }
      catch (cause) { error = cause instanceof Error ? cause.message : 'Printing failed.' }
    }
    const jobId = randomUUID()
    if (this.jobs.size >= 10) this.jobs.delete(this.jobs.keys().next().value!)
    this.jobs.set(jobId, { html, device: config.printer_name, actor, route, raw })
    return { html, jobId, error }
  }

  async preview(jobId: string, actor: number) {
    const job = this.jobs.get(jobId)
    if (!job || job.actor !== actor) throw new Error('This print preview is no longer available.')
    await this.print(job.html, job.device, job.route, job.raw)
  }

  private async print(html: string, device: string | null, route?: PrinterSetting, raw?: Buffer) {
    if (route?.connection_type === 'lan') {
      const endpoint = privatePrinter(route.address)
      if (!endpoint || !raw) throw new Error('This LAN printer job does not have an ESC/POS payload.')
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection(endpoint)
        socket.setTimeout(5000)
        socket.once('timeout', () => socket.destroy(new Error('LAN printer timed out.')))
        socket.once('error', reject)
        socket.once('connect', () => socket.end(raw, () => { socket.destroy(); resolve() }))
      })
      return
    }
    if (route) device = route.address || (route.connection_type === 'usb' ? route.name : null)
    const view = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } })
    try {
      // Base64 keeps the data URL compact, including embedded logos and QR codes.
      await view.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html).toString('base64'))
      await new Promise<void>((resolve, reject) => {
        view.webContents.print({ silent: true, printBackground: true, deviceName: device || undefined, margins: { marginType: 'none' } },
          (ok, reason) => ok ? resolve() : reject(new Error(reason || 'The printer did not accept the job.')))
      })
    } finally { if (!view.isDestroyed()) view.destroy() }
  }
}

export function zReportHtml(report: import('../src/types/pos').ZReport) {
  const fmt = (amount: number) => report.currency + amount.toFixed(2)
  return roll(80, [`<header><h2>${esc(report.restaurant)}</h2><h2>Z-Report</h2>
${paragraph(report.day)}${paragraph('Closed by ' + report.actor)}</header><hr>
${line('Orders', String(report.orderCount))}${line('Net sales', fmt(report.sales))}${line('Tax', fmt(report.tax))}
${Object.entries(report.payments).map(([mode, amount]) => line(mode + ' net', fmt(amount))).join('')}<hr>
${line('Opening float', fmt(report.opening))}${line('Cash sales', fmt(report.cashSales))}${line('Cash refunds', fmt(report.refunds))}
${line('Cash expenses', fmt(report.cashExpenses??0))}
${line('Expected cash', fmt(report.expected))}${line('Actual counted', fmt(report.actual))}
<strong>${line('Over / short', fmt(report.variance))}</strong><hr>
${[2000,500,200,100,50,20,10].map((value,i) => line(fmt(value), String(report.counts[i]))).join('')}
${line('Coins', fmt(report.coins))}`])
}

const plain = (value: unknown) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/₹/g,'INR ').replace(/[^\x20-\x7e]/g,'?')
const partText = (lines: unknown[]) => Buffer.from(lines.map(plain).join('\n')+'\n','ascii')
const startRaw = Buffer.from([27,64])
const cutRaw = Buffer.from([10,10,10,29,86,0])
export function rawTicket(ticket: KitchenTicket) {
  return Buffer.concat([startRaw,partText([`${ticket.station.toUpperCase()} KOT #${ticket.id}`,ticket.reference,
    ...ticket.lines.flatMap(row=>[`${row.quantity} x ${row.name}`,...(row.notes?[row.notes]:[])])]),cutRaw])
}

function rawQr(uri: string) {
  const data = Buffer.from(uri,'utf8')
  const length = data.length + 3
  return Buffer.concat([Buffer.from([29,40,107,3,0,49,67,5,29,40,107,length&255,length>>8,49,80,48]),
    data,Buffer.from([29,40,107,3,0,49,81,48,10])])
}
export function rawReceipt(doc: ReceiptDocument, prebill: boolean) {
  const money = (minor: number) => doc.brand.currency_symbol + (minor/100).toFixed(2)
  return Buffer.concat(doc.parts.flatMap((part,index)=>{
    const lines = [doc.brand.restaurant_name,doc.brand.address,doc.brand.phone,doc.brand.gstin && 'GSTIN: '+doc.brand.gstin,
      (prebill?'Pre-bill ':'Receipt ')+doc.order.bill_number+(doc.parts.length>1?' / '+(index+1):''),doc.location,
      ...part.lines.flatMap(row=>[`${row.quantity} x ${row.name}  ${money(row.net)}`,...(row.notes?[row.notes]:[])]),
      'Subtotal '+money(part.net),'CGST '+money(Math.floor(part.tax/2)),'SGST '+money(Math.ceil(part.tax/2)),
      'Discount '+money(part.discount),'Total '+money(part.total),!prebill && doc.order.payment_mode || '',doc.brand.receipt_footer]
    return [startRaw,partText(lines.filter(Boolean)),
      ...(prebill&&part.total>0?[rawQr(upiUri(doc.brand.upi_id,doc.brand.restaurant_name,part.total/100))]:[]),cutRaw]
  }))
}
export function rawZReport(report: import('../src/types/pos').ZReport) {
  return Buffer.concat([startRaw,partText([report.restaurant,'Z-REPORT '+report.day,'Closed by '+report.actor,
    ...Object.entries({ 'Net sales':report.sales,'Tax':report.tax,'Opening':report.opening,'Cash sales':report.cashSales,
      'Refunds':report.refunds,'Expenses':report.cashExpenses??0,'Expected':report.expected,'Actual':report.actual,'Variance':report.variance })
      .map(([label,value])=>label+' '+report.currency+value.toFixed(2))]),cutRaw])
}
