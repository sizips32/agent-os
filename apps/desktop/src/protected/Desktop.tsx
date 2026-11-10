import { useEffect, useRef, useState } from 'react'
import {
  IconArrowUp,
  IconApps,
  IconRefresh,
  IconSquare,
  IconExternalLink,
  IconMessageCircle,
  IconPlus,
  IconRobot,
  IconSparkles,
  IconBolt,
  IconWaveSine,
  IconPaperclip,
  IconMicrophone,
  IconX
} from '@tabler/icons-react'
import { HermesAvatar } from '../components/app-icon.tsx'
import type {
  AttachmentPreview,
  Conversation,
  ConversationSummary,
  HermesState,
  NativeApp,
  ProtectedBridge
} from '../../protected/types.ts'
import './desktop.css'
import { TaskPanel } from './TaskPanel'
import { TerminalWorkspace } from './TerminalWorkspace'
import { VaultPane, type VaultSeed } from './VaultPane'
import { vaultCompose, VAULT_SYSTEM_PROMPT, type VaultEvidence } from '../../protected/vault-types'
import { SESSION_NOT_FOUND, VAULT_RECORD_UNAVAILABLE } from '../../protected/session-messages'
import { Result } from './Result'
import { Discovery } from './Discovery'
import { StatusPoller } from '../../protected/status-poller.ts'
import { SubmissionFlow } from '../../protected/submission-flow.ts'
import { attachmentInstructions, REQUEST_LIMIT } from '../../protected/attachment-content.ts'
declare global {
  interface Window {
    protectedHerald: ProtectedBridge
  }
}
const shortcuts = [
  { name: 'Samantha', bundle: 'com.openai.codex', Icon: IconMessageCircle, detail: '앱 열기 · 대화 직접 선택' },
  { name: 'Hermes', bundle: 'com.nousresearch.hermes', Icon: IconRobot },
  { name: 'Buzz', bundle: 'xyz.block.buzz.app', Icon: IconWaveSine, IconPaperclip, IconMicrophone, IconX },
  { name: 'Muse', bundle: 'com.meta.endo', Icon: IconSparkles },
  { name: 'Grok Bot', bundle: 'com.anysphere.sand', Icon: IconBolt }
]
export function ProtectedDesktop() {
  const [apps, setApps] = useState<NativeApp[]>([])
  const [appsLoaded, setAppsLoaded] = useState(false)
  const [fixtureMode, setFixtureMode] = useState(false)
  const [diagnosis, setDiagnosis] = useState('지젤 프로필 확인 중…')
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<'chat' | 'apps' | 'conversations' | 'activity' | 'discovery' | 'vault' | 'tasks'>(
    'chat'
  )
  const [conversationPage, setConversationPage] = useState(0)
  const [filter, setFilter] = useState('')
  const [text, setText] = useState('')
  const [evidence, setEvidence] = useState<VaultEvidence[]>([])
  const [vaultConsent, setVaultConsent] = useState(false)
  const [vaultSeed, setVaultSeed] = useState<VaultSeed | null>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([])
  const attachmentRef = useRef<AttachmentPreview[]>([])
  const attachmentGeneration = useRef(0)
  const [picking, setPicking] = useState(false)
  const [attachmentNotice, setAttachmentNotice] = useState('')
  const [dictationNotice, setDictationNotice] = useState('')
  const [nativeImageAllowed, setNativeImageAllowed] = useState(false)
  const caret = useRef({ start: 0, end: 0 })
  function replaceAttachments(items: AttachmentPreview[]) {
    attachmentRef.current = items
    setAttachments(items)
  }
  async function clearAttachments() {
    ++attachmentGeneration.current
    const ids = attachmentRef.current.map(item => item.id)
    replaceAttachments([])
    await window.protectedHerald.cancelAttachmentRead()
    const results = await Promise.allSettled(ids.map(id => window.protectedHerald.removeAttachment(id)))
    if (results.some(item => item.status === 'rejected'))
      reportError('첨부 정리를 확인하지 못했습니다. 자동 재전송하지 않습니다.')
  }
  async function pickAttachment() {
    if (picking || lock.current || reading || state) return
    const generation = attachmentGeneration.current
    setPicking(true)
    setAttachmentNotice('')
    try {
      const choice = await window.protectedHerald.pickAttachment()
      if (generation !== attachmentGeneration.current) {
        if (choice.item) await window.protectedHerald.removeAttachment(choice.item.id)
        return
      }
      if (choice.error) {
        const labels: Record<string, string> = {
          attachment_limit: '첨부는 최대 8개입니다.',
          protected_file: '설정·인증·기억 등 보호 파일은 첨부하지 않습니다.',
          unsupported_file: 'TXT·MD·CSV·JSON·PDF·DOCX·XLSX·PPTX·JPEG·PNG·WebP를 지원합니다.',
          legacy_document: '구형 DOC·XLS·PPT는 안전한 읽기가 미검증입니다. DOCX·XLSX·PPTX로 저장해 주세요.',
          encrypted_file: '암호화 문서는 읽지 않습니다. 암호 없는 사본을 직접 선택해 주세요.',
          invalid_document: '손상되었거나 확장자와 실제 형식이 다른 문서입니다.',
          no_text: '읽을 수 있는 글자가 없습니다. OCR은 사진·도표의 의미 분석이 아닙니다.',
          document_limit: '페이지·셀·압축 해제·이미지 크기가 로컬 안전 한도를 초과했습니다.',
          active_content: '매크로·임베디드 개체·외부 데이터 참조가 포함되어 읽지 않습니다.',
          extraction_failed: '로컬 추출이 실패했거나 90초 제한을 초과했습니다. 외부 서비스로 보내지 않습니다.',
          extraction_unavailable: '로컬 문서 읽기 도구를 사용할 수 없습니다.',
          ocr_failed:
            '이미지/문서는 읽었지만 로컬 OCR 인식에 실패했습니다. 파일 손상으로 판정하지 않으며 외부로 보내지 않습니다.',
          ocr_unavailable: '이미지는 읽었지만 사용 가능한 로컬 OCR 인식기를 찾지 못했습니다. 외부로 보내지 않습니다.',
          extraction_timeout:
            '로컬 읽기의 90초 한도를 넘었습니다. 파일 손상으로 판정하지 않으며 외부로 보내지 않습니다.',
          one_image_only: '이미지는 1개만 첨부할 수 있습니다.',
          file_size: '빈 파일 또는 크기 초과입니다. 텍스트 64KiB, 문서 16MiB, 이미지 5MiB 이내입니다.',
          utf8_required: 'UTF-8 텍스트 파일만 지원합니다.',
          text_limit: '첨부 텍스트는 12,000자 이내여야 합니다.',
          invalid_image: '확인할 수 없는 이미지입니다.',
          busy: '요청 중에는 첨부할 수 없습니다.'
        }
        setAttachmentNotice(
          (choice.name ? `${choice.name}: ` : '') +
            (labels[choice.error] || '파일을 읽지 못했습니다. 다시 선택해 주세요.')
        )
      } else if (choice.item) replaceAttachments([...attachmentRef.current, choice.item])
    } catch {
      setAttachmentNotice('파일 선택을 완료하지 못했습니다. 자동 전송하지 않습니다.')
    } finally {
      setPicking(false)
    }
  }
  async function removeAttachment(id: string) {
    if (lock.current || discoveryAiLock.current || reading || state) return
    try {
      await window.protectedHerald.removeAttachment(id)
      replaceAttachments(attachmentRef.current.filter(item => item.id !== id))
    } catch {
      setAttachmentNotice('첨부 제거를 확인하지 못했습니다. 전송 전에 다시 확인하세요.')
    }
  }
  async function cancelAttachmentRead() {
    ++attachmentGeneration.current
    await window.protectedHerald.cancelAttachmentRead()
    setPicking(false)
    setAttachmentNotice('로컬 첨부 읽기를 취소했습니다. 전송하지 않았습니다.')
  }
  async function selectAttachmentRange(item: AttachmentPreview, start: number, end: number, confirmed: boolean) {
    if (active || state || lock.current) return
    setPicking(true)
    try {
      const updated = await window.protectedHerald.setAttachmentRange(item.id, start, end, confirmed)
      if (attachmentRef.current.some(v => v.id === item.id))
        replaceAttachments(attachmentRef.current.map(v => (v.id === item.id ? updated : v)))
      setAttachmentNotice('')
    } catch {
      setAttachmentNotice('추출 내용 안에서 전송할 1~12,000자를 선택해 주세요. 전체 요청 한도도 적용됩니다.')
    } finally {
      setPicking(false)
    }
  }
  function typelessInput() {
    const input = composerInput.current
    if (!input || input.disabled) return
    const position =
      document.activeElement === input ? { start: input.selectionStart, end: input.selectionEnd } : caret.current
    input.focus()
    input.setSelectionRange(position.start, position.end)
    setDictationNotice(
      apps.some(app => app.bundleId === 'now.typeless.desktop')
        ? '입력 위치를 유지했습니다. 기존 Typeless 단축키를 직접 눌러 말해 주세요. 정리된 텍스트는 초안에만 반영됩니다. 이 앱은 녹음을 시작하지 않습니다. Typeless는 음성을 클라우드에서 처리합니다.'
        : 'Typeless 앱을 먼저 실행한 뒤 입력창에서 기존 단축키를 직접 사용하세요. 이 앱은 녹음을 시작하거나 요청을 전송하지 않습니다.'
    )
  }
  const [message, setMessage] = useState('')
  const [profileCode, setProfileCode] = useState('diagnostic_unavailable')
  const [errors, setErrors] = useState<string[]>([])
  const [launchNotice, setLaunchNotice] = useState<{ app: string; text: string } | null>(null)
  const [observedResponse, setObservedResponse] = useState(false)
  function reportError(message: string) {
    setErrors(items => (items.includes(message) ? items : [...items, message]))
  }
  const [launching, setLaunching] = useState('')
  const [history, setHistory] = useState<HermesState[]>([])
  const [state, setState] = useState<HermesState | null>(null)
  const [savedConversations, setSavedConversations] = useState<{ workId: string; sessionId: string }[]>([])
  const [summaries, setSummaries] = useState<ConversationSummary[]>([])
  const [titlesLoading, setTitlesLoading] = useState(false)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const recentConversations = history
    .filter((item, i, items) => item.sessionId && items.findIndex(other => other.sessionId === item.sessionId) === i)
    .slice(0, 3)
  const allConversations = [...history, ...savedConversations].filter(
    (item, i, items) =>
      items.findIndex(other => (other.sessionId || other.workId) === (item.sessionId || item.workId)) === i
  )
  const visiblePage = Math.min(conversationPage, Math.max(0, Math.ceil(allConversations.length / 7) - 1))
  const pageConversations = view === 'conversations' ? allConversations.slice(visiblePage * 7, visiblePage * 7 + 7) : []
  useEffect(() => {
    let current = true
    const ids = [
      ...new Set(
        [...(conversation ? [conversation] : []), ...recentConversations, ...pageConversations]
          .filter(item => item.sessionId)
          .map(item => item.workId)
      )
    ].slice(0, 10)
    setSummaries([])
    if (!ids.length) {
      setTitlesLoading(false)
      return
    }
    setTitlesLoading(true)
    void window.protectedHerald
      .conversationSummaries(ids)
      .then(items => {
        if (current) setSummaries(items)
      })
      .catch(() => {
        if (current) setSummaries(ids.map(workId => ({ workId, title: null, startedAt: null, unavailable: true })))
      })
      .finally(() => {
        if (current) setTitlesLoading(false)
      })
    return () => {
      current = false
    }
  }, [history, savedConversations, view, visiblePage, conversation?.workId])
  function summaryLabel(workId: string, index: number) {
    const item = summaries.find(entry => entry.workId === workId)
    const date = item?.startedAt
      ? new Date(item.startedAt * 1000).toLocaleString('ko-KR', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '날짜 미확인'
    return {
      title: item?.title || '새 대화',
      detail: `${date} · 기록 ${index + 1}${titlesLoading ? ' · 질문 확인 중' : item?.unavailable || !item ? ' · 질문 확인 불가' : !item.title ? ' · 질문 없음/보호됨' : ''}`
    }
  }
  const [sessionInput, setSessionInput] = useState('')
  const [reading, setReading] = useState(false)
  const selectionGeneration = useRef(0)
  const [busy, setBusy] = useState(false)
  const key = useRef(crypto.randomUUID())
  const lock = useRef(false)
  const discoveryAiLock = useRef(false)
  const [discoveryAiBusy, setDiscoveryAiBusy] = useState(false)
  const poll = useRef<StatusPoller | null>(null)
  const [revision, setRevision] = useState(0)
  function replaceState(next: HermesState | null) {
    poll.current?.stop()
    setState(next)
    setRevision(v => v + 1)
  }
  const refreshGeneration = useRef(0)
  const flow = useRef<SubmissionFlow | null>(null)
  if (!flow.current) flow.current = new SubmissionFlow(window.protectedHerald, replaceState)
  async function refresh() {
    const generation = ++refreshGeneration.current
    setChecking(true)
    setReady(false)
    setNativeImageAllowed(false)
    setDiagnosis('지젤 프로필 확인 중…')
    try {
      const nextApps = await window.protectedHerald.apps()
      if (generation !== refreshGeneration.current) return
      setApps(nextApps)
      setAppsLoaded(true)
      const profile = await window.protectedHerald.profile()
      const nextHistory = await window.protectedHerald.history()
      const nextSelections = await window.protectedHerald.selectedConversations()
      if (generation !== refreshGeneration.current) return
      setReady(profile.ready)
      setNativeImageAllowed(profile.nativeImageAllowed === true)
      setProfileCode(profile.code)
      setDiagnosis(profile.message)
      setFixtureMode(!!profile.fixtureMode)
      setHistory(nextHistory)
      setSavedConversations(nextSelections)
    } catch {
      if (generation === refreshGeneration.current) {
        setDiagnosis('목록 또는 프로필 확인 실패 · 다시 확인하거나 기존 Hermes 앱을 열어 주세요.')
        reportError('연결 진단을 완료하지 못했습니다.')
      }
    } finally {
      if (generation === refreshGeneration.current) setChecking(false)
    }
  }
  useEffect(() => {
    void refresh()
    return () => {
      ++refreshGeneration.current
      poll.current?.stop()
      flow.current?.reset()
      ++selectionGeneration.current
      ++attachmentGeneration.current
      for (const item of attachmentRef.current) void window.protectedHerald.removeAttachment(item.id).catch(() => {})
    }
  }, [])
  useEffect(() => {
    if (!state || state.status !== 'running' || busy) return
    const current = new StatusPoller(
      state.workId,
      () =>
        window.protectedHerald.request({
          action: 'status',
          workId: state.workId
        }),
      setState,
      () => reportError('상태를 확인할 수 없습니다. 같은 요청을 재전송하지 마세요.')
    )
    poll.current = current
    const timer = setInterval(() => void current.tick(), 500)
    return () => {
      current.stop()
      clearInterval(timer)
    }
  }, [state?.workId, state?.status, busy, revision])
  async function cancel() {
    const generation = selectionGeneration.current
    poll.current?.stop()
    try {
      await flow.current!.cancel()
      if (generation === selectionGeneration.current)
        setMessage('중단 요청을 전달했습니다. 결과 확인 전까지 동일 요청을 재전송하지 마세요.')
    } catch {
      if (generation === selectionGeneration.current)
        reportError('중단을 확인할 수 없습니다. 동일 요청을 재전송하지 말고 기존 Hermes 세션을 확인하세요.')
    } finally {
      if (generation === selectionGeneration.current) setRevision(v => v + 1)
    }
  }
  async function launch(app: NativeApp, purpose?: string) {
    if (launching) return
    setLaunching(app.id)
    try {
      await window.protectedHerald.launch(app.id)
      setLaunchNotice({
        app: app.name,
        text:
          purpose === 'Samantha'
            ? 'Samantha: ChatGPT 열기 요청을 macOS에 전달했습니다. 사만다 대화는 직접 선택해 주세요. 메시지는 전송하지 않았습니다.'
            : `${app.name} 열기 요청을 macOS에 전달했습니다. 보안 경고는 직접 확인해 주세요.`
      })
    } catch {
      setLaunchNotice({ app: app.name, text: `${purpose ?? app.name} 열기 실패` })
      reportError(`${purpose ?? app.name} 열기 실패. 앱 목록을 새로 확인해 주세요.`)
    } finally {
      setLaunching('')
    }
  }
  async function openConversation(workId: string, exactSession = false) {
    if (lock.current || state?.status === 'running') return
    const generation = ++selectionGeneration.current
    setReading(true)
    try {
      const selected = exactSession
        ? await window.protectedHerald.selectConversation(workId)
        : await window.protectedHerald.conversation(workId)
      const references = await window.protectedHerald.selectedConversations()
      if (generation !== selectionGeneration.current) return
      setSavedConversations(references)
      flow.current!.reset()
      setConversation(selected)
      if (selected.kind !== 'vault_context') void clearAttachments()
      setDictationNotice('')
      if (state && selected.kind !== 'vault_context') setText('')
      replaceState(null)
      setView('chat')
      key.current = crypto.randomUUID()
      setMessage(
        selected.kind === 'vault_context'
          ? '앱에 저장된 근거 실행 질문·응답입니다. 원문 근거 사본은 저장하지 않습니다. 텍스트 전용 실행이므로 일반 지젤 대화로 이어가지 않습니다.'
          : selected.canResume
            ? '선택한 지젤 대화의 최근 기록입니다. 입력 후 전송하면 이 대화를 이어갑니다.'
            : '이전 전송 결과가 불명입니다. 기록만 읽으며 이 대화에 추가 전송하지 않습니다.'
      )
    } catch (error) {
      if (generation === selectionGeneration.current)
        reportError(
          error instanceof Error &&
            (error.message.includes(SESSION_NOT_FOUND) || error.message.includes(VAULT_RECORD_UNAVAILABLE))
            ? error.message.includes(SESSION_NOT_FOUND)
              ? SESSION_NOT_FOUND
              : VAULT_RECORD_UNAVAILABLE
            : '선택한 대화를 읽지 못했습니다. 삭제·다른 프로필·정책·지원 인터페이스를 기존 Hermes 앱에서 확인하세요.'
        )
    } finally {
      if (generation === selectionGeneration.current) setReading(false)
    }
  }
  function newConversation() {
    for (const item of evidence) void window.protectedHerald.vault({ action: 'release', id: item.id })
    setEvidence([])
    setVaultConsent(false)
    if (lock.current || discoveryAiLock.current || reading || state?.status === 'running') return
    if (state) setText('')
    flow.current!.reset()
    ++selectionGeneration.current
    setReading(false)
    setConversation(null)
    void clearAttachments()
    setAttachmentNotice('')
    setDictationNotice('')
    setView('chat')
    replaceState(null)
    key.current = crypto.randomUUID()
    setMessage('새 지젤 대화입니다. 이전 요청이 불명이면 기존 Hermes 세션을 먼저 확인하세요.')
  }
  async function send() {
    if (
      lock.current ||
      discoveryAiLock.current ||
      reading ||
      (conversation && !conversation.canResume) ||
      !ready ||
      picking ||
      !composedText.trim() ||
      overLimit ||
      imageBlocked ||
      rangeBlocked ||
      (evidence.length > 0 && !vaultConsent) ||
      state?.status === 'running'
    )
      return
    poll.current?.stop()
    lock.current = true
    setBusy(true)
    try {
      await flow.current!.begin(
        text,
        key.current,
        evidence.length ? undefined : conversation?.workId,
        attachments.map(item => item.id),
        evidence.map(e => e.id)
      )
      setHistory(await window.protectedHerald.history())
    } catch {
      reportError('전송을 확인할 수 없습니다. 동일 요청은 자동으로 재시도하지 않습니다. 기존 Hermes 세션을 확인하세요.')
    } finally {
      await clearAttachments()
      lock.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    if (state?.status === 'completed' && state.events.includes('response_received')) setObservedResponse(true)
  }, [state])
  const active = discoveryAiBusy || reading || busy || picking || state?.status === 'running'
  const composedText = vaultCompose(attachmentInstructions(text, attachments), evidence)
  useEffect(() => setVaultConsent(false), [composedText])
  const overLimit = composedText.length + (evidence.length ? VAULT_SYSTEM_PROMPT.length : 0) > REQUEST_LIMIT
  const imageBlocked =
    attachments.some(item => item.kind === 'image' && item.readingMode !== 'ocr') &&
    (!nativeImageAllowed || evidence.length > 0)
  const rangeBlocked = attachments.some(item => item.rangeConfirmed === false)
  const discoveryFocusPending = useRef<'composer' | 'entry' | null>(null)
  const discoveryEntry = useRef<HTMLButtonElement>(null)
  const discoveryNav = useRef<HTMLButtonElement>(null)
  const discoveryOrigin = useRef<'entry' | 'nav'>('entry')
  useEffect(() => {
    if (view === 'chat' && discoveryFocusPending.current) {
      const target =
        discoveryFocusPending.current === 'entry'
          ? discoveryOrigin.current === 'entry'
            ? discoveryEntry.current
            : discoveryNav.current
          : composerInput.current
      target?.focus()
      discoveryFocusPending.current = null
    }
  }, [view])
  const discoveryBlocked = active
    ? '현재 요청·첨부 읽기가 진행 중입니다. 끝난 뒤 적용해 주세요.'
    : state || (conversation && !conversation.canResume)
      ? '현재 대화는 입력할 수 없습니다. UNKNOWN은 재전송하지 않고 새 대화나 계속 가능한 대화를 직접 선택해 주세요.'
      : ''
  function applyDiscovery(draft: string, previewOnly = false) {
    if (lock.current || active || state || (conversation && !conversation.canResume))
      return { ok: false, message: '대화 상태가 바뀌어 적용하지 않았습니다. 실행 중·결과 불명 기록을 확인해 주세요.' }
    const next = text + (text ? '\n\n' : '') + draft
    const count =
      vaultCompose(attachmentInstructions(next, attachments), evidence).length +
      (evidence.length ? VAULT_SYSTEM_PROMPT.length : 0)
    if (count > REQUEST_LIMIT || next.includes('\0'))
      return {
        ok: false,
        message: `기존 입력·첨부·초안 합계 ${count.toLocaleString()} / 12,000자입니다. 내용을 줄인 뒤 다시 적용해 주세요. 자르거나 덮어쓰지 않았습니다.`
      }
    if (!previewOnly) {
      setText(next)
      discoveryFocusPending.current = 'composer'
      setView('chat')
    }
    return { ok: true, message: '기존 입력 뒤에 초안을 한 번 적용했습니다. 첨부는 유지했고 전송하지 않았습니다.' }
  }
  const filteredApps = apps.filter(app => app.name.toLowerCase().includes(filter.toLowerCase()))
  const activity = state ? [state, ...history.filter(item => item.workId !== state.workId)] : history
  const needsReview = activity.filter(item => item.status !== 'completed').length
  const emptyConversation = !conversation && !state && !busy && !reading
  function addEvidence(item: VaultEvidence) {
    if (active || state || evidence.length >= 8)
      return { ok: false, message: '현재 요청/결과를 마무리하거나 근거 개수를 줄여 주세요.' }
    if (
      evidence.some(e => e.path === item.path && e.hash === item.hash && e.start === item.start && e.end === item.end)
    )
      return { ok: false, message: '이미 같은 원문 구간을 근거에 담았습니다. 중복 추가하지 않습니다.' }
    const next = [...evidence, item]
    if (vaultCompose(attachmentInstructions(text, attachments), next).length + VAULT_SYSTEM_PROMPT.length > 12000)
      return { ok: false, message: '질문·첨부·근거·구분자 합계가 12,000자를 넘습니다. 구간을 줄여 주세요.' }
    setEvidence(next)
    setVaultConsent(false)
    return { ok: true, message: '근거를 질문에 담았습니다. 아직 전송하지 않았습니다.' }
  }
  function exportDraft(body: string, label: string) {
    setVaultSeed({ text: body, label })
    setView('vault')
  }
  const composer = (
    <footer className="agent-composer">
      <div className="agent-input-wrap">
        <textarea
          ref={composerInput}
          aria-label="지젤에게 보낼 요청"
          disabled={!!state || active || (!!conversation && !conversation.canResume)}
          value={text}
          onChange={e => setText(e.target.value)}
          onSelect={e => {
            caret.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }
          }}
          onBlur={e => {
            caret.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }
          }}
          maxLength={12000}
          placeholder="지젤에게 요청을 입력하세요"
          rows={3}
          className="w-full resize-none rounded-2xl border border-line bg-panel p-4 text-sm"
        />
        <div className="agent-input-tools">
          <button
            aria-label="파일 첨부"
            title="TXT·MD·CSV·JSON · JPEG·PNG·WebP"
            disabled={active || !!state || (!!conversation && !conversation.canResume)}
            onClick={() => void pickAttachment()}
          >
            <IconPaperclip size={18} aria-hidden="true" />
          </button>
          <button
            aria-label="Typeless 음성 입력 안내"
            title="입력창 포커스 · 기존 Typeless 단축키를 직접 사용"
            disabled={active || !!state || (!!conversation && !conversation.canResume)}
            onPointerDown={event => event.preventDefault()}
            onClick={typelessInput}
          >
            <IconMicrophone size={18} aria-hidden="true" />
          </button>
        </div>
        {busy || state?.status === 'running' ? (
          <button aria-label="응답 대기 중단" onClick={() => void cancel()} className="agent-input-action agent-stop">
            <IconSquare size={16} aria-hidden="true" />
            중단
          </button>
        ) : (
          <button
            aria-label="지젤에게 전송"
            disabled={
              !!state ||
              active ||
              !ready ||
              !composedText.trim() ||
              overLimit ||
              imageBlocked ||
              rangeBlocked ||
              (evidence.length > 0 && !vaultConsent) ||
              (!!conversation && !conversation.canResume)
            }
            onClick={() => void send()}
            className="agent-input-action bg-accent text-accent-fg"
          >
            <IconArrowUp size={17} aria-hidden="true" />
            전송
          </button>
        )}
      </div>
      {!!evidence.length && (
        <div className="vault-evidence" aria-label="질문에 담은 볼트 근거">
          {evidence.map(e => (
            <div key={e.id}>
              <strong>{e.title}</strong>
              <small>
                원문 선택 {e.start}~{e.end}자
              </small>
              <details>
                <summary>선택 근거 미리보기</summary>
                <pre>{e.text}</pre>
                <small>{e.path}</small>
              </details>
              <button
                disabled={active || !!state}
                onClick={() => {
                  setEvidence(v => v.filter(x => x.id !== e.id))
                  void window.protectedHerald.vault({ action: 'release', id: e.id })
                }}
              >
                근거 제거
              </button>
            </div>
          ))}
        </div>
      )}
      {!!evidence.length && (
        <details className="vault-send-preview" open>
          <summary>실제 전송 미리보기 · 새 텍스트 전용 지젤 세션</summary>
          <textarea
            aria-label="근거 포함 실제 전송 범위"
            value={'[앱 공통 시스템 지시]\n' + VAULT_SYSTEM_PROMPT + '\n\n[사용자 질문과 선택 자료]\n' + composedText}
            readOnly
            rows={4}
          />
          <p>
            선택한 구간과 질문/텍스트 첨부만 전달 · 기억/SOUL/규칙/prefill/personality/추가 system context 제외 · 앱
            공통 지시만 사용 · 도구/자식 실행/볼트 접근 제한 · 기존 대화는 이어가지 않음 · 외부 모델 비용 발생 가능
          </p>
          <label>
            <input
              type="checkbox"
              aria-label="근거 전송 범위 확인"
              checked={vaultConsent}
              disabled={active || !!state}
              onChange={e => setVaultConsent(e.target.checked)}
            />{' '}
            이 실제 전송 범위와 새 세션을 확인했습니다. 전송 버튼을 직접 누를 때만 요청합니다.
          </label>
        </details>
      )}
      {!!attachments.length && (
        <div className="agent-attachments" aria-label="선택한 첨부 · 아직 전송하지 않음">
          {attachments.map(item => (
            <div key={item.id} className="agent-attachment">
              <div className="agent-attachment-header">
                <span>
                  {item.name} · {(item.bytes / 1024).toFixed(1)}KiB ·{' '}
                  {item.kind === 'image' ? '이미지' : '실제 텍스트 내용'}
                </span>
                <button
                  aria-label={`${item.name} 첨부 제거`}
                  disabled={active || !!state}
                  onClick={() => void removeAttachment(item.id)}
                >
                  <IconX size={14} aria-hidden="true" />
                  제거
                </button>
              </div>
              {item.kind === 'image' && <img src={item.dataUrl} alt={`${item.name} 첨부 미리보기`} />}
              {item.text !== undefined && (
                <details>
                  <summary>실제로 전송할 추출 내용 미리보기</summary>
                  <pre>{item.text}</pre>
                </details>
              )}
              {item.fullText !== undefined && (
                <div className="agent-document-range">
                  <p>
                    {item.partial
                      ? '부분 인식 · 일부 글자·언어 누락 가능'
                      : item.truncated
                        ? '일부 추출 · 안전 한도에 따른 누락 있음'
                        : '지원 영역의 텍스트 추출 완료'}{' '}
                    · {item.units?.length || 1}/{item.totalUnits || 1} 페이지·시트·슬라이드·본문 ·{' '}
                    {item.fullText.length.toLocaleString()}자
                  </p>
                  <p>
                    전송: {item.rangeStart}~{item.rangeEnd}자(0부터, 끝 제외) · 미전송{' '}
                    {item.fullText.length - (item.text?.length || 0)}자{item.truncated ? ' + 추출되지 않은 내용' : ''}
                  </p>
                  <label>
                    시작{' '}
                    <input
                      aria-label={`${item.name} 전송 시작`}
                      type="number"
                      min={0}
                      max={item.fullText.length - 1}
                      value={item.rangeStart ?? 0}
                      disabled={active || !!state}
                      onChange={e => void selectAttachmentRange(item, Number(e.target.value), item.rangeEnd!, false)}
                    />
                  </label>
                  <label>
                    끝{' '}
                    <input
                      aria-label={`${item.name} 전송 끝`}
                      type="number"
                      min={1}
                      max={item.fullText.length}
                      value={item.rangeEnd ?? item.fullText.length}
                      disabled={active || !!state}
                      onChange={e => void selectAttachmentRange(item, item.rangeStart!, Number(e.target.value), false)}
                    />
                  </label>
                  <details>
                    <summary>페이지·시트·슬라이드별 읽기 결과 / 범위 선택</summary>
                    {item.units?.map(unit => (
                      <button
                        key={`${unit.start}-${unit.label}`}
                        disabled={active || !!state || unit.end === unit.start}
                        onClick={() =>
                          void selectAttachmentRange(item, unit.start, Math.min(unit.end, unit.start + 8000), false)
                        }
                      >
                        {unit.label} · {unit.method} · {unit.start}~{unit.end}자
                      </button>
                    ))}
                  </details>
                  {item.warnings?.map(w => (
                    <p key={w}>{w}</p>
                  ))}
                  <label>
                    <input
                      aria-label={`${item.name} 전송 범위 확인`}
                      type="checkbox"
                      checked={item.rangeConfirmed === true}
                      disabled={active || !!state}
                      onChange={e =>
                        void selectAttachmentRange(item, item.rangeStart!, item.rangeEnd!, e.target.checked)
                      }
                    />{' '}
                    표시된 전송 범위와 제외된 내용을 확인했습니다.
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {(evidence.length > 0 || attachments.length > 0 || text.length > 0) && (
        <p className="agent-attachment-count" data-warning={overLimit || imageBlocked}>
          {(composedText.length + (evidence.length ? VAULT_SYSTEM_PROMPT.length : 0)).toLocaleString('ko-KR')} /
          12,000자 · 파일 제목·구분자 포함{overLimit ? ' · 한도 초과, 전송 불가' : ''}
        </p>
      )}
      {rangeBlocked && (
        <p role="status" className="agent-attachment-warning">
          긴 문서·부분 인식·일부 추출·변경된 전송 범위를 확인해야 전송할 수 있습니다. 자동 요약·분할 전송하지 않습니다.
        </p>
      )}
      {imageBlocked && (
        <p role="status" className="agent-attachment-warning">
          이미지 전송 불가 · 근거 격리 경로는 텍스트 전용이며, 일반 경로도 기존 모델 호환 확인이 필요합니다. 미리보기만
          제공하며 별도 모델·서비스로 우회하지 않습니다.
        </p>
      )}
      {attachments.some(item => item.kind === 'image' && item.readingMode !== 'ocr') && !imageBlocked && (
        <p className="agent-attachment-count">기존 모델의 직접 이미지 입력 설정 확인 · 실제 이미지 응답은 미검증</p>
      )}
      {attachmentNotice && (
        <p role="status" className="agent-attachment-warning">
          {attachmentNotice}
        </p>
      )}
      {picking && (
        <p role="status" className="agent-attachment-warning">
          파일 선택·로컬 추출 중 · OCR 최대 90초 · 외부 업로드 없음{' '}
          <button onClick={() => void cancelAttachmentRead()}>첨부 읽기 취소</button>
        </p>
      )}
      {dictationNotice && (
        <p role="status" className="agent-dictation-notice">
          {dictationNotice}
        </p>
      )}
      <div className="agent-composer-meta">
        <span role="status" className="text-xs text-fg-3">
          {busy
            ? '요청 준비 중 · 중단 가능'
            : state?.status === 'running'
              ? '응답 대기 중 · 최대 15분 · 중단 가능'
              : conversation?.kind === 'vault_context'
                ? '근거 실행 기록 · 읽기 전용 · 일반 대화 재개 없음'
                : (conversation && !conversation.canResume) || state?.status === 'unknown'
                  ? '결과 불명 · 기록만 읽기 · 추가 전송 금지'
                  : errors.length
                    ? '오류 안내를 확인하세요. 자동 재전송하지 않습니다.'
                    : '직접 전송할 때만 요청을 보냅니다.'}
        </span>
        <div className="flex gap-3">
          {state && !active && state.sessionId && (
            <button
              onClick={() => void openConversation(state.workId)}
              className="rounded-lg border border-line px-4 py-2"
            >
              {state.status === 'unknown' ? '기록만 확인' : '기록 보기·이어가기'}
            </button>
          )}
          {(conversation || state) && !active && (
            <button
              onClick={() => {
                newConversation()
                if (state) setText('')
              }}
              className="rounded-lg border border-line px-4 py-2"
            >
              새 대화
            </button>
          )}
        </div>
      </div>
    </footer>
  )
  return (
    <div className="agent-desktop flex h-screen bg-bg text-fg">
      <aside className="agent-sidebar flex shrink-0 flex-col border-r border-line">
        <header className="agent-brand">
          <HermesAvatar size={30} rounded={8} />
          <h1>Agent OS</h1>
        </header>
        <p className="agent-profile-note">{fixtureMode ? '로컬 시험 · 전송 없음' : '기존 지젤 프로필'}</p>
        <div className="agent-sidebar-context" role="region" tabIndex={0} aria-label="대화 탐색과 최근 기록">
          <nav aria-label="지젤 대화 탐색" className="agent-chat-nav">
            <button
              aria-current={view === 'chat' ? 'page' : undefined}
              onClick={() => setView('chat')}
              className="agent-nav-row"
            >
              <IconMessageCircle size={18} aria-hidden="true" />
              지젤 대화
            </button>
            <button disabled={active} onClick={newConversation} className="agent-nav-row">
              <IconPlus size={18} aria-hidden="true" />새 대화
            </button>
          </nav>
          <div className="agent-recents">
            <h2>최근 지젤 대화</h2>
            {recentConversations.map((item, index) => (
              <button
                disabled={active}
                key={item.workId}
                aria-current={conversation?.workId === item.workId ? 'true' : undefined}
                onClick={() => void openConversation(item.workId)}
                title={`${summaryLabel(item.workId, index).title}\n세션 ID: ${item.sessionId}`}
                className="agent-recent-row"
              >
                <span>{summaryLabel(item.workId, index).title}</span>
                <small>{summaryLabel(item.workId, index).detail}</small>
              </button>
            ))}
            {!history.some(item => item.sessionId) && <p>전송 기록이 아직 없습니다.</p>}
            <button
              aria-current={view === 'tasks' ? 'page' : undefined}
              className="agent-nav-row"
              onClick={() => setView('tasks')}
            >
              작업 연결·저장 경로
            </button>
            <button
              disabled={active}
              aria-current={view === 'vault' ? 'page' : undefined}
              className="agent-nav-row"
              onClick={() => setView('vault')}
            >
              Obsidian 근거와 초안
            </button>
            <button
              disabled={active}
              aria-current={view === 'discovery' ? 'page' : undefined}
              ref={discoveryNav}
              aria-label="문제 발견 열기"
              className="agent-nav-row"
              onClick={() => {
                discoveryOrigin.current = 'nav'
                setView('discovery')
              }}
            >
              <IconSparkles size={18} aria-hidden="true" />
              문제 발견
            </button>
            <button
              disabled={active}
              aria-current={view === 'conversations' ? 'page' : undefined}
              className="agent-nav-row"
              onClick={() => {
                setConversationPage(0)
                setView('conversations')
              }}
            >
              전체 대화 보기
            </button>
            <button
              disabled={active}
              aria-current={view === 'activity' ? 'page' : undefined}
              className="agent-nav-row agent-activity-link"
              onClick={() => setView('activity')}
            >
              활동 기록{needsReview > 0 && <span className="agent-review-count">확인 필요 {needsReview}</span>}
            </button>
          </div>
        </div>
        <div className="agent-sidebar-actions">
          <h2 className="agent-group-title">외부 앱 열기</h2>
          {shortcuts.map(shortcut => {
            const found = apps.find(a => a.bundleId === shortcut.bundle)
            return (
              <button
                key={shortcut.name}
                disabled={!found || !!launching}
                onClick={() => found && void launch(found, shortcut.name)}
                aria-label={shortcut.name}
                title={shortcut.detail}
                className="agent-app-row"
              >
                <shortcut.Icon size={18} aria-hidden="true" />
                <span>
                  {shortcut.name}
                  {shortcut.detail && <small className="agent-app-purpose">{shortcut.detail}</small>}
                </span>
                {found ? (
                  <IconExternalLink size={15} />
                ) : (
                  <span className="text-xs">{appsLoaded ? '미설치' : '확인 중'}</span>
                )}
              </button>
            )
          })}
          {launchNotice && (
            <p role="status" tabIndex={0} aria-label="앱 열기 결과" className="agent-launch-notice">
              {launchNotice.text}
            </p>
          )}
          <p className="agent-handoff-note">앱 열기만 · 메시지 전송 없음</p>
          <button
            aria-current={view === 'apps' ? 'page' : undefined}
            onClick={() => setView('apps')}
            className="agent-nav-row"
          >
            <IconApps size={19} />앱 실행
          </button>
          <button className="agent-quit" onClick={() => void window.protectedHerald.quit()}>
            Agent OS 종료
          </button>
        </div>
      </aside>
      <TerminalWorkspace>
        <main className="agent-stage flex min-w-0 flex-1 flex-col">
          <div className="agent-watermark" aria-hidden="true">
            Agent OS
          </div>
          <header className="flex items-center justify-between border-b border-line px-8 py-5">
            <div>
              <h2
                className="agent-current-title text-lg font-semibold"
                title={conversation && view === 'chat' ? `세션 ID: ${conversation.sessionId}` : undefined}
              >
                {view === 'chat'
                  ? conversation
                    ? summaryLabel(conversation.workId, 0).title
                    : '지젤 대화'
                  : view === 'tasks'
                    ? '작업 연결·저장 경로'
                    : view === 'vault'
                      ? 'Obsidian 근거와 초안'
                      : view === 'apps'
                        ? '앱 실행'
                        : view === 'discovery'
                          ? '문제 발견'
                          : view === 'activity'
                            ? '활동 기록'
                            : '전체 대화 보기'}
              </h2>
              <div className="agent-status-badges" aria-label="연결 상태">
                <span data-tone={ready ? 'ready' : 'neutral'}>
                  {checking ? '지젤 · 확인 중' : ready ? '지젤 · 준비' : '지젤 · 확인 필요'}
                </span>
                <span>
                  {checking
                    ? '인증 · 확인 중'
                    : ready
                      ? '인증 · 로컬 확인'
                      : profileCode === 'auth_required'
                        ? '인증 · 필요'
                        : '인증 · 미확인'}
                </span>
                <span>
                  {fixtureMode
                    ? observedResponse
                      ? '가상 응답 · 수신'
                      : '가상 응답 · 미확인'
                    : observedResponse
                      ? '이 실행의 응답 · 수신 확인'
                      : '이 실행의 응답 · 미확인'}
                </span>
              </div>
              <details className="agent-policy">
                <summary>연결 및 보호 정보</summary>
                <p>{diagnosis}</p>
                <p>
                  기존 지젤의 기억과 승인 정책을 사용합니다. 설정·인증·기억을 복사하거나 변경하지 않습니다. 시스템
                  bridge·기억 편집·직접 녹음 기능은 제공하지 않습니다.
                </p>
                <p>
                  파일 첨부는 TXT·MD·CSV·JSON의 실제 UTF-8 내용과 이미지 1개 JPEG·PNG·WebP(5MiB 이내)입니다. 텍스트
                  파일은 64KiB·전체 요청 12,000자 이내입니다. PDF·DOCX·XLSX·PPTX(16MiB)와 이미지 글자 OCR을 로컬에서
                  읽습니다. PDF 최대 40페이지·스캔 20페이지, 추출 최대 200,000자. 구형·암호화·손상·활성 콘텐츠는
                  거부합니다. 긴 문서는 표시된 범위를 확인한 뒤 전체 요청 12,000자 이내에서 전송합니다. OCR은 이미지
                  의미 분석이 아닙니다. 선택만으로 전송하지 않습니다. 이미지 모델 경로가 미확인이면 전송하지 않습니다.
                </p>
                <p>
                  마이크 버튼은 입력창 포커스와 기존 Typeless 단축키 안내만 제공합니다. 이 앱은 녹음·오디오
                  업로드·단축키 송신을 하지 않습니다.
                </p>
                <p>
                  앱 열기는 메시지 전송과 별개입니다. 앱에서 전송하거나 직접 선택한 대화 참조만 읽습니다. 제목은 첫
                  질문에서 확인하며 대화 본문을 앱에 복제하지 않습니다.
                </p>
                <p>
                  응답 수신은 작업 효과 검증이 아닙니다. 중단 뒤 일부 텍스트는 최종 응답이 아니며 결과 불명 대화는
                  기록만 읽을 수 있습니다.
                </p>
              </details>
            </div>
            <button disabled={checking} aria-label="목록과 프로필 새로 확인" onClick={() => void refresh()}>
              <IconRefresh size={19} />
            </button>
          </header>
          {errors.map(error => (
            <div key={error} role="alert" className="agent-error">
              <span>{error}</span>
              <button
                aria-label="오류 안내 확인"
                onClick={() => setErrors(items => items.filter(item => item !== error))}
              >
                확인
              </button>
            </div>
          ))}
          {!ready && !checking && (
            <div role="alert" className="border-b border-line px-8 py-3 text-xs">
              {diagnosis}
              <button onClick={() => void refresh()} className="ml-4 rounded border border-line px-3 py-2">
                다시 확인
              </button>
              {apps.find(a => a.bundleId === 'com.nousresearch.hermes') && (
                <button
                  onClick={() => void launch(apps.find(a => a.bundleId === 'com.nousresearch.hermes')!)}
                  disabled={!!launching}
                  className="ml-2 rounded border border-line px-3 py-2"
                >
                  기존 Hermes 열기
                </button>
              )}
            </div>
          )}
          <Discovery
            visible={view === 'discovery'}
            blocked={discoveryBlocked}
            target={
              conversation
                ? `선택한 지젤 대화 · ${summaryLabel(conversation.workId, 0).title}`
                : state
                  ? '현재 결과 기록 · 입력 불가'
                  : '새 지젤 대화 입력창'
            }
            onExport={body => exportDraft(body, '사용자 회고 초안 · 검토 전')}
            onClose={() => {
              discoveryFocusPending.current = 'entry'
              setView('chat')
            }}
            onApply={applyDiscovery}
            aiBlocked={!ready ? '지젤 연결 준비를 먼저 확인해 주세요.' : discoveryBlocked}
            onAiBusy={busy => {
              discoveryAiLock.current = busy
              setDiscoveryAiBusy(busy)
            }}
            onAiReserve={() => {
              if (
                lock.current ||
                discoveryAiLock.current ||
                active ||
                !ready ||
                state ||
                (conversation && !conversation.canResume)
              )
                return false
              discoveryAiLock.current = true
              setDiscoveryAiBusy(true)
              return true
            }}
          />
          <VaultPane
            visible={view === 'vault'}
            evidence={evidence}
            onEvidence={addEvidence}
            seed={vaultSeed}
            composer={composer}
            blocked={!!discoveryBlocked}
            submissionStatus={state?.status}
          />
          <TaskPanel visible={view === 'tasks'} />
          {view === 'tasks' || view === 'vault' || view === 'discovery' ? null : view === 'activity' ? (
            <section className="agent-activity flex-1 overflow-auto">
              <div className="agent-activity-heading">
                <p className="agent-context-notice">
                  전송과 결과 확인 기록입니다. 기록 열기는 요청을 다시 실행하지 않습니다.
                </p>
                <button onClick={() => setView('chat')}>활동 기록 닫기</button>
              </div>
              {needsReview > 0 && (
                <p role="status" className="agent-activity-warning">
                  확인 필요 {needsReview}건 · 결과 불명·실패·미완료 기록을 기존 Hermes에서 확인하세요. 자동 재전송하지
                  않습니다.
                </p>
              )}
              {!activity.length && <p>아직 활동 기록이 없습니다.</p>}
              {activity.map(item => (
                <button
                  disabled={active}
                  key={item.workId}
                  data-status={item.status}
                  className="agent-activity-row"
                  onClick={() => {
                    if (item.sessionId) void openConversation(item.workId)
                    else {
                      flow.current!.reset()
                      setConversation(null)
                      replaceState(item)
                      setView('chat')
                    }
                  }}
                >
                  <strong>
                    {item.status === 'completed'
                      ? '응답 수신'
                      : item.status === 'unknown'
                        ? '결과 불명 · 재전송 금지'
                        : item.status === 'failed'
                          ? '실패 · 확인 필요'
                          : '미완료 · 확인 필요'}
                  </strong>
                  <span>{item.sessionId || item.workId}</span>
                  <small>{item.reason || '기록만 확인'}</small>
                </button>
              ))}
            </section>
          ) : view === 'conversations' ? (
            <section className="agent-conversation-list flex-1 overflow-auto">
              <p className="agent-context-notice">
                앱의 최근 전송 기록과 직접 선택한 대화입니다. 선택하면 기록만 읽으며 메시지는 보내지 않습니다.
              </p>
              {!active && (
                <details className="mt-4 text-xs text-fg-3">
                  <summary>정확한 세션 ID로 대화 선택</summary>
                  <p className="mt-2">
                    Hermes에서 확인한 정확한 세션 ID를 입력하세요. giselle의 CLI·단일 요청·데스크톱·TUI 대화만 확인하며
                    아직 전송하지 않습니다.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      aria-label="기존 지젤 세션 ID"
                      value={sessionInput}
                      onChange={e => setSessionInput(e.target.value)}
                      maxLength={100}
                      placeholder="정확한 세션 ID"
                      className="min-w-0 flex-1 rounded border border-line bg-panel p-2"
                    />
                    <button
                      disabled={!sessionInput.trim()}
                      onClick={() => void openConversation(sessionInput.trim(), true)}
                      className="rounded border border-line p-2"
                    >
                      대화 확인·선택
                    </button>
                  </div>
                  {savedConversations.map(item => (
                    <button key={item.workId} onClick={() => void openConversation(item.workId)} className="mt-2 block">
                      {item.sessionId} · 선택한 대화 복원
                    </button>
                  ))}
                </details>
              )}
              {pageConversations.map((item, index) => (
                <button
                  disabled={active}
                  key={item.workId}
                  className="agent-recent-row"
                  title={`세션 ID: ${item.sessionId || '미확인'} · 참조: ${item.workId}`}
                  onClick={() => {
                    if (item.sessionId) void openConversation(item.workId)
                    else {
                      const receipt = history.find(entry => entry.workId === item.workId)
                      if (receipt) {
                        flow.current!.reset()
                        replaceState(receipt)
                        setView('chat')
                      }
                    }
                  }}
                >
                  <span>{summaryLabel(item.workId, visiblePage * 7 + index).title}</span>
                  <small>{summaryLabel(item.workId, visiblePage * 7 + index).detail}</small>
                  <small>세션: {item.sessionId || '아직 없음'}</small>
                </button>
              ))}
              {!allConversations.length && <p>표시할 대화 기록이 없습니다.</p>}
              {!!allConversations.length && (
                <nav className="agent-list-pagination" aria-label="전체 대화 목록 페이지">
                  <button disabled={active || visiblePage === 0} onClick={() => setConversationPage(visiblePage - 1)}>
                    이전 목록
                  </button>
                  <span>
                    {visiblePage + 1} / {Math.ceil(allConversations.length / 7)}
                  </span>
                  <button
                    disabled={active || (visiblePage + 1) * 7 >= allConversations.length}
                    onClick={() => setConversationPage(visiblePage + 1)}
                  >
                    다음 목록
                  </button>
                </nav>
              )}
            </section>
          ) : view === 'apps' ? (
            <div className="agent-apps overflow-auto p-8">
              {launchNotice && (
                <p role="status" className="agent-launch-notice">
                  {launchNotice.text}
                </p>
              )}
              <p className="agent-handoff-note">기존 앱을 엽니다. 메시지는 전송하지 않습니다.</p>
              <input
                aria-label="앱 검색"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="설치된 앱 검색"
                className="mb-5 w-full rounded-xl border border-line bg-bg p-3"
              />
              <div className="grid grid-cols-3 gap-3">
                {filteredApps.map(a => (
                  <button
                    disabled={!!launching}
                    key={a.id}
                    onClick={() => void launch(a)}
                    className="rounded-xl border border-line bg-panel p-4 text-left hover:bg-white/8"
                  >
                    <div>{a.name}</div>
                    <div className="mt-2 truncate text-[10px] text-fg-3">{a.bundleId}</div>
                  </button>
                ))}
              </div>
              {!apps.length && <p>확인된 앱이 없습니다. 새로 확인 버튼을 눌러 주세요.</p>}
              {!!apps.length && !filteredApps.length && <p>검색 결과가 없습니다.</p>}
            </div>
          ) : (
            <>
              <section className="flex-1 overflow-auto p-8">
                <div className="mx-auto max-w-3xl">
                  {conversation && <p className="agent-conversation-label">선택한 대화 · {conversation.sessionId}</p>}
                  {message && (
                    <p role="status" className="agent-context-notice">
                      {message}
                    </p>
                  )}
                  {emptyConversation && (
                    <div className="agent-empty">
                      <small>YOUR AGENT WORKSPACE</small>
                      <h3>무엇을 함께 실행할까요?</h3>
                      {composer}
                      <div className="agent-examples" aria-label="요청 예시 · 클릭하면 입력만 채웁니다">
                        {[
                          {
                            label: '오늘 할 일 정리',
                            text: '오늘 할 일을 함께 정리하고 싶어요. 먼저 필요한 내용을 질문해 주세요.'
                          },
                          {
                            label: '작업 계획 세우기',
                            text: '새 작업의 계획을 세워 주세요. 실행하거나 파일을 변경하기 전에 계획부터 보여 주세요.'
                          },
                          {
                            label: '내용 요약하기',
                            text: '제가 다음에 붙여 넣을 내용을 간결하게 요약해 주세요. 우선 내용을 기다려 주세요.'
                          }
                        ].map(example => (
                          <button
                            key={example.label}
                            onClick={() => {
                              setText(example.text)
                              composerInput.current?.focus()
                            }}
                          >
                            {example.label}
                          </button>
                        ))}
                      </div>
                      <button
                        ref={discoveryEntry}
                        className="agent-discovery-entry"
                        onClick={() => {
                          discoveryOrigin.current = 'entry'
                          setView('discovery')
                        }}
                      >
                        문제 발견 · 생각 정리 시작
                      </button>
                      <p className="agent-example-hint">예시를 누르면 입력만 채웁니다. 전송은 직접 눌러 주세요.</p>
                    </div>
                  )}
                  {reading && <p role="status">선택한 대화 확인 중…</p>}
                  {conversation && (
                    <article className="mt-4 rounded-2xl border border-line bg-panel p-5">
                      <p className="text-xs text-fg-3">
                        최근 최대 60개 메시지 · 60,000자 이내 · 비밀정보 가림 · 전체 기록은 Hermes에서 확인
                      </p>
                      {conversation.messages.map((item, i) => (
                        <div key={i} className="mt-4">
                          <p className="text-xs text-accent">{item.role === 'user' ? '나' : '지젤'}</p>
                          {item.role === 'assistant' ? (
                            <Result
                              text={item.text}
                              workId={conversation.workId}
                              occurrence={
                                conversation.messages
                                  .slice(0, i)
                                  .filter(m => m.role === 'assistant' && m.text === item.text).length
                              }
                              protectedResult={active || !conversation.canResume}
                              allowDraft={!active && conversation.kind === 'vault_context'}
                              onDraft={body => exportDraft(body, 'AI 답변 · 검토 전')}
                            />
                          ) : (
                            <p className="whitespace-pre-wrap text-sm leading-7">{item.text}</p>
                          )}
                        </div>
                      ))}
                      {!conversation.messages.length && <p>표시할 사용자·지젤 메시지가 없습니다.</p>}
                    </article>
                  )}
                  {busy && !state && (
                    <p role="status" className="mt-8">
                      요청 준비 중 · 중단할 수 있습니다.
                    </p>
                  )}
                  {state && (
                    <article data-state={state.status} className="mt-8 rounded-2xl border border-line bg-panel p-6">
                      <div className="mb-4 text-xs text-accent">
                        {state.status === 'completed'
                          ? '응답 수신'
                          : state.status === 'unknown'
                            ? '결과 불명 · 재전송 금지'
                            : state.status === 'running'
                              ? '지젤 응답 대기'
                              : state.status}
                      </div>
                      <Result
                        text={state.text}
                        workId={state.workId}
                        occurrence={
                          conversation?.messages.filter(m => m.role === 'assistant' && m.text === state.text).length ??
                          0
                        }
                        protectedResult={active || !['completed', 'failed'].includes(state.status)}
                        onDraft={body => exportDraft(body, 'AI 답변 · 검토 전')}
                      />
                      <p className="mt-5 text-[10px] text-fg-3">
                        세션: {state.sessionId || '아직 없음'} · {state.events.join(' → ')}
                      </p>
                      <p className="mt-2 text-xs text-fg-3">
                        응답 수신은 작업 효과 검증을 의미하지 않습니다. 중단 뒤 일부 텍스트는 최종 응답이 아닙니다.
                      </p>
                      <p role="status" className="mt-2 text-xs text-fg-3">
                        {state.reason}
                      </p>
                    </article>
                  )}
                </div>
              </section>
              {!emptyConversation && composer}
            </>
          )}
        </main>
      </TerminalWorkspace>
    </div>
  )
}
