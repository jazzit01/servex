import { createHash, createPublicKey, verify } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { atomicWrite } from './db'
import type { LicenseState } from '../src/types/pos'

export function machineFingerprint() {
  let identity = os.hostname()
  try {
    if (process.platform === 'win32') {
      const info = execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
      identity = info.match(/MachineGuid\s+REG_SZ\s+([^\s]+)/i)?.[1] ?? identity
    } else if (process.platform === 'linux') identity = fs.readFileSync('/etc/machine-id', 'utf8').trim() || identity
    else if (process.platform === 'darwin') {
      identity = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 3000 })
        .match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? identity
    }
  } catch { /* The hostname is a fallback on restricted hosts. */ }
  return createHash('sha256').update('ServeX license v1:' + identity.toLowerCase()).digest('hex').slice(0, 24).toUpperCase()
}

// Provision this value with the issuer's SPKI public PEM before shipping a paid release.
export const PUBLIC_KEY_PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAFYuEVds3FsTsKtgbT0IoRWMpnQF7w3g3vkA+aOHZFFY=\n-----END PUBLIC KEY-----\n"

export function validActivation(value: string, machine: string, publicKey: string = PUBLIC_KEY_PEM) {
  if (!publicKey.startsWith('-----BEGIN PUBLIC KEY-----') || typeof value !== 'string' || value.length > 256) return false
  const deviceId = machine.trim().toUpperCase()
  if (!/^[A-F0-9]{24}$/.test(deviceId)) return false
  const token = value.trim()
  try {
    const key = createPublicKey(publicKey)
    if (key.asymmetricKeyType !== 'ed25519') return false
    if (/^SVX-[A-Za-z0-9_-]{86}$/.test(token)) {
      const encoded = token.slice(4)
      const signature = Buffer.from(encoded, 'base64url')
      return signature.length === 64 && signature.toString('base64url') === encoded &&
        verify(null, Buffer.from(deviceId), key, signature)
    }
    if (/^SVX-(?:[A-F0-9]{4}-){31}[A-F0-9]{4}$/i.test(token)) {
      const signature = Buffer.from(token.slice(4).replace(/-/g, ''), 'hex')
      return verify(null, Buffer.from('ServeX commercial v1:' + deviceId), key, signature)
    }
    return false
  } catch { return false }
}

export class LicenseManager {
  readonly machine = machineFingerprint()
  private clock: { start: number; seen: number }

  constructor(private file: string, private publicKey?: string) {
    const now = Date.now()
    if (!fs.existsSync(file)) {
      this.clock = { start: now, seen: now }
      this.save()
      return
    }
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf8')) as { start: number; seen: number }
      if (!Number.isSafeInteger(record.start) || !Number.isSafeInteger(record.seen) ||
          record.start < 0 || record.seen < record.start) throw new Error('Invalid trial clock')
      this.clock = record
    } catch {
      // Preserve the damaged file and require activation instead of issuing a new trial.
      this.clock = { start: 0, seen: now }
    }
  }

  private save() { atomicWrite(this.file, Buffer.from(JSON.stringify(this.clock))) }

  accepts(key: string) { return validActivation(key, this.machine, this.publicKey) }

  state(key: string | null): LicenseState {
    if (key && this.accepts(key)) return { machine: this.machine, daysLeft: 0, mode: 'active' }
    const now = Math.max(Date.now(), this.clock.seen)
    if (now - this.clock.seen >= 60000) { this.clock.seen = now; this.save() }
    const daysLeft = Math.max(0, Math.min(7, Math.ceil((this.clock.start + 7 * 86400000 - now) / 86400000)))
    return { machine: this.machine, daysLeft, mode: daysLeft ? 'trial' : 'expired' }
  }
}
