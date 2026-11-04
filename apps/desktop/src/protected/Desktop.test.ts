// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ProtectedDesktop } from './Desktop'
import { discoveryDraft } from './Discovery'
import type { DiscoveryStoreView, DiscoveryCommand } from '../../protected/discovery-state'
import { attachmentInstructions } from '../../protected/attachment-content'
import type { ProtectedBridge, HermesState } from '../../protected/types'
vi.mock('./TerminalWorkspace', () => ({ TerminalWorkspace: ({ children }: { children: import('react').ReactNode }) => children }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let host: HTMLDivElement
let bridge: ProtectedBridge
const work = 'work_' + 'a'.repeat(32)
const receipt = (status: HermesState['status'] = 'completed'): HermesState => ({ workId: work, sessionId: 'fixture_session', status, text: 'fixture response', reason: 'fixture only', events: status === 'completed' ? ['response_received'] : ['response_delta'] })
const buttons = (label: string) => [...host.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label)
const button = (label: string) => { const b = buttons(label)[0]; if (!b) throw Error('missing ' + label); return b }
const click = async (b: HTMLButtonElement) => { await act(async () => { b.click() }) }
async function input(value: string) {
  await act(async () => {
    const el = host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 요청"]')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function mount() { await act(async () => { root.render(createElement(ProtectedDesktop)) }) }
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  let discoveryState: DiscoveryStoreView = {revision:0,records:{},trash:{},applied:[]}
  bridge = {
    taskReport: vi.fn(),
    terminal: { open: vi.fn(), write: vi.fn(), resize: vi.fn(), acknowledge: vi.fn(), onEvent: vi.fn(() => () => {}) },
    vault: vi.fn(async()=>({available:true,name:'fixture vault'})),
    copyResult: vi.fn(async()=>{}), resultControl: vi.fn(async()=>({hidden:false})),
    discovery: vi.fn(async (command: DiscoveryCommand)=>{if(command.action==='ai-reserve'){discoveryState.requests??={};discoveryState.requests[command.id]={requestId:command.requestId}}if(command.action==='ai-bind')discoveryState.requests![command.id].workId=command.workId;if(command.action==='save')discoveryState.records[command.snapshot.domain]={snapshot:structuredClone(command.snapshot),savedAt:new Date().toISOString()};if(command.action==='claim')discoveryState.applied.push(command.id);if(command.action!=='load')discoveryState.revision++;return structuredClone(discoveryState)}),
    apps: vi.fn(async () => []), profile: vi.fn(async () => ({ profile: 'giselle' as const, ready: true, code: 'ready', message: 'fixture diagnostic', fixtureMode: true })),
    history: vi.fn(async () => []), selectedConversations: vi.fn(async () => []), conversationSummaries: vi.fn(async () => []), launch: vi.fn(async () => {}), quit: vi.fn(async () => {}),
    cancelAttachmentRead: vi.fn(async () => {}), setAttachmentRange: vi.fn(), pickAttachment: vi.fn(async () => ({})), removeAttachment: vi.fn(async () => {}), discardPrepared: vi.fn(async () => {}),
    prepare: vi.fn(async () => work), request: vi.fn(async () => receipt()),
    conversation: vi.fn(async () => ({ workId: work, sessionId: 'fixture_session', canResume: true, limited: true, messages: [{ role: 'assistant' as const, text: 'selected fixture' }] })),
    selectConversation: vi.fn(async () => ({ workId: work, sessionId: 'fixture_session', canResume: true, limited: true, messages: [] }))
  }
  window.protectedHerald = bridge
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
test('first screen places one composer beside title; all three examples fill only', async () => {
  await mount()
  const empty = host.querySelector('.agent-empty')!
  expect(empty.querySelector('h3')?.textContent).toBe('무엇을 함께 실행할까요?')
  expect(empty.querySelector('textarea')).not.toBeNull()
  expect(host.querySelectorAll('textarea')).toHaveLength(1)
  for (const b of empty.querySelectorAll<HTMLButtonElement>('.agent-examples button')) { await click(b); expect(document.activeElement).toBe(host.querySelector('textarea')); expect(host.querySelector('textarea')!.value.length).toBeGreaterThan(10) }
  expect(empty.querySelectorAll('.agent-examples button')).toHaveLength(3)
  expect(bridge.prepare).not.toHaveBeenCalled(); expect(bridge.request).not.toHaveBeenCalled()
})
test('duplicate sends submit one request and completed input cannot replay old text', async () => {
  await mount(); await input('fixture request')
  const send = button('전송')
  await act(async () => { send.click(); send.click() })
  expect(bridge.prepare).toHaveBeenCalledTimes(1); expect(bridge.request).toHaveBeenCalledTimes(1)
  expect(host.querySelector('textarea')!.disabled).toBe(true)
  expect(host.textContent).toContain('가상 응답 · 수신')
  await click(button('새 대화')); expect(host.querySelector('textarea')!.value).toBe('')
  expect(bridge.request).toHaveBeenCalledTimes(1)
})
test('stop during prepare never dispatches after late preparation', async () => {
  let resolve!: (value: string) => void
  bridge.prepare = vi.fn(() => new Promise<string>((r) => { resolve = r }))
  await mount(); await input('fixture request'); await click(button('전송'))
  await click(button('중단')); await act(async () => { resolve(work) })
  expect(bridge.request).not.toHaveBeenCalled()
})
test('running partial response stops to unknown; unknown record cannot resume', async () => {
  bridge.request = vi.fn(async (op) => receipt(op.action === 'cancel' ? 'unknown' : 'running'))
  bridge.conversation = vi.fn(async () => ({ workId: work, sessionId: 'fixture_session', canResume: false, limited: true, messages: [] }))
  await mount(); await input('fixture request'); await click(button('전송'))
  expect(host.textContent).toContain('fixture response'); expect(button('새 대화').disabled).toBe(true)
  await click(button('중단')); expect(host.textContent).toContain('결과 불명 · 재전송 금지')
  await click(button('기록만 확인')); expect(host.querySelector('textarea')!.disabled).toBe(true)
  expect(button('전송').disabled).toBe(true); expect(host.textContent).toContain('추가 전송 금지')
  expect(bridge.request).toHaveBeenCalledTimes(2)
})
test('recent conversation selection is read-only then sends exact resume reference', async () => {
  bridge.history = vi.fn(async () => [receipt(), { ...receipt(), workId: 'work_' + 'b'.repeat(32) }])
  bridge.conversationSummaries = vi.fn(async () => [{ workId: work, title: '한국어 첫 질문으로 이어가기', startedAt: 1700000000, unavailable: false }])
  await mount(); expect(host.querySelectorAll('.agent-recents .agent-recent-row')).toHaveLength(1)
  expect(host.querySelector('.agent-recent-row span')?.textContent).toBe('한국어 첫 질문으로 이어가기')
  await click(host.querySelector<HTMLButtonElement>('.agent-recent-row')!)
  expect(bridge.conversation).toHaveBeenCalledWith(work); expect(bridge.request).not.toHaveBeenCalled()
  expect(host.querySelector('.agent-empty')).toBeNull(); expect(host.querySelector('main > .agent-composer')).not.toBeNull()
  await input('continuation fixture'); await click(button('전송'))
  expect(bridge.prepare).toHaveBeenCalledWith('continuation fixture', expect.any(String), work)
  expect(localStorage.length).toBe(0)
})
test('diagnostic failure never claims local authentication or response success', async () => {
  bridge.profile = vi.fn(async () => ({ profile: 'giselle' as const, ready: false, code: 'auth_required', message: 'authentication required' }))
  await mount(); await input('fixture'); expect(button('전송').disabled).toBe(true)
  expect(host.textContent).toContain('인증 · 필요'); expect(host.textContent).not.toContain('인증 · 로컬 확인')
  expect(host.textContent).toContain('이 실행의 응답 · 미확인')
})
test('failure survives new conversation and refresh until explicit acknowledgement', async () => {
  bridge.prepare = vi.fn(async () => { throw Error('fixture fail') })
  await mount(); await input('fixture'); await click(button('전송'))
  expect(host.querySelector('.agent-error')).not.toBeNull()
  await click(button('새 대화')); await click(host.querySelector<HTMLButtonElement>('[aria-label="목록과 프로필 새로 확인"]')!)
  expect(host.querySelector('.agent-error')).not.toBeNull()
  await click(button('확인')); expect(host.querySelector('.agent-error')).toBeNull(); expect(bridge.request).not.toHaveBeenCalled()
})
test('external launch notice stays by action and does not imply message delivery', async () => {
  bridge.apps = vi.fn(async () => [{ id: 'fixture-app', name: 'Buzz', bundleId: 'xyz.block.buzz.app' }])
  bridge.launch = vi.fn().mockRejectedValueOnce(Error('fixture')).mockResolvedValueOnce(undefined)
  await mount(); await click(button('Buzz')); await click(button('Buzz'))
  expect(host.querySelector('aside .agent-launch-notice')?.textContent).toContain('macOS에 전달')
  expect(host.querySelector('.agent-error')).not.toBeNull(); expect(host.textContent).toContain('메시지 전송 없음')
  expect(bridge.prepare).not.toHaveBeenCalled()
})

test('navigation selected state follows the current view and native controls accept focus', async () => {
  await mount()
  expect(button('지젤 대화').getAttribute('aria-current')).toBe('page')
  await click(button('앱 실행'))
  expect(button('앱 실행').getAttribute('aria-current')).toBe('page')
  expect(button('지젤 대화').hasAttribute('aria-current')).toBe(false)
  button('지젤 대화').focus(); expect(document.activeElement).toBe(button('지젤 대화'))
  await click(button('지젤 대화')); expect(host.querySelector('.agent-empty textarea')).not.toBeNull()
  expect(bridge.launch).not.toHaveBeenCalled(); expect(bridge.request).not.toHaveBeenCalled()
})

test('Samantha replaces the duplicate Codex shortcut and opens the same verified host without sending or selecting a conversation', async () => {
  bridge.apps = vi.fn(async () => [{ id: 'verified-chatgpt', name: 'ChatGPT', bundleId: 'com.openai.codex' }])
  await mount()
  const samantha = host.querySelector<HTMLButtonElement>('[aria-label="Samantha"]')!
  expect(host.querySelector('aside [aria-label="Codex"]')).toBeNull()
  expect(host.querySelector('aside [aria-label="사만다 · dots"]')).toBeNull()
  expect(samantha.disabled).toBe(false)
  expect(samantha.textContent).toContain('대화 직접 선택')
  await click(samantha)
  expect(bridge.launch).toHaveBeenCalledWith('verified-chatgpt')
  expect(host.querySelector('.agent-launch-notice')?.textContent).toContain('대화는 직접 선택')
  expect(vi.mocked(bridge.launch).mock.calls.map(([id]) => id)).toEqual(['verified-chatgpt'])
  expect(bridge.prepare).not.toHaveBeenCalled(); expect(bridge.request).not.toHaveBeenCalled()
  expect(bridge.selectConversation).not.toHaveBeenCalled(); expect(bridge.conversation).not.toHaveBeenCalled()
})

test('Samantha dots is unavailable without the verified host and reports opener failure by purpose', async () => {
  await mount()
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Samantha"]')!.disabled).toBe(true)
  bridge.apps = vi.fn(async () => [{ id: 'verified-chatgpt', name: 'ChatGPT', bundleId: 'com.openai.codex' }])
  bridge.launch = vi.fn().mockRejectedValue(Error('fixture'))
  await click(host.querySelector<HTMLButtonElement>('[aria-label="목록과 프로필 새로 확인"]')!)
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Samantha"]')!)
  expect(host.querySelector('.agent-error')?.textContent).toContain('Samantha 열기 실패')
  expect(bridge.request).not.toHaveBeenCalled()
})

test('duplicate Korean question labels retain separate dates and original IDs; long labels stay text only', async () => {
  const second = 'work_' + 'b'.repeat(32)
  const title = '한국어로 오늘 할 일을 정리해 줘 '.repeat(4).slice(0, 80) + '…'
  bridge.history = vi.fn(async () => [receipt(), { ...receipt(), workId: second, sessionId: 'second_fixture' }])
  bridge.conversationSummaries = vi.fn(async () => [
    { workId: work, title, startedAt: 1700000000, unavailable: false },
    { workId: second, title, startedAt: 1700086400, unavailable: false }
  ])
  await mount()
  const rows = [...host.querySelectorAll<HTMLButtonElement>('.agent-recents .agent-recent-row')]
  expect(rows.map((row) => row.querySelector('span')!.textContent)).toEqual([title, title])
  expect(rows[0].querySelector('small')!.textContent).not.toBe(rows[1].querySelector('small')!.textContent)
  expect(rows[1].title).toContain('세션 ID: second_fixture')
  await click(rows[1]); expect(bridge.conversation).toHaveBeenCalledWith(second)
  expect(localStorage.length).toBe(0); expect(bridge.prepare).not.toHaveBeenCalled()
})

test('empty and unreadable sessions use honest labels without exposing IDs as visible titles', async () => {
  bridge.history = vi.fn(async () => [receipt()])
  bridge.conversationSummaries = vi.fn(async () => [{ workId: work, title: null, startedAt: null, unavailable: false }])
  await mount(); expect(host.querySelector('.agent-recent-row span')?.textContent).toBe('새 대화')
  expect(host.querySelector('.agent-recent-row small')?.textContent).toContain('질문 없음/보호됨')
  bridge.conversationSummaries = vi.fn().mockRejectedValue(Error('private error'))
  await click(host.querySelector<HTMLButtonElement>('[aria-label="목록과 프로필 새로 확인"]')!)
  expect(host.querySelector('.agent-recent-row small')?.textContent).toContain('질문 확인 불가')
  expect(host.querySelector('.agent-recent-row')?.textContent).not.toContain('fixture_session')
  expect(host.textContent).not.toContain('private error'); expect(bridge.request).not.toHaveBeenCalled()
})

test.each([0, 1, 3, 4])('sidebar keeps only three latest question previews with %i conversations and opens the separate full list', async (count) => {
  const records = Array.from({ length: count }, (_, i) => ({ ...receipt(), workId: 'work_' + (i + 1).toString(16).padStart(32, '0'), sessionId: 'fixture_' + i }))
  bridge.history = vi.fn(async () => records)
  bridge.conversationSummaries = vi.fn(async (ids: string[]) => ids.map((workId) => ({ workId, title: '긴 한국어 첫 질문을 제목으로 표시합니다 '.repeat(3).slice(0, 80) + '…', startedAt: 1700000000, unavailable: false })))
  await mount()
  const rows = [...host.querySelectorAll<HTMLButtonElement>('aside .agent-recent-row')]
  expect(rows).toHaveLength(Math.min(3, count))
  expect(rows.map((row) => row.title.split('세션 ID: ')[1])).toEqual(records.slice(0, 3).map((r) => r.sessionId))
  await click(button('전체 대화 보기'))
  expect(host.querySelector('main h2')?.textContent).toBe('전체 대화 보기')
  expect(host.querySelectorAll('.agent-conversation-list .agent-recent-row')).toHaveLength(count)
  expect(host.querySelectorAll('aside .agent-recent-row')).toHaveLength(Math.min(3, count))
  expect(bridge.request).not.toHaveBeenCalled(); expect(bridge.conversation).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(0)
})

test('older full-list conversations remain reachable by pagination and continue using the original reference', async () => {
  const records = Array.from({ length: 9 }, (_, i) => ({ ...receipt(), workId: 'work_' + (i + 1).toString(16).padStart(32, '0'), sessionId: 'fixture_' + i }))
  bridge.history = vi.fn(async () => records)
  bridge.conversationSummaries = vi.fn(async (ids: string[]) => ids.map((workId) => ({ workId, title: '동일 질문', startedAt: 1700000000, unavailable: false })))
  bridge.conversation = vi.fn(async (workId) => ({ workId, sessionId: 'fixture_8', canResume: true, limited: true, messages: [] }))
  await mount(); await click(button('전체 대화 보기'))
  expect(host.querySelectorAll('.agent-conversation-list .agent-recent-row')).toHaveLength(7)
  await click(button('다음 목록'))
  const rows = [...host.querySelectorAll<HTMLButtonElement>('.agent-conversation-list .agent-recent-row')]
  expect(rows).toHaveLength(2); expect(button('다음 목록').disabled).toBe(true)
  await click(rows[1]); expect(bridge.conversation).toHaveBeenCalledWith(records[8].workId)
  await input('fixture continuation'); await click(button('전송'))
  expect(bridge.prepare).toHaveBeenCalledWith('fixture continuation', expect.any(String), records[8].workId)
  expect(vi.mocked(bridge.conversationSummaries).mock.calls.every(([ids]) => ids.length <= 10)).toBe(true)
})

test('compact sidebar separates fixed app actions from scrollable records and full-list return preserves the unsent draft', async () => {
  await mount(); await input('보내지 않은 한국어 초안')
  const region = host.querySelector<HTMLDivElement>('.agent-sidebar-context')!
  region.focus(); expect(document.activeElement).toBe(region); expect(region.getAttribute('role')).toBe('region')
  expect(host.querySelector('.agent-brand h1')?.textContent).toBe('Agent OS')
  expect(host.querySelector('.agent-brand img')).not.toBeNull()
  expect(host.querySelector('.agent-sidebar-actions [aria-label="Samantha"]')).not.toBeNull()
  expect(host.querySelector('.agent-sidebar-context [aria-label="Samantha"]')).toBeNull()
  await click(button('전체 대화 보기')); expect(host.querySelector('.agent-conversation-list')).not.toBeNull()
  button('지젤 대화').focus(); expect(document.activeElement).toBe(button('지젤 대화'))
  await click(button('지젤 대화'))
  expect(host.querySelector('textarea')!.value).toBe('보내지 않은 한국어 초안')
  expect(bridge.prepare).not.toHaveBeenCalled(); expect(bridge.request).not.toHaveBeenCalled(); expect(bridge.quit).not.toHaveBeenCalled()
})
test('composer keeps send and stop inside input wrapper and locks empty/result text', async () => {
  bridge.request = vi.fn(async (op) => receipt(op.action === 'cancel' ? 'unknown' : 'running'))
  await mount()
  expect(host.querySelector('.agent-input-wrap textarea')).not.toBeNull()
  expect(host.querySelector('.agent-input-wrap .agent-input-action')).toBe(button('전송'))
  expect(button('전송').disabled).toBe(true)
  await input('typed fixture'); expect(button('전송').disabled).toBe(false)
  await click(button('전송'))
  expect(host.querySelector('.agent-input-wrap .agent-input-action')).toBe(button('중단'))
  expect(buttons('전송')).toHaveLength(0)
  await click(button('중단'))
  expect(button('전송').disabled).toBe(true)
  expect(host.querySelector('.agent-composer-meta')?.textContent).toContain('추가 전송 금지')
})
test('selected first-question title and exact ID selection live in consolidated navigation', async () => {
  bridge.history = vi.fn(async () => [receipt()])
  bridge.conversationSummaries = vi.fn(async (ids: string[]) => ids.map((workId) => ({ workId, title: '첫 질문 제목', startedAt: 1700000000, unavailable: false })))
  await mount()
  expect(host.querySelector('main input[aria-label="기존 지젤 세션 ID"]')).toBeNull()
  await click(host.querySelector<HTMLButtonElement>('.agent-recents .agent-recent-row')!)
  expect(host.querySelector('main h2')?.textContent).toBe('첫 질문 제목')
  expect(host.querySelector('.agent-recents .agent-recent-row')?.getAttribute('aria-current')).toBe('true')
  expect(bridge.request).not.toHaveBeenCalled()
  await click(button('전체 대화 보기'))
  expect(host.querySelector('.agent-conversation-list input[aria-label="기존 지젤 세션 ID"]')).not.toBeNull()
  await click(button('새 대화')); expect(host.querySelector('.agent-empty')).not.toBeNull()
})
test('protection disclosure remains available in header on every view', async () => {
  await mount()
  const policy = host.querySelector<HTMLDetailsElement>('main > header .agent-policy')!
  expect(policy).not.toBeNull(); expect(host.querySelector('main section .agent-policy')).toBeNull()
  await act(async () => { policy.open = true })
  expect(policy.textContent).toContain('응답 수신은 작업 효과 검증이 아닙니다')
  await click(button('앱 실행')); expect(policy.open).toBe(true)
  expect(host.querySelector('main > header .agent-policy')).toBe(policy)
  expect(bridge.prepare).not.toHaveBeenCalled()
})
test('activity opens and closes without dispatch; unknown receipt stays read-only', async () => {
  bridge.history = vi.fn(async () => [receipt('unknown'), { ...receipt(), workId: 'work_' + 'b'.repeat(32), sessionId: 'completed_fixture' }])
  bridge.conversation = vi.fn(async () => ({ workId: work, sessionId: 'fixture_session', messages: [], limited: true, canResume: false }))
  await mount(); await input('unsent draft')
  expect(host.querySelector('.agent-review-count')?.textContent).toBe('확인 필요 1')
  await click(host.querySelector<HTMLButtonElement>('.agent-activity-link')!)
  expect(host.querySelector('main h2')?.textContent).toBe('활동 기록')
  expect(host.querySelectorAll('.agent-activity-row')).toHaveLength(2)
  expect(host.querySelector('.agent-activity-warning')?.textContent).toContain('자동 재전송하지 않습니다')
  await click(button('활동 기록 닫기')); expect(host.querySelector('textarea')!.value).toBe('unsent draft')
  await click(host.querySelector<HTMLButtonElement>('.agent-activity-link')!)
  await click(host.querySelector<HTMLButtonElement>('.agent-activity-row[data-status="unknown"]')!)
  expect(host.querySelector('textarea')!.disabled).toBe(true); expect(button('전송').disabled).toBe(true)
  expect(bridge.prepare).not.toHaveBeenCalled(); expect(bridge.request).not.toHaveBeenCalled()
})
const attachedText = { id: 'attachment_' + 'c'.repeat(32), kind: 'text' as const, name: 'notes.md', bytes: 12, text: '실제 파일 내용' }
test('attachment selection, preview, removal and cancelled picker never dispatch', async () => {
  bridge.pickAttachment = vi.fn(async () => ({ item: attachedText }))
  await mount(); await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!)
  expect(host.querySelector('.agent-attachments pre')?.textContent).toBe('실제 파일 내용')
  expect(bridge.prepare).not.toHaveBeenCalled(); expect(bridge.request).not.toHaveBeenCalled()
  await click(host.querySelector<HTMLButtonElement>('[aria-label="notes.md 첨부 제거"]')!)
  expect(bridge.removeAttachment).toHaveBeenCalledWith(attachedText.id); expect(host.querySelector('.agent-attachments')).toBeNull()
  bridge.pickAttachment = vi.fn(async () => ({})); await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!)
  expect(host.querySelector('.agent-attachments')).toBeNull()
})
test('text attachment is included by ID on explicit send only; duplicate click sends once and clears selection', async () => {
  bridge.pickAttachment = vi.fn(async () => ({ item: attachedText }))
  await mount(); await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!); await input('요약')
  expect(button('전송').disabled).toBe(false)
  await act(async () => { button('전송').click(); button('전송').click() })
  expect(bridge.prepare).toHaveBeenCalledWith('요약', expect.any(String), undefined, [attachedText.id])
  expect(bridge.prepare).toHaveBeenCalledTimes(1); expect(bridge.request).toHaveBeenCalledTimes(1)
  expect(host.querySelector('.agent-attachments')).toBeNull(); expect(bridge.removeAttachment).toHaveBeenCalledWith(attachedText.id)
})
test('attachment aggregate length and unverified image prevent partial or silent dispatch', async () => {
  bridge.pickAttachment = vi.fn(async () => ({ item: attachedText }))
  await mount(); await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!); await input('x'.repeat(11999))
  expect(button('전송').disabled).toBe(true); expect(host.textContent).toContain('한도 초과')
  await click(button('새 대화')); await input('짧은 요청')
  bridge.pickAttachment = vi.fn(async () => ({ item: { id: 'attachment_'+'d'.repeat(32), kind: 'image' as const, name: 'image.png', bytes: 10, dataUrl: 'data:image/png;base64,AAAA' } }))
  await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!)
  expect(host.querySelector('.agent-attachments img')).not.toBeNull(); expect(button('전송').disabled).toBe(true)
  expect(host.textContent).toContain('별도 모델·서비스로 우회하지 않습니다')
  expect(bridge.prepare).not.toHaveBeenCalled(); expect(bridge.request).not.toHaveBeenCalled()
})
test('attachment picker failure and failed prepare are visible and never auto retried', async () => {
  bridge.pickAttachment = vi.fn(async () => ({ error: 'unsupported_file' }))
  await mount(); await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!)
  expect(host.textContent).toContain('PDF·DOCX·XLSX·PPTX')
  bridge.pickAttachment = vi.fn(async () => ({ item: attachedText })); await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!)
  bridge.prepare = vi.fn(async () => { throw Error('fixture rejection') })
  await click(button('전송'))
  expect(host.querySelector('.agent-attachments')).toBeNull(); expect(host.querySelector('.agent-error')).not.toBeNull()
  expect(bridge.prepare).toHaveBeenCalledTimes(1); expect(bridge.request).not.toHaveBeenCalled()
})
test('Typeless help preserves insertion point and input events remain editable drafts without dispatch', async () => {
  bridge.apps = vi.fn(async () => [{ id: 'fixture_typeless', name: 'Typeless', bundleId: 'now.typeless.desktop' }])
  await mount(); await input('앞뒤')
  const el = host.querySelector('textarea')!
  await act(async () => { el.focus(); el.setSelectionRange(1,1); el.dispatchEvent(new Event('select', { bubbles: true })) })
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Typeless 음성 입력 안내"]')!)
  expect(document.activeElement).toBe(el); expect(el.selectionStart).toBe(1)
  expect(host.textContent).toContain('이 앱은 녹음을 시작하지 않습니다')
  await input('앞 정리된 가상 음성 텍스트 뒤')
  expect(el.value).toContain('정리된 가상 음성 텍스트'); expect(el.disabled).toBe(false)
  expect(bridge.launch).not.toHaveBeenCalled(); expect(bridge.prepare).not.toHaveBeenCalled(); expect(bridge.request).not.toHaveBeenCalled()
})
test('long document preview distinguishes extraction from selected range and blocks send until acknowledgement', async () => {
  const fullText = '한글 English '.repeat(1400)
  const item = { ...attachedText, fullText, text: fullText.slice(0, 8000), rangeStart: 0, rangeEnd: 8000, rangeConfirmed: false, totalUnits: 1,
    units: [{ label: '본문', method: 'DOCX 텍스트', start: 0, end: fullText.length }] }
  bridge.pickAttachment = vi.fn(async () => ({ item }))
  bridge.setAttachmentRange = vi.fn(async (_id, start, end, confirmed) => ({ ...item, text: fullText.slice(start, end), rangeStart: start, rangeEnd: end, rangeConfirmed: confirmed }))
  await mount(); await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!)
  expect(button('전송').disabled).toBe(true); expect(bridge.prepare).not.toHaveBeenCalled()
  expect(host.textContent).toContain('미전송'); expect(host.querySelector('.agent-attachments pre')?.textContent).toBe(fullText.slice(0,8000))
  await act(async () => { host.querySelector<HTMLInputElement>('[aria-label="notes.md 전송 범위 확인"]')!.click() })
  expect(bridge.setAttachmentRange).toHaveBeenCalledWith(item.id, 0, 8000, true)
  expect(button('전송').disabled).toBe(false)
  await click(button('전송')); expect(bridge.prepare).toHaveBeenCalledWith('', expect.any(String), undefined, [item.id])
})
test('OCR text can send without image-model support while original-image transfer remains blocked', async () => {
  const item = { ...attachedText, kind: 'image' as const, readingMode: 'ocr' as const, name: 'scan.png', text: '한국어 OCR letters', dataUrl: 'data:image/png;base64,AAAA' }
  bridge.pickAttachment = vi.fn(async () => ({ item }))
  await mount(); await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!)
  expect(host.querySelector('.agent-attachments img')).not.toBeNull(); expect(button('전송').disabled).toBe(false)
  expect(host.querySelector('.agent-attachments pre')?.textContent).toBe(item.text)
  expect(bridge.request).not.toHaveBeenCalled()
})
test('cancelled local extraction cannot revive a late result or dispatch anything', async () => {
  let finish!: (selection: { item: typeof attachedText }) => void
  bridge.pickAttachment = vi.fn(async () => await new Promise<{ item: typeof attachedText }>(resolve => { finish = resolve }))
  await mount(); await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!)
  await click(button('첨부 읽기 취소'))
  await act(async () => { finish({ item: attachedText }) })
  expect(bridge.cancelAttachmentRead).toHaveBeenCalled(); expect(bridge.removeAttachment).toHaveBeenCalledWith(attachedText.id)
  expect(host.querySelector('.agent-attachments')).toBeNull(); expect(bridge.prepare).not.toHaveBeenCalled(); expect(bridge.request).not.toHaveBeenCalled()
})
async function discoveryAnswer(value: string) {
  await act(async () => {
    const el = host.querySelector<HTMLTextAreaElement>('#discovery-answer')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el,value)
    el.dispatchEvent(new Event('input',{bubbles:true}))
  })
}
const discoveryAnswers = ['최근 실제 경험','직접 적은 막힌 지점','원하는 변화','직접 정한 다음 행동']
async function discoveryReview(domain='업무·자동화') {
  await click(button('문제 발견 · 생각 정리 시작')); await click(host.querySelector<HTMLButtonElement>(`[aria-label="${domain} 시작"]`)!)
  for(let i=0;i<4;i++){await discoveryAnswer(discoveryAnswers[i]);await click(button(i===3?'내 답변 정리하기':'다음 질문'))}
}
async function discoveryReady() {
  await act(async()=>{host.querySelector<HTMLInputElement>('[aria-label="내 해석과 계획 확인"]')!.click()})
  await click(button('지젤에게 보낼 초안 만들기'))
}
test('discovery preserves existing draft and attachments through close/reentry/back and never invokes transport',async()=>{
  bridge.pickAttachment=vi.fn(async()=>({item:attachedText}))
  await mount();await input('기존 초안');await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!)
  await click(button('문제 발견 · 생각 정리 시작'));await click(host.querySelector<HTMLButtonElement>('[aria-label="업무·자동화 시작"]')!);await discoveryAnswer('기억할 경험')
  await click(button('다음 질문'));await discoveryAnswer('막힌 점');await click(button('이전 질문'))
  expect(host.querySelector<HTMLTextAreaElement>('#discovery-answer')!.value).toBe('기억할 경험')
  await click(button('대화로 돌아가기 · 내용 유지'))
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 요청"]')!.value).toBe('기존 초안')
  expect(host.querySelector('.agent-attachments pre')?.textContent).toBe(attachedText.text)
  expect(document.activeElement).toBe(button('문제 발견 · 생각 정리 시작'))
  await click(button('문제 발견 · 생각 정리 시작'));expect(host.querySelector<HTMLTextAreaElement>('#discovery-answer')!.value).toBe('기억할 경험')
  expect(bridge.prepare).not.toHaveBeenCalled();expect(bridge.request).not.toHaveBeenCalled();expect(bridge.removeAttachment).not.toHaveBeenCalled()
})
test('discovery applies confirmed user-edited content once, appends latest draft, retains attachment and focuses composer',async()=>{
  bridge.pickAttachment=vi.fn(async()=>({item:attachedText}));await mount();await input('원래 작성한 글');await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!)
  await discoveryReview()
  await act(async()=>{const el=host.querySelector<HTMLTextAreaElement>('[aria-label="해결할 문제 또는 생각할 주제"]')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,'사용자가 수정한 해석');el.dispatchEvent(new Event('input',{bubbles:true}))})
  expect(button('지젤에게 보낼 초안 만들기').disabled).toBe(true);await discoveryReady()
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 초안"]')!.value).toContain('사용자가 수정한 해석')
  await click(button('대화로 돌아가기 · 내용 유지'));await input('그 사이 직접 수정한 글');await click(button('문제 발견 · 생각 정리 시작'))
  const apply=button('기존 입력 뒤에 초안 적용');await act(async()=>{apply.click();apply.click()})
  const composer=host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 요청"]')!
  expect(composer.value.startsWith('그 사이 직접 수정한 글\n\n')).toBe(true);expect(composer.value.match(/내가 확인·편집한 문제 발견 초안/g)).toHaveLength(1)
  expect(document.activeElement).toBe(composer);expect(host.querySelector('.agent-attachments pre')?.textContent).toBe(attachedText.text)
  expect(bridge.prepare).not.toHaveBeenCalled();expect(bridge.request).not.toHaveBeenCalled()
  await click(button('문제 발견 · 생각 정리 시작'));expect(button('이미 적용한 초안').disabled).toBe(true);expect(button('확인 화면으로 돌아가기').disabled).toBe(true)
})
test('skipped/unknown answers and no-problem result do not fabricate tasks; new-track reset needs explicit confirmation',async()=>{
  await mount();await click(button('문제 발견 · 생각 정리 시작'));await click(host.querySelector<HTMLButtonElement>('[aria-label="업무·자동화 시작"]')!)
  await click(button('기억나지 않음'));await click(button('건너뛰기'));await click(button('건너뛰기'));await click(button('건너뛰기'))
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="상황"]')!.value).toBe('기억나지 않음')
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="해결할 문제 또는 생각할 주제"]')!.value).toBe('')
  await act(async()=>{host.querySelector<HTMLInputElement>('[aria-label="내 해석과 계획 확인"]')!.click()});expect(button('지젤에게 보낼 초안 만들기').disabled).toBe(true)
  await click(button('질문으로 돌아가기'));await click(button('문제 없음'));expect(host.textContent).toContain('지금은 문제 없음');expect(host.querySelector('[aria-label="지젤에게 보낼 초안"]')).toBeNull()
  await click(button('새 문제 시작'));await click(button('이번 내용 유지'));expect(host.textContent).toContain('지금은 문제 없음')
  await click(button('새 문제 시작'));await click(button('회고만 비우고 새로 시작'));await click(host.querySelector<HTMLButtonElement>('[aria-label="신앙·투자·일상 시작"]')!);expect(host.querySelector<HTMLTextAreaElement>('#discovery-answer')!.value).toBe('')
  expect(bridge.prepare).not.toHaveBeenCalled();expect(bridge.request).not.toHaveBeenCalled()
})
test('faith/investment topic changes retain input and distinguish sources from interpretation without inventing evidence',async()=>{
  await mount();await click(button('문제 발견 · 생각 정리 시작'));await click(host.querySelector<HTMLButtonElement>('[aria-label="신앙·투자·일상 시작"]')!);await discoveryAnswer('직접 적은 생각')
  for(const [topic,word] of [['faith','성경 본문·공식 교리'],['invest','사실·출처']] as const){await act(async()=>{const el=host.querySelector<HTMLSelectElement>('[aria-label="생각 정리 분야"]')!;el.value=topic;el.dispatchEvent(new Event('change',{bubbles:true}))});expect(host.textContent).toContain(word);expect(host.querySelector<HTMLTextAreaElement>('#discovery-answer')!.value).toBe('직접 적은 생각')}
  expect(bridge.prepare).not.toHaveBeenCalled();expect(bridge.request).not.toHaveBeenCalled()
})
for(const extra of [0,1])test(`discovery aggregate budget exactly 12000 ${extra?'plus one rejects':'accepts'} without truncation`,async()=>{
  const draft=discoveryDraft('work','daily',{situation:discoveryAnswers[0],problem:discoveryAnswers[1],outcome:discoveryAnswers[2],action:discoveryAnswers[3],basis:'',interpretation:''})
  const budget=attachmentInstructions('\n\n'+draft,[attachedText]).length
  const original='x'.repeat(12000-budget+extra)
  bridge.pickAttachment=vi.fn(async()=>({item:attachedText}));await mount();await input(original);await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!);await discoveryReview();await discoveryReady();await click(button('기존 입력 뒤에 초안 적용'))
  if(extra){expect(host.textContent).toContain('12,001 / 12,000');await click(button('대화로 돌아가기 · 내용 유지'));expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 요청"]')!.value).toBe(original)}
  else {const current=host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 요청"]')!.value;expect(current).toBe(original+'\n\n'+draft);expect(attachmentInstructions(current,[attachedText]).length).toBe(12000)}
  expect(bridge.prepare).not.toHaveBeenCalled();expect(bridge.request).not.toHaveBeenCalled()
})
test('discovery cannot apply to UNKNOWN and cannot open while a request is running',async()=>{
  await mount();await input('요청');bridge.request=vi.fn(async()=>receipt('unknown'));await click(button('전송'))
  await click(host.querySelector<HTMLButtonElement>('[aria-label="문제 발견 열기"]')!);await click(host.querySelector<HTMLButtonElement>('[aria-label="업무·자동화 시작"]')!)
  for(let i=0;i<4;i++){await discoveryAnswer(discoveryAnswers[i]);await click(button(i===3?'내 답변 정리하기':'다음 질문'))}
  await discoveryReady();expect(button('기존 입력 뒤에 초안 적용').disabled).toBe(true);expect(host.textContent).toContain('UNKNOWN은 재전송하지 않고')
  expect(bridge.request).toHaveBeenCalledTimes(1)
  await click(button('대화로 돌아가기 · 내용 유지'));await click(button('새 대화'));await input('새 요청');bridge.request=vi.fn(async()=>receipt('running'));await click(button('전송'))
  expect(host.querySelector<HTMLButtonElement>('[aria-label="문제 발견 열기"]')!.disabled).toBe(true)
})

test('AI followup uses separate transport, blocks composer while running, and preserves original text and attachment',async()=>{
 bridge.pickAttachment=vi.fn(async()=>({item:{id:'attachment_'+'c'.repeat(32),name:'synthetic.txt',kind:'text' as const,bytes:8,text:'synthetic',fullText:'synthetic',rangeStart:0,rangeEnd:9,rangeConfirmed:true,totalUnits:1,units:[],warnings:[]}}))
 let resolve!:(s:HermesState)=>void;bridge.request=vi.fn(()=>new Promise<HermesState>(r=>resolve=r))
 await mount();await input('preserve composer');await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!);await click(button('문제 발견 · 생각 정리 시작'));await click(host.querySelector<HTMLButtonElement>('[aria-label="업무·자동화 시작"]')!)
 await act(async()=>{const el=host.querySelector<HTMLTextAreaElement>('#discovery-answer')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,'synthetic scoped');el.dispatchEvent(new Event('input',{bubbles:true}))})
 await click(button('AI 질문 제안 준비 · 전송 범위 보기'));await act(async()=>host.querySelector<HTMLInputElement>('[aria-label="AI 외부 전송 범위 확인"]')!.click());await click(button('지젤에게 AI 질문 제안 요청'))
 expect(button('새 대화').disabled).toBe(true);expect(host.querySelector<HTMLFieldSetElement>('.agent-discovery-local')!.disabled).toBe(true)
 expect(vi.mocked(bridge.prepare).mock.calls[0].slice(2)).toEqual([undefined,[],'discovery_questions']);expect(vi.mocked(bridge.prepare).mock.calls[0][0]).not.toContain('preserve composer');expect(vi.mocked(bridge.prepare).mock.calls[0][0]).not.toContain('synthetic.txt')
 await act(async()=>resolve({...receipt(),text:JSON.stringify({interpretation:'tentative',questions:['one?']})}));await click(button('대화로 돌아가기 · 내용 유지'));expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 요청"]')!.value).toBe('preserve composer');expect(host.textContent).toContain('synthetic.txt');expect(bridge.prepare).toHaveBeenCalledOnce();expect(bridge.request).toHaveBeenCalledOnce()
})

test('missing session lookup preserves user question and does not resubmit or invent a result',async()=>{
 const {SESSION_NOT_FOUND}=await import('../../protected/session-messages')
 bridge.request=vi.fn(async()=>receipt('unknown'))
 bridge.conversation=vi.fn(async()=>{throw Error(SESSION_NOT_FOUND)})
 await mount();await input('합성 사용자 작성 내용 유지');await click(button('전송'));await click(button('기록만 확인'))
 expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 요청"]')!.value).toBe('합성 사용자 작성 내용 유지')
 expect(host.textContent).toContain(SESSION_NOT_FOUND);expect(bridge.request).toHaveBeenCalledTimes(1);expect(bridge.prepare).toHaveBeenCalledTimes(1)
})
test('app-owned isolated record opens read-only and preserves current question without clearing or resuming',async()=>{
 bridge.conversation=vi.fn(async()=>({workId:work,sessionId:'fixture_session',canResume:false,limited:true,kind:'vault_context' as const,messages:[{role:'assistant' as const,text:'stored synthetic answer'}]}))
 await mount();await input('합성 현재 질문 보존');await click(button('전송'));await click(button('기록 보기·이어가기'))
 expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 요청"]')!.value).toBe('합성 현재 질문 보존');expect(host.textContent).toContain('앱에 저장된 근거 실행 질문·응답');expect(host.textContent).toContain('stored synthetic answer');expect(button('결과 전체를 INBOX 초안으로').disabled).toBe(false);expect(button('전송').disabled).toBe(true);expect(bridge.request).toHaveBeenCalledTimes(1)
})

test('OCR failure is not corruption and partial OCR requires review',async()=>{
 await mount();bridge.pickAttachment=vi.fn(async()=>({error:'ocr_failed',name:'chart.png'}));await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!);expect(host.textContent).toContain('파일 손상으로 판정하지 않으며');expect(host.textContent).not.toContain('확장자와 실제 형식이 다른 문서');expect(bridge.prepare).not.toHaveBeenCalled();expect(bridge.request).not.toHaveBeenCalled()
 bridge.pickAttachment=vi.fn(async()=>({item:{id:'attachment_'+'a'.repeat(32),kind:'image' as const,name:'chart.png',bytes:100,readingMode:'ocr' as const,text:'BC 457',fullText:'BC 457',rangeStart:0,rangeEnd:6,rangeConfirmed:false,partial:true,truncated:false}}))
 await click(host.querySelector<HTMLButtonElement>('[aria-label="파일 첨부"]')!);expect(host.textContent).toContain('부분 인식 · 일부 글자·언어 누락 가능');expect(button('전송').disabled).toBe(true);expect(bridge.request).not.toHaveBeenCalled()
})
