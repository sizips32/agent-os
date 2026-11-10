// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useShortcuts } from './useShortcuts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let host: HTMLDivElement
const clicks: Record<string, number> = {}

function App({ disabled = false }: { disabled?: boolean }) {
  useShortcuts()
  const button = (id: string, off = false) =>
    createElement('button', {
      key: id,
      'data-shortcut': id,
      disabled: off,
      onClick: () => (clicks[id] = (clicks[id] ?? 0) + 1)
    })
  return createElement(
    'div',
    null,
    ...['send', 'new', 'stop', 'vault', 'terminal'].map(id => button(id, disabled)),
    createElement('input', { 'data-shortcut': 'vault-search' }),
    createElement('footer', { className: 'agent-composer' }, createElement('textarea', { id: 'composer' })),
    createElement('div', { className: 'xterm' }, createElement('textarea', { id: 'term' }))
  )
}
const press = (init: KeyboardEventInit, on: Element = document.body) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  on.dispatchEvent(event)
  return event
}

beforeEach(async () => {
  for (const k of Object.keys(clicks)) delete clicks[k]
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(App)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('each shortcut presses its control', () => {
  press({ key: 'Enter', metaKey: true }, host.querySelector('#composer')!)
  press({ key: 'n', metaKey: true })
  press({ key: '.', metaKey: true })
  press({ key: '`', ctrlKey: true })
  expect(clicks).toEqual({ send: 1, new: 1, stop: 1, terminal: 1 })
})

test('Cmd+K opens the vault and focuses its search', async () => {
  vi.useFakeTimers()
  press({ key: 'k', metaKey: true })
  await vi.runAllTimersAsync()
  vi.useRealTimers()
  expect(clicks.vault).toBe(1)
  expect(document.activeElement).toBe(host.querySelector('[data-shortcut="vault-search"]'))
})

test('a disabled control is not triggered', async () => {
  await act(async () => root.render(createElement(App, { disabled: true })))
  press({ key: 'Enter', metaKey: true })
  press({ key: 'n', metaKey: true })
  expect(clicks).toEqual({})
})

test('plain keys, extra modifiers and IME composition are ignored', () => {
  press({ key: 'Enter' })
  press({ key: 'n', metaKey: true, shiftKey: true })
  press({ key: 'Enter', metaKey: true, altKey: true })
  press({ key: 'Enter', metaKey: true, isComposing: true })
  expect(clicks).toEqual({})
})

test('terminal input wins, except the terminal collapse shortcut', () => {
  const terminal = host.querySelector('#term')!
  const send = press({ key: 'Enter', metaKey: true }, terminal)
  press({ key: '.', metaKey: true }, terminal)
  press({ key: '`', ctrlKey: true }, terminal)
  expect(send.defaultPrevented).toBe(false)
  expect(clicks).toEqual({ terminal: 1 })
})

test('listener is removed on unmount', async () => {
  await act(async () => root.unmount())
  root = createRoot(host)
  press({ key: 'Enter', metaKey: true })
  expect(clicks).toEqual({})
})

test('send fires only from inside the composer, never from another field or the page', () => {
  press({ key: 'Enter', metaKey: true })
  press({ key: 'Enter', metaKey: true }, host.querySelector('[data-shortcut="vault-search"]')!)
  expect(clicks).toEqual({})
  press({ key: 'Enter', metaKey: true }, host.querySelector('#composer')!)
  expect(clicks).toEqual({ send: 1 })
})
