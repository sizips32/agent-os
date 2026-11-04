import { test, expect } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, symlink, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Attachments, attachmentIds } from './attachments'
import { attachmentInstructions } from './attachment-content'
const work = 'work_' + 'a'.repeat(32)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=', 'base64')
async function harness(fn: (a: Attachments, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-os-attachment-test-'))
  const a = new Attachments()
  try { await fn(a, dir) } finally { await a.dispose(); await rm(dir, { recursive: true, force: true }) }
}
test('text selection previews real UTF-8 bytes; only explicit staging composes content', async () => harness(async (a, dir) => {
  const file = path.join(dir, 'notes.md'); await writeFile(file, '실제 파일 내용: $(echo harmless)')
  const item = await a.pickFile(file)
  expect(item.text).toBe('실제 파일 내용: $(echo harmless)'); expect(item).not.toHaveProperty('path')
  const staged = await a.stage(work, '요약해 주세요', [item.id], false)
  expect(staged.instructions).toBe(attachmentInstructions('요약해 주세요', [item]))
  expect(staged.instructions).toContain(item.text); expect(staged.image).toBeUndefined()
  expect(await readFile(file, 'utf8')).toBe(item.text)
  expect(() => a.compose('again', [item.id])).toThrow('attachment_missing')
}))
test('unsupported, malformed UTF-8, NUL, protected, symlink and oversized inputs are rejected', async () => harness(async (a, dir) => {
  for (const [name, bytes, code] of [
    ['file.exe', Buffer.from('exe'), 'unsupported_file'], ['.env.json', Buffer.from('{}'), 'protected_file'],
    ['broken.txt', Buffer.from([0xff]), 'utf8_required'], ['nul.txt', Buffer.from('a\0b'), 'text_limit'],
    ['large.txt', Buffer.alloc(65537), 'file_size'],
    ['large.png', Buffer.alloc(5*1024*1024+1), 'file_size'], ['wrong.png', Buffer.from('not an image'), 'invalid_image']
  ] as const) {
    const p = path.join(dir, name); await writeFile(p, bytes)
    await expect(a.pickFile(p)).rejects.toThrow(code)
  }
  const p = path.join(dir, 'valid.txt'); await writeFile(p, 'valid'); await symlink(p, path.join(dir, 'link.txt'))
  await expect(a.pickFile(path.join(dir, 'link.txt'))).rejects.toThrow('protected_file')
}))
test('aggregate 12000 limit includes file name and delimiters; invalid refs never stage', async () => harness(async (a, dir) => {
  const p = path.join(dir, 'one.txt'); await writeFile(p, '한글 파일 내용')
  const item = await a.pickFile(p)
  await expect(a.stage(work, 'x'.repeat(11999), [item.id], false)).rejects.toThrow('text_limit')
  expect(a.compose('', [item.id]).instructions).toContain('한글 파일 내용')
  for (const refs of [null, ['../file'], [item.id, item.id], Array(9).fill(item.id)]) expect(() => attachmentIds(refs)).toThrow()
  a.remove(item.id); a.remove(item.id)
  expect(() => a.compose('draft', [item.id])).toThrow('attachment_missing')
  expect(() => a.remove('../x')).toThrow()
}))
test('image selection stays in memory; unverified model blocks; owned copy survives source removal then cleans', async () => harness(async (a, dir) => {
  const file = path.join(dir, 'image.png'); await writeFile(file, png)
  const item = await a.pickFile(file)
  expect(item.dataUrl).toContain('data:image/png;base64,'); expect(item).not.toHaveProperty('path')
  await expect(a.stage(work, '', [item.id], false)).rejects.toThrow('image_unverified')
  await expect(a.pickFile(file)).rejects.toThrow('one_image_only')
  await rm(file)
  const staged = await a.stage(work, '', [item.id], true)
  expect(staged.instructions).toBe('첨부한 이미지를 확인해 주세요.')
  expect(await readFile(staged.image!.path)).toEqual(png)
  expect((await stat(staged.image!.path)).mode & 0o777).toBe(0o600)
  expect(await readdir(path.dirname(staged.image!.path))).toEqual([path.basename(staged.image!.path)])
  await a.release(work); await a.release(work)
  await expect(stat(staged.image!.path)).rejects.toThrow()
}))
test('removal and app disposal cannot modify the user-selected originals', async () => harness(async (a, dir) => {
  const file = path.join(dir, 'image.webp')
  const data = Buffer.from('RIFFxxxxWEBPxxxx'); await writeFile(file, data)
  const item = await a.pickFile(file); const staged = await a.stage(work, 'image', [item.id], true)
  await a.dispose()
  expect(await readFile(file)).toEqual(data); await expect(stat(staged.image!.path)).rejects.toThrow()
}))

test('partial OCR preview preserves image and blocks staging until exact range confirmation',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'agent-os-partial-ocr-'));const a=new Attachments('fixture',async()=>({units:[{label:'이미지',method:'대체 로컬 OCR',text:'BC 457 AD 34'}],totalUnits:1,truncated:false,partial:true,warnings:['영어·숫자 부분 인식']}))
 try{const file=path.join(dir,'chart.png');await writeFile(file,png);const item=await a.pickFile(file);expect(item.partial).toBe(true);expect(item.dataUrl).toContain('data:image/png');expect(item.rangeConfirmed).toBe(false);expect(()=>a.compose('',[item.id])).toThrow('range_unconfirmed');a.setRange(item.id,0,item.fullText!.length,true);const result=await a.stage(work,'',[item.id],false);expect(result.instructions).toContain('BC 457 AD 34');expect(result.image).toBeUndefined();expect(await readFile(file)).toEqual(png)}finally{await a.dispose();await rm(dir,{recursive:true,force:true})}
})
