import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import os from 'node:os'
import { WebSocket, WebSocketServer } from 'ws'
import type { PosDatabase } from './db'
import type { FloorService } from './service'
import type { LanState, OrderInput } from '../src/types/pos'

function privateIpv4(address: string) {
  return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(address)
}

async function body(request: IncomingMessage) {
  if (!/^application\/json(?:;|$)/i.test(String(request.headers['content-type']))) throw new Error('Send application/json.')
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 32768) throw new Error('Order body is too large.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as OrderInput
}

export class LocalServer {
  private http: ReturnType<typeof createServer> | undefined
  private ws: WebSocketServer | undefined
  private token = ''
  private url: string | null = null
  private error: string | undefined
  private starting: Promise<LanState> | undefined

  constructor(private db: PosDatabase, private orders: FloorService, private permitted: () => boolean, private onOrder = () => {}) {}

  state(): LanState {
    return { enabled: Boolean(this.url), url: this.url,
      pairing: this.url ? JSON.stringify({ version: 1, url: this.url, token: this.token }) : null, error: this.error }
  }

  start(actor: number) {
    if (this.starting) return this.starting
    if (this.url) return Promise.resolve(this.state())
    const address = Object.values(os.networkInterfaces()).flatMap(rows => rows ?? [])
      .find(row => row.family === 'IPv4' && !row.internal && privateIpv4(row.address))?.address
    if (!address) { this.error = 'No private IPv4 network interface is available.'; return Promise.resolve(this.state()) }
    this.token = randomBytes(32).toString('base64url')
    this.error = undefined
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false })
    this.ws = sockets
    const canAccess = () => this.permitted() &&
      this.db.all("SELECT id FROM users WHERE id=? AND role='admin' AND is_active=1", [actor]).length === 1
    const server = createServer({ requestTimeout: 10000, headersTimeout: 5000, maxHeaderSize: 8192 }, async (request, response) => {
      const send = (status: number, data: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        response.end(JSON.stringify(data))
      }
      if (request.headers.origin || !this.auth(request.headers.authorization) || !canAccess()) return send(401, { error: 'Unauthorized' })
      try {
        if (request.method === 'GET' && request.url === '/api/v1/catalog') {
          return send(200, {
            zones: this.db.all('SELECT * FROM zones ORDER BY sort_order, id'),
            tables: this.db.all('SELECT * FROM tables ORDER BY id'),
            categories: this.db.all('SELECT id, name, sort_order FROM categories WHERE is_active=1 ORDER BY sort_order,id'),
            menu: this.db.all(`SELECT m.id,m.name,m.category_id,m.price,m.tax_slab,m.is_veg FROM menu_items m JOIN categories c ON c.id=m.category_id
              WHERE m.archived=0 AND m.is_available=1 AND c.is_active=1 ORDER BY m.id`),
          })
        }
        if (request.method === 'POST' && request.url === '/api/v1/orders') {
          const key = request.headers['idempotency-key']
          if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) return send(400, { error: 'Use a unique Idempotency-Key.' })
          const input = await body(request)
          if (!canAccess() || this.http !== server || !this.auth(request.headers.authorization)) {
            return send(403, { error: 'Mobile order access is disabled.' })
          }
          const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
          const cached = this.db.all<{ payload: string; order_id: number }>('SELECT payload,order_id FROM lan_requests WHERE request_id=?', [key])[0]
          if (cached) return cached.payload === hash ? send(200, { orderId: cached.order_id }) : send(409, { error: 'Idempotency key already used.' })
          const orderId = this.orders.createOrder(input, actor, { key, hash })
          this.changed()
          this.onOrder()
          return send(201, { orderId })
        }
        send(404, { error: 'Not found' })
      } catch (error) {
        if (!response.destroyed) send(400, { error: error instanceof Error && !('code' in error) ? error.message : 'Order could not be processed.' })
      }
    })
    server.maxConnections = 32
    server.on('upgrade', (request, socket, head) => {
      if (request.url !== '/api/v1/events' || request.headers.origin || !this.auth(request.headers.authorization) || !canAccess() || sockets.clients.size >= 16) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        return
      }
      sockets.handleUpgrade(request, socket, head, ws => {
        ws.on('error', () => ws.terminate())
        ws.on('message', () => ws.close(1008, 'Read only'))
        ws.send(JSON.stringify({ type: 'ready' }))
      })
    })
    this.http = server
    const pending = new Promise<LanState>(resolve => {
      server.on('error', (error: NodeJS.ErrnoException) => {
        if (this.http !== server) { resolve(this.state()); return }
        this.stop()
        this.error = error.code === 'EADDRINUSE' ? 'Port 4890 is already in use.' : 'Could not start Mobile Waiter Sync.'
        resolve(this.state())
      })
      server.listen(4890, address, () => {
        if (this.http === server) this.url = `http://${address}:4890`
        resolve(this.state())
      })
    })
    this.starting = pending.finally(() => { this.starting = undefined })
    return this.starting
  }

  private auth(value?: string) {
    const expected = Buffer.from('Bearer ' + this.token)
    const provided = Buffer.from(value ?? '')
    return Boolean(this.token) && provided.length === expected.length && timingSafeEqual(provided, expected)
  }

  changed() {
    for (const client of this.ws?.clients ?? []) {
      if (!this.permitted() || client.bufferedAmount > 16384) client.terminate()
      else if (client.readyState === WebSocket.OPEN) client.send('{"type":"catalog-changed"}')
    }
  }

  stop() {
    this.url = null
    this.token = ''
    for (const client of this.ws?.clients ?? []) client.terminate()
    this.ws?.close()
    this.http?.closeAllConnections()
    this.http?.close()
    this.ws = undefined
    this.http = undefined
  }
}
