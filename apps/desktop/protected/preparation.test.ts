import { test, expect } from 'vitest'
import { PreparationGate } from './preparation'
test('duplicate preparation joins one snapshot while a conflicting request is rejected', async () => {
  const gate = new PreparationGate<string>()
  let release!: (id: string) => void,
    count = 0
  const prepare = async () => {
    count++
    return new Promise<string>(resolve => {
      release = resolve
    })
  }
  const first = gate.run('request', 'same attachments', prepare)
  const second = gate.run('request', 'same attachments', prepare)
  await expect(gate.run('request', 'different attachments', prepare)).rejects.toThrow('conflict')
  expect(count).toBe(1)
  release('owned_work')
  expect(await first).toBe('owned_work')
  expect(await second).toBe('owned_work')
})
test('failed preparation clears its gate without silently retrying', async () => {
  const gate = new PreparationGate<string>()
  let count = 0
  await expect(
    gate.run('request', 'same', async () => {
      count++
      throw Error('blocked')
    })
  ).rejects.toThrow('blocked')
  expect(count).toBe(1)
  expect(await gate.run('new request', 'new', async () => 'new_owned_work')).toBe('new_owned_work')
})
