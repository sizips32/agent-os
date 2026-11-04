import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fallbackImageOcr, runLocal, timeLeft, READ_BUDGET_MS } from './local-ocr'
import yauzl from 'yauzl'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
export type Extracted = { units: { label: string; text: string; method: string }[]; totalUnits: number; truncated: boolean; warnings: string[]; partial?: boolean }
const list = (v: any): any[] => v == null ? [] : Array.isArray(v) ? v : [v]
function xml(text: string): any {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw Error('invalid_document')
  return new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false, processEntities: true }).parse(text)
}
function strings(node: any, tag: string): string[] {
  if (!node || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([key, value]) => key === tag ? list(value).map(v => typeof v === 'object' ? String(v['#text'] ?? '') : String(v)) : list(value).flatMap(v => strings(v, tag)))
}
function paragraphs(source: string, prefix: 'w' | 'a') {
  if (prefix === 'w') {
    const tokens = /<w:(tbl|tr|tc)(?:\s[^>]*)?>|<\/w:(tbl|tr|tc)>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
    let table = 0; const stack: { table: number; row: number; cell: number }[] = []; const output: string[] = []
    for (const match of source.matchAll(tokens)) {
      if (match[1] === 'tbl') stack.push({ table: ++table, row: 0, cell: 0 })
      else if (match[2] === 'tbl') stack.pop()
      else if (match[1] === 'tr' && stack.length) { stack.at(-1)!.row++; stack.at(-1)!.cell = 0 }
      else if (match[1] === 'tc' && stack.length) stack.at(-1)!.cell++
      else if (!match[1] && !match[2]) {
        const text = strings(xml(match[0]), 'w:t').join(''); const context = stack.at(-1)
        output.push((context ? `[표 ${context.table} · 행 ${context.row} · 셀 ${context.cell}] ` : '') + text)
      }
    }
    return output.join('\n')
  }
  const pattern = new RegExp(`<${prefix}:p(?:\\s[^>]*)?>[\\s\\S]*?<\\/${prefix}:p>`, 'g')
  return [...source.matchAll(pattern)].map(m => strings(xml(m[0]), `${prefix}:t`).join('')).join('\n')
}
export async function office(bytes: Buffer, ext: string): Promise<Extracted> {
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw Error('invalid_document')
  const files = new Map<string, string>()
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (err, zip) => {
      if (err || !zip) { reject(Error('invalid_document')); return }
      let count = 0, total = 0, settled = false
      const fail = (code: string) => { if (!settled) { settled = true; zip.close(); reject(Error(code)) } }
      zip.on('error', () => fail('invalid_document'))
      zip.on('end', () => { if (!settled) { settled = true; resolve() } })
      zip.on('entry', entry => {
        if (++count > 3000 || entry.uncompressedSize > 8 * 1024 * 1024 ||
            (total += entry.uncompressedSize) > 32 * 1024 * 1024 ||
            entry.uncompressedSize > Math.max(1, entry.compressedSize) * 200) { fail('document_limit'); return }
        if (entry.generalPurposeBitFlag & 1) { fail('encrypted_file'); return }
        if (/(vbaProject|embeddings\/|externalLinks\/)/i.test(entry.fileName)) { fail('active_content'); return }
        if (!/\.(xml|rels)$/.test(entry.fileName)) { zip.readEntry(); return }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) { fail('invalid_document'); return }
          const chunks: Buffer[] = []; let size = 0
          stream.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8 * 1024 * 1024) { stream.destroy(); fail('document_limit') } else chunks.push(chunk) })
          stream.on('error', () => fail('invalid_document'))
          stream.on('end', () => {
            if (settled) return
            try {
              const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
              if (/<!DOCTYPE|<!ENTITY/i.test(text)) { fail('active_content'); return }
              if (files.has(entry.fileName)) { fail('invalid_document'); return }
              files.set(entry.fileName, text); zip.readEntry()
            } catch { fail('invalid_document') }
          })
        })
      }); zip.readEntry()
    })
  })
  const units: Extracted['units'] = []; const warnings: string[] = []
  const contentTypes = files.get('[Content_Types].xml') || ''
  const expected = { '.docx': 'wordprocessingml.document.main+xml', '.xlsx': 'spreadsheetml.sheet.main+xml', '.pptx': 'presentationml.presentation.main+xml' }[ext]
  if (!expected || !contentTypes.includes(expected) || /macroEnabled|vbaProject/i.test(contentTypes)) throw Error('invalid_document')
  xml(contentTypes)
  if (ext === '.docx') {
    const content = files.get('word/document.xml'); if (!content) throw Error('invalid_document')
    xml(content)
    units.push({ label: '본문·표 셀(문단 순서)', text: paragraphs(content, 'w'), method: 'DOCX 텍스트' })
    warnings.push('본문 문단과 표·행·셀의 텍스트입니다. 머리말·꼬리말·각주·그림·임베디드 개체는 읽지 않습니다.')
  } else if (ext === '.pptx') {
    const p = xml(files.get('ppt/presentation.xml') || '')
    const rel = xml(files.get('ppt/_rels/presentation.xml.rels') || '')
    const targets = new Map(list(rel.Relationships?.Relationship).map(r => [r['@_Id'], r['@_Target']]))
    const slides = list(p['p:presentation']?.['p:sldIdLst']?.['p:sldId'])
    if (!slides.length || slides.length > 200) throw Error('document_limit')
    for (const [index, slide] of slides.entries()) {
      const target = String(targets.get(slide['@_r:id']) || '')
      if (!/^slides\/slide\d+\.xml$/.test(target)) throw Error('invalid_document')
      const source = files.get('ppt/' + target); if (!source) throw Error('invalid_document')
      xml(source)
      units.push({ label: `슬라이드 ${index + 1}`, text: paragraphs(source, 'a'), method: 'PPTX 텍스트' })
    }
    warnings.push('프레젠테이션 순서의 텍스트만 추출합니다. 발표자 노트·그림·도형 의미·차트는 제외됩니다.')
  } else if (ext === '.xlsx') {
    const workbook = xml(files.get('xl/workbook.xml') || '')
    const rels = xml(files.get('xl/_rels/workbook.xml.rels') || '')
    const targets = new Map(list(rels.Relationships?.Relationship).map(r => [r['@_Id'], r['@_Target']]))
    const shared = files.has('xl/sharedStrings.xml') ? list(xml(files.get('xl/sharedStrings.xml')!).sst?.si).map(s => strings({ si: s }, 't').join('')) : []
    const sheets = list(workbook.workbook?.sheets?.sheet)
    if (!sheets.length || sheets.length > 100) throw Error('document_limit')
    let cells = 0
    for (const sheet of sheets) {
      const raw = String(targets.get(sheet['@_r:id']) || '')
      const target = raw.startsWith('/xl/') ? raw.slice(4) : raw
      if (!/^worksheets\/sheet\d+\.xml$/.test(target)) throw Error('invalid_document')
      const data = xml(files.get('xl/' + target) || '')
      const lines = list(data.worksheet?.sheetData?.row).flatMap(row => list(row.c).map(cell => {
        if (++cells > 20000) throw Error('document_limit')
        const address = String(cell['@_r'] || '')
        if (!/^[A-Z]{1,3}\d{1,7}$/.test(address)) throw Error('invalid_document')
        const type = cell['@_t']; const value = cell.v == null ? '' : String(cell.v)
        if (type === 's' && (!/^\d+$/.test(value) || shared[Number(value)] === undefined)) throw Error('invalid_document')
        const content = type === 's' ? shared[Number(value)] : type === 'inlineStr' ? strings({ is: cell.is }, 't').join('') : value
        return `${address}: ${content}${cell.f !== undefined ? ' [수식 캐시값; 재계산 안 함]' : ''}`
      }))
      units.push({ label: `시트 ${String(sheet['@_name'] || '')}`, text: lines.join('\n'), method: 'XLSX 셀 값' })
    }
    warnings.push('시트명·셀 주소·저장된 값입니다. 수식·매크로·외부 참조는 실행하지 않습니다. 서식·그림·차트는 제외됩니다.')
  } else throw Error('unsupported_file')
  if (!units.some(u => u.text.trim())) throw Error('no_text')
  let remaining = 200000, truncated = false
  for (const unit of units) {
    if (unit.text.length > remaining) { truncated = true; unit.method += remaining === 0 ? ' · 추출 한도로 생략' : ' · 일부만 추출' }
    unit.text = unit.text.slice(0, remaining); remaining -= unit.text.length
  }
  return { units, totalUnits: units.length, truncated, warnings }
}
export async function nativeDocument(bytes: Buffer, ext: string, helper: string, signal?: AbortSignal): Promise<Extracted> {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-os-document-'))
  try {
    const file = path.join(dir, 'input' + ext); await writeFile(file, bytes, { mode: 0o600, flag: 'wx' })
    const deadline=Date.now()+READ_BUDGET_MS
    let output:string
    try { output=await runLocal(helper,[file,ext==='.pdf'?'pdf':'image'],timeLeft(deadline),signal) }
    catch(error){
      const code=error instanceof Error?error.message:'extraction_failed'
      if(ext!=='.pdf'&&['ocr_failed','no_text'].includes(code)){
        try{return await fallbackImageOcr(file,{deadline,signal})}
        catch(fallback){if(code==='no_text'&&fallback instanceof Error&&fallback.message==='ocr_unavailable')throw Error('no_text');throw fallback}
      }
      throw error
    }
    const result = JSON.parse(output) as Extracted
    if (!Array.isArray(result.units) || result.units.length > 40 || !result.units.every(u => typeof u.text === 'string' && typeof u.label === 'string')) throw Error('extraction_failed')
    return result
  } finally { await rm(dir, { recursive: true, force: true }) }
}
