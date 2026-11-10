// @vitest-environment jsdom
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { VaultPane, type VaultSeed } from './VaultPane'
import type { VaultCommand, VaultReply, VaultEvidence } from '../../protected/vault-types'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root, host: HTMLDivElement, seed: VaultSeed | null, send: ReturnType<typeof vi.fn>
const evidence: VaultEvidence[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    path: '0_INBOX/source.md',
    title: 'synthetic source',
    hash: 'a'.repeat(64),
    start: 0,
    end: 3,
    text: 'abc'
  }
]
const saved = {
  id: '22222222-2222-4222-8222-222222222222',
  path: '0_INBOX/AgentOS-fixture.md',
  hash: 'b'.repeat(64),
  title: 'fixture'
}
const hit = {
  id: '33333333-3333-4333-8333-333333333333',
  path: '1_SEMANTIC_LAYER/concept.md',
  title: 'concept',
  hash: 'c'.repeat(64),
  tags: [],
  topic: 'Technical',
  context: ''
}
async function render(next = seed) {
  seed = next
  await act(async () => {
    root.render(
      createElement(VaultPane, {
        visible: true,
        evidence,
        onEvidence: () => ({ ok: true, message: 'selected' }),
        seed,
        composer: null,
        blocked: false,
        submissionStatus: 'completed'
      })
    )
  })
}
const button = (label: string) => {
  const e = [...host.querySelectorAll('button')].find(x => x.textContent === label)
  if (!e) throw Error(label)
  return e
}
async function click(label: string) {
  await act(async () => button(label).click())
}
async function input(label: string, value: string) {
  await act(async () => {
    const e = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
    Object.getOwnPropertyDescriptor(
      e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )!.set!.call(e, value)
    e.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  seed = { text: 'synthetic original body', label: 'synthetic export' }
  send = vi.fn(
    async (c: VaultCommand): Promise<VaultReply> =>
      c.action === 'info'
        ? { available: true, name: 'fixture' }
        : c.action === 'save-preview'
          ? { markdown: 'synthetic approved markdown' }
          : c.action === 'save' || c.action === 'links-save'
            ? { saved }
            : c.action === 'suggest'
              ? { suggestions: [{ note: hit, reason: 'fixture' }] }
              : c.action === 'links-preview'
                ? { markdown: 'synthetic approved links' }
                : {}
  )
  window.protectedHerald = { vault: send } as any
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
test('late draft preview is discarded after body edit; confirmation sends the exact newly previewed snapshot', async () => {
  await render()
  await input('INBOX 초안 제목', 'title')
  let resolve!: (v: VaultReply) => void
  send.mockImplementationOnce(
    () =>
      new Promise(r => {
        resolve = r
      })
  )
  await click('저장 내용 미리보기')
  await input('INBOX 초안 본문', 'edited while preview pending')
  await act(async () => resolve({ markdown: 'STALE APPROVAL' }))
  expect(host.textContent).not.toContain('STALE APPROVAL')
  expect([...host.querySelectorAll('button')].some(x => x.textContent === '확인 · 새 INBOX 초안 저장')).toBe(false)
  await click('저장 내용 미리보기')
  const preview = send.mock.calls.findLast(([c]) => c.action === 'save-preview')![0]
  await click('확인 · 새 INBOX 초안 저장')
  const actual = send.mock.calls.find(([c]) => c.action === 'save')![0]
  expect(actual.draft).toEqual(preview.draft)
  expect(actual.draft.body).toBe('edited while preview pending')
})
test('new export cannot overwrite dirty title/body/tags/sources; cancel and restore preserve them', async () => {
  await render()
  await input('INBOX 초안 제목', 'owned title')
  await input('INBOX 초안 본문', 'owned body')
  await input('INBOX 초안 태그', 'owned-tag')
  await act(async () => host.querySelector<HTMLInputElement>('fieldset input')!.click())
  await render({ text: 'new export', label: 'new' })
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="INBOX 초안 본문"]')!.value).toBe('owned body')
  expect(host.querySelector('[aria-label="작성 중인 초안 보호"]')).not.toBeNull()
  await click('전환 취소 · 현재 초안 유지')
  await render({ text: 'next export', label: 'next' })
  await click('현재 초안 보관 후 새 결과로 전환')
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="INBOX 초안 본문"]')!.value).toBe('next export')
  await click('이전 작성 초안 복원 · 현재 초안도 보관')
  expect(host.querySelector<HTMLInputElement>('[aria-label="INBOX 초안 제목"]')!.value).toBe('owned title')
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="INBOX 초안 본문"]')!.value).toBe('owned body')
  expect(host.querySelector<HTMLInputElement>('[aria-label="INBOX 초안 태그"]')!.value).toBe('owned-tag')
  expect(host.querySelector<HTMLInputElement>('fieldset input')!.checked).toBe(true)
  expect(send.mock.calls.some(([c]) => c.action === 'save')).toBe(false)
})
test('late link preview is discarded after candidate change; only newly approved link IDs can save', async () => {
  await render()
  await input('INBOX 초안 제목', 'title')
  await click('저장 내용 미리보기')
  await click('확인 · 새 INBOX 초안 저장')
  await click('관련 개념·MOC 제안 보기')
  await act(async () => host.querySelector<HTMLInputElement>('.vault-link-candidate input')!.click())
  let resolve!: (v: VaultReply) => void
  send.mockImplementationOnce(
    () =>
      new Promise(r => {
        resolve = r
      })
  )
  await click('선택 링크 반영 미리보기')
  await act(async () => host.querySelector<HTMLInputElement>('.vault-link-candidate input')!.click())
  await act(async () => resolve({ markdown: 'STALE LINKS' }))
  expect(host.textContent).not.toContain('STALE LINKS')
  expect(send.mock.calls.some(([c]) => c.action === 'links-save')).toBe(false)
  await act(async () => host.querySelector<HTMLInputElement>('.vault-link-candidate input')!.click())
  await click('선택 링크 반영 미리보기')
  const preview = send.mock.calls.findLast(([c]) => c.action === 'links-preview')![0]
  await click('확인 · 링크 포함 새 버전 저장')
  const actual = send.mock.calls.find(([c]) => c.action === 'links-save')![0]
  expect(actual.linkIds).toEqual(preview.linkIds)
  expect(actual.captureId).toBe(preview.captureId)
  expect(actual.saved).toEqual(preview.saved)
  expect(host.textContent).toContain('새 버전 INBOX 초안으로 저장')
})

test('_giselle folder selection sends a bounded local search and never saves or submits', async () => {
  await render()
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('[aria-label="볼트 폴더"]')!
    expect([...select.options].map(o => o.value)).toEqual(['0_INBOX', '1_SEMANTIC_LAYER', '_giselle'])
    select.value = '_giselle'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click('로컬 노트 검색')
  expect(send.mock.calls.findLast(([c]) => c.action === 'search')?.[0]).toMatchObject({
    action: 'search',
    folder: '_giselle',
    subfolder: ''
  })
  expect(send.mock.calls.some(([c]) => c.action === 'save' || c.action === 'links-save')).toBe(false)
})
