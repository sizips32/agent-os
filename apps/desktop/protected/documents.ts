import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fallbackImageOcr, runLocal, timeLeft, READ_BUDGET_MS } from './local-ocr'
import { fileURLToPath } from 'node:url'
export type Extracted = {
  units: { label: string; text: string; method: string }[]
  totalUnits: number
  truncated: boolean
  warnings: string[]
  partial?: boolean
}
export const OFFICE_HELPER = fileURLToPath(new URL('../dist/native/office-reader', import.meta.url))
// DOCX/XLSX/PPTX parsing runs in the sandboxed Rust helper (native/office-reader), never in this process.
export async function office(
  bytes: Buffer,
  ext: string,
  helper = OFFICE_HELPER,
  signal?: AbortSignal
): Promise<Extracted> {
  if (!['.docx', '.xlsx', '.pptx'].includes(ext)) throw Error('unsupported_file')
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-os-office-'))
  try {
    const file = path.join(dir, 'input' + ext)
    await writeFile(file, bytes, { mode: 0o600, flag: 'wx' })
    const result = JSON.parse(await runLocal(helper, [file, ext], READ_BUDGET_MS, signal)) as Extracted
    if (
      !Array.isArray(result.units) ||
      result.units.length > 200 ||
      result.totalUnits !== result.units.length ||
      typeof result.truncated !== 'boolean' ||
      !Array.isArray(result.warnings) ||
      !result.warnings.every(w => typeof w === 'string') ||
      !result.units.every(
        u => typeof u.text === 'string' && typeof u.label === 'string' && typeof u.method === 'string'
      )
    )
      throw Error('extraction_failed')
    return result
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
export async function nativeDocument(
  bytes: Buffer,
  ext: string,
  helper: string,
  signal?: AbortSignal
): Promise<Extracted> {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-os-document-'))
  try {
    const file = path.join(dir, 'input' + ext)
    await writeFile(file, bytes, { mode: 0o600, flag: 'wx' })
    const deadline = Date.now() + READ_BUDGET_MS
    let output: string
    try {
      output = await runLocal(helper, [file, ext === '.pdf' ? 'pdf' : 'image'], timeLeft(deadline), signal)
    } catch (error) {
      const code = error instanceof Error ? error.message : 'extraction_failed'
      if (ext !== '.pdf' && ['ocr_failed', 'no_text'].includes(code)) {
        try {
          return await fallbackImageOcr(file, { deadline, signal })
        } catch (fallback) {
          if (code === 'no_text' && fallback instanceof Error && fallback.message === 'ocr_unavailable')
            throw Error('no_text')
          throw fallback
        }
      }
      throw error
    }
    const result = JSON.parse(output) as Extracted
    if (
      !Array.isArray(result.units) ||
      result.units.length > 40 ||
      !result.units.every(u => typeof u.text === 'string' && typeof u.label === 'string')
    )
      throw Error('extraction_failed')
    return result
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
