// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { parseMarkdown } from './markdown-parse'
import { Result } from './Result'
import type { ProtectedBridge } from '../../protected/types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const workId = `work_${'a'.repeat(32)}`
let root: Root
let host: HTMLDivElement
let bridge: ProtectedBridge
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
const render = (value: string) => act(async () => root.render(createElement(Result, { text: value, workId })))

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  bridge = {
    copyResult: vi.fn(async () => {}),
    resultControl: vi.fn(async () => ({ hidden: false }))
  } as unknown as ProtectedBridge
  window.protectedHerald = bridge
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const rendered = () => host.querySelector('.agent-result-md')

test('structure renders as headings, lists, code, tables and emphasis', async () => {
  await render(
    '# 제목\n\n- 하나\n- **둘** 과 `코드`\n\n```js\nconst a = 1\n```\n\n| 이름 | 값 |\n| --- | --- |\n| x | 1 |\n'
  )
  expect(rendered()!.querySelector('h3')!.textContent).toBe('제목')
  expect(rendered()!.querySelectorAll('li')).toHaveLength(2)
  expect(rendered()!.querySelector('strong')!.textContent).toBe('둘')
  expect(rendered()!.querySelector('pre code')!.textContent).toBe('const a = 1')
  expect(rendered()!.querySelectorAll('th')).toHaveLength(2)
  expect(rendered()!.querySelector('td')!.textContent).toBe('x')
})

test('plain text keeps the original pre view and offers no raw toggle', async () => {
  await render('그냥 한 줄의 답변입니다.\n두 번째 줄')
  expect(rendered()).toBeNull()
  expect(host.querySelector('pre')!.textContent).toBe('그냥 한 줄의 답변입니다.\n두 번째 줄')
  expect(button('원문 보기')).toBeUndefined()
})

test('raw toggle shows the exact original and back', async () => {
  const value = '**굵게** 와 `코드`'
  await render(value)
  expect(rendered()).not.toBeNull()
  await act(async () => button('원문 보기').click())
  expect(rendered()).toBeNull()
  expect(host.querySelector('pre')!.textContent).toBe(value)
  await act(async () => button('서식 보기').click())
  expect(rendered()).not.toBeNull()
})

test('copy-all uses the original text, not the rendered one', async () => {
  const value = '## 제목\n\n- **굵게**'
  await render(value)
  await act(async () => button('결과 전체 복사').click())
  expect(bridge.copyResult).toHaveBeenCalledWith(value)
})

test('hiding is keyed on the original text', async () => {
  const value = '## 제목\n\n- 항목'
  await render(value)
  await act(async () => button('결과 삭제…').click())
  await act(async () => button('이 결과만 숨기기 확인').click())
  expect(bridge.resultControl).toHaveBeenCalledWith(expect.objectContaining({ action: 'hide', text: value }))
})

test('HTML, script, event handlers, javascript: links and remote images never become active elements', async () => {
  await render(
    [
      '<script>window.__pwned = 1</script>',
      '<img src="http://evil.test/p.png" onerror="window.__pwned = 2">',
      '[누르세요](javascript:window.__pwned=3)',
      '![트래커](http://evil.test/pixel.png)',
      '<a href="http://evil.test">raw anchor</a>',
      '**굵게** 라서 서식 보기로 렌더링됩니다.'
    ].join('\n\n')
  )
  const view = rendered()!
  expect(view.querySelector('script, img, a, iframe, object, embed, form, [onerror], [href], [src]')).toBeNull()
  expect(view.textContent).toContain('<script>window.__pwned = 1</script>')
  expect(view.textContent).toContain('<img src="http://evil.test/p.png"')
  expect(view.textContent).toContain('누르세요 (javascript:window.__pwned=3)')
  expect(view.textContent).toContain('[이미지] 트래커 (http://evil.test/pixel.png)')
  expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
})

test('unclosed code fence runs to the end and does not reinterpret what follows', async () => {
  await render('앞 문단\n\n```\nlet open = true\n**not bold**')
  expect(rendered()!.querySelector('pre code')!.textContent).toBe('let open = true\n**not bold**')
  expect(rendered()!.querySelector('strong')).toBeNull()
})

test('snake_case, math and lone asterisks stay literal', async () => {
  await render('use snake_case_name and 2 * 3 * 4 = 24\n\n- ok')
  const p = rendered()!.querySelector('p')!
  expect(p.textContent).toBe('use snake_case_name and 2 * 3 * 4 = 24')
  expect(p.querySelector('em')).toBeNull()
})

test('nested lists and ordered lists keep their structure', async () => {
  await render('1. 첫째\n   - 안쪽 가\n   - 안쪽 나\n2. 둘째')
  const outer = rendered()!.querySelector('ol')!
  expect(outer.children).toHaveLength(2)
  expect(outer.querySelectorAll('ul li')).toHaveLength(2)
})

test('table rows are padded or cut to the header width', async () => {
  await render('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |')
  const rows = [...rendered()!.querySelectorAll('tbody tr')]
  expect(rows).toHaveLength(2)
  for (const row of rows) expect(row.querySelectorAll('td')).toHaveLength(2)
  expect(rows[1].textContent).not.toContain('3')
})

test('unclosed markers in a maximum-size answer parse in bounded time', () => {
  // Pushed state re-parses up to 20,000 characters every ~100 ms; this must not go quadratic.
  for (const unit of ['*a ', '_a ', '**a ', '[a ', '`a ']) {
    const input = unit.repeat(Math.floor(20000 / unit.length))
    const start = performance.now()
    parseMarkdown(input)
    expect(performance.now() - start, unit).toBeLessThan(150)
  }
})
