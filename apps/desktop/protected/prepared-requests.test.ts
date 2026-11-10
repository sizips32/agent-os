import { expect, test } from 'vitest'
import { MAX_UNSUBMITTED, PreparedRequests } from './prepared-requests'

const fp = (text: string) => PreparedRequests.fingerprint(['p', text, undefined, []])

test('the same request id and content returns the same work, even after submission', () => {
  const prepared = new PreparedRequests()
  prepared.add('req', fp('a'), 'work_1')
  expect(prepared.find('req', fp('a'))).toBe('work_1')
  expect(prepared.find('other', fp('a'))).toBeUndefined()
})

test('the same request id with different content is a conflict', () => {
  const prepared = new PreparedRequests()
  prepared.add('req', fp('a'), 'work_1')
  expect(() => prepared.find('req', fp('b'))).toThrow('Request identifier conflict')
})

test('only unsubmitted work counts toward the limit, so 300 sequential submissions never hit it', () => {
  const prepared = new PreparedRequests()
  const submitted = new Set<string>()
  for (let i = 0; i < 300; i++) {
    prepared.assertRoom(id => submitted.has(id))
    prepared.add(`req${i}`, fp(String(i)), `work_${i}`)
    submitted.add(`work_${i}`)
  }
  expect(prepared.find('req0', fp('0'))).toBe('work_0')
})

test('the limit trips on unsent requests; discarding frees room but the request id still fails closed', () => {
  const prepared = new PreparedRequests()
  for (let i = 0; i < MAX_UNSUBMITTED; i++) prepared.add(`req${i}`, fp(String(i)), `work_${i}`)
  expect(() => prepared.assertRoom(() => false)).toThrow('Local request limit reached')
  prepared.discard('work_0')
  expect(() => prepared.assertRoom(() => false)).not.toThrow()
  expect(prepared.find('req0', fp('0'))).toBe('work_0')
  expect(() => prepared.find('req0', fp('changed'))).toThrow('Request identifier conflict')
})
