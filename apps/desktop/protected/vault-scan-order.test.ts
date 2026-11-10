import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { Vault } from './vault'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const r of roots.splice(0)) {
    await rm(r, { recursive: true, force: true }).catch(() => {})
  }
})

async function vaultWith(populate: (semantic: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(tmpdir(), 'vault-scan-'))
  roots.push(temp)
  const semantic = path.join(temp, 'vault/1_SEMANTIC_LAYER')
  await mkdir(path.join(temp, 'vault/0_INBOX'), { recursive: true })
  await mkdir(semantic, { recursive: true })
  await populate(semantic)
  return { root: path.join(temp, 'vault'), storage: path.join(temp, 'store') }
}

// Same inputs, different read-ahead: everything the caller can observe must be identical.
async function run(setup: { root: string; storage: string }, readAhead: number, query = 'key') {
  // A generous time budget: these tests are about the count/byte caps, not the 2 s deadline, which a slow
  // machine (CI) would otherwise hit first.
  const vault = new Vault(setup.root, setup.storage, async () => {}, { readAhead, searchBudgetMs: 10 * 60 * 1000 })
  const r = await vault.search(query, '1_SEMANTIC_LAYER', '', '')
  return {
    hits: (r.hits ?? []).map(h => ({ path: h.path, title: h.title, context: h.context, tags: h.tags })),
    scan: r.scan,
    limited: r.limited
  }
}

async function writeMany(dir: string, count: number, body: (i: number) => string) {
  await mkdir(dir, { recursive: true })
  for (let start = 0; start < count; start += 200) {
    await Promise.all(
      Array.from({ length: Math.min(200, count - start) }, (_, k) => {
        const i = start + k
        return writeFile(path.join(dir, `n${String(i).padStart(5, '0')}.md`), body(i))
      })
    )
  }
}

test('mixed tree: results, counts and order do not depend on the read-ahead window', async () => {
  const setup = await vaultWith(async semantic => {
    await mkdir(path.join(semantic, 'A/deep/er'), { recursive: true })
    await mkdir(path.join(semantic, 'B'), { recursive: true })
    await writeMany(semantic, 25, i => `# 제목 ${i}\n본문 key ${i % 3 ? '있음' : ''}`)
    await writeMany(path.join(semantic, 'A'), 15, i => `---\ntags:\n  - key\n---\n# A${i}`)
    await writeMany(path.join(semantic, 'A/deep/er'), 10, i => `# key 제목 ${i}`)
    await writeFile(path.join(semantic, 'B/huge.md'), `key ${'x'.repeat(70 * 1024)}`)
    await writeFile(path.join(semantic, 'B/locked.md'), 'key locked')
    await chmod(path.join(semantic, 'B/locked.md'), 0o000)
    await writeFile(path.join(semantic, 'B/notes.txt'), 'key but not markdown')
    await writeFile(path.join(semantic, 'real.md'), 'key real')
    await symlink(path.join(semantic, 'real.md'), path.join(semantic, 'B/linked.md'))
  })
  const baseline = await run(setup, 1)
  expect(baseline.scan).toMatchObject({ oversized: 1 })
  expect(baseline.hits.length).toBeGreaterThan(0)
  for (const readAhead of [2, 8, 32]) expect(await run(setup, readAhead)).toEqual(baseline)
})

test('the 3,000-note cap truncates at the same note regardless of read-ahead', async () => {
  const setup = await vaultWith(semantic => writeMany(semantic, 3100, i => `# n${i}\nkey`))
  const baseline = await run(setup, 1)
  expect(baseline.scan).toMatchObject({ notes: 3000, truncated: true })
  expect(baseline.limited).toBe(true)
  expect(await run(setup, 8)).toEqual(baseline)
})

test('the 32 MiB byte cap truncates at the same note regardless of read-ahead', async () => {
  const body = (i: number) => `# n${i}\nkey ${'x'.repeat(60 * 1024)}`
  const setup = await vaultWith(semantic => writeMany(semantic, 620, body))
  const baseline = await run(setup, 1)
  expect(baseline.scan?.truncated).toBe(true)
  expect(baseline.scan?.notes).toBeLessThan(620)
  expect(await run(setup, 8)).toEqual(baseline)
})

test('reads overlap with a read-ahead window and never overlap without one', async () => {
  const setup = await vaultWith(semantic => writeMany(semantic, 60, i => `# n${i}\nkey`))
  const track = async (readAhead: number) => {
    let inFlight = 0
    let peak = 0
    const original = (Vault.prototype as unknown as { read: (rel: string) => Promise<string> }).read
    const spy = vi
      .spyOn(Vault.prototype as unknown as { read: (rel: string) => Promise<string> }, 'read')
      .mockImplementation(async function (this: unknown, rel: string) {
        peak = Math.max(peak, ++inFlight)
        try {
          return await original.call(this, rel)
        } finally {
          inFlight--
        }
      })
    await run(setup, readAhead)
    spy.mockRestore()
    return peak
  }
  expect(await track(1)).toBe(1)
  expect(await track(8)).toBeGreaterThan(1)
})
