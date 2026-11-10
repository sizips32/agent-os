// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test('a child render error shows the fallback, and the button remounts the child', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let fail = true
  const Child = () => {
    if (fail) throw Error('boom secret request text')
    return createElement('p', null, 'recovered')
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(ErrorBoundary, null, createElement(Child))))
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  expect(host.textContent).toContain('같은 요청을 다시 보내지 말고')
  expect(host.textContent).not.toContain('secret request text')
  fail = false
  await act(async () => host.querySelector('button')!.click())
  expect(host.textContent).toBe('recovered')
  await act(async () => root.unmount())
})
