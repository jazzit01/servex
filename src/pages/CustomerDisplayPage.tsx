import { useEffect,useState } from 'react'
import QRCode from 'qrcode'
import { upiUri } from '../types/settlement'
import type { DisplayState } from '../types/enterprise'

export default function CustomerDisplayPage(){
  const [state,setState]=useState<DisplayState>()
  const [qr,setQr]=useState<{ uri:string; image:string }>()
  useEffect(()=>{
    let live=true
    let changed=false
    const unsubscribe=window.servexApi.onDisplay(next=>{changed=true;if(live)setState(next)})
    void window.servexApi.displayState().then(next=>{if(live&&!changed)setState(next)}).catch(()=>{})
    return()=>{live=false;unsubscribe()}
  },[])
  const uri=state?.checkout&&state.total>0?upiUri(state.upi,state.name,state.total):''
  useEffect(()=>{
    if(!uri)return
    let live=true
    void QRCode.toDataURL(uri,{width:540,margin:4}).then(image=>{if(live)setQr({uri,image})}).catch(()=>{})
    return()=>{live=false}
  },[uri])
  if(!state)return <div className="grid h-screen place-items-center bg-slate-950 text-white">Opening customer display…</div>
  const money=(amount:number)=>state.currency+amount.toFixed(2)
  return <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950 p-8 text-white">
    <header className="flex shrink-0 items-center gap-5 border-b border-slate-700 pb-5">
      <img className="size-20 rounded-2xl bg-white object-contain" alt="" src={state.logo??import.meta.env.BASE_URL+'servex-logo.png'}/>
      <h1 className="text-4xl">{state.name}</h1>
    </header>
    {!state.items.length?<section className="grid flex-1 place-items-center text-center"><div><h2 className="text-5xl">Welcome</h2><p className="mt-3 text-lg text-slate-300">Your order will appear here.</p></div></section>:
      <div className={`grid min-h-0 flex-1 gap-8 pt-6 ${uri?'grid-cols-[minmax(0,1fr)_minmax(340px,42%)]':'grid-cols-1'}`}>
        <section className="flex min-h-0 flex-col">
          <ul className="min-h-0 flex-1 divide-y divide-slate-800 overflow-auto" aria-label="Current order">
            {state.items.map((row,index)=><li className="flex justify-between gap-3 py-3 text-xl" key={index}><span>{row.qty} × {row.name}</span><strong>{money(row.amount)}</strong></li>)}
          </ul>
          <div className="flex items-center justify-between border-t border-slate-700 pt-4 text-3xl font-bold"><span>Total</span><span className="text-teal-300">{money(state.total)}</span></div>
        </section>
        {uri&&<aside className="grid content-center justify-items-center gap-3"><h2 className="text-2xl">Scan to Pay</h2>
          {qr?.uri===uri&&<img className="aspect-square w-full max-w-[min(44vh,480px)] rounded-xl bg-white [image-rendering:pixelated]" alt="UPI QR for the exact amount due" src={qr.image}/>}
          <p className="text-2xl font-bold text-teal-300">{money(state.total)}</p></aside>}
      </div>}
  </main>
}
