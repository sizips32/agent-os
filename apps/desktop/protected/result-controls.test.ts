import { test, expect, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ResultControls, copyResultText, resultCommand } from './result-controls'
const dirs: string[] = []
async function fixture(allowed = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'agent-result-'))
  dirs.push(root)
  const dir = path.join(root, 'view')
  const mayHide = vi.fn(async () => allowed)
  return { root, dir, mayHide, store: new ResultControls(dir, mayHide) }
}
const input = {
  action: 'load' as const,
  workId: 'work_' + 'a'.repeat(32),
  text: '한글\n```ts\nconst x = 1;\n```\n  끝  ',
  occurrence: 0
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
})
test('clipboard writes exact text only and rejects invalid input before writing', () => {
  const write = vi.fn()
  copyResultText(input.text, write)
  expect(write).toHaveBeenCalledExactlyOnceWith(input.text)
  for (const invalid of ['', null, {}, 'x'.repeat(262145), 'bad\0text'])
    expect(() => copyResultText(invalid, write)).toThrow()
  expect(write).toHaveBeenCalledTimes(1)
})
test('hide/restore persists, stores hashes only and preserves original fixture', async () => {
  const { root, dir, store } = await fixture()
  const original = path.join(root, 'original.txt')
  await writeFile(original, input.text)
  expect(await store.execute(input)).toEqual({ hidden: false })
  expect(await store.execute({ ...input, action: 'hide' })).toEqual({ hidden: true })
  const file = await readFile(path.join(dir, 'hidden-results.json'), 'utf8')
  expect(file).not.toContain(input.text)
  expect(JSON.parse(file)).toHaveLength(1)
  expect((await stat(dir)).mode & 0o777).toBe(0o700)
  expect((await stat(path.join(dir, 'hidden-results.json'))).mode & 0o777).toBe(0o600)
  const restarted = new ResultControls(dir, async () => true)
  expect(await restarted.execute(input)).toEqual({ hidden: true })
  expect(await restarted.execute({ ...input, action: 'restore' })).toEqual({ hidden: false })
  expect(await readFile(original, 'utf8')).toBe(input.text)
})
test('same text in another occurrence/work remains; concurrent changes serialize', async () => {
  const { store } = await fixture()
  const other = { ...input, occurrence: 1 }
  await Promise.all([store.execute({ ...input, action: 'hide' }), store.execute({ ...other, action: 'hide' })])
  await store.execute({ ...input, action: 'restore' })
  expect(await store.execute(other)).toEqual({ hidden: true })
  expect(await store.execute({ ...other, workId: 'work_' + 'b'.repeat(32) })).toEqual({ hidden: false })
})
test('running/UNKNOWN authority denies hide without writes and permits restoration', async () => {
  const { store, dir, mayHide } = await fixture(false)
  await expect(store.execute({ ...input, action: 'hide' })).rejects.toThrow('UNKNOWN')
  expect(mayHide).toHaveBeenCalledOnce()
  await expect(stat(dir)).rejects.toThrow()
  expect(await store.execute({ ...input, action: 'restore' })).toEqual({ hidden: false })
})
test.each([
  null,
  {},
  { ...input, action: 'erase' },
  { ...input, workId: '../../db' },
  { ...input, occurrence: -1 },
  { ...input, occurrence: 61 },
  { ...input, text: '' },
  { ...input, text: 'x'.repeat(262145) },
  { ...input, extra: true }
])('invalid command rejected: %j', invalid => {
  expect(() => resultCommand(invalid)).toThrow()
})
test('malformed and symlink files are rejected without changing source', async () => {
  const { dir, root, store } = await fixture()
  await mkdir(dir)
  const file = path.join(dir, 'hidden-results.json')
  await writeFile(file, 'private malformed fixture')
  await expect(store.execute({ ...input, action: 'hide' })).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toBe('private malformed fixture')
  await rm(file)
  const outside = path.join(root, 'outside')
  await writeFile(outside, '[]')
  await symlink(outside, file)
  await expect(store.execute({ ...input, action: 'hide' })).rejects.toThrow()
  expect(await readFile(outside, 'utf8')).toBe('[]')
})
