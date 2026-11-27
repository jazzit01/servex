import { useEffect, useState } from 'react'
import { Plus, UserRoundCog } from 'lucide-react'
import { Field, Modal } from '../ManagementControls'
import { runAction, usePosStore } from '../../store/usePosStore'
import type { Role, StaffUser } from '../../types/pos'

export default function StaffSettings() {
  const actor = usePosStore(state => state.cashier)
  const notify = usePosStore(state => state.notify)
  const [users, setUsers] = useState<StaffUser[]>([])
  const [editing, setEditing] = useState<StaffUser | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let current = true
    void window.servexApi.listStaff().then(rows => { if (current) setUsers(rows) }).catch(error => { if (current) notify(error.message, true) })
    return () => { current = false }
  }, [notify])

  async function save(action: () => Promise<void>, message: string) {
    setBusy(true)
    const saved = await runAction(async () => {
      await action()
      setUsers(await window.servexApi.listStaff())
    }, message)
    setBusy(false)
    if (saved) setEditing(null)
  }
  const selected = editing && editing !== 'new' ? editing : null
  return <section className="panel overflow-hidden">
    <div className="flex items-center justify-between border-b p-5">
      <div><h2 className="flex items-center gap-2"><UserRoundCog size={18} className="text-teal-700" /> Staff & cashier PINs</h2><p className="subtitle">Each active staff member needs a unique four-digit PIN.</p></div>
      <button className="primary" disabled={busy} onClick={() => setEditing('new')}><Plus size={16} /> Add staff</button>
    </div>
    <table className="w-full text-left text-sm">
      <thead className="bg-slate-50 text-xs text-slate-600"><tr>{['Name', 'Role', 'Status', 'Actions'].map(label => <th key={label} scope="col" className="px-5 py-3">{label}</th>)}</tr></thead>
      <tbody className="divide-y">{users.map(user => <tr key={user.id}>
        <th className="px-5 py-3 font-semibold" scope="row">{user.name}{user.id === actor?.id && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}</th>
        <td className="px-5 capitalize">{user.role}</td><td className="px-5"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${user.is_active ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-600'}`}>{user.is_active ? 'Active' : 'Inactive'}</span></td>
        <td className="space-x-2 px-5"><button className="secondary" disabled={busy} onClick={() => setEditing(user)}>Edit</button>
          {Boolean(user.is_active) && user.id !== actor?.id && <button className="secondary" disabled={busy} onClick={() => {
            if (window.confirm(`Deactivate ${user.name}?`)) void save(() => window.servexApi.saveStaff({ ...user, active: false }), 'Staff deactivated.')
          }}>Deactivate</button>}</td>
      </tr>)}</tbody>
    </table>
    {editing && <Modal title={selected ? 'Edit staff member' : 'Add staff member'} onClose={() => { if (!busy) setEditing(null) }}>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const pin = String(form.get('pin') ?? '')
        void save(() => window.servexApi.saveStaff({
          id: selected?.id, name: String(form.get('name')), role: String(form.get('role')) as Role,
          pin: pin || undefined, active: form.has('active'),
        }), 'Staff saved.')
      }}>
        <Field label="Name"><input className="field" name="name" maxLength={80} required defaultValue={selected?.name} /></Field>
        <Field label="Role"><select className="field" name="role" defaultValue={selected?.role ?? 'cashier'}>
          <option value="admin">Admin</option><option value="manager">Manager</option><option value="cashier">Cashier</option>
        </select></Field>
        <Field label={selected ? 'New PIN (optional)' : 'PIN'}><input className="field" name="pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} pattern="[0-9]{4}" required={!selected} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={!selected || Boolean(selected.is_active)} /> Active account</label>
        <div className="flex justify-end gap-2"><button type="button" className="secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={busy}>Save staff</button></div>
      </form>
    </Modal>}
  </section>
}
