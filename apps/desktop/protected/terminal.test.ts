import { describe, expect, test, vi } from 'vitest'
import { LocalTerminal, terminalEnvironment, terminalSize, type ShellPty } from './terminal'
function fixture() {
  let data!: (s: string) => void, exit!: (v: { exitCode: number }) => void
  const child: ShellPty = {
    pid: 123,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onData: vi.fn(fn => {
      data = fn
      return { dispose: vi.fn() }
    }),
    onExit: vi.fn(fn => {
      exit = fn
      return { dispose: vi.fn() }
    })
  }
  const spawn = vi.fn(() => child),
    emit = vi.fn(),
    terminal = new LocalTerminal(spawn, emit, true)
  return { child, spawn, emit, terminal, data: (v: string) => data(v), exit: () => exit({ exitCode: 0 }) }
}
describe('app-owned local PTY', () => {
  test('duplicate open reuses a single shell', () => {
    const f = fixture(),
      first = f.terminal.open({ cols: 80, rows: 24 })
    expect(f.terminal.open({ cols: 100, rows: 30 })).toEqual(first)
    expect(f.spawn).toHaveBeenCalledOnce()
    expect(f.child.kill).not.toHaveBeenCalled()
  })
  test('input, Ctrl+C, resize, output and natural exit use only the owned id', () => {
    const f = fixture(),
      h = f.terminal.open({ cols: 80, rows: 24 })
    f.terminal.write(h.id, '\x03')
    f.terminal.resize(h.id, { cols: 120, rows: 40 })
    f.data('synthetic output')
    expect(f.child.write).toHaveBeenCalledWith('\x03')
    expect(f.child.resize).toHaveBeenCalledWith(120, 40)
    expect(f.emit).toHaveBeenCalledWith({ id: h.id, type: 'data', data: 'synthetic output' })
    expect(() => f.terminal.write('foreign-id', 'ls\r')).toThrow()
    f.exit()
    expect(f.terminal.running).toBe(false)
    expect(() => f.terminal.write(h.id, 'ls\r')).toThrow()
    f.terminal.open({ cols: 80, rows: 24 })
    expect(f.spawn).toHaveBeenCalledTimes(2)
  })
  test('rejects command/path injection, invalid sizes and oversized input before native calls', () => {
    const f = fixture()
    for (const value of [
      null,
      [],
      { cols: 80, rows: 24, program: 'evil' },
      { cols: NaN, rows: 24 },
      { cols: 999999, rows: 1 },
      { cols: 80, rows: 0 },
      { cols: '80', rows: 24 }
    ])
      expect(() => f.terminal.open(value)).toThrow()
    expect(f.spawn).not.toHaveBeenCalled()
    const h = f.terminal.open({ cols: 80, rows: 24 })
    expect(() => f.terminal.write(h.id, '한'.repeat(30000))).toThrow()
    expect(() => f.terminal.write(h.id, null)).toThrow()
    expect(f.child.write).not.toHaveBeenCalled()
    expect(terminalSize({ cols: 2, rows: 1 })).toEqual({ cols: 2, rows: 1 })
  })
  test('close is idempotent; no replacement is spawned until owned shell exits', () => {
    const f = fixture(),
      h = f.terminal.open({ cols: 80, rows: 24 })
    f.terminal.close()
    f.terminal.close()
    expect(f.child.kill).toHaveBeenCalledExactlyOnceWith('SIGHUP')
    expect(() => f.terminal.open({ cols: 80, rows: 24 })).toThrow('closing')
    expect(() => f.terminal.write(h.id, 'ls\r')).toThrow()
    f.exit()
    expect(f.terminal.running).toBe(false)
  })
  test('backpressure bounds queued output until renderer has consumed it', () => {
    const f = fixture(),
      h = f.terminal.open({ cols: 80, rows: 24 })
    f.data('x'.repeat(131072))
    expect(f.child.pause).toHaveBeenCalledOnce()
    expect(() => f.terminal.acknowledge(h.id, 999999)).toThrow()
    f.terminal.acknowledge(h.id, 100000)
    expect(f.child.resume).toHaveBeenCalledOnce()
    expect(() => f.terminal.acknowledge('foreign', 1)).toThrow()
  })
  test('environment does not inherit provider credentials, Electron flags or Giselle profile', () => {
    const env = terminalEnvironment('/Users/synthetic')
    expect(env.HOME).toBe('/Users/synthetic')
    expect(env.SHELL).toBe('/bin/zsh')
    for (const key of ['HERMES_HOME', 'OPENAI_API_KEY', 'XAI_API_KEY', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'])
      expect(env).not.toHaveProperty(key)
  })
})
