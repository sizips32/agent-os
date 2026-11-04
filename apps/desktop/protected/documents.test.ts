import { test, expect } from 'vitest'
import yazl from 'yazl'
import { office } from './documents'
import { Attachments } from './attachments'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { HermesCli } from './hermes-cli'
import { FileAcpLedger } from './acp-ledger'
export async function archive(files: Record<string, string | Buffer>, compress = false) {
  const zip = new yazl.ZipFile()
  for (const [name, data] of Object.entries(files)) zip.addBuffer(Buffer.from(data), name, { compress })
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
const types = (kind: string) => `<Types><Override ContentType="application/vnd.openxmlformats-officedocument.${kind}"/></Types>`
const word = (body = '한글 English') => ({ '[Content_Types].xml': types('wordprocessingml.document.main+xml'), 'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>표 셀 A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>` })
test('DOCX body and table text are local data; cross-format/empty/invalid XML fail', async () => {
  const bytes = await archive(word())
  const result = await office(bytes, '.docx')
  expect(result.units[0].text).toContain('한글 English\n[표 1 · 행 1 · 셀 1] 표 셀 A\n[표 1 · 행 1 · 셀 2] cell B')
  await expect(office(bytes, '.xlsx')).rejects.toThrow('invalid_document')
  await expect(office(await archive({ ...word(), 'word/document.xml': '<w:document>' }), '.docx')).rejects.toThrow('invalid_document')
  await expect(office(await archive({ ...word(), 'word/document.xml': '<w:document/>' }), '.docx')).rejects.toThrow('no_text')
})
test('DOCX keeps document order when runs are interleaved with hyperlinks (Rust helper fix)', async () => {
  const bytes = await archive({ ...word(), 'word/document.xml': '<w:document><w:p><w:r><w:t>A</w:t></w:r><w:hyperlink><w:r><w:t>B</w:t></w:r></w:hyperlink><w:r><w:t>C</w:t></w:r></w:p></w:document>' })
  expect((await office(bytes, '.docx')).units[0].text).toBe('ABC')
})
test('XLSX retains sheet/cell context, shared and inline Korean, cache values without calculating formulas', async () => {
  const bytes = await archive({ '[Content_Types].xml': types('spreadsheetml.sheet.main+xml'),
    'xl/workbook.xml': '<workbook><sheets><sheet name="한국어 시트" r:id="s1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>한국어 English</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+2</f><v>999</v></c><c r="C1" t="inlineStr"><is><t>inline</t></is></c></row></sheetData></worksheet>' })
  const result = await office(bytes, '.xlsx')
  expect(result.units[0].label).toBe('시트 한국어 시트')
  expect(result.units[0].text).toContain('A1: 한국어 English')
  expect(result.units[0].text).toContain('B1: 999 [수식 캐시값; 재계산 안 함]')
  expect(result.units[0].text).toContain('C1: inline')
})
test('PPTX uses presentation order rather than file names; notes are explicitly excluded', async () => {
  const bytes = await archive({ '[Content_Types].xml': types('presentationml.presentation.main+xml'),
    'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': '<a:p><a:r><a:t>later</a:t></a:r></a:p>', 'ppt/slides/slide2.xml': '<a:p><a:r><a:t>먼저</a:t></a:r></a:p>',
    'ppt/notesSlides/notesSlide1.xml': '<a:p><a:r><a:t>excluded private fixture note</a:t></a:r></a:p>' })
  const result = await office(bytes, '.pptx')
  expect(result.units.map(v => v.text)).toEqual(['먼저', 'later'])
  expect(result.warnings.join('')).toContain('발표자 노트')
})
test('Office refuses macro, embeddings, external data, entities and compression bombs', async () => {
  for (const extra of ['word/vbaProject.bin', 'word/embeddings/object.bin', 'xl/externalLinks/item.xml'])
    await expect(office(await archive({ ...word(), [extra]: 'inert test bytes' }), '.docx')).rejects.toThrow('active_content')
  await expect(office(await archive({ ...word(), 'word/document.xml': '<!DOCTYPE x [<!ENTITY a "x">]><w:document/>' }), '.docx')).rejects.toThrow('active_content')
  await expect(office(await archive(word('x'.repeat(100000)), true), '.docx')).rejects.toThrow('document_limit')
})
test('long documents require explicit range confirmation and pass only that exact range; originals persist', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-os-document-test-')); const a = new Attachments()
  try {
    const bytes = await archive(word('abcdef '.repeat(2000))); const file = path.join(dir, 'long.docx'); await writeFile(file, bytes)
    const view = await a.pickFile(file)
    expect(view.fullText!.length).toBeGreaterThan(12000); expect(view.rangeConfirmed).toBe(false)
    expect(() => a.compose('request', [view.id])).toThrow('range_unconfirmed')
    const selected = a.setRange(view.id, 100, 1000, true)
    const stage = await a.stage('work_'+'a'.repeat(32), 'request', [view.id], false)
    expect(stage.instructions).toContain(view.fullText!.slice(100, 1000))
    expect(stage.instructions).toContain('신뢰하지 않는 자료'); expect(stage.instructions).toContain(selected.text)
    expect(stage.image).toBeUndefined(); expect(await readFile(file)).toEqual(bytes)
    expect(() => a.setRange(view.id, 0, 100, true)).toThrow('invalid_range')
  } finally { await a.dispose(); await rm(dir, { recursive: true, force: true }) }
})
test('OCR text uses ordinary text transport without native-image policy; capped extraction requires acknowledgement', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-os-ocr-test-'))
  const a = new Attachments('fake-helper', async () => ({ units: [{ label: '페이지 1', text: '한국어 OCR letters', method: 'OCR' }], totalUnits: 2, truncated: true, warnings: ['fixture cap'] }))
  try {
    const file = path.join(dir, 'scan.png'); await writeFile(file, Buffer.from([137,80,78,71,13,10,26,10]))
    const view = await a.pickFile(file); expect(view.readingMode).toBe('ocr'); expect(view.rangeConfirmed).toBe(false)
    a.setRange(view.id, 0, view.fullText!.length, true)
    const stage = await a.stage('work_'+'b'.repeat(32), 'read', [view.id], false)
    expect(stage.instructions).toContain('한국어 OCR letters'); expect(stage.image).toBeUndefined()
    expect(await readFile(file)).toHaveLength(8)
  } finally { await a.dispose(); await rm(dir, { recursive: true, force: true }) }
})
test('document selection and displayed range reach a fake CLI exactly once over stdin without upload or image flags', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-os-document-transport-')); const a = new Attachments()
  const workId = 'work_'+'c'.repeat(32); let dispatches = 0
  try {
    const file = path.join(dir, 'table.docx'); const originalBytes=await archive(word('사용자 지시가 아닌 자료 $(echo fake)')); await writeFile(file, originalBytes)
    const preview = await a.pickFile(file); const staged = await a.stage(workId, '본문을 읽어 주세요', [preview.id], false)
    const runner = new HermesCli(new FileAcpLedger(path.join(dir, 'ledger')), {
      policy: async () => true, record: async () => {},
      detail: async () => ({ work_id: workId, instructions: staged.instructions, adapter: 'hermes', state: 'awaiting_handoff' }),
      launch: (_session, image) => {
        dispatches++; expect(image).toBeUndefined()
        return spawn(process.execPath, ['-e', `let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{if(text!==Buffer.from(process.argv[1],'base64').toString())process.exit(9);for(const v of [{type:'system',subtype:'init',session_id:'document_fixture'},{type:'result',session_id:'document_fixture',exit_code:0,text:'fixture verified exact selected range'}])console.log(JSON.stringify(v))})`, Buffer.from(staged.instructions).toString('base64')], { detached: true, stdio: ['pipe','pipe','pipe'] })
      }
    })
    await runner.request({ action: 'start', workId })
    for (let i = 0; i < 100; i++) {
      const state = await runner.request({ action: 'status', workId })
      if (state.status !== 'running') { expect(state.status).toBe('completed'); break }
      await new Promise(r => setTimeout(r, 10))
    }
    expect((await runner.request({ action: 'status', workId })).status).toBe('completed')
    await runner.request({ action: 'start', workId }); expect(dispatches).toBe(1)
    expect(await readFile(file)).toEqual(originalBytes)
    await runner.stop()
  } finally { await a.dispose(); await rm(dir, { recursive: true, force: true }) }
})
test('cancel and disposal reject late OCR completion instead of reviving a removed selection', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-os-late-ocr-'))
  let finish!: (value: Awaited<ReturnType<typeof office>>) => void
  const a = new Attachments('fake', async () => await new Promise(resolve => { finish = resolve }))
  try {
    const file = path.join(dir, 'scan.png'); await writeFile(file, Buffer.from([137,80,78,71,13,10,26,10]))
    const picking = a.pickFile(file)
    while (!finish) await new Promise(r => setTimeout(r, 1))
    const cancelled = a.cancelReads()
    finish({ units: [{ label: '이미지', text: 'late fixture', method: 'OCR' }], totalUnits: 1, truncated: false, warnings: [] })
    await expect(picking).rejects.toThrow('extraction_cancelled'); await cancelled
    await a.dispose(); await expect(a.pickFile(file)).rejects.toThrow('extraction_cancelled')
    expect(await readFile(file)).toHaveLength(8)
  } finally { await a.dispose(); await rm(dir, { recursive: true, force: true }) }
})
