import { test, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, symlinkSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultResults } from './vault-results'
import { Sessions, conversationResult } from './sessions'
import { FileAcpLedger } from './acp-ledger'
import { executionDiagnostic } from './execution-diagnostic'
import { SESSION_NOT_FOUND, VAULT_RECORD_UNAVAILABLE } from './session-messages'
const roots: string[] = []
const id = 'work_' + '7'.repeat(32)
function fixture(status: 'completed' | 'unknown' = 'completed') {
  const dir = mkdtempSync(join(tmpdir(), 'vault-result-test-'))
  roots.push(dir)
  const ledger = new FileAcpLedger(join(dir, 'ledger'))
  ledger.claim(id, 'a'.repeat(64))
  ledger.settle(id, {
    status,
    text: '',
    reason: '',
    verification: '',
    sessionId: 'fixture_session',
    executionMode: 'vault_context'
  })
  return { dir, ledger, store: new VaultResults(join(dir, 'results')) }
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
test('completed isolated response survives restart without querying Hermes DB or persisting source evidence', async () => {
  const { dir, ledger, store } = fixture()
  store.save(id, 'fixture_session', '합성 질문', '합성 결과')
  const sessions = new Sessions(
    ledger,
    '',
    async () => {
      throw Error('Hermes DB must not be read')
    },
    undefined,
    undefined,
    new VaultResults(join(dir, 'results'))
  )
  expect(await sessions.open(id)).toMatchObject({
    canResume: false,
    kind: 'vault_context',
    messages: [
      { role: 'user', text: '합성 질문' },
      { role: 'assistant', text: '합성 결과' }
    ]
  })
  expect((await sessions.summaries([id]))[0]).toMatchObject({ title: '합성 질문', unavailable: false })
  const stored = JSON.parse(readFileSync(join(dir, 'results', id + '.json'), 'utf8'))
  expect(Object.keys(stored).sort()).toEqual(['answer', 'createdAt', 'question', 'sessionId', 'version', 'workId'])
  expect(statSync(join(dir, 'results', id + '.json')).mode & 0o777).toBe(0o600)
  expect(readFileSync(join(dir, 'ledger', id + '.json'), 'utf8')).not.toContain('합성')
})
test('unknown isolated submission has no fabricated response or DB fallback', async () => {
  const { ledger, store } = fixture('unknown')
  const sessions = new Sessions(
    ledger,
    '',
    async () => {
      throw Error('must not query DB')
    },
    undefined,
    undefined,
    store
  )
  await expect(sessions.open(id)).rejects.toThrow(VAULT_RECORD_UNAVAILABLE)
  expect((await sessions.summaries([id]))[0].unavailable).toBe(true)
})
test('persisted response with unsettled receipt is read-only and never resumes', async () => {
  const { ledger, store } = fixture('unknown')
  store.save(id, 'fixture_session', 'question', 'answer')
  expect((await new Sessions(ledger, '', undefined, undefined, undefined, store).open(id)).canResume).toBe(false)
})
test('result write is idempotent and never overwrites conflicting response', () => {
  const { dir, store } = fixture()
  store.save(id, 'fixture_session', 'q', 'a')
  const before = readFileSync(join(dir, 'results', id + '.json'), 'utf8')
  store.save(id, 'fixture_session', 'q', 'a')
  expect(() => store.save(id, 'fixture_session', 'q', 'different')).toThrow('conflict')
  expect(readFileSync(join(dir, 'results', id + '.json'), 'utf8')).toBe(before)
  expect(readdirSync(join(dir, 'results'))).toEqual([id + '.json'])
})
test('result references and linked paths cannot read or write outside owned store', () => {
  const { dir, store } = fixture()
  const outside = join(dir, 'outside.json')
  writeFileSync(outside, 'original')
  symlinkSync(outside, join(dir, 'results', id + '.json'))
  expect(() => store.read(id)).toThrow()
  expect(() => store.save(id, 'fixture_session', 'q', 'a')).toThrow()
  expect(() => store.read('../outside')).toThrow()
  expect(readFileSync(outside, 'utf8')).toBe('original')
})
test('wrong stored identity, oversized records and credential-looking text fail closed', () => {
  const { dir, store } = fixture()
  expect(() => store.save(id, 'fixture_session', 'api_key: ' + 'x'.repeat(24), 'a')).toThrow('Credential')
  store.save(id, 'fixture_session', 'q', 'a')
  const p = join(dir, 'results', id + '.json'),
    v = JSON.parse(readFileSync(p, 'utf8'))
  writeFileSync(p, JSON.stringify({ ...v, workId: 'work_' + '8'.repeat(32) }))
  expect(() => store.read(id)).toThrow('identity')
  writeFileSync(p, 'x'.repeat(262145))
  expect(() => store.read(id)).toThrow('limit')
})
test('missing SDK session produces accurate lookup explanation', () => {
  expect(() => conversationResult({ error: 'session_not_found' })).toThrow(SESSION_NOT_FOUND)
})
test('diagnostics contain only validated code, stage and canonical timestamp', () => {
  const { dir, ledger } = fixture()
  const d = executionDiagnostic('runtime_boundary', 'initialization')
  ledger.settle(id, {
    status: 'unknown',
    text: 'private fixture',
    reason: 'secret diagnostic',
    verification: '',
    diagnostic: d
  })
  expect(ledger.diagnostic(id)).toEqual(d)
  expect(readFileSync(join(dir, 'ledger', id + '.json'), 'utf8')).not.toMatch(/private fixture|secret diagnostic/)
  for (const [code, stage, at] of [
    ['secret-value', 'startup', d.at],
    ['runtime_boundary', 'credential-path', d.at],
    ['runtime_boundary', 'startup', '2026-10-13T01:02:03.000Z secret']
  ])
    expect(() => executionDiagnostic(code, stage, at)).toThrow()
})

test('explicit session selection cannot upgrade a completed isolated run to a general tool session even if SDK DB exists', async () => {
  const { dir, ledger, store } = fixture()
  store.save(id, 'fixture_session', 'q', 'a')
  let dbReads = 0
  const sessions = new Sessions(
    ledger,
    '',
    async () => {
      dbReads++
      return {
        sessionId: 'fixture_session',
        messages: [{ role: 'assistant', text: 'SDK DB fixture exists' }],
        limited: true
      }
    },
    join(dir, 'selections'),
    undefined,
    store
  )
  expect(await sessions.select('fixture_session')).toMatchObject({
    workId: id,
    kind: 'vault_context',
    canResume: false
  })
  expect(dbReads).toBe(0)
  expect(sessions.references()).toEqual([])
})

test('isolated provenance outside recent 50 remains read-only through explicit selection with an existing SDK DB', async () => {
  const { dir, ledger, store } = fixture()
  store.save(id, 'fixture_session', 'q', 'a')
  const { utimesSync } = await import('node:fs')
  utimesSync(join(dir, 'ledger', id + '.json'), 1700000000, 1700000000)
  for (let i = 0; i < 52; i++) {
    const key = 'work_' + i.toString(16).padStart(32, '0')
    ledger.claim(key, 'a'.repeat(64))
    ledger.settle(key, { status: 'completed', text: '', reason: '', verification: '', sessionId: 'ordinary_' + i })
  }
  expect(ledger.recentKeys()).toHaveLength(50)
  expect(ledger.recentKeys()).not.toContain(id)
  let dbReads = 0
  const sessions = new Sessions(
    ledger,
    '',
    async () => {
      dbReads++
      return { sessionId: 'fixture_session', messages: [], limited: true }
    },
    join(dir, 'selections'),
    undefined,
    store
  )
  expect(await sessions.select('fixture_session')).toMatchObject({
    workId: id,
    kind: 'vault_context',
    canResume: false
  })
  expect(dbReads).toBe(0)
  expect(sessions.references()).toEqual([])
})
