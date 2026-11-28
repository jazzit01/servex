import { useState } from 'react'
import { CalendarPlus, Clock, Users } from 'lucide-react'
import { Field,Modal } from '../ManagementControls'
import { enterpriseAction,useEnterprise } from './useEnterprise'
import { usePosStore } from '../../store/usePosStore'
import type { Reservation } from '../../types/enterprise'

export default function ReservationsDrawer({close}:{close:()=>void}){
  const rows=useEnterprise('reservations')
  const {data,startOrder}=usePosStore()
  const [adding,setAdding]=useState<'booked'|'waitlist'>()
  const [seating,setSeating]=useState<Reservation>()
  const [busy,setBusy]=useState(false)
  const vacant=data?.tables.filter(table=>table.status==='vacant'&&!data.seated.some(guest=>guest.table_id===table.id))??[]
  const waitlist=rows?.filter(row=>row.status==='waitlist')??[]
  const now=Date.now()
  function open(row:Reservation, id:number){
    const table=data?.tables.find(item=>item.id===id)
    if(table)startOrder(table.type==='room'?'room':'dinein',id,{...row,table_id:id,status:'seated'})
  }
  return <>
    <Modal wide title="Reservations & Waitlist" drawer onClose={close} dismissDisabled={busy}>
      <div className="flex flex-wrap gap-2 pb-3">
        <button className="primary" onClick={()=>setAdding('booked')}><CalendarPlus size={16}/>New Booking</button>
        <button className="secondary" onClick={()=>setAdding('waitlist')}><Users size={16}/>Add Walk-In</button>
      </div>
      <div className="space-y-2">
        {rows?.map(row=>{
          const eligible=vacant.filter(table=>table.capacity>=row.guest_count)
          const assigned=eligible.find(table=>table.id===row.table_id)
          const recommended=assigned??eligible.sort((a,b)=>a.capacity-b.capacity)[0]
          const location=data?.tables.find(table=>table.id===row.table_id)
          const elapsed=Math.max(0,Math.floor((now-Date.parse(row.reservation_time))/60000))
          const wait=recommended?Math.max(0,waitlist.indexOf(row))*15:Math.max(15,(waitlist.indexOf(row)+1)*15)
          return <article key={row.id} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2"><div><h2>{row.customer_name}</h2>
              <p className="caption">{row.guest_count} guests · {row.customer_phone} {location?'· '+location.label:''}</p>
              <p className="caption flex items-center gap-1"><Clock size={13}/>{row.status==='waitlist'?`Waiting ${elapsed} min · Estimated ${wait} min`:
                row.status==='seated'?'Seated · Awaiting order':new Date(row.reservation_time).toLocaleString()}</p></div>
              <div className="flex gap-2"><button className="secondary" disabled={busy||(!recommended&&row.status!=='seated')} onClick={async()=>{
                if(row.status==='seated'&&row.table_id){open(row,row.table_id);return}
                if(!recommended)return
                if(!assigned&&row.status==='booked'){setSeating(row);return}
                setBusy(true)
                if(await enterpriseAction({type:'seat',id:row.id,table:recommended.id},'Guest seated.'))open(row,recommended.id)
                setBusy(false)
              }}>{row.status==='seated'?'Open Billing':'Seat Guest'}</button>
              <button className="secondary" disabled={busy} onClick={()=>void enterpriseAction({type:'cancelReservation',id:row.id},'Reservation canceled.')}>Cancel Booking</button></div>
            </div>
            {row.notes&&<p className="mt-2 text-xs">{row.notes}</p>}
          </article>
        })}
        {!rows?.length&&<p className="p-3 text-sm text-slate-500">{rows?'No bookings or waiting guests.':'Loading reservations…'}</p>}
      </div>
    </Modal>
    {adding&&<Modal title={adding==='booked'?'New Booking':'Add Walk-In'} onClose={()=>setAdding(undefined)} dismissDisabled={busy}>
      <form className="space-y-3" onSubmit={async e=>{
        e.preventDefault(); const form=new FormData(e.currentTarget);setBusy(true)
        const time=adding==='waitlist'?new Date():new Date(String(form.get('time')))
        if(await enterpriseAction({type:'reservation',value:{table_id:Number(form.get('table'))||null,customer_name:String(form.get('name')),
          customer_phone:String(form.get('phone')),guest_count:Number(form.get('guests')),reservation_time:time.toISOString(),
          status:adding,notes:String(form.get('notes'))}},'Reservation saved.'))setAdding(undefined)
        setBusy(false)
      }}>
        <Field label="Guest name"><input className="field" name="name" required maxLength={80}/></Field>
        <Field label="Phone"><input className="field" name="phone" type="tel" required maxLength={32}/></Field>
        <Field label="Guests"><input className="field" name="guests" type="number" min={1} max={100} defaultValue={2} required/></Field>
        {adding==='booked'&&<>
          <Field label="Booking time"><input className="field" name="time" type="datetime-local" required/></Field>
          <Field label="Table or room"><select className="field" name="table" required defaultValue=""><option value="">Choose location</option>
            {data?.tables.map(table=><option key={table.id} value={table.id}>{table.label} · {table.capacity} seats</option>)}</select></Field>
        </>}
        <Field label="Notes"><textarea className="field" name="notes" maxLength={500}/></Field>
        <button className="primary" disabled={busy}>Save Reservation</button>
      </form>
    </Modal>}
    {seating&&<Modal title={'Seat '+seating.customer_name} onClose={()=>setSeating(undefined)} dismissDisabled={busy}>
      <form className="space-y-3" onSubmit={async e=>{
        e.preventDefault(); const id=Number(new FormData(e.currentTarget).get('table'));setBusy(true)
        if(await enterpriseAction({type:'seat',id:seating.id,table:id},'Guest seated.'))open(seating,id)
        setBusy(false)
      }}><Field label="Vacant location"><select name="table" className="field" required>
        {vacant.filter(row=>row.capacity>=seating.guest_count).map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></Field>
        <button className="primary" disabled={busy}>Seat Guest</button></form>
    </Modal>}
  </>
}
