// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DiscoveryFollowup } from './DiscoveryFollowup'
import type { Followup } from '../../protected/discovery-ai'
import type { DiscoveryCommand, DiscoveryStoreView } from '../../protected/discovery-state'
import type { ProtectedBridge, HermesState } from '../../protected/types'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const id = '11111111-1111-4111-8111-111111111111',
  workId = 'work_' + 'a'.repeat(32),
  input = { situation: 'synthetic only', problem: 'blockage', outcome: '', action: '', basis: '', interpretation: '' }
const response = JSON.stringify({ interpretation: 'tentative synthetic', questions: ['first?', 'second?'] })
const terminal = (status = 'completed', text = response): HermesState => ({
  workId,
  status: status as HermesState['status'],
  text,
  sessionId: 'fixture',
  events: [],
  reason: 'synthetic'
})
let root: Root,
  host: HTMLDivElement,
  view: DiscoveryStoreView,
  bridge: ProtectedBridge,
  mutate: ReturnType<typeof vi.fn<(c: DiscoveryCommand) => Promise<DiscoveryStoreView | null>>>,
  changed: Followup | undefined,
  onAnswers: ReturnType<typeof vi.fn<() => void>>,
  busy: ReturnType<typeof vi.fn<(busy: boolean) => void>>
function Wrapper() {
  const [value, setValue] = useState<Followup>(),
    [stored, setStored] = useState(view)
  return createElement(DiscoveryFollowup, {
    id,
    domain: 'work',
    topic: 'daily',
    context: input,
    value,
    stored,
    blocked: '',
    onChange: v => {
      changed = v
      setValue(v)
    },
    mutate: async command => {
      const next = await mutate(command)
      if (next) setStored(next)
      return next
    },
    onBusy: (v: boolean) => busy(v),
    onReserve: () => true,
    onAnswers: () => onAnswers()
  })
}
const button = (label: string) => {
  const b = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label)
  if (!b) throw Error('Missing ' + label)
  return b
}
const click = async (label: string) => act(async () => button(label).click())
const preview = () => click('AI 질문 제안 준비 · 전송 범위 보기')
const consent = () =>
  act(async () => host.querySelector<HTMLInputElement>('[aria-label="AI 외부 전송 범위 확인"]')!.click())
const send = () => click('지젤에게 AI 질문 제안 요청')
beforeEach(async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  view = { revision: 0, records: {}, trash: {}, applied: [] }
  changed = undefined
  busy = vi.fn()
  onAnswers = vi.fn()
  mutate = vi.fn(async (c: DiscoveryCommand) => {
    if (c.action === 'ai-reserve') view.requests = { [id]: { requestId: c.requestId } }
    if (c.action === 'ai-bind') view.requests![id].workId = c.workId
    view.revision++
    return structuredClone(view)
  })
  bridge = {
    prepare: vi.fn(async () => workId),
    request: vi.fn(async () => terminal()),
    discardPrepared: vi.fn(async () => {}),
    conversation: vi.fn(async () => ({
      workId,
      sessionId: 'fixture',
      canResume: true,
      messages: [{ role: 'assistant', text: response }]
    }))
  } as unknown as ProtectedBridge
  window.protectedHerald = bridge
  await act(async () => root.render(createElement(Wrapper)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})
test('opening and range preview never sends; explicit consent submits once with fresh text-only purpose', async () => {
  expect(bridge.prepare).not.toHaveBeenCalled()
  await preview()
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="AI 전송 범위"]')!.value).toContain('synthetic only')
  expect(button('지젤에게 AI 질문 제안 요청').disabled).toBe(true)
  await consent()
  await act(async () => {
    button('지젤에게 AI 질문 제안 요청').click()
    button('지젤에게 AI 질문 제안 요청').click()
  })
  expect(bridge.prepare).toHaveBeenCalledTimes(1)
  expect(vi.mocked(bridge.prepare).mock.calls[0].slice(2)).toEqual([undefined, [], 'discovery_questions'])
  expect(bridge.request).toHaveBeenCalledExactlyOnceWith({ action: 'start', workId })
  expect(mutate.mock.calls.map(c => c[0].action)).toEqual(['ai-reserve', 'ai-bind'])
  expect(changed?.phase).toBe('questions')
  expect(changed?.cursor).toBe(0)
  await click('아니에요 · 해석 제외')
  expect(changed?.decision).toBe('no')
  await click('AI 질문 건너뛰기')
  expect(changed?.questions[0].skipped).toBe(true)
  expect(changed?.cursor).toBe(1)
  await click('후속 질문 그만하기 · 답변 유지')
  await click('같은 AI 질문 이어하기')
  await click('추가 답변 확인')
  await click('추가 답변을 초안 검토에 포함')
  expect(onAnswers).toHaveBeenCalledOnce()
  expect(bridge.request).toHaveBeenCalledTimes(1)
})
test('cancel during durable reservation never prepares or starts', async () => {
  let resolve!: (v: DiscoveryStoreView) => void
  mutate.mockImplementationOnce(() => new Promise(r => (resolve = r)))
  await preview()
  await consent()
  await act(async () => {
    button('지젤에게 AI 질문 제안 요청').click()
  })
  await click('AI 질문 요청 중단')
  await act(async () => resolve({ ...view, revision: 1, requests: { [id]: { requestId: crypto.randomUUID() } } }))
  expect(bridge.prepare).not.toHaveBeenCalled()
  expect(changed?.phase).toBe('cancelled')
  expect(busy).toHaveBeenLastCalledWith(false)
})
test('cancel during preparation discards bound work and never starts', async () => {
  let resolve!: (id: string) => void
  bridge.prepare = vi.fn(() => new Promise<string>(r => (resolve = r)))
  await preview()
  await consent()
  await act(async () => button('지젤에게 AI 질문 제안 요청').click())
  await click('AI 질문 요청 중단')
  await act(async () => resolve(workId))
  expect(bridge.request).not.toHaveBeenCalled()
  expect(bridge.discardPrepared).toHaveBeenCalledWith(workId)
  expect(changed?.phase).toBe('unknown')
})
test('binding failure discards prepared work without dispatch', async () => {
  mutate
    .mockImplementationOnce(async () => ({
      ...view,
      revision: 1,
      requests: { [id]: { requestId: crypto.randomUUID() } }
    }))
    .mockResolvedValueOnce(null)
  await preview()
  await consent()
  await send()
  expect(bridge.request).not.toHaveBeenCalled()
  expect(bridge.discardPrepared).toHaveBeenCalledWith(workId)
})
test.each(['invalid JSON', 'x'.repeat(3001)])('invalid response is rejected without automatic resend', async text => {
  bridge.request = vi.fn(async () => terminal('completed', text))
  await preview()
  await consent()
  await send()
  expect(changed?.phase).toBe('failed')
  expect(bridge.prepare).toHaveBeenCalledOnce()
  expect(host.textContent).toContain('실패')
})
test('observed tool activity rejects proposed questions', async () => {
  bridge.request = vi.fn(async () => ({ ...terminal(), events: ['tool_started:fixture'] }))
  await preview()
  await consent()
  await send()
  expect(changed?.phase).toBe('failed')
  expect(host.textContent).toContain('도구 실행')
})
test('UNKNOWN only queries the same work and recovers result without new send', async () => {
  bridge.request = vi.fn(async () => terminal('unknown', ''))
  await preview()
  await consent()
  await send()
  expect(changed?.phase).toBe('unknown')
  await click('기존 AI 요청 상태·결과 확인')
  expect(bridge.request).toHaveBeenLastCalledWith({ action: 'status', workId })
  expect(bridge.conversation).toHaveBeenCalledWith(workId)
  expect(changed?.phase).toBe('questions')
  expect(bridge.prepare).toHaveBeenCalledOnce()
})
test('reopened reservation with no snapshot can inspect and cancel running request without submission', async () => {
  await act(async () => root.unmount())
  view.requests = { [id]: { requestId: crypto.randomUUID(), workId } }
  root = createRoot(host)
  bridge.request = vi.fn(async op => terminal(op.action === 'cancel' ? 'unknown' : 'running', ''))
  await act(async () => root.render(createElement(Wrapper)))
  expect(bridge.request).not.toHaveBeenCalled()
  await click('기존 AI 요청 상태·결과 확인')
  expect(changed?.phase).toBe('running')
  await click('AI 질문 요청 중단')
  expect(bridge.request).toHaveBeenLastCalledWith({ action: 'cancel', workId })
  expect(bridge.prepare).not.toHaveBeenCalled()
  expect(changed?.phase).toBe('unknown')
})
test('realistic start-running status-completed updates questions automatically with one start only', async () => {
  vi.useFakeTimers()
  try {
    bridge.request = vi.fn(async op => (op.action === 'start' ? terminal('running', '') : terminal()))
    await preview()
    await consent()
    await send()
    expect(changed?.phase).toBe('running')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(changed?.phase).toBe('questions')
    expect(host.querySelector('[aria-label="AI 후속 질문 답변"]')).not.toBeNull()
    expect(busy).toHaveBeenLastCalledWith(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(bridge.request).toHaveBeenCalledTimes(2)
    expect(vi.mocked(bridge.request).mock.calls.map(c => c[0])).toEqual([
      { action: 'start', workId },
      { action: 'status', workId }
    ])
    expect(bridge.prepare).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
test.each(['unknown', 'failed'])(
  'terminal %s stops automatic status reads without retrying model submission',
  async status => {
    vi.useFakeTimers()
    try {
      bridge.request = vi.fn(async op => (op.action === 'start' ? terminal('running', '') : terminal(status, '')))
      await preview()
      await consent()
      await send()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(changed?.phase).toBe(status)
      expect(busy).toHaveBeenLastCalledWith(false)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(bridge.request).toHaveBeenCalledTimes(2)
      expect(bridge.prepare).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  }
)
test('status failure stops polling and unlocks as UNKNOWN without retransmission', async () => {
  vi.useFakeTimers()
  try {
    bridge.request = vi.fn(async op => {
      if (op.action === 'start') return terminal('running', '')
      throw Error('status transport error')
    })
    await preview()
    await consent()
    await send()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(changed?.phase).toBe('unknown')
    expect(busy).toHaveBeenLastCalledWith(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(bridge.request).toHaveBeenCalledTimes(2)
    expect(bridge.prepare).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
test('polling serializes slow reads and unmount discards a late completed response', async () => {
  vi.useFakeTimers()
  try {
    let resolve!: (s: HermesState) => void
    bridge.request = vi.fn(async op =>
      op.action === 'start' ? terminal('running', '') : new Promise<HermesState>(r => (resolve = r))
    )
    await preview()
    await consent()
    await send()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })
    expect(bridge.request).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
    const before = changed
    await act(async () => resolve(terminal()))
    expect(changed).toEqual(before)
    root = createRoot(host)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(bridge.request).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
test('cancel invalidates pending completed status; UNKNOWN cannot be overwritten or resubmitted', async () => {
  vi.useFakeTimers()
  try {
    let resolve!: (s: HermesState) => void
    bridge.request = vi.fn(async op =>
      op.action === 'start'
        ? terminal('running', '')
        : op.action === 'cancel'
          ? terminal('unknown', '')
          : new Promise<HermesState>(r => (resolve = r))
    )
    await preview()
    await consent()
    await send()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await click('AI 질문 요청 중단')
    expect(changed?.phase).toBe('unknown')
    await act(async () => resolve(terminal()))
    expect(changed?.phase).toBe('unknown')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(bridge.request).toHaveBeenCalledTimes(3)
    expect(bridge.prepare).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
test('wrong-work status fails closed instead of showing another work or polling indefinitely', async () => {
  vi.useFakeTimers()
  try {
    bridge.request = vi.fn(async op =>
      op.action === 'start' ? terminal('running', '') : { ...terminal(), workId: 'work_' + 'b'.repeat(32) }
    )
    await preview()
    await consent()
    await send()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(changed?.phase).toBe('unknown')
    expect(host.querySelector('[aria-label="AI 후속 질문 답변"]')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(bridge.request).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
test('cancel returning running resumes serialized status reads until the owned work settles', async () => {
  vi.useFakeTimers()
  try {
    bridge.request = vi.fn(async op => (op.action === 'status' ? terminal('unknown', '') : terminal('running', '')))
    await preview()
    await consent()
    await send()
    await click('AI 질문 요청 중단')
    expect(changed?.phase).toBe('running')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(changed?.phase).toBe('unknown')
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(bridge.request).toHaveBeenCalledTimes(3)
    expect(bridge.prepare).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
test.each(['malformed', 'tools'])(
  'automatic terminal %s response is rejected without falling back to conversation or resending',
  async kind => {
    vi.useFakeTimers()
    try {
      bridge.request = vi.fn(async op =>
        op.action === 'start'
          ? terminal('running', '')
          : kind === 'tools'
            ? { ...terminal(), events: ['tool_started:fixture'] }
            : terminal('completed', 'invalid JSON')
      )
      await preview()
      await consent()
      await send()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(changed?.phase).toBe('failed')
      expect(bridge.conversation).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(bridge.request).toHaveBeenCalledTimes(2)
      expect(bridge.prepare).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  }
)
