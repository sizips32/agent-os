import { constants } from 'node:fs'
import { open, realpath, lstat, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type { AttachmentPreview, WorkImage } from './types'
import { attachmentInstructions, REQUEST_LIMIT } from './attachment-content'
import { office, nativeDocument, type Extracted } from './documents'
const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.json'])
const IMAGE_EXT = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
])
const IMAGE_MAX = 5 * 1024 * 1024
const TEXT_MAX = 64 * 1024
const DOCUMENT_EXT = new Set(['.pdf', '.docx', '.xlsx', '.pptx'])
const idPattern = /^attachment_[a-f0-9]{32}$/
export function attachmentIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 8 ||
    value.some(id => typeof id !== 'string' || !idPattern.test(id)) ||
    new Set(value).size !== value.length
  )
    throw Error('Invalid attachments')
  return value as string[]
}
function safeSelectedFile(p: string) {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  const parts = p.toLowerCase().split(path.sep)
  return (
    !parts.some(s =>
      ['.hermes', '.codex', '.ssh', '.aws', '.config', '.gnupg', 'memories', 'credentials', 'keychains'].includes(s)
    ) && !/^(\.env|auth\.|credentials|config\.|id_(rsa|ed25519)|.*\.(pem|key)$)/i.test(path.basename(p))
  )
}
export function imageMime(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  return null
}
export class Attachments {
  constructor(
    private helper?: string,
    private extractNative = nativeDocument,
    private officeHelper?: string
  ) {}
  private selected = new Map<string, { view: AttachmentPreview; bytes: Buffer; ext: string }>()
  private staged = new Map<string, { dir: string; image: WorkImage }>()
  private readGeneration = 0
  private closed = false
  private reads = new Set<Promise<Extracted>>()
  private controllers = new Set<AbortController>()
  // Called only with a path returned by the native file picker; no path IPC exists.
  async pickFile(candidate: string): Promise<AttachmentPreview> {
    if (this.closed) throw Error('extraction_cancelled')
    const generation = this.readGeneration
    if (this.selected.size >= 8) throw Error('attachment_limit')
    if (!safeSelectedFile(candidate)) throw Error('protected_file')
    if ((await lstat(candidate)).isSymbolicLink()) throw Error('protected_file')
    const actual = await realpath(candidate)
    if (!safeSelectedFile(actual)) throw Error('protected_file')
    const ext = path.extname(actual).toLowerCase()
    if (['.doc', '.xls', '.ppt'].includes(ext)) throw Error('legacy_document')
    const kind = TEXT_EXT.has(ext) || DOCUMENT_EXT.has(ext) ? 'text' : IMAGE_EXT.has(ext) ? 'image' : null
    if (!kind) throw Error('unsupported_file')
    if (kind === 'image' && [...this.selected.values()].some(item => item.view.kind === 'image'))
      throw Error('one_image_only')
    const file = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let bytes: Buffer
    try {
      const stat = await file.stat()
      const max = kind === 'image' ? IMAGE_MAX : DOCUMENT_EXT.has(ext) ? 16 * 1024 * 1024 : TEXT_MAX
      if (!stat.isFile() || stat.size === 0 || stat.size > max) throw Error('file_size')
      // Bounded read also rejects files that grow after stat().
      const buffer = Buffer.alloc(max + 1)
      let length = 0
      while (length < buffer.length) {
        const result = await file.read(buffer, length, buffer.length - length, null)
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      if (length > max || !length) throw Error('file_size')
      bytes = buffer.subarray(0, length)
    } finally {
      await file.close()
    }
    const name = path
      .basename(actual)
      .replace(/[\x00-\x1f\x7f]/g, '')
      .slice(0, 100)
    const id = `attachment_${randomUUID().replaceAll('-', '')}`
    let view: AttachmentPreview
    if (DOCUMENT_EXT.has(ext) || (kind === 'image' && this.helper)) {
      let extracted: Extracted
      const native = ext === '.pdf' || kind === 'image'
      if (native) {
        if (!this.helper) throw Error('extraction_unavailable')
        if (ext === '.pdf' && bytes.toString('ascii', 0, 5) !== '%PDF-') throw Error('invalid_document')
        if (kind === 'image' && imageMime(bytes) !== IMAGE_EXT.get(ext)) throw Error('invalid_image')
      }
      const controller = new AbortController()
      this.controllers.add(controller)
      const pending = native
        ? this.extractNative(bytes, ext, this.helper!, controller.signal)
        : office(bytes, ext, this.officeHelper, controller.signal)
      this.reads.add(pending)
      try {
        extracted = await pending
      } finally {
        this.reads.delete(pending)
        this.controllers.delete(controller)
      }
      let fullText = ''
      const units = extracted.units.map(unit => {
        const start = fullText.length
        fullText += `[${unit.label} · ${unit.method}]\n${unit.text || (unit.method.includes('생략') ? '(추출 한도로 내용 생략)' : '(글자 없음)')}\n\n`
        return { label: unit.label, method: unit.method, start, end: fullText.length }
      })
      const end = Math.min(fullText.length, 8000)
      view = {
        id,
        kind,
        name,
        bytes: bytes.length,
        text: fullText.slice(0, end),
        fullText,
        rangeStart: 0,
        rangeEnd: end,
        rangeConfirmed: end === fullText.length && !extracted.truncated && !extracted.partial,
        truncated: extracted.truncated,
        partial: extracted.partial,
        units,
        totalUnits: extracted.totalUnits,
        warnings: extracted.warnings,
        ...(kind === 'image'
          ? { readingMode: 'ocr' as const, dataUrl: `data:${IMAGE_EXT.get(ext)};base64,${bytes.toString('base64')}` }
          : {})
      }
    } else if (kind === 'text') {
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw Error('utf8_required')
      }
      if (text.includes('\0')) throw Error('text_limit')
      const end = Math.min(text.length, 8000)
      view = {
        id,
        kind,
        name,
        bytes: bytes.length,
        text: text.slice(0, end),
        fullText: text,
        rangeStart: 0,
        rangeEnd: end,
        rangeConfirmed: end === text.length,
        units: [{ label: '본문', method: 'UTF-8', start: 0, end: text.length }],
        totalUnits: 1
      }
    } else {
      const mime = imageMime(bytes)
      if (mime !== IMAGE_EXT.get(ext)) throw Error('invalid_image')
      view = { id, kind, name, bytes: bytes.length, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` }
    }
    if (this.closed || generation !== this.readGeneration) throw Error('extraction_cancelled')
    this.selected.set(id, { view, bytes, ext })
    return { ...view }
  }
  remove(id: unknown) {
    if (typeof id !== 'string' || !idPattern.test(id)) throw Error('Invalid attachment')
    this.selected.delete(id)
  }
  setRange(id: unknown, start: unknown, end: unknown, confirmed: unknown): AttachmentPreview {
    if (
      typeof id !== 'string' ||
      !idPattern.test(id) ||
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      typeof confirmed !== 'boolean'
    )
      throw Error('invalid_range')
    const item = this.selected.get(id)
    if (
      !item?.view.fullText ||
      start < 0 ||
      end <= start ||
      end > item.view.fullText.length ||
      end - start > REQUEST_LIMIT
    )
      throw Error('invalid_range')
    item.view = {
      ...item.view,
      rangeStart: start,
      rangeEnd: end,
      rangeConfirmed: confirmed,
      text: item.view.fullText.slice(start, end)
    }
    return { ...item.view }
  }
  compose(draft: string, ids: unknown) {
    const refs = attachmentIds(ids)
    const items = refs.map(id => {
      const item = this.selected.get(id)
      if (!item) throw Error('attachment_missing')
      return item
    })
    if (items.some(item => item.view.rangeConfirmed === false)) throw Error('range_unconfirmed')
    if (items.filter(item => item.view.kind === 'image').length > 1) throw Error('one_image_only')
    const instructions = attachmentInstructions(
      draft,
      items.map(item => item.view)
    )
    if (!instructions.trim() || instructions.includes('\0') || instructions.length > REQUEST_LIMIT)
      throw Error('text_limit')
    return { refs, items, instructions }
  }
  async stage(workId: string, draft: string, ids: unknown, nativeImageAllowed: boolean) {
    if (!/^work_[a-f0-9]{32}$/.test(workId)) throw Error('Invalid work')
    const composed = this.compose(draft, ids)
    const item = composed.items.find(item => item.view.kind === 'image' && item.view.readingMode !== 'ocr')
    if (item && !nativeImageAllowed) throw Error('image_unverified')
    let image: WorkImage | undefined
    if (item) {
      const dir = await mkdtemp(path.join(tmpdir(), 'agent-os-attachments-'))
      try {
        const file = path.join(dir, `${workId}${item.ext}`)
        await writeFile(file, item.bytes, { mode: 0o600, flag: 'wx' })
        image = { path: file, sha256: createHash('sha256').update(item.bytes).digest('hex') }
        this.staged.set(workId, { dir, image })
      } catch (error) {
        await rm(dir, { recursive: true, force: true })
        throw error
      }
    }
    for (const id of composed.refs) this.selected.delete(id)
    return { instructions: composed.instructions, image }
  }
  async release(workId: string) {
    const item = this.staged.get(workId)
    if (!item) return
    await rm(item.dir, { recursive: true, force: true })
    this.staged.delete(workId)
  }
  async dispose() {
    this.closed = true
    await this.cancelReads()
    this.selected.clear()
    for (const id of [...this.staged.keys()]) await this.release(id)
  }
  async cancelReads() {
    this.readGeneration++
    for (const controller of this.controllers) controller.abort()
    await Promise.allSettled([...this.reads])
  }
}
