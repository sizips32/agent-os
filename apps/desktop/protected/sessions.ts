import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdirSync, lstatSync, realpathSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { Conversation, ConversationSummary } from './types'
import type { FileAcpLedger } from './acp-ledger'
import type { VaultResults } from './vault-results'
import { SESSION_NOT_FOUND, VAULT_RECORD_UNAVAILABLE } from './session-messages'
export function validSession(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id) && !['latest', 'default'].includes(id)
}
export function conversationResult(value: unknown): Pick<Conversation, 'sessionId' | 'messages' | 'limited'> & {
  lineage: string[]
} {
  const v = value as Conversation
  if ((value as { error?: string })?.error === 'session_not_found') throw Error(SESSION_NOT_FOUND)
  if (!v || !validSession(v.sessionId) || !Array.isArray(v.messages) || v.messages.length > 60 || v.limited !== true)
    throw Error('Session unavailable')
  const lineage = (v as Conversation & { lineage?: unknown }).lineage ?? [v.sessionId]
  if (
    !Array.isArray(lineage) ||
    !lineage.length ||
    lineage.length > 100 ||
    !lineage.every(validSession) ||
    !lineage.includes(v.sessionId)
  )
    throw Error('Invalid lineage')
  let total = 0
  for (const m of v.messages) {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.text !== 'string' || m.text.length > 12000)
      throw Error('Invalid conversation')
    total += m.text.length
  }
  if (total > 60000) throw Error('Conversation too large')
  return {
    sessionId: v.sessionId,
    messages: v.messages.map(m => ({ role: m.role, text: m.text })),
    limited: true,
    lineage
  }
}
export class Sessions {
  constructor(
    private ledger: FileAcpLedger,
    private helper: string,
    private read?: (session: string) => Promise<unknown>,
    private selections?: string,
    private readTitle?: (session: string) => Promise<unknown>,
    private vaultResults?: VaultResults
  ) {
    if (selections) {
      mkdirSync(selections, { recursive: true, mode: 0o700 })
      if (lstatSync(selections).isSymbolicLink() || !lstatSync(selections).isDirectory())
        throw Error('Invalid selection directory')
      this.selections = realpathSync(selections)
    }
  }
  private file(id: string) {
    if (!this.selections || !/^selection_[a-f0-9]{32}$/.test(id)) throw Error('Invalid selection')
    const p = path.join(this.selections, id + '.json')
    try {
      if (lstatSync(p).isSymbolicLink()) throw Error('Linked selection denied')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    return p
  }
  references(): { workId: string; sessionId: string }[] {
    if (!this.selections) return []
    return readdirSync(this.selections)
      .filter(n => /^selection_[a-f0-9]{32}\.json$/.test(n))
      .slice(0, 50)
      .flatMap(n => {
        try {
          const v = JSON.parse(readFileSync(this.file(n.slice(0, -5)), 'utf8'))
          return v.profile === 'giselle' && validSession(v.sessionId)
            ? [{ workId: n.slice(0, -5), sessionId: v.sessionId }]
            : []
        } catch {
          return []
        }
      })
  }
  private async readHelper(session: string, summary = false): Promise<unknown> {
    const reader = summary ? this.readTitle : this.read
    return reader
      ? await reader(session)
      : JSON.parse(
          (
            await promisify(execFile)(
              '/usr/bin/sandbox-exec',
              [
                '-p',
                '(version 1) (allow default) (deny file-write*) (deny network*)',
                path.join(homedir(), '.hermes/hermes-agent/venv/bin/python'),
                '-I',
                '-B',
                this.helper,
                session,
                ...(summary ? ['--summary'] : [])
              ],
              {
                shell: false,
                timeout: 8000,
                maxBuffer: 512000,
                env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }
              }
            )
          ).stdout
        )
  }
  private async readSession(session: string) {
    return conversationResult(await this.readHelper(session))
  }
  async summaries(workIds: unknown): Promise<ConversationSummary[]> {
    if (
      !Array.isArray(workIds) ||
      workIds.length > 10 ||
      !workIds.every(id => typeof id === 'string' && /^(work|selection)_[a-f0-9]{32}$/.test(id))
    )
      throw Error('Invalid summary selection')
    const selected = this.references()
    const refs = [...new Set<string>(workIds)].map(workId => {
      const reference = selected.find(r => r.workId === workId)
      if (!reference && (!workId.startsWith('work_') || !this.ledger.lookup(workId)))
        throw Error('App-owned or explicitly selected session required')
      const sessionId = reference?.sessionId || this.ledger.sessionReference(workId)
      if (!validSession(sessionId)) throw Error('No confirmed session reference')
      return { workId, sessionId }
    })
    const result: ConversationSummary[] = []
    const cache = new Map<string, Omit<ConversationSummary, 'workId'>>()
    for (const { workId, sessionId } of refs) {
      if (this.ledger.vaultContext(workId)) {
        try {
          const v = this.vaultResults!.read(workId)
          result.push({
            workId,
            title: v.question.slice(0, 80) || '근거 실행 기록',
            startedAt: Date.parse(v.createdAt) / 1000,
            unavailable: false
          })
        } catch {
          result.push({ workId, title: '근거 실행 · 결과 기록 미확정', startedAt: null, unavailable: true })
        }
        continue
      }
      if (!cache.has(sessionId)) {
        try {
          const v = (await this.readHelper(sessionId, true)) as { title: unknown; startedAt: unknown }
          if (
            !v ||
            !(
              v.title === null ||
              (typeof v.title === 'string' &&
                v.title.length <= 200 &&
                !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(v.title))
            ) ||
            !(
              v.startedAt === null ||
              (typeof v.startedAt === 'number' &&
                Number.isFinite(v.startedAt) &&
                v.startedAt > 0 &&
                v.startedAt < 4102444800)
            )
          )
            throw Error('Invalid summary')
          cache.set(sessionId, {
            title: v.title as string | null,
            startedAt: v.startedAt as number | null,
            unavailable: false
          })
        } catch {
          cache.set(sessionId, { title: null, startedAt: null, unavailable: true })
        }
      }
      result.push({ workId, ...cache.get(sessionId)! })
    }
    return result
  }
  async select(session: unknown): Promise<Conversation> {
    if (!validSession(session) || !this.selections) throw Error('Exact Giselle session required')
    const isolated = this.ledger.vaultWorkForSessions([session])
    if (isolated) return this.open(isolated)
    const workId =
      'selection_' +
      createHash('sha256')
        .update('giselle:' + session)
        .digest('hex')
        .slice(0, 32)
    const result = await this.readSession(session)
    const isolatedLineage = this.ledger.vaultWorkForSessions(result.lineage)
    if (isolatedLineage) return this.open(isolatedLineage)
    if (!this.references().some(r => r.workId === workId)) {
      if (this.references().length >= 50) throw Error('Selected session limit reached')
      writeFileSync(this.file(workId), JSON.stringify({ profile: 'giselle', sessionId: session }), {
        flag: 'wx',
        mode: 0o600
      })
    }
    return {
      sessionId: result.sessionId,
      messages: result.messages,
      limited: result.limited,
      workId,
      canResume: !this.ledger.hasUnsettledSession(result.lineage)
    }
  }
  async open(workId: unknown): Promise<Conversation> {
    if (typeof workId !== 'string') throw Error('App-owned or explicitly selected session required')
    const selected = this.references().find(r => r.workId === workId)
    if (!selected && (!/^work_[a-f0-9]{32}$/.test(workId) || !this.ledger.lookup(workId)))
      throw Error('App-owned or explicitly selected session required')
    const session = selected?.sessionId || this.ledger.sessionReference(workId)
    if (!validSession(session)) throw Error('No confirmed session reference')
    if (!selected && this.ledger.vaultContext(workId)) {
      try {
        if (!this.vaultResults) throw Error()
        const result = this.vaultResults.conversation(workId)
        if (result.sessionId !== session) throw Error()
        return result
      } catch {
        throw Error(VAULT_RECORD_UNAVAILABLE)
      }
    }
    // A newer unknown/running submission to this conversation blocks continuation after restart.
    const result = await this.readSession(session)
    const unsettled = this.ledger.hasUnsettledSession(result.lineage)
    return {
      sessionId: result.sessionId,
      messages: result.messages,
      limited: result.limited,
      workId,
      canResume: !unsettled && (!!selected || this.ledger.completed(workId))
    }
  }
}
