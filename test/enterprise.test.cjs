const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { test } = require('node:test')
const { once } = require('node:events')
const initSqlJs = require('sql.js')
const { PosDatabase } = require('../dist-electron/electron/db')
const { FloorService } = require('../dist-electron/electron/service')
const { Enterprise, privatePrinter } = require('../dist-electron/electron/enterprise')
const { Reports } = require('../dist-electron/electron/reports')
const { Printer, rawTicket } = require('../dist-electron/electron/printer')
const { priceAt } = require('../dist-electron/src/types/scheduledPricing')
const { removeEnterprise } = require('./helpers/legacy-schema.cjs')

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'servex-pro-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const db = await PosDatabase.open(path.join(dir,'pos.db'))
  return { db, pro:new Enterprise(db), service:new FloorService(db), reports:new Reports(db) }
}
const basket = [{id:1,quantity:1}]
const whole = {kind:'none'}
const saveReceipt = (order,parts)=>JSON.stringify({order,parts})

test('Enterprise migration preserves historical catalog and accepts an upgraded backup',async t=>{
  const {db,pro}=await fixture(t)
  const sqlite=await initSqlJs()
  const old=new sqlite.Database(db.bytes())
  removeEnterprise(old)
  old.run("UPDATE menu_items SET name='Legacy Tikka', price=177 WHERE id=1; PRAGMA user_version=6")
  db.restore(old.export(),()=>{})
  old.close()
  assert.deepEqual(db.all('SELECT name,price FROM menu_items WHERE id=1')[0],{name:'Legacy Tikka',price:177})
  assert.equal(pro.data('ingredients').ingredients.length,5)
  db.restore(db.bytes(),()=>{})
  assert.equal(pro.data('ingredients').ingredients.length,5)
})

test('inventory and loyalty settle exactly once and void reverses their recorded effects',async t=>{
  const {db,pro,service}=await fixture(t)
  pro.action({type:'ingredient',value:{name:'Test grain',unit:'kg',low_stock_threshold:1,cost_per_unit:100}},1)
  const ingredient=pro.data('ingredients').ingredients.find(row=>row.name==='Test grain')
  pro.action({type:'stock',id:ingredient.id,quantity:2,cost:100},1)
  pro.action({type:'recipe',menu:1,rows:[{ingredient_id:ingredient.id,quantity_required:.25}]},1)
  const phone='+91 80123 45678'
  pro.action({type:'customer',name:'Guest',phone,birthday:'2000-07-25'},1)
  db.write('UPDATE customers SET loyalty_points=30 WHERE phone=?',['8012345678'])
  const id=service.createOrder({type:'parcel',tableId:null,items:[{id:1,quantity:2}],phone,guestName:'Guest'},1)
  const input={orderId:id,revision:0,mode:'Cash',split:whole,tendered:600,redeem:20}
  assert.throws(()=>service.settle({...input,redeem:31},1,saveReceipt),/loyalty/)
  assert.equal(pro.data('ingredients').ingredients.find(row=>row.id===ingredient.id).current_stock,2)
  const {order,parts}=JSON.parse(service.settle(input,1,saveReceipt))
  assert.equal(order.grand_total,568)
  assert.equal(parts[0].total,56800)
  assert.equal(pro.data('ingredients').ingredients.find(row=>row.id===ingredient.id).current_stock,1.5)
  assert.equal(pro.customer(phone).loyalty_points,21.36)
  assert.equal(pro.customer(phone).favorite_item,'Paneer Tikka')
  assert.throws(()=>service.settle(input,1,saveReceipt),/closed/)
  pro.action({type:'recipe',menu:1,rows:[]},1)
  service.voidReceipt(id,1)
  assert.equal(pro.data('ingredients').ingredients.find(row=>row.id===ingredient.id).current_stock,2)
  assert.equal(pro.customer(phone).loyalty_points,30)
  assert.equal(pro.customer(phone).total_visits,0)
})

test('parked carts release their table and seat reservations block competing orders',async t=>{
  const {pro,service,reports}=await fixture(t)
  const parked=service.createOrder({type:'dinein',tableId:1,items:basket,parked:true},1)
  assert.equal(service.table(1).status,'vacant')
  assert.equal(pro.data('parked').parked[0].id,parked)
  assert.throws(()=>service.activeOrder(parked),/closed/)
  pro.action({type:'resume',id:parked},1)
  assert.equal(service.table(1).status,'occupied')
  service.parkOrder(parked,1,1)
  assert.equal(service.table(1).status,'vacant')
  const base={table_id:1,customer_name:'Guest',customer_phone:'8012345678',guest_count:2,notes:null}
  const time=new Date(Date.now()+3600000).toISOString()
  pro.action({type:'reservation',value:{...base,reservation_time:time,status:'booked'}},1)
  assert.throws(()=>pro.action({type:'reservation',value:{...base,reservation_time:time,status:'booked'}},1),/overlaps/)
  const booked=pro.data('reservations').reservations[0]
  pro.action({type:'seat',id:booked.id,table:1},1)
  assert.throws(()=>pro.action({type:'resume',id:parked},1),/no longer vacant/)
  assert.throws(()=>service.createOrder({type:'dinein',tableId:1,items:basket},1),/seated reservation/)
  const id=service.createOrder({type:'dinein',tableId:1,items:basket,reservationId:booked.id},1)
  assert.equal(service.table(1).status,'occupied')
  assert.equal(pro.data('reservations').reservations.length,0)
  service.settle({orderId:id,revision:0,mode:'Cash',tendered:300,split:whole},1,saveReceipt)
  pro.action({type:'expense',value:{title:'Milk run',category:'Milk',amount:44,payment_mode:'Cash',notes:null}},1)
  const day=reports.close({opening:100,counts:[0,0,0,0,0,0,0],coins:0},{id:1,name:'Admin'})
  assert.equal(day.expected,350)
  assert.equal(day.cashExpenses,44)
  assert.throws(()=>pro.action({type:'resume',id:parked},1),/day is closed/)
})

test('overnight pricing follows the prior weekday and KOT batches by station',async t=>{
  const {db,service}=await fixture(t)
  const monday=new Date(2026,10,30,23,0)
  const tuesday=new Date(2026,11,1,1,0)
  const rule={name:'Night Shift',rule_type:'discount_percent',value:20,category_id:3,days_of_week:'1',start_time:'22:00',end_time:'02:00',is_active:1}
  assert.equal(priceAt(100,3,[rule],monday).price,80)
  assert.equal(priceAt(100,3,[rule],tuesday).price,80)
  assert.equal(priceAt(100,2,[rule],tuesday).price,100)
  db.write("UPDATE menu_items SET station='none' WHERE id=3")
  const id=service.createOrder({type:'parcel',tableId:null,items:[...basket,{id:7,quantity:1},{id:3,quantity:1}]},1)
  const tickets=service.sendKot(id,0,1).map(ticket=>service.ticket(ticket))
  assert.deepEqual(tickets.map(ticket=>[ticket.station,ticket.lines[0].name]),[['kitchen','Paneer Tikka'],['bar','Masala Chai']])
  assert.equal(service.lines(id).find(line=>line.menu_item_id===3).kot_printed,0)
  assert.throws(()=>service.sendKot(id,1,1),/no unsent/)
})

test('LAN printer uses bounded private endpoints and strips ESC/POS controls from order text',async t=>{
  assert.equal(privatePrinter('8.8.8.8:9100'),null)
  assert.equal(privatePrinter('127.0.0.1:9100'),null)
  const address=Object.values(os.networkInterfaces()).flat().find(row=>row?.family==='IPv4' && privatePrinter(row.address+':9100'))?.address
  if(!address){t.skip('No private test interface');return}
  const server=net.createServer()
  server.listen(0,address)
  await once(server,'listening')
  t.after(()=>server.close())
  const payload=new Promise(resolve=>server.once('connection',socket=>{
    const chunks=[]
    socket.on('data',chunk=>chunks.push(chunk))
    socket.on('end',()=>resolve(Buffer.concat(chunks)))
  }))
  const ticket={id:1,station:'bar',reference:'Test',lines:[{name:'Coffee',quantity:1,notes:'No ice\x1b@'}]}
  const bytes=rawTicket(ticket)
  const route={id:1,name:'Fixture',role:'bar',address:address+':'+server.address().port,connection_type:'lan',paper_width:'80mm',is_active:1}
  const result=await new Printer().submit('<p>Test</p>',{print_preview:0,printer_name:null},1,route,bytes)
  assert.equal(result.html,null)
  assert.deepEqual(await payload,bytes)
  assert.match(bytes.toString('ascii'),/No ice @/)
})
