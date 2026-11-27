import { BrowserWindow, dialog, nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './db'
import type { PickedMedia } from '../src/types/pos'

export const MEDIA_NAME = /^(?:image-[a-f0-9]{64}|logo-[a-f0-9-]{36})\.png$/
export const MEDIA_LIMIT = 2 * 1024 * 1024

export class MediaLibrary {
  constructor(readonly directory: string, legacy: string) {
    fs.mkdirSync(directory, { recursive: true })
    if (!fs.existsSync(legacy)) return
    for (const entry of fs.readdirSync(legacy, { withFileTypes: true })) {
      if (!entry.isFile() || !MEDIA_NAME.test(entry.name)) continue
      const source = path.join(legacy, entry.name)
      if (!this.read(entry.name) && fs.statSync(source).size <= MEDIA_LIMIT) {
        atomicWrite(path.join(directory, entry.name), fs.readFileSync(source))
      }
    }
  }

  read(name: string | null) {
    if (typeof name !== 'string' || !MEDIA_NAME.test(name)) return null
    const file = path.join(this.directory, name)
    const stat = fs.lstatSync(file, { throwIfNoEntry: false })
    return stat?.isFile() && stat.size <= MEDIA_LIMIT ? fs.readFileSync(file) : null
  }

  preview(name: string | null) {
    const bytes = this.read(name)
    return bytes ? 'data:image/png;base64,' + bytes.toString('base64') : null
  }

  async pick(window: BrowserWindow, stillAuthorized: () => boolean): Promise<PickedMedia | null> {
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] })
    if (result.canceled || !stillAuthorized()) return null
    const file = result.filePaths[0]
    if (fs.statSync(file).size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.')
    const image = nativeImage.createFromPath(file)
    if (image.isEmpty()) throw new Error('The image could not be opened.')
    const { width, height } = image.getSize()
    const resized = Math.max(width, height) <= 512 ? image : image.resize(width >= height ? { width: 512 } : { height: 512 })
    const bytes = resized.toPNG()
    const name = 'image-' + createHash('sha256').update(bytes).digest('hex') + '.png'
    if (!this.read(name)) atomicWrite(path.join(this.directory, name), bytes)
    return { name, preview: 'data:image/png;base64,' + bytes.toString('base64') }
  }
}
