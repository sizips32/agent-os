import { randomUUID } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import type { TerminalEvent, TerminalHandle, TerminalSize } from './terminal-types'

type Disposable = { dispose(): void }
export interface ShellPty {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  pause(): void
  resume(): void
  onData(listener: (data: string) => void): Disposable
  onExit(listener: (event: { exitCode: number }) => void): Disposable
}
export type SpawnPty = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }) => ShellPty
export function terminalSize(input: unknown): TerminalSize {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== 'cols' && k !== 'rows')) throw Error('Invalid terminal size')
  const { cols, rows } = input as TerminalSize
  if (!Number.isInteger(cols) || cols < 2 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 300) throw Error('Invalid terminal size')
  return { cols, rows }
}
/** Do not pass Electron, provider credentials or the Giselle process profile into the user's shell. */
export function terminalEnvironment(home = homedir()): Record<string, string> {
  return {
    HOME: home, USER: path.basename(home), LOGNAME: path.basename(home), SHELL: '/bin/zsh',
    PATH: [path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    LANG: 'en_US.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'AgentOS', TMPDIR: tmpdir()
  }
}
/** One app-owned PTY; folding changes only the view. Nothing is written to a transcript. */
export class LocalTerminal {
  private current?: { handle: TerminalHandle; pty: ShellPty; listeners: Disposable[]; closing: boolean; pending: number; paused: boolean }
  constructor(private spawn: SpawnPty, private emit: (event: TerminalEvent) => void, private fixture = false) {}
  get running() { return !!this.current }
  open(input: unknown): TerminalHandle {
    const size = terminalSize(input)
    if (this.current) {
      if (this.current.closing) throw Error('Terminal is closing')
      this.current.pty.resize(size.cols, size.rows)
      return this.current.handle
    }
    const shell = '/bin/zsh'
    const pty = this.spawn(shell, this.fixture ? ['-f'] : ['-l'], { name: 'xterm-256color', ...size, cwd: homedir(), env: terminalEnvironment() })
    const handle = { id: randomUUID(), pid: pty.pid, shell }
    const session = { handle, pty, listeners: [] as Disposable[], closing: false, pending: 0, paused: false }
    this.current = session
    session.listeners.push(pty.onData(data => {
      if (this.current !== session || session.closing) return
      session.pending += Buffer.byteLength(data)
      if (session.pending >= 131072 && !session.paused) { session.paused = true; pty.pause() }
      this.emit({ id: handle.id, type: 'data', data })
    }))
    session.listeners.push(pty.onExit(({ exitCode }) => {
      if (this.current !== session) return
      this.current = undefined
      for (const listener of session.listeners) listener.dispose()
      this.emit({ id: handle.id, type: 'exit', exitCode })
    }))
    return handle
  }
  private owned(id: unknown) {
    if (typeof id !== 'string' || !this.current || this.current.closing || id !== this.current.handle.id) throw Error('Unknown terminal')
    return this.current.pty
  }
  write(id: unknown, data: unknown) {
    if (typeof data !== 'string' || !data.length || Buffer.byteLength(data) > 65536) throw Error('Invalid terminal input')
    this.owned(id).write(data)
  }
  resize(id: unknown, input: unknown) {
    const size = terminalSize(input)
    this.owned(id).resize(size.cols, size.rows)
  }
  acknowledge(id: unknown, bytes: unknown) {
    if (!this.current || this.current.closing) return
    this.owned(id)
    const session = this.current!
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1 || bytes > session.pending) throw Error('Invalid terminal acknowledgement')
    session.pending -= bytes
    if (session.paused && session.pending < 65536) { session.paused = false; session.pty.resume() }
  }
  close() {
    const session = this.current
    if (!session || session.closing) return
    session.closing = true
    try { session.pty.kill('SIGHUP') } catch {
      this.current = undefined
      for (const listener of session.listeners) listener.dispose()
    }
  }
}
