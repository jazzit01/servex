import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, Search } from 'lucide-react'
import { Modal } from '../ManagementControls'

const steps = [
  ['Staff PIN sign-in', 'Select your staff profile and enter your four-digit PIN.'],
  ['Choose a zone, table, or takeaway', 'Open a table or room from Floors & Rooms, or press F1 for takeaway.'],
  ['Add items and send KOT', 'Add dishes to the cart and press F2 to send the Kitchen Order Ticket.'],
  ['Checkout and print the GST bill', 'Press F4, confirm payment, and print the GST receipt.'],
  ['Close the day and back up', 'Reconcile cash in Reports → Z-Close, then confirm the close and its backup.'],
] as const

const controls = [
  ['Floors & Rooms', 'Browse zones and open a table or room order.'],
  ['Edit Layout', 'Move or resize tables, then save or press Esc to discard.'],
  ['Quick Billing', 'Build, hold, or resume a cart and take payment.'],
  ['Orders & KOT', 'Review kitchen tickets and orders, or reprint a bill.'],
  ['Menu Manager', 'Manage dishes, categories, prices, and availability.'],
  ['Customers & Loyalty', 'Find customer profiles and manage loyalty records.'],
  ['Inventory & Recipes', 'Track ingredients, stock purchases, and dish recipes.'],
  ['Reports & Z-Close', 'Review sales, expenses, and audit logs, or close the day.'],
  ['Customer Second Screen', 'Show the live cart and checkout QR code on the customer display.'],
  ['Smart Calculator', 'Calculate GST, splits, custom charges, discounts, or cash tendered.'],
  ['Dark Mode', 'Switch between light and dark themes.'],
  ['Sound', 'Mute or enable counter sounds.'],
  ['Commands', 'Search for actions, screens, tables, or dishes.'],
  ['Help', 'Search this guide or print the keyboard shortcuts.'],
  ['Settings', 'Manage restaurant details, staff, locations, printers, and backups.'],
  ['License Activation / Device ID', 'Open the license badge or Settings → License to copy the Device ID or enter an Activation Key.'],
  ['Staff profile and Lock Screen', 'Check who is signed in and lock the till before stepping away.'],
  ['Collapse sidebar', 'Show or hide sidebar labels.'],
  ['New Takeaway', 'Start a new takeaway cart from the header.'],
] as const

const shortcuts = [
  { title: 'Zone Switching', entries: [
    ['Alt + 0', 'Select All Zones'],
    ['Alt + 1 to Alt + 9', 'Switch to zones 1–9 in display order', 'Alt+2 Alt+3 Alt+4 Alt+5 Alt+6 Alt+7 Alt+8'],
  ] },
  { title: 'Counter & Billing', entries: [
    ['F1', 'Quick Takeaway'],
    ['F2', 'Send KOT'],
    ['F4', 'Checkout & Bill'],
    ['F9', 'Smart POS Calculator'],
  ] },
  { title: 'App Navigation', entries: [
    ['Ctrl + K', 'Open Command Palette'],
    ['Ctrl + / or ?', 'Open Help'],
    ['Esc', 'Cancel, close, or discard layout edits'],
  ] },
] as const

const tabs = ['How to Use', 'Every Screen & Control', 'Keyboard Shortcuts'] as const
type Tab = typeof tabs[number]

function searchTerms(text: string) {
  return text.toLowerCase().replace(/[+&]/g, ' ').trim().split(/\s+/).filter(Boolean)
}

function Reference({ entries, numbered }: { entries: readonly (readonly [string, string])[]; numbered?: boolean }) {
  return <ul className="space-y-1.5">{entries.map(([title, detail], index) => <li key={title}
    className="rounded-lg border bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
    <strong>{numbered && `${index + 1}. `}{title}</strong> <span className="text-slate-600">{detail}</span>
  </li>)}</ul>
}

function ShortcutGroups({ matches }: { matches: (text: string) => boolean }) {
  return <div className="space-y-3">{shortcuts.map(group => {
    const entries = group.entries.filter(entry => matches(`${group.title} ${entry.join(' ')}`))
    if (!entries.length) return null
    return <section key={group.title}>
      <h3 className="mb-1 text-sm font-semibold">{group.title}</h3>
      <dl className="divide-y rounded-lg border">{entries.map(([keys, action]) =>
        <div key={keys} className="grid grid-cols-[minmax(9rem,1fr)_2fr] items-center gap-3 px-3 py-2 text-sm">
          <dt><kbd className="rounded border bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-900 dark:text-white">{keys}</kbd></dt><dd>{action}</dd>
        </div>)}</dl>
    </section>
  })}</div>
}

export default function HelpGuideModal({ close }: { close: () => void }) {
  const [tab, setTab] = useState<Tab>(tabs[0])
  const [query, setQuery] = useState('')
  const terms = searchTerms(query)
  const searching = terms.length > 0
  const matches = (text: string) => {
    const searchable = searchTerms(text).join(' ')
    return terms.every(term => searchable.includes(term))
  }
  const quickSteps = steps.filter(entry => matches(entry.join(' ')))
  const screens = controls.filter(entry => matches(entry.join(' ')))
  const foundShortcuts = shortcuts.some(group => group.entries.some(entry => matches(`${group.title} ${entry.join(' ')}`)))

  return <Modal wide title="Help & Shortcuts Guide" onClose={close} dismissLabel="Close">
    <label className="relative block">
      <Search size={17} className="pointer-events-none absolute left-3 top-3 text-slate-500"/>
      <input data-modal-focus type="search" className="field pl-10" aria-label="Search help"
        placeholder="Search any shortcut, screen, or control..." value={query} onChange={event => setQuery(event.target.value)}/>
    </label>
    <div role="tablist" aria-label="Help sections" className="my-3 flex flex-wrap gap-1.5">
      {tabs.map((name, index) => <button key={name} id={`help-tab-${index}`} role="tab" aria-selected={name === tab}
        aria-controls="help-guide-content" tabIndex={name === tab ? 0 : -1}
        className={`secondary px-3 py-1.5 ${name === tab ? 'border-teal-300 bg-teal-50 text-teal-800' : ''}`}
        onClick={() => { setTab(name); setQuery('') }}
        onKeyDown={event => {
          const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key]
          if (next === undefined) return
          event.preventDefault()
          setTab(tabs[next])
          setQuery('')
          document.getElementById(`help-tab-${next}`)?.focus()
        }}>{name}</button>)}
    </div>
    <div id="help-guide-content" role={searching ? 'region' : 'tabpanel'}
      aria-label={searching ? 'Search results' : undefined}
      aria-labelledby={searching ? undefined : `help-tab-${tabs.indexOf(tab)}`}
      className="max-h-[52vh] space-y-4 overflow-auto pr-1">
      {(searching ? quickSteps.length > 0 : tab === tabs[0]) && <section>
        {searching && <h3 className="mb-2 text-sm font-semibold">{tabs[0]}</h3>}
        <Reference entries={quickSteps} numbered={!searching}/>
      </section>}
      {(searching ? screens.length > 0 : tab === tabs[1]) && <section>
        {searching && <h3 className="mb-2 text-sm font-semibold">{tabs[1]}</h3>}
        <Reference entries={screens}/>
      </section>}
      {(searching ? foundShortcuts : tab === tabs[2]) && <section>
        {searching && <h3 className="mb-2 text-sm font-semibold">{tabs[2]}</h3>}
        <ShortcutGroups matches={matches}/>
        <button className="secondary mt-3" onClick={() => window.print()}><Printer size={16}/> Print Shortcut Cheat-Sheet</button>
      </section>}
      {searching && !quickSteps.length && !screens.length && !foundShortcuts &&
        <p role="status" className="py-4 text-sm text-slate-600">No matching help topics.</p>}
    </div>
    {createPortal(<article className="shortcut-cheat-sheet">
      <h1>ServeX POS · Keyboard Shortcuts</h1>
      <ShortcutGroups matches={() => true}/>
      <p>On the floor map, bare digits also switch zones outside editable fields.</p>
    </article>, document.body)}
  </Modal>
}
