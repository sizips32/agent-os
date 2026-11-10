import { expect, test } from 'vitest'
import { StatusPoller } from './status-poller'
import type { HermesState } from './types'
const state = (workId: string, status: HermesState['status'] = 'running'): HermesState => ({
  workId,
  status,
  sessionId: '',
  text: '',
  events: [],
  reason: ''
})
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (v: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { resolve, reject, promise }
}
test.each(['work switch', 'cancel', 'new request', 'unmount/restart'])(
  '%s invalidates an outstanding reply',
  async () => {
    const d = deferred<HermesState>(),
      seen: HermesState[] = []
    const poll = new StatusPoller(
      'old',
      () => d.promise,
      s => seen.push(s),
      () => {
        throw Error('stale error')
      }
    )
    const task = poll.tick()
    poll.stop()
    d.resolve(state('old'))
    await task
    expect(seen).toEqual([])
  }
)
test('queries cannot overlap or overwrite a completed result out of order', async () => {
  const d = deferred<HermesState>()
  let calls = 0
  const seen: HermesState[] = []
  const poll = new StatusPoller(
    'a',
    () => {
      calls++
      return d.promise
    },
    s => seen.push(s),
    () => {}
  )
  const first = poll.tick()
  await poll.tick()
  expect(calls).toBe(1)
  d.resolve(state('a', 'completed'))
  await first
  expect(seen[0].status).toBe('completed')
})
test('stale failure and wrong work identity do not affect current view', async () => {
  const d = deferred<HermesState>()
  let failed = 0,
    published = 0
  const poll = new StatusPoller(
    'a',
    () => d.promise,
    () => published++,
    () => failed++
  )
  const task = poll.tick()
  poll.stop()
  d.reject(Error('late'))
  await task
  await new StatusPoller(
    'a',
    async () => state('b'),
    () => published++,
    () => failed++
  ).tick()
  expect([failed, published]).toEqual([0, 0])
})
