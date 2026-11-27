import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { atomicWrite, PosDatabase } from './db'
import { MEDIA_LIMIT, MEDIA_NAME, MediaLibrary } from './media'

const magic = Buffer.from('SVXBAK\x02')
const maxBytes = 96 * 1024 * 1024
const png = Buffer.from('89504e470d0a1a0a', 'hex')

export function validatePassphrase(value: string, requireMinimum = true) {
  if (typeof value !== 'string' || value.length > 256 || (requireMinimum && value.length < 12)) {
    throw new Error('Use a backup passphrase of 12 to 256 characters.')
  }
}

export function encodeBackup(db: Uint8Array, files: Map<string, Buffer>, secret: string) {
  const database = Buffer.from(db.buffer, db.byteOffset, db.byteLength)
  const chunks = [Buffer.alloc(4), database]
  chunks[0].writeUInt32BE(database.length)
  let total = 4 + database.length
  for (const [name, bytes] of files) {
    const key = Buffer.from(name, 'ascii')
    const frame = Buffer.alloc(5)
    frame.writeUInt8(key.length)
    frame.writeUInt32BE(bytes.length, 1)
    total += frame.length + key.length + bytes.length
    if (total > maxBytes) throw new Error('This backup exceeds the 96 MB uncompressed limit.')
    chunks.push(frame, key, bytes)
  }
  if (total > maxBytes) throw new Error('This backup exceeds the 96 MB uncompressed limit.')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const header = Buffer.concat([magic, salt, iv])
  const cipher = createCipheriv('aes-256-gcm', scryptSync(secret, salt, 32), iv)
  cipher.setAAD(header)
  const compressed = gzipSync(Buffer.concat(chunks, total))
  const payload = Buffer.concat([cipher.update(compressed), cipher.final()])
  return Buffer.concat([header, cipher.getAuthTag(), payload])
}

export function decodeBackup(buffer: Buffer, secret: string) {
  const offset = magic.length
  const headerSize = offset + 28
  if (buffer.length > maxBytes + 65536 || buffer.length <= headerSize + 16 || !buffer.subarray(0, offset).equals(magic)) {
    throw new Error('Choose a supported encrypted ServeX backup.')
  }
  let contents: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', scryptSync(secret, buffer.subarray(offset, offset + 16), 32), buffer.subarray(offset + 16, headerSize))
    decipher.setAAD(buffer.subarray(0, headerSize))
    decipher.setAuthTag(buffer.subarray(headerSize, headerSize + 16))
    const compressed = Buffer.concat([decipher.update(buffer.subarray(headerSize + 16)), decipher.final()])
    contents = gunzipSync(compressed, { maxOutputLength: maxBytes })
  } catch {
    throw new Error('The backup is damaged or its passphrase is incorrect.')
  }
  const invalid = () => new Error('The archive contains invalid database or media entries.')
  if (contents.length < 4) throw invalid()
  const dbEnd = 4 + contents.readUInt32BE(0)
  if (dbEnd < 20 || dbEnd > contents.length) throw invalid()
  const files = new Map<string, Buffer>()
  let cursor = dbEnd
  while (cursor < contents.length) {
    if (contents.length - cursor < 5) throw invalid()
    const nameSize = contents.readUInt8(cursor)
    const size = contents.readUInt32BE(cursor + 1)
    const start = cursor + 5 + nameSize
    const end = start + size
    if (end > contents.length || size > MEDIA_LIMIT) throw invalid()
    const name = contents.toString('latin1', cursor + 5, start)
    const bytes = contents.subarray(start, end)
    if (!MEDIA_NAME.test(name) || files.has(name) || !bytes.subarray(0, 8).equals(png)) throw invalid()
    if (name.startsWith('image-') && name !== 'image-' + createHash('sha256').update(bytes).digest('hex') + '.png') throw invalid()
    files.set(name, bytes)
    cursor = end
  }
  return { db: contents.subarray(4, dbEnd), files }
}

export function backupFilename(date = new Date()) {
  const two = (n: number) => String(n).padStart(2, '0')
  return `ServeX_Backup_${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}_${two(date.getHours())}${two(date.getMinutes())}.svxbak`
}

export class BackupEngine {
  constructor(private db: PosDatabase, private media: MediaLibrary, private rollingDir: string) {}

  archive(secret: string) {
    const db = this.db.bytes()
    const files = new Map<string, Buffer>()
    let size = db.length
    for (const entry of fs.readdirSync(this.media.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !MEDIA_NAME.test(entry.name)) continue
      const bytes = this.media.read(entry.name)
      if (!bytes) throw new Error('A ServeX media file exceeds the backup limit.')
      size += bytes.length
      if (size > maxBytes) throw new Error('This backup exceeds the 96 MB uncompressed limit.')
      files.set(entry.name, bytes)
    }
    return encodeBackup(db, files, secret)
  }

  restore(file: string, passphrase: string, localKey: string | undefined, safetyKey: string) {
    if (fs.statSync(file).size > maxBytes + 65536) throw new Error('The backup is too large.')
    const bytes = fs.readFileSync(file)
    // Version 1 exported plain SQLite with no media. Keep those migration files usable.
    const legacy = bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))
    const { db, files } = legacy ? { db: bytes, files: new Map<string, Buffer>() } : decodeBackup(bytes, passphrase || localKey || '')
    this.db.restore(db, () => {
      const safety = path.join(this.rollingDir, '..', 'restore-safety',
        backupFilename().replace('.svxbak', `_${randomUUID()}.svxbak`))
      atomicWrite(safety, this.archive(safetyKey))
      // Install immutable assets before committing the database. A failed restore leaves
      // the active database and its previously referenced assets intact.
      for (const [name, asset] of files) {
        const existing = this.media.read(name)
        if (existing && !existing.equals(asset)) throw new Error('A backup image conflicts with an existing ServeX asset.')
        if (!existing) atomicWrite(path.join(this.media.directory, name), asset)
      }
    }, legacy)
  }

  rolling(secret: string) {
    const file = backupFilename().replace('.svxbak', `_${String(Date.now()).padStart(13, '0')}_${randomUUID()}.svxbak`)
    atomicWrite(path.join(this.rollingDir, file), this.archive(secret))
    const snapshots = fs.readdirSync(this.rollingDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^ServeX_Backup_.*_\d{13}_[a-f0-9-]{36}\.svxbak$/.test(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => b.slice(-57).localeCompare(a.slice(-57)))
    for (const name of snapshots.slice(5)) fs.unlinkSync(path.join(this.rollingDir, name))
  }
}
