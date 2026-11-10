import { mkdtempSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { FileAcpLedger } from './acp-ledger'

const fingerprint = 'a'.repeat(64)
const key = (n: number) => `work_${n.toString(16).padStart(32, '0')}`
let dir: string
let ledger: FileAcpLedger

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-'))
  ledger = new FileAcpLedger(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('recentKeys is newest first, capped at 50, and skips symlinks and foreign files', () => {
  for (let i = 1; i <= 55; i++) {
    ledger.claim(key(i), fingerprint)
    const t = new Date(1_700_000_000_000 + i * 1000)
    utimesSync(join(dir, `${key(i)}.json`), t, t)
  }
  symlinkSync(join(dir, `${key(1)}.json`), join(dir, key(99) + '.json'))
  writeFileSync(join(dir, 'notes.txt'), 'x')
  const keys = ledger.recentKeys()
  expect(keys).toHaveLength(50)
  expect(keys[0]).toBe(key(55))
  expect(keys[49]).toBe(key(6))
  expect(keys).not.toContain(key(99))
})

test('cached receipt fields follow our own settle', () => {
  ledger.claim(key(1), fingerprint)
  expect(ledger.completed(key(1))).toBe(false)
  expect(ledger.sessionReference(key(1))).toBe('')
  ledger.settle(key(1), { status: 'completed', text: '', reason: '', verification: 'v', sessionId: 'sess_1' })
  expect(ledger.completed(key(1))).toBe(true)
  expect(ledger.sessionReference(key(1))).toBe('sess_1')
})

test('a receipt replaced by another process is re-read, not served from cache', () => {
  ledger.claim(key(1), fingerprint)
  expect(ledger.completed(key(1))).toBe(false)
  const replacement = join(dir, 'replacement.tmp')
  writeFileSync(
    replacement,
    JSON.stringify({ version: 1, owner: 'x', fingerprint, status: 'completed', sessionId: 'sess_9' })
  )
  renameSync(replacement, join(dir, `${key(1)}.json`))
  expect(ledger.completed(key(1))).toBe(true)
  expect(ledger.sessionReference(key(1))).toBe('sess_9')
})

test('missing receipts read as absent and a deleted receipt is not served from cache', () => {
  expect(ledger.completed(key(2))).toBe(false)
  expect(ledger.sessionReference(key(2))).toBe('')
  ledger.claim(key(3), fingerprint)
  expect(ledger.lookup(key(3))).toBe(true)
  ledger.completed(key(3))
  rmSync(join(dir, `${key(3)}.json`))
  expect(ledger.lookup(key(3))).toBe(false)
  expect(ledger.completed(key(3))).toBe(false)
})
