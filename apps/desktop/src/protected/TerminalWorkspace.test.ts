// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TerminalWorkspace, readTerminalLayout } from './TerminalWorkspace'
import type { TerminalEvent } from '../../protected/terminal-types'
const f = vi.hoisted(() => ({
  input: undefined as undefined | ((s: string) => void),
  output: [] as string[],
  opens: 0,
  disposed: 0
}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    parser = { registerOscHandler: vi.fn() }
    loadAddon() {}
    open() {
      f.opens++
    }
    onData(fn: (s: string) => void) {
      f.input = fn
      return { dispose() {} }
    }
    write(s: string, done?: () => void) {
      f.output.push(s)
      done?.()
    }
    dispose() {
      f.disposed++
    }
    focus() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  }
}))
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  }
})
let root: Root, host: HTMLDivElement, receive: (e: TerminalEvent) => void
const api = {
  open: vi.fn(async () => ({ id: 'synthetic', pid: 123, shell: '/bin/zsh' })),
  write: vi.fn(async () => {}),
  resize: vi.fn(async () => {}),
  acknowledge: vi.fn(async () => {}),
  onEvent: vi.fn((fn: (e: TerminalEvent) => void) => {
    receive = fn
    return vi.fn()
  })
}
async function mount() {
  await act(async () => {
    root.render(createElement(TerminalWorkspace, null, createElement('main', null, 'preserved chat')))
  })
}
async function click(text: string) {
  await act(async () => {
    ;[...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!.click()
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  f.output = []
  f.opens = 0
  f.disposed = 0
  window.protectedHerald = { terminal: api } as unknown as typeof window.protectedHerald
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
test('fold and reopen preserve the same PTY and xterm while keeping chat mounted', async () => {
  await mount()
  await click('접기')
  expect(host.querySelector('.agent-terminal-body')?.hasAttribute('hidden')).toBe(true)
  await click('펼치기')
  expect(api.open).toHaveBeenCalledOnce()
  expect(f.opens).toBe(1)
  expect(f.disposed).toBe(0)
  expect(host.querySelector('main')?.textContent).toBe('preserved chat')
})
test('real input, Ctrl+C and output acknowledgements are routed to the selected session', async () => {
  await mount()
  await act(async () => f.input!('pwd\r'))
  await click('중단')
  expect(api.write).toHaveBeenCalledWith('synthetic', 'pwd\r')
  expect(api.write).toHaveBeenCalledWith('synthetic', '\x03')
  await act(async () => receive({ id: 'synthetic', type: 'data', data: 'synthetic output' }))
  expect(f.output).toContain('synthetic output')
  expect(api.acknowledge).toHaveBeenCalledWith('synthetic', 16)
  await act(async () => receive({ id: 'foreign', type: 'data', data: 'wrong session' }))
  expect(f.output).not.toContain('wrong session')
})
test('keyboard resizing persists a bounded height and corrupt preferences are harmless', async () => {
  localStorage.setItem('agentos.terminal-layout.v1', 'invalid')
  expect(readTerminalLayout()).toEqual({ open: true, ratio: 0.36 })
  await mount()
  const divider = host.querySelector('[role=separator]')!
  await act(async () => divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
  expect(divider.getAttribute('aria-valuenow')).toBe('60')
  expect(JSON.parse(localStorage.getItem('agentos.terminal-layout.v1')!).ratio).toBe(0.6)
})
test('natural shell exit enables a fresh explicit session without auto-restarting', async () => {
  await mount()
  await act(async () => receive({ id: 'synthetic', type: 'exit', exitCode: 0 }))
  expect(api.open).toHaveBeenCalledOnce()
  expect(host.textContent).toContain('종료 · 코드 0')
  await click('다시 열기')
  expect(api.open).toHaveBeenCalledTimes(2)
})
