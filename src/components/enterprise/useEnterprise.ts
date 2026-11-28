import { useEffect, useState } from 'react'
import { runAction, usePosStore } from '../../store/usePosStore'
import type { EnterpriseAction, EnterpriseData } from '../../types/enterprise'

export function useEnterprise<K extends keyof EnterpriseData>(section: K, filter = '') {
  const [rows, setRows] = useState<EnterpriseData[K]>()
  const snapshot = usePosStore(state => state.data)
  const notify = usePosStore(state => state.notify)
  useEffect(() => {
    let current = true
    void window.servexApi.enterpriseData(section,filter).then(data => { if (current) setRows(data[section]) })
      .catch(error => { if (current) notify(error.message,true) })
    return () => { current = false }
  },[section,filter,snapshot,notify])
  return rows
}

export function enterpriseAction(action: EnterpriseAction, message = 'Changes saved.') {
  return runAction(() => window.servexApi.enterpriseAction(action),message)
}

export function useCustomer(phone: string) {
  const [match,setMatch]=useState<{ phone:string; customer:Awaited<ReturnType<typeof window.servexApi.customerLookup>> }>()
  useEffect(()=>{
    if(phone.replace(/\D/g,'').length<7)return
    let live=true
    const timer=setTimeout(()=>{
      void window.servexApi.customerLookup(phone).then(customer=>{if(live)setMatch({phone,customer})}).catch(()=>{})
    },180)
    return()=>{live=false;clearTimeout(timer)}
  },[phone])
  return match?.phone===phone ? match.customer : null
}
