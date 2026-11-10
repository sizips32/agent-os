import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { IPC, type IpcChannel } from './ipc-args'

const channels = Object.keys(IPC) as IpcChannel[]
const arity = (channel: IpcChannel) => {
  for (let n = 0; n <= 8; n++) {
    try {
      IPC[channel](Array(n).fill('x'))
      return n
    } catch {}
  }
}

test('every channel registered in main has an argument rule, and every rule has a channel', () => {
  const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
  const registered = [...source.matchAll(/handle\(\s*'(protected:[a-z-]+)'/g)].map(m => m[1]).sort()
  expect(registered).toEqual([...channels].sort())
})

test('zero-argument channels reject any argument', () => {
  for (const channel of channels.filter(c => arity(c) === 0)) {
    expect(IPC[channel]([])).toEqual([])
    expect(() => IPC[channel](['x'])).toThrow('Invalid IPC arguments')
  }
  expect(channels.filter(c => arity(c) === 0)).toContain('protected:quit')
})

test('fixed-arity channels reject too few and too many arguments', () => {
  for (const channel of channels.filter(c => (arity(c) ?? 0) > 0 && c !== 'protected:prepare')) {
    const n = arity(channel)!
    expect(() => IPC[channel](Array(n - 1).fill('x'))).toThrow('Invalid IPC arguments')
    expect(() => IPC[channel](Array(n + 1).fill('x'))).toThrow('Invalid IPC arguments')
  }
})

test('prepare needs string text and request id and allows omitted trailing arguments', () => {
  const prepare = IPC['protected:prepare']
  expect(prepare(['t', 'r'])).toEqual(['t', 'r', undefined, undefined, undefined, undefined])
  expect(() => prepare([])).toThrow()
  expect(() => prepare(['t'])).toThrow()
  expect(() => prepare([1, 'r'])).toThrow()
  expect(() => prepare(['t', null])).toThrow()
  expect(() => prepare(['t', 'r', 1, 2, 3, 4, 5])).toThrow()
})

test('arguments are passed through unchanged for consumers to validate', () => {
  const command = { action: 'x' }
  expect(IPC['protected:vault']([command])[0]).toBe(command)
  expect(IPC['protected:attachment-range'](['id', 1, 2, true])).toEqual(['id', 1, 2, true])
})
