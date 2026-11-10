import { expect, test, vi } from 'vitest'
import { HermesStreamParser, MAX_PROTOCOL_EVENTS, MAX_PROTOCOL_LINE_BYTES } from './hermes-stream'
import type { HermesState } from './types'

const frame = (v: unknown) => `${JSON.stringify(v)}\n`
const init = (session_id = 'sess_1') => frame({ type: 'system', subtype: 'init', session_id })
const result = (over: Record<string, unknown> = {}) =>
  frame({ type: 'result', session_id: 'sess_1', exit_code: 0, text: 'done', ...over })

function setup(vault = false) {
  const state: HermesState = { workId: 'work_x', status: 'running', sessionId: '', text: '', events: [], reason: '' }
  const hooks = { confirmSession: vi.fn((id: string) => void (state.sessionId = id)), onInvalid: vi.fn() }
  return { state, hooks, parser: new HermesStreamParser(state, vault, hooks) }
}

test('well-formed stream reaches a terminal result and confirms the session once', () => {
  const { parser, state, hooks } = setup()
  parser.push(Buffer.from(init() + frame({ type: 'text', text: 'hi' }) + result()))
  parser.end()
  expect(parser.terminal?.exit_code).toBe(0)
  expect(parser.trailing).toBe(false)
  expect(state.text).toBe('hi')
  expect(hooks.confirmSession).toHaveBeenCalledTimes(1)
  expect(hooks.onInvalid).not.toHaveBeenCalled()
})

test('a frame split across chunks, including a split multi-byte character, parses once complete', () => {
  const { parser, state } = setup()
  const bytes = Buffer.from(init() + frame({ type: 'text', text: '안녕' }))
  const cut = bytes.indexOf(Buffer.from('안')) + 1
  parser.push(bytes.subarray(0, cut))
  parser.push(bytes.subarray(cut))
  expect(state.text).toBe('안녕')
})

test('truncated JSON line is rejected with invalid_json and stops parsing', () => {
  const { parser, state, hooks } = setup()
  parser.push(Buffer.from(`${init()}{"type":"text","text":\n${result()}`))
  expect(hooks.onInvalid).toHaveBeenCalledTimes(1)
  expect(state.diagnostic?.branch).toBe('invalid_json')
  expect(parser.terminal).toBeNull()
})

test('unterminated final data counts as trailing', () => {
  const { parser } = setup()
  parser.push(Buffer.from(`${init()}{"type":"text"`))
  parser.end()
  expect(parser.trailing).toBe(true)
})

test('events before init are rejected', () => {
  const { parser, state, hooks } = setup()
  parser.push(Buffer.from(frame({ type: 'text', text: 'early' })))
  expect(hooks.onInvalid).toHaveBeenCalled()
  expect(state.diagnostic?.branch).toBe('invalid_init')
  expect(state.text).toBe('')
})

test('a second init and any frame after the result are rejected', () => {
  const dup = setup()
  dup.parser.push(Buffer.from(init() + init()))
  expect(dup.hooks.onInvalid).toHaveBeenCalled()
  const late = setup()
  late.parser.push(Buffer.from(init() + result()))
  late.parser.push(Buffer.from(frame({ type: 'text', text: 'late' })))
  expect(late.hooks.onInvalid).toHaveBeenCalled()
  expect(late.state.text).toBe('')
})

test('result session must match the confirmed one and exit_code 0 requires a valid session', () => {
  const mismatch = setup()
  mismatch.parser.push(Buffer.from(init('sess_1') + result({ session_id: 'sess_2' })))
  expect(mismatch.state.diagnostic?.branch).toBe('session_mismatch')
  const empty = setup()
  empty.parser.push(Buffer.from(init('') + result({ session_id: '' })))
  expect(empty.state.diagnostic?.branch).toBe('invalid_result')
})

test('oversized frame is rejected before it is parsed', () => {
  const { parser, state, hooks } = setup()
  parser.push(Buffer.from(init()))
  parser.push(Buffer.from(`${'x'.repeat(MAX_PROTOCOL_LINE_BYTES + 1)}\n`))
  expect(hooks.onInvalid).toHaveBeenCalled()
  expect(state.diagnostic?.branch).toBe('protocol_frame_limit')
})

test('an unterminated buffer over the frame limit is rejected without waiting for a newline', () => {
  const { parser, state, hooks } = setup()
  parser.push(Buffer.from('x'.repeat(MAX_PROTOCOL_LINE_BYTES + 1)))
  expect(hooks.onInvalid).toHaveBeenCalled()
  expect(state.diagnostic?.branch).toBe('protocol_frame_limit')
})

test('event count over the limit is rejected', () => {
  const { parser, state, hooks } = setup()
  const tool = frame({ type: 'tool_use', name: 'search' })
  parser.push(Buffer.from(init() + tool.repeat(MAX_PROTOCOL_EVENTS - 1)))
  expect(hooks.onInvalid).not.toHaveBeenCalled()
  parser.push(Buffer.from(tool))
  expect(hooks.onInvalid).toHaveBeenCalled()
  expect(state.diagnostic?.branch).toBe('protocol_event_limit')
})

test('tool names are validated and tool bodies are never retained', () => {
  const ok = setup()
  ok.parser.push(Buffer.from(init() + frame({ type: 'tool_use', name: 'web.search', input: { secret: 'x' } })))
  expect(ok.state.events).toContain('tool_started:web.search')
  expect(JSON.stringify(ok.state)).not.toContain('secret')
  const bad = setup()
  bad.parser.push(Buffer.from(init() + frame({ type: 'tool_use', name: 'bad name!' })))
  expect(bad.hooks.onInvalid).toHaveBeenCalled()
})

test('error frames are only accepted in vault context, where parsing continues after reporting invalid', () => {
  const plain = setup(false)
  plain.parser.push(Buffer.from(init() + frame({ type: 'error', code: 'runtime_boundary' })))
  expect(plain.state.diagnostic?.branch).toBe('invalid_event')
  const vault = setup(true)
  vault.parser.push(Buffer.from(init() + frame({ type: 'error', code: 'runtime_boundary' }) + result()))
  expect(vault.hooks.onInvalid).toHaveBeenCalledTimes(1)
  expect(vault.state.events.some(e => e.startsWith('runtime_error:'))).toBe(true)
  expect(vault.parser.terminal).not.toBeNull()
})

test('text over the response cap is rejected', () => {
  const { parser, hooks } = setup()
  parser.push(Buffer.from(init() + frame({ type: 'text', text: 'a'.repeat(20001) })))
  expect(hooks.onInvalid).toHaveBeenCalled()
})
