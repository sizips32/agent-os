import { expect, test } from 'vitest'
import { followupPrompt, parseFollowup, validFollowup, followupAnswers, type Followup } from './discovery-ai'
import { validDiscovery } from './discovery-state'
const input = {
  situation: 'synthetic experience',
  problem: 'synthetic problem',
  outcome: '',
  action: '',
  basis: '',
  interpretation: ''
}
const ai: Followup = {
  phase: 'questions',
  input,
  interpretation: 'tentative',
  decision: null,
  questions: [{ question: 'What blocked you?', answer: 'synthetic answer', skipped: false }],
  cursor: 0
}
test.each(['faith', 'invest', 'daily'] as const)(
  'bounded %s prompt includes only current structured answers and tentative constraints',
  topic => {
    const prompt = followupPrompt('thought', topic, input)
    expect(prompt).toContain(JSON.stringify(input, null, 2).slice(1, -1).trim().split('\n')[0].trim())
    expect(prompt).toContain('잠정')
    expect(prompt).toContain('도구·웹·파일·기억')
    expect(prompt).toContain('공식 교리')
    expect(prompt).toContain('투자 성과')
    expect(prompt).not.toContain('attachments')
    expect(prompt).not.toContain('resumeWorkId')
  }
)
test('strict response accepts JSON or exact JSON fence and rejects prose, invented keys and unbounded output', () => {
  const response = { interpretation: 'tentative', questions: ['one?', 'two?'] }
  expect(parseFollowup(JSON.stringify(response)).questions).toHaveLength(2)
  expect(parseFollowup('```json\n' + JSON.stringify(response) + '\n```').interpretation).toBe('tentative')
  for (const raw of [
    'prefix ' + JSON.stringify(response),
    JSON.stringify({ ...response, facts: [] }),
    JSON.stringify({ ...response, questions: [] }),
    JSON.stringify({ ...response, questions: [''] }),
    JSON.stringify({ ...response, questions: Array(4).fill('question') }),
    JSON.stringify({ ...response, interpretation: 'x'.repeat(401) }),
    'x'.repeat(3001)
  ])
    expect(() => parseFollowup(raw)).toThrow()
})
test('local state permits temporarily blank edited question, rejects hidden fields and restores optional state', () => {
  expect(validFollowup(ai)).toBe(true)
  expect(validFollowup({ ...ai, questions: [{ question: '', answer: 'kept', skipped: false }] })).toBe(true)
  expect(validFollowup({ ...ai, attachmentIds: [] })).toBe(false)
  expect(validFollowup({ ...ai, cursor: 3 })).toBe(false)
  const snapshot = {
    id: '11111111-1111-4111-8111-111111111111',
    domain: 'work',
    topic: 'daily',
    step: 0,
    screen: 'questions',
    answers: ['', '', '', ''],
    review: input,
    confirmed: false,
    applied: false
  }
  expect(validDiscovery(snapshot)).toBe(true)
  expect(validDiscovery({ ...snapshot, ai, includeAi: true })).toBe(true)
  expect(validDiscovery({ ...snapshot, ai })).toBe(false)
})
test('draft includes only user accepted interpretation and non-skipped supplied answers', () => {
  expect(followupAnswers(ai)).not.toContain('tentative')
  expect(followupAnswers({ ...ai, decision: 'no' })).not.toContain('tentative')
  expect(followupAnswers({ ...ai, decision: 'edit' })).toContain('tentative')
  expect(followupAnswers({ ...ai, questions: [{ ...ai.questions[0], skipped: true }] })).toBe('')
})
