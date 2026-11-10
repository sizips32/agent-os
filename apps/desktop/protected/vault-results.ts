import {
  constants,
  mkdirSync,
  lstatSync,
  realpathSync,
  readdirSync,
  openSync,
  readSync,
  fstatSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  linkSync,
  unlinkSync
} from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Conversation } from './types'
type Stored = { version: 1; workId: string; sessionId: string; question: string; answer: string; createdAt: string }
const work = (s: unknown): s is string => typeof s === 'string' && /^work_[a-f0-9]{32}$/.test(s)
const validText = (s: unknown, max: number): s is string =>
  typeof s === 'string' && s.length <= max && !s.includes('\0')
export class VaultResults {
  private identity: { ino: number; dev: number }
  constructor(private root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const s = lstatSync(root)
    if (!s.isDirectory() || s.isSymbolicLink()) throw Error('Unsafe result directory')
    this.root = realpathSync(root)
    this.identity = { ino: s.ino, dev: s.dev }
  }
  private file(id: string) {
    if (!work(id)) throw Error('Invalid result reference')
    const s = lstatSync(this.root)
    if (s.isSymbolicLink() || s.ino !== this.identity.ino || s.dev !== this.identity.dev)
      throw Error('Result directory changed')
    return path.join(this.root, id + '.json')
  }
  private validate(v: Stored): Stored {
    if (
      !v ||
      Object.keys(v).sort().join(',') !== 'answer,createdAt,question,sessionId,version,workId' ||
      v.version !== 1 ||
      !work(v.workId) ||
      !validText(v.sessionId, 100) ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(v.sessionId) ||
      !validText(v.question, 12000) ||
      !validText(v.answer, 20000) ||
      !Number.isFinite(Date.parse(v.createdAt))
    )
      throw Error('Invalid result record')
    if (
      /-----BEGIN .*PRIVATE KEY|\b(?:sk-proj-|ghp_|github_pat_)[\w-]{15,}|(?:api_key|password|access_token)\s*[:=]\s*["']?[^\s"']{12,}/i.test(
        v.question + '\n' + v.answer
      )
    )
      throw Error('Credential-bearing result denied')
    return v
  }
  read(id: string): Stored {
    const f = openSync(this.file(id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const s = fstatSync(f)
      if (!s.isFile() || s.size > 262144) throw Error('Result record limit')
      const b = Buffer.alloc(262145)
      let n = 0
      while (n < b.length) {
        const read = readSync(f, b, n, b.length - n, null)
        if (!read) break
        n += read
      }
      if (n > 262144) throw Error('Result record limit')
      const v = this.validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, n))))
      if (v.workId !== id) throw Error('Result identity mismatch')
      return v
    } finally {
      closeSync(f)
    }
  }
  save(workId: string, sessionId: string, question: string, answer: string) {
    const v = this.validate({ version: 1, workId, sessionId, question, answer, createdAt: new Date().toISOString() })
    const target = this.file(workId)
    try {
      const old = this.read(workId)
      if (old.sessionId === sessionId && old.question === question && old.answer === answer) return
      throw Error('Result identity conflict')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    if (readdirSync(this.root).filter(x => /^work_[a-f0-9]{32}\.json$/.test(x)).length >= 200)
      throw Error('Result record limit')
    const temp = path.join(this.root, randomUUID() + '.pending')
    let fd: number | undefined
    try {
      fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      writeFileSync(fd, JSON.stringify(v))
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      this.file(workId)
      linkSync(temp, target)
      const dir = openSync(this.root, 'r')
      try {
        fsyncSync(dir)
      } finally {
        closeSync(dir)
      }
    } finally {
      if (fd !== undefined) closeSync(fd)
      try {
        unlinkSync(temp)
      } catch {}
    }
  }
  conversation(id: string): Conversation {
    const v = this.read(id)
    return {
      workId: id,
      sessionId: v.sessionId,
      messages: [
        { role: 'user', text: v.question },
        { role: 'assistant', text: v.answer }
      ],
      limited: true,
      canResume: false,
      kind: 'vault_context'
    }
  }
}
