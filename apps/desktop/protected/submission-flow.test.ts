import { test, expect } from 'vitest'
import { SubmissionFlow } from './submission-flow'
import type { HermesState } from './types'
const id = 'work_' + 'a'.repeat(32)
const state = (status: HermesState['status'], text = ''): HermesState => ({
  workId: id,
  status,
  text,
  sessionId: 'fixture',
  events: [],
  reason: ''
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
test('cancel before prepare completes prevents any start request', async () => {
  const prepare = deferred<string>(),
    calls: string[] = [],
    states: HermesState[] = []
  const flow = new SubmissionFlow(
    {
      prepare: () => prepare.promise,
      request: async op => {
        calls.push(op.action)
        return state('idle')
      }
    },
    s => states.push(s)
  )
  const pending = flow.begin('local', 'key')
  await flow.cancel()
  prepare.resolve(id)
  await pending
  expect(calls).toEqual([])
  expect(states.at(-1)?.status).toBe('unknown')
})
test('accepted work publishes pending before start settles; preflight cancel preserves pending then unknown', async () => {
  const start = deferred<HermesState>(),
    states: HermesState[] = []
  let cancelled = false
  const flow = new SubmissionFlow(
    {
      prepare: async () => id,
      request: async op => {
        if (op.action === 'cancel') {
          cancelled = true
          return state('idle')
        }
        return start.promise
      }
    },
    s => states.push(s)
  )
  const pending = flow.begin('local', 'key')
  await Promise.resolve()
  await Promise.resolve()
  expect(states.at(-1)?.status).toBe('running')
  await flow.cancel()
  expect(cancelled).toBe(true)
  expect(states.at(-1)?.status).toBe('running')
  start.reject(Error('cancelled before launch'))
  await pending
  expect(states.at(-1)?.status).toBe('unknown')
})
test('cancel after first partial reply forwards only cancel and preserves partial result', async () => {
  const calls: string[] = [],
    states: HermesState[] = []
  const flow = new SubmissionFlow(
    {
      prepare: async () => id,
      request: async op => {
        calls.push(op.action)
        return state(op.action === 'start' ? 'running' : 'unknown', 'partial')
      }
    },
    s => states.push(s)
  )
  await flow.begin('local', 'key')
  await flow.cancel()
  expect(calls).toEqual(['start', 'cancel'])
  expect(states.at(-1)).toMatchObject({ status: 'unknown', text: 'partial' })
})
test('completion that wins the cancel race remains completed', async () => {
  const states: HermesState[] = []
  const flow = new SubmissionFlow(
    {
      prepare: async () => id,
      request: async () => state('completed', 'final')
    },
    s => states.push(s)
  )
  await flow.begin('local', 'key')
  await flow.cancel()
  expect(states.at(-1)).toMatchObject({ status: 'completed', text: 'final' })
})
test('start rejection clears pending to unknown without a retry', async () => {
  const states: HermesState[] = [],
    calls: string[] = []
  const flow = new SubmissionFlow(
    {
      prepare: async () => id,
      request: async op => {
        calls.push(op.action)
        throw Error('preflight denied')
      }
    },
    s => states.push(s)
  )
  await expect(flow.begin('local', 'key')).rejects.toThrow('preflight denied')
  expect(states.at(-1)?.status).toBe('unknown')
  expect(calls).toEqual(['start'])
})
test('late start and cancellation replies cannot replace a later request', async () => {
  const old = deferred<HermesState>(),
    cancel = deferred<HermesState>(),
    seen: HermesState[] = []
  let count = 0
  const next = 'work_' + 'b'.repeat(32)
  const flow = new SubmissionFlow(
    {
      prepare: async () => (++count === 1 ? id : next),
      request: async op =>
        op.action === 'cancel'
          ? cancel.promise
          : op.workId === id
            ? old.promise
            : { ...state('completed', 'new'), workId: next }
    },
    s => seen.push(s)
  )
  const first = flow.begin('old', '1')
  await Promise.resolve()
  await Promise.resolve()
  const stop = flow.cancel()
  await flow.begin('new', '2')
  old.resolve(state('running', 'old'))
  cancel.resolve(state('unknown', 'old'))
  await first
  await stop
  expect(seen.at(-1)).toMatchObject({
    workId: next,
    text: 'new',
    status: 'completed'
  })
})
test('late running start cannot overwrite an already observed cancellation', async () => {
  const delayed = deferred<HermesState>(),
    seen: HermesState[] = []
  const flow = new SubmissionFlow(
    {
      prepare: async () => id,
      request: async op => (op.action === 'start' ? delayed.promise : state('unknown', 'partial'))
    },
    s => seen.push(s)
  )
  const begin = flow.begin('local', 'key')
  await Promise.resolve()
  await Promise.resolve()
  await flow.cancel()
  delayed.resolve(state('running'))
  await begin
  expect(seen.at(-1)).toMatchObject({ status: 'unknown', text: 'partial' })
})
test('reset after selecting another view invalidates a late cancellation reply', async () => {
  const delayed = deferred<HermesState>(),
    seen: HermesState[] = []
  const flow = new SubmissionFlow(
    { prepare: async () => id, request: async op => (op.action === 'cancel' ? delayed.promise : state('completed')) },
    s => seen.push(s)
  )
  await flow.begin('local', 'key')
  const cancel = flow.cancel()
  flow.reset()
  const count = seen.length
  delayed.resolve(state('unknown'))
  await cancel
  expect(seen).toHaveLength(count)
})
test('cancelled prepare releases its owned attachment snapshot without dispatch', async () => {
  const prepare = deferred<string>(),
    discarded: string[] = [],
    calls: string[] = []
  const flow = new SubmissionFlow(
    {
      prepare: () => prepare.promise,
      discardPrepared: async id => {
        discarded.push(id)
      },
      request: async op => {
        calls.push(op.action)
        return state('idle')
      }
    },
    () => {}
  )
  const pending = flow.begin('draft', 'key', undefined, ['attachment_' + 'a'.repeat(32)])
  await flow.cancel()
  prepare.resolve(id)
  await pending
  expect(discarded).toEqual([id])
  expect(calls).toEqual([])
})
test('a plain YouTube URL remains ordinary text and never invokes an attachment path', async () => {
  const prompt = 'https://youtu.be/fixture123?si=fixture 이 영상을 분석해 주세요',
    calls: unknown[][] = []
  const flow = new SubmissionFlow(
    {
      prepare: async (...args) => {
        calls.push(args)
        return id
      },
      request: async () => state('completed', 'fixture analysis')
    },
    () => {}
  )
  await flow.begin(prompt, 'request key', undefined, [])
  expect(calls).toEqual([[prompt, 'request key', undefined]])
})
