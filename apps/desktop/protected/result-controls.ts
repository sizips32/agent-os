import { constants } from 'node:fs'
import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
export type ResultCommand = { action: 'load' | 'hide' | 'restore'; workId: string; text: string; occurrence: number }
export function copyResultText(input: unknown, write: (text: string) => void) {
  if (typeof input !== 'string' || !input.length || input.length > 262144 || input.includes('\0'))
    throw Error('Invalid copy text')
  write(input)
}
export function resultCommand(input: unknown): ResultCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid result command')
  const v = input as Record<string, unknown>
  if (
    Object.keys(v).length !== 4 ||
    !['load', 'hide', 'restore'].includes(v.action as string) ||
    typeof v.workId !== 'string' ||
    !/^(work|selection)_[a-f0-9]{32}$/.test(v.workId) ||
    typeof v.text !== 'string' ||
    !v.text.length ||
    v.text.length > 262144 ||
    v.text.includes('\0') ||
    !Number.isInteger(v.occurrence) ||
    (v.occurrence as number) < 0 ||
    (v.occurrence as number) > 60
  )
    throw Error('Invalid result command')
  return v as ResultCommand
}
export class ResultControls {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private directory: string,
    private mayHide: (workId: string) => Promise<boolean>
  ) {}
  execute(input: unknown): Promise<{ hidden: boolean }> {
    let command: ResultCommand
    try {
      command = resultCommand(input)
    } catch (error) {
      return Promise.reject(error)
    }
    const run = this.queue.then(() => this.run(command))
    this.queue = run.catch(() => {})
    return run
  }
  private async read(): Promise<string[]> {
    try {
      const dir = await lstat(this.directory)
      if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error('unsafe')
      const file = await open(
        path.join(this.directory, 'hidden-results.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > 150000) throw Error('invalid')
        const bytes = Buffer.alloc(150001)
        let size = 0
        while (size < bytes.length) {
          const r = await file.read(bytes, size, bytes.length - size, null)
          if (!r.bytesRead) break
          size += r.bytesRead
        }
        if (size > 150000) throw Error('invalid')
        const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)))
        if (
          !Array.isArray(parsed) ||
          parsed.length > 2000 ||
          !parsed.every(x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)) ||
          new Set(parsed).size !== parsed.length
        )
          throw Error('invalid')
        return parsed
      } finally {
        await file.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw Error('결과 숨김 기록을 확인할 수 없습니다. 원본과 기존 파일은 변경하지 않았습니다.')
    }
  }
  private async write(keys: string[]) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const dir = await lstat(this.directory)
    if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error('unsafe')
    const temp = path.join(this.directory, `.pending-${randomUUID()}`)
    try {
      const file = await open(
        temp,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      )
      try {
        await file.writeFile(JSON.stringify(keys))
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temp, path.join(this.directory, 'hidden-results.json'))
    } finally {
      await unlink(temp).catch(() => {})
    }
  }
  private async run(c: ResultCommand) {
    const keys = await this.read()
    const id = createHash('sha256')
      .update(JSON.stringify([c.workId, c.text, c.occurrence]))
      .digest('hex')
    if (c.action === 'load') return { hidden: keys.includes(id) }
    if (c.action === 'hide') {
      if (!(await this.mayHide(c.workId)))
        throw Error('실행 중·UNKNOWN·미확인 결과는 숨길 수 없습니다. 상태 기록은 유지합니다.')
      if (!keys.includes(id)) {
        if (keys.length >= 2000) throw Error('숨김 한도입니다. 기존 숨김을 되돌린 뒤 진행해 주세요.')
        keys.push(id)
      }
    } else {
      const index = keys.indexOf(id)
      if (index >= 0) keys.splice(index, 1)
    }
    await this.write(keys)
    return { hidden: keys.includes(id) }
  }
}
