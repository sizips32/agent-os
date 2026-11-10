import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CATCH_UP_MS, QUIET_RECONCILE_MS, startStatusFeed } from './status-feed'
import type { HermesState } from './types'

const state = (status: HermesState['status'], workId = 'work_a', text = ''): HermesState => ({
  workId,
  status,
  sessionId: 's',
  text,
  events: [],
  reason: ''
})

function setup(read: () => Promise<HermesState> = async () => state('running')) {
  let listener: (s: HermesState) => void = () => {}
  const unsubscribe = vi.fn()
  const published: HermesState[] = []
  const feed = startStatusFeed({
    workId: 'work_a',
    read: vi.fn(read),
    publish: s => published.push(s),
    failed: vi.fn(),
    subscribe: l => {
      listener = l
      return unsubscribe
    }
  })
  return { feed, push: (s: HermesState) => listener(s), published, unsubscribe }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('pushed events for this work are published and others are ignored', () => {
  const { feed, push, published } = setup()
  push(state('running', 'work_a', 'one'))
  push(state('running', 'work_b', 'other'))
  expect(published.map(s => s.text)).toEqual(['one'])
  feed.stop()
})

test('one catch-up read runs early, then a read only after a quiet period', async () => {
  const { feed, published } = setup()
  await vi.advanceTimersByTimeAsync(CATCH_UP_MS)
  expect(published).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(QUIET_RECONCILE_MS - 1)
  expect(published).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(published).toHaveLength(2)
  feed.stop()
})

test('each event pushes the reconciling read back', async () => {
  const { feed, push, published } = setup()
  await vi.advanceTimersByTimeAsync(CATCH_UP_MS)
  await vi.advanceTimersByTimeAsync(QUIET_RECONCILE_MS - 100)
  push(state('running', 'work_a', 'event'))
  await vi.advanceTimersByTimeAsync(QUIET_RECONCILE_MS - 100)
  expect(published.map(s => s.text)).toEqual(['', 'event'])
  feed.stop()
})

test('a terminal event stops the feed: no more reads, listener removed', async () => {
  const { push, published, unsubscribe } = setup()
  push(state('completed', 'work_a', 'done'))
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(QUIET_RECONCILE_MS * 3)
  expect(published.map(s => s.status)).toEqual(['completed'])
})

test('stop() unsubscribes and cancels pending reads', async () => {
  const { feed, published, unsubscribe } = setup()
  feed.stop()
  await vi.advanceTimersByTimeAsync(QUIET_RECONCILE_MS * 3)
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  expect(published).toHaveLength(0)
})

test('a slow read is never overlapped by the next one', async () => {
  let reads = 0
  let release: () => void = () => {}
  const { feed } = setup(() => {
    reads++
    return new Promise<HermesState>(resolve => {
      release = () => resolve(state('running'))
    })
  })
  await vi.advanceTimersByTimeAsync(CATCH_UP_MS)
  expect(reads).toBe(1)
  await vi.advanceTimersByTimeAsync(QUIET_RECONCILE_MS * 2)
  expect(reads).toBe(1)
  release()
  await vi.advanceTimersByTimeAsync(0)
  feed.stop()
})
