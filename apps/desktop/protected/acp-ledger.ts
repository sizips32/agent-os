import { randomUUID } from 'node:crypto'
import { constants, opendirSync, fstatSync, readSync } from 'node:fs'
import {
  mkdirSync,
  lstatSync,
  realpathSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readFileSync,
  readdirSync,
  statSync,
  renameSync
} from 'node:fs'
import { join } from 'node:path'
import type { AcpLedger, AcpOutcome } from './types'
import { executionDiagnostic } from './execution-diagnostic'

// Dedicated app-owned directory only. Stores hashes/status, never prompt or answer.
// Hermes CLI host uses this ledger. Reservation survives restart and is never
// retried automatically, including a crash before dispatch (conservative false block).
export class FileAcpLedger implements AcpLedger {
  private owned = new Map<string, string>()
  constructor(private root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (!lstatSync(root).isDirectory()) throw new Error('Ledger must be an app-owned real directory')
    this.root = realpathSync(root)
  }
  private path(key: string) {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new Error('Invalid ledger key')
    const file = join(this.root, `${key}.json`)
    try {
      if (lstatSync(file).isSymbolicLink()) throw Error('Linked receipt denied')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    return file
  }
  private syncDirectory() {
    const fd = openSync(this.root, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
  claim(key: string, fingerprint: string) {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid fingerprint')
    let fd: number
    try {
      fd = openSync(this.path(key), 'wx', 0o600)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw e
    }
    const owner = randomUUID()
    try {
      writeFileSync(fd, JSON.stringify({ version: 1, owner, fingerprint, status: 'unknown' }))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    this.syncDirectory()
    this.owned.set(key, owner)
    return true
  }
  lookup(key: string): boolean {
    try {
      const fd = openSync(this.path(key), 'r')
      closeSync(fd)
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw e
    }
  }
  sessionReference(key: string): string {
    if (!this.lookup(key)) return ''
    const stored = JSON.parse(readFileSync(this.path(key), 'utf8'))
    return typeof stored.sessionId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(stored.sessionId)
      ? stored.sessionId
      : ''
  }
  interruption(key: string): 'timeout' | 'interrupted' | undefined {
    if (!this.lookup(key)) return undefined
    const value = JSON.parse(readFileSync(this.path(key), 'utf8')).interruption
    return value === 'timeout' || value === 'interrupted' ? value : undefined
  }
  completed(key: string): boolean {
    return this.lookup(key) && JSON.parse(readFileSync(this.path(key), 'utf8')).status === 'completed'
  }
  vaultContext(key: string): boolean {
    return this.lookup(key) && JSON.parse(readFileSync(this.path(key), 'utf8')).executionMode === 'vault_context'
  }
  vaultWorkForSessions(sessions: string[]): string | undefined {
    if (!sessions.length || sessions.length > 100 || sessions.some(s => !/^[A-Za-z0-9_-]{1,100}$/.test(s)))
      throw Error('Invalid session provenance query')
    const wanted = new Set(sessions),
      dir = opendirSync(this.root)
    let count = 0
    try {
      let entry
      while ((entry = dir.readSync())) {
        if (!/^work_[a-f0-9]{32}\.json$/.test(entry.name)) continue
        if (++count > 5000) throw Error('Session provenance lookup limit; resume denied')
        const key = entry.name.slice(0, -5),
          fd = openSync(this.path(key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try {
          const stat = fstatSync(fd)
          if (!stat.isFile() || stat.size > 4096) throw Error('Invalid session provenance record')
          const b = Buffer.alloc(4097)
          let n = 0
          while (n < b.length) {
            const got = readSync(fd, b, n, b.length - n, null)
            if (!got) break
            n += got
          }
          if (n > 4096) throw Error('Session provenance record limit')
          const record = JSON.parse(b.subarray(0, n).toString('utf8'))
          if (record.executionMode === 'vault_context' && wanted.has(record.sessionId)) return key
        } finally {
          closeSync(fd)
        }
      }
    } finally {
      dir.closeSync()
    }
    return undefined
  }
  diagnostic(key: string) {
    if (!this.lookup(key)) return undefined
    const d = JSON.parse(readFileSync(this.path(key), 'utf8')).diagnostic
    if (!d) return undefined
    try {
      return executionDiagnostic(d.code, d.stage, d.at, d)
    } catch {
      return undefined
    }
  }
  hasUnsettledSession(ids: string[]): boolean {
    return readdirSync(this.root)
      .filter(n => /^work_[a-f0-9]{32}\.json$/.test(n))
      .some(n => {
        const value = JSON.parse(readFileSync(this.path(n.slice(0, -5)), 'utf8'))
        return ids.includes(value.sessionId) && value.status !== 'completed'
      })
  }
  recentKeys(): string[] {
    return readdirSync(this.root)
      .filter(name => /^work_[a-f0-9]{32}\.json$/.test(name))
      .filter(name => !lstatSync(join(this.root, name)).isSymbolicLink())
      .sort((a, b) => statSync(join(this.root, b)).mtimeMs - statSync(join(this.root, a)).mtimeMs)
      .slice(0, 50)
      .map(name => name.slice(0, -5))
  }
  settle(key: string, outcome: AcpOutcome) {
    const path = this.path(key)
    const stored = JSON.parse(readFileSync(path, 'utf8'))
    if (!this.owned.has(key) || stored.owner !== this.owned.get(key))
      throw new Error('Reservation belongs to another host')
    const temporary = join(this.root, `${randomUUID()}.pending`)
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(
        fd,
        JSON.stringify({
          ...stored,
          status: outcome.status,
          verification: outcome.verification,
          ...(outcome.executionMode === 'vault_context' ? { executionMode: 'vault_context' } : {}),
          ...(outcome.diagnostic
            ? {
                diagnostic: executionDiagnostic(
                  outcome.diagnostic.code,
                  outcome.diagnostic.stage,
                  outcome.diagnostic.at,
                  outcome.diagnostic
                )
              }
            : {}),
          ...(outcome.interruption === 'timeout' || outcome.interruption === 'interrupted'
            ? { interruption: outcome.interruption }
            : {}),
          ...(outcome.sessionId && /^[A-Za-z0-9_-]{1,100}$/.test(outcome.sessionId)
            ? { sessionId: outcome.sessionId }
            : {})
        })
      )
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, path)
    this.syncDirectory()
  }
}
