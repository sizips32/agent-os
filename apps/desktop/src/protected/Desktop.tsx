import { useEffect, useRef, useState } from 'react'
import type { ProtectedBridge } from '../../protected/types.ts'
import './desktop.css'
import { TaskPanel } from './TaskPanel'
import { TerminalWorkspace } from './TerminalWorkspace'
import { VaultPane, type VaultSeed } from './VaultPane'
import { vaultCompose, VAULT_SYSTEM_PROMPT } from '../../protected/vault-types'
import { Composer } from './Composer'
import { useAttachments } from './useAttachments'
import { useProfile } from './useProfile'
import { useLauncher } from './useLauncher'
import { useEvidence } from './useEvidence'
import { useConversationSummaries } from './useConversationSummaries'
import { useSubmission } from './useSubmission'
import { useShortcuts } from './useShortcuts'
import { useDictationHint } from './useDictationHint'
import { useDiscoveryLink } from './useDiscoveryLink'
import { useConversations } from './useConversations'
import { AttachmentTray } from './AttachmentTray'
import { Sidebar, type View } from './Sidebar'
import { StageHeader } from './StageHeader'
import { StatusBanners } from './StatusBanners'
import { ActivityView, AppsView, ConversationListView } from './Views'
import { ChatThread } from './ChatThread'
import { EvidenceTray } from './EvidenceTray'
import { ComposerNotices } from './ComposerNotices'
import { Discovery } from './Discovery'
import { attachmentInstructions, REQUEST_LIMIT } from '../../protected/attachment-content.ts'
declare global {
  interface Window {
    protectedHerald: ProtectedBridge
  }
}
export function ProtectedDesktop() {
  const [view, setView] = useState<View>('chat')
  const [conversationPage, setConversationPage] = useState(0)
  const [filter, setFilter] = useState('')
  const [text, setText] = useState('')
  const [vaultSeed, setVaultSeed] = useState<VaultSeed | null>(null)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [sessionInput, setSessionInput] = useState('')
  const [discoveryAiBusy, setDiscoveryAiBusy] = useState(false)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const caret = useRef({ start: 0, end: 0 })
  const selection = useRef(0)
  const discoveryAiLock = useRef(false)
  function reportError(message: string) {
    setErrors(items => (items.includes(message) ? items : [...items, message]))
  }
  useShortcuts()
  const profileState = useProfile({ reportError })
  const {
    apps,
    appsLoaded,
    fixtureMode,
    diagnosis,
    checking,
    ready,
    nativeImageAllowed,
    profileCode,
    history,
    savedConversations,
    refresh
  } = profileState
  const { dictationNotice, setDictationNotice, typelessInput } = useDictationHint({ composerInput, caret, apps })
  const submission = useSubmission({ selection, reportError, onCancelled: setMessage })
  const { state, busy, observedResponse, lock, cancel } = submission
  const { launching, launchNotice, launch } = useLauncher({ reportError })
  const attachmentState = useAttachments({
    blocked: {
      pick: () => lock.current || reading || !!state,
      remove: () => lock.current || discoveryAiLock.current || reading || !!state,
      range: () => active || !!state || lock.current
    },
    reportError
  })
  const {
    attachments,
    picking,
    notice: attachmentNotice,
    setNotice: setAttachmentNotice,
    clearAttachments,
    pickAttachment,
    removeAttachment,
    cancelAttachmentRead,
    selectAttachmentRange
  } = attachmentState
  const {
    evidence,
    consent: vaultConsent,
    setConsent: setVaultConsent,
    addEvidence,
    removeEvidence,
    clearEvidence
  } = useEvidence({
    locked: () => active || !!state,
    instructions: () => attachmentInstructions(text, attachments)
  })
  const { conversation, reading, openConversation, newConversation, openActivity, openListItem } = useConversations({
    submission,
    selection,
    discoveryAiLock,
    ports: {
      setSavedConversations: profileState.setSavedConversations,
      clearEvidence,
      clearAttachments,
      clearAttachmentNotice: () => setAttachmentNotice(''),
      clearDictation: () => setDictationNotice(''),
      clearText: () => setText(''),
      showChat: () => setView('chat'),
      setMessage,
      reportError
    }
  })
  const recentConversations = history
    .filter((item, i, items) => item.sessionId && items.findIndex(other => other.sessionId === item.sessionId) === i)
    .slice(0, 3)
  const allConversations = [...history, ...savedConversations].filter(
    (item, i, items) =>
      items.findIndex(other => (other.sessionId || other.workId) === (item.sessionId || item.workId)) === i
  )
  const visiblePage = Math.min(conversationPage, Math.max(0, Math.ceil(allConversations.length / 7) - 1))
  const pageConversations = view === 'conversations' ? allConversations.slice(visiblePage * 7, visiblePage * 7 + 7) : []
  const summaryLabel = useConversationSummaries({
    history,
    savedConversations,
    view,
    visiblePage,
    conversation,
    recentConversations,
    pageConversations
  })
  useEffect(() => {
    void refresh()
    return () => {
      profileState.dispose()
      submission.dispose()
      ++selection.current
      attachmentState.dispose()
    }
  }, [])
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
    await submission.submit(
      {
        text,
        resumeWorkId: evidence.length ? undefined : conversation?.workId,
        attachmentIds: attachments.map(item => item.id),
        evidenceIds: evidence.map(e => e.id)
      },
      { reloadHistory: profileState.reloadHistory, clearAttachments }
    )
  }
  const active = discoveryAiBusy || reading || busy || picking || state?.status === 'running'
  const composedText = vaultCompose(attachmentInstructions(text, attachments), evidence)
  useEffect(() => setVaultConsent(false), [composedText])
  const overLimit = composedText.length + (evidence.length ? VAULT_SYSTEM_PROMPT.length : 0) > REQUEST_LIMIT
  const imageBlocked =
    attachments.some(item => item.kind === 'image' && item.readingMode !== 'ocr') &&
    (!nativeImageAllowed || evidence.length > 0)
  const rangeBlocked = attachments.some(item => item.rangeConfirmed === false)
  const discovery = useDiscoveryLink({
    view,
    setView,
    composerInput,
    text,
    setText,
    attachments,
    evidence,
    state,
    conversation,
    ready,
    active,
    lock,
    aiLock: discoveryAiLock,
    setAiBusy: setDiscoveryAiBusy
  })
  const filteredApps = apps.filter(app => app.name.toLowerCase().includes(filter.toLowerCase()))
  const activity = state ? [state, ...history.filter(item => item.workId !== state.workId)] : history
  const needsReview = activity.filter(item => item.status !== 'completed').length
  const emptyConversation = !conversation && !state && !busy && !reading
  function exportDraft(body: string, label: string) {
    setVaultSeed({ text: body, label })
    setView('vault')
  }
  const canSend =
    ready &&
    !!composedText.trim() &&
    !overLimit &&
    !imageBlocked &&
    !rangeBlocked &&
    !(evidence.length > 0 && !vaultConsent)
  const composer = (
    <Composer
      text={text}
      composerInput={composerInput}
      caret={caret}
      state={state}
      active={active}
      busy={busy}
      conversation={conversation}
      canSend={canSend}
      errorCount={errors.length}
      onText={setText}
      onPick={() => void pickAttachment()}
      onTypeless={typelessInput}
      onCancel={() => void cancel()}
      onSend={() => void send()}
      onOpenConversation={workId => void openConversation(workId)}
      onNewConversation={() => {
        newConversation()
        if (state) setText('')
      }}
    >
      <EvidenceTray
        evidence={evidence}
        locked={active || !!state}
        consent={vaultConsent}
        composedText={composedText}
        onRemove={removeEvidence}
        onConsent={setVaultConsent}
      />
      <AttachmentTray
        attachments={attachments}
        locked={active || !!state}
        onRemove={id => void removeAttachment(id)}
        onRange={(item, start, end, confirmed) => void selectAttachmentRange(item, start, end, confirmed)}
      />
      <ComposerNotices
        evidence={evidence}
        attachments={attachments}
        text={text}
        composedText={composedText}
        overLimit={overLimit}
        imageBlocked={imageBlocked}
        rangeBlocked={rangeBlocked}
        attachmentNotice={attachmentNotice}
        picking={picking}
        dictationNotice={dictationNotice}
        onCancelRead={() => void cancelAttachmentRead()}
      />
    </Composer>
  )
  return (
    <div className="agent-desktop flex h-screen bg-bg text-fg">
      <Sidebar
        fixtureMode={fixtureMode}
        view={view}
        active={active}
        needsReview={needsReview}
        recentConversations={recentConversations}
        history={history}
        conversation={conversation}
        apps={apps}
        appsLoaded={appsLoaded}
        launching={launching}
        launchNotice={launchNotice}
        discoveryNav={discovery.nav}
        summaryLabel={summaryLabel}
        onView={setView}
        onNewConversation={newConversation}
        onOpenConversation={workId => void openConversation(workId)}
        onDiscovery={discovery.openFromNav}
        onAllConversations={() => {
          setConversationPage(0)
          setView('conversations')
        }}
        onLaunch={(app, purpose) => void launch(app, purpose)}
      />
      <TerminalWorkspace>
        <main className="agent-stage flex min-w-0 flex-1 flex-col">
          <div className="agent-watermark" aria-hidden="true">
            Agent OS
          </div>
          <StageHeader
            view={view}
            conversation={conversation}
            ready={ready}
            checking={checking}
            profileCode={profileCode}
            fixtureMode={fixtureMode}
            observedResponse={observedResponse}
            diagnosis={diagnosis}
            summaryLabel={summaryLabel}
            onRefresh={() => void refresh()}
          />
          <StatusBanners
            errors={errors}
            ready={ready}
            checking={checking}
            diagnosis={diagnosis}
            apps={apps}
            launching={launching}
            onDismiss={error => setErrors(items => items.filter(item => item !== error))}
            onRefresh={() => void refresh()}
            onLaunch={app => void launch(app)}
          />
          <Discovery
            visible={view === 'discovery'}
            blocked={discovery.blocked}
            target={
              conversation
                ? `선택한 지젤 대화 · ${summaryLabel(conversation.workId, 0).title}`
                : state
                  ? '현재 결과 기록 · 입력 불가'
                  : '새 지젤 대화 입력창'
            }
            onExport={body => exportDraft(body, '사용자 회고 초안 · 검토 전')}
            onClose={discovery.close}
            onApply={discovery.apply}
            aiBlocked={!ready ? '지젤 연결 준비를 먼저 확인해 주세요.' : discovery.blocked}
            onAiBusy={discovery.onAiBusy}
            onAiReserve={discovery.onAiReserve}
          />
          <VaultPane
            visible={view === 'vault'}
            evidence={evidence}
            onEvidence={addEvidence}
            seed={vaultSeed}
            composer={composer}
            blocked={!!discovery.blocked}
            submissionStatus={state?.status}
          />
          <TaskPanel visible={view === 'tasks'} />
          {view === 'tasks' || view === 'vault' || view === 'discovery' ? null : view === 'activity' ? (
            <ActivityView
              activity={activity}
              needsReview={needsReview}
              active={active}
              onClose={() => setView('chat')}
              onOpen={openActivity}
            />
          ) : view === 'conversations' ? (
            <ConversationListView
              active={active}
              sessionInput={sessionInput}
              savedConversations={savedConversations}
              pageConversations={pageConversations}
              allConversations={allConversations}
              visiblePage={visiblePage}
              summaryLabel={summaryLabel}
              onSessionInput={setSessionInput}
              onOpen={(workId, exact) => void openConversation(workId, exact)}
              onOpenItem={item => openListItem(item, history)}
              onPage={setConversationPage}
            />
          ) : view === 'apps' ? (
            <AppsView
              apps={apps}
              filteredApps={filteredApps}
              filter={filter}
              launching={launching}
              launchNotice={launchNotice}
              onFilter={setFilter}
              onLaunch={app => void launch(app)}
            />
          ) : (
            <>
              <ChatThread
                conversation={conversation}
                message={message}
                emptyConversation={emptyConversation}
                composer={composer}
                discoveryEntry={discovery.entry}
                reading={reading}
                busy={busy}
                state={state}
                active={active}
                onExample={example => {
                  setText(example)
                  composerInput.current?.focus()
                }}
                onDiscoveryEntry={discovery.openFromEntry}
                onExport={exportDraft}
              />
              {!emptyConversation && composer}
            </>
          )}
        </main>
      </TerminalWorkspace>
    </div>
  )
}
