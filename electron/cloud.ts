import { safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite, PosDatabase } from './db'
import { BackupEngine, backupFilename, validatePassphrase } from './backup'
import type { CloudInput } from '../src/types/pos'

interface Credentials { endpoint: string; token: string; passphrase: string }

export class DeviceSecrets {
  constructor(private directory: string) {}

  private requireVault() {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('OS credential storage is unavailable.')
    }
  }

  read(name: 'backup-key' | 'cloud') {
    this.requireVault()
    const file = path.join(this.directory, name)
    return fs.existsSync(file) ? safeStorage.decryptString(fs.readFileSync(file)) : undefined
  }

  write(name: 'backup-key' | 'cloud', value: string) {
    this.requireVault()
    atomicWrite(path.join(this.directory, name), safeStorage.encryptString(value))
  }

  localKey() {
    const current = this.read('backup-key')
    if (current) return current
    const key = randomBytes(32).toString('base64url')
    this.write('backup-key', key)
    return key
  }
}

export class CloudBackup {
  private upload: AbortController | null = null
  private revision = 0

  constructor(private db: PosDatabase, private backup: BackupEngine, private secrets: DeviceSecrets) {}

  private config() {
    return this.db.all<{ cloud_sync_enabled: number; cloud_endpoint: string | null; cloud_last_synced: string | null }>(
      'SELECT cloud_sync_enabled, cloud_endpoint, cloud_last_synced FROM settings WHERE id = 1',
    )[0]
  }

  private credentials(endpoint: string | null): Credentials | undefined {
    if (!endpoint) return undefined
    const raw = this.secrets.read('cloud')
    const value = raw ? JSON.parse(raw) as Credentials : undefined
    return value?.endpoint === endpoint ? value : undefined
  }

  status() {
    const config = this.config()
    let credentials: Credentials | undefined
    try { credentials = this.credentials(config.cloud_endpoint) } catch { /* Vault may be unavailable. */ }
    return {
      tokenConfigured: Boolean(credentials?.token),
      passphraseConfigured: Boolean(credentials?.passphrase),
      lastSynced: config.cloud_last_synced,
    }
  }

  update(input: CloudInput) {
    if (typeof input.enabled !== 'boolean' || typeof input.endpoint !== 'string' || input.endpoint.length > 2048) {
      throw new Error('Enter a valid cloud backup configuration.')
    }
    let endpoint = input.endpoint.trim()
    if (endpoint) {
      let url: URL
      try { url = new URL(endpoint) } catch { throw new Error('Enter a valid HTTPS endpoint.') }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Enter an HTTPS endpoint without credentials or a fragment.')
      endpoint = url.href
    }
    const previous = this.config()
    const previousCredentials = endpoint && (input.enabled || input.token || input.passphrase) ? this.credentials(endpoint) : undefined
    const token = input.token ?? previousCredentials?.token ?? ''
    const passphrase = input.passphrase ?? previousCredentials?.passphrase ?? ''
    if (typeof token !== 'string' || token.length > 4096 || /[^\x21-\x7e]/.test(token)) throw new Error('Enter a valid cloud token.')
    if (passphrase) validatePassphrase(passphrase)
    if ((input.enabled || input.token || input.passphrase) && (!endpoint || !token || !passphrase)) {
      throw new Error('Cloud backup requires an HTTPS endpoint, token, and backup passphrase.')
    }
    if (endpoint && token && passphrase) this.secrets.write('cloud', JSON.stringify({ endpoint, token, passphrase }))
    this.invalidate()
    this.db.write('UPDATE settings SET cloud_sync_enabled = ?, cloud_endpoint = ?, cloud_last_synced = ? WHERE id = 1',
      [Number(input.enabled), endpoint || null, previous.cloud_endpoint === endpoint && !input.passphrase ? previous.cloud_last_synced : null])
  }

  invalidate() {
    this.revision++
    this.upload?.abort()
  }

  async sync(automatic = false) {
    if (this.upload) {
      if (automatic) return
      throw new Error('A cloud backup is already running.')
    }
    const config = this.config()
    if (automatic && (!config.cloud_sync_enabled || (config.cloud_last_synced && Date.now() - Date.parse(config.cloud_last_synced) < 86400000))) return
    const credentials = this.credentials(config.cloud_endpoint)
    if (!credentials) throw new Error('Save the cloud endpoint, token, and backup passphrase first.')
    const revision = this.revision
    const upload = new AbortController()
    this.upload = upload
    try {
      const body = this.backup.archive(credentials.passphrase)
      const response = await fetch(credentials.endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([upload.signal, AbortSignal.timeout(30000)]),
        headers: {
          Authorization: 'Bearer ' + credentials.token,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${backupFilename()}"`,
        },
        body: new Uint8Array(body),
      })
      await response.body?.cancel()
      if (!response.ok) throw new Error(`Cloud backup failed (HTTP ${response.status}).`)
      if (revision === this.revision) {
        this.db.write('UPDATE settings SET cloud_last_synced = ? WHERE id = 1', [new Date().toISOString()])
      }
    } finally { this.upload = null }
  }
}
