import type { HermesState, NativeApp } from '../../protected/types.ts'

type ConversationRef = { workId: string; sessionId: string }
type Label = (workId: string, index: number) => { title: string; detail: string }

export function ActivityView({
  activity,
  needsReview,
  active,
  onClose,
  onOpen
}: {
  activity: HermesState[]
  needsReview: number
  active: boolean
  onClose: () => void
  onOpen: (item: HermesState) => void
}) {
  return (
    <section className="agent-activity flex-1 overflow-auto">
      <div className="agent-activity-heading">
        <p className="agent-context-notice">전송과 결과 확인 기록입니다. 기록 열기는 요청을 다시 실행하지 않습니다.</p>
        <button onClick={onClose}>활동 기록 닫기</button>
      </div>
      {needsReview > 0 && (
        <p role="status" className="agent-activity-warning">
          확인 필요 {needsReview}건 · 결과 불명·실패·미완료 기록을 기존 Hermes에서 확인하세요. 자동 재전송하지 않습니다.
        </p>
      )}
      {!activity.length && <p>아직 활동 기록이 없습니다.</p>}
      {activity.map(item => (
        <button
          disabled={active}
          key={item.workId}
          data-status={item.status}
          className="agent-activity-row"
          onClick={() => onOpen(item)}
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
  )
}

export function ConversationListView({
  active,
  sessionInput,
  savedConversations,
  pageConversations,
  allConversations,
  visiblePage,
  summaryLabel,
  onSessionInput,
  onOpen,
  onOpenItem,
  onPage
}: {
  active: boolean
  sessionInput: string
  savedConversations: { workId: string; sessionId: string }[]
  pageConversations: ConversationRef[]
  allConversations: ConversationRef[]
  visiblePage: number
  summaryLabel: Label
  onSessionInput: (value: string) => void
  onOpen: (workId: string, exactSession?: boolean) => void
  onOpenItem: (item: ConversationRef) => void
  onPage: (page: number) => void
}) {
  return (
    <section className="agent-conversation-list flex-1 overflow-auto">
      <p className="agent-context-notice">
        앱의 최근 전송 기록과 직접 선택한 대화입니다. 선택하면 기록만 읽으며 메시지는 보내지 않습니다.
      </p>
      {!active && (
        <details className="mt-4 text-xs text-fg-3">
          <summary>정확한 세션 ID로 대화 선택</summary>
          <p className="mt-2">
            Hermes에서 확인한 정확한 세션 ID를 입력하세요. giselle의 CLI·단일 요청·데스크톱·TUI 대화만 확인하며 아직
            전송하지 않습니다.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              aria-label="기존 지젤 세션 ID"
              value={sessionInput}
              onChange={e => onSessionInput(e.target.value)}
              maxLength={100}
              placeholder="정확한 세션 ID"
              className="min-w-0 flex-1 rounded border border-line bg-panel p-2"
            />
            <button
              disabled={!sessionInput.trim()}
              onClick={() => onOpen(sessionInput.trim(), true)}
              className="rounded border border-line p-2"
            >
              대화 확인·선택
            </button>
          </div>
          {savedConversations.map(item => (
            <button key={item.workId} onClick={() => onOpen(item.workId)} className="mt-2 block">
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
          onClick={() => onOpenItem(item)}
        >
          <span>{summaryLabel(item.workId, visiblePage * 7 + index).title}</span>
          <small>{summaryLabel(item.workId, visiblePage * 7 + index).detail}</small>
          <small>세션: {item.sessionId || '아직 없음'}</small>
        </button>
      ))}
      {!allConversations.length && <p>표시할 대화 기록이 없습니다.</p>}
      {!!allConversations.length && (
        <nav className="agent-list-pagination" aria-label="전체 대화 목록 페이지">
          <button disabled={active || visiblePage === 0} onClick={() => onPage(visiblePage - 1)}>
            이전 목록
          </button>
          <span>
            {visiblePage + 1} / {Math.ceil(allConversations.length / 7)}
          </span>
          <button
            disabled={active || (visiblePage + 1) * 7 >= allConversations.length}
            onClick={() => onPage(visiblePage + 1)}
          >
            다음 목록
          </button>
        </nav>
      )}
    </section>
  )
}

export function AppsView({
  apps,
  filteredApps,
  filter,
  launching,
  launchNotice,
  onFilter,
  onLaunch
}: {
  apps: NativeApp[]
  filteredApps: NativeApp[]
  filter: string
  launching: string
  launchNotice: { app: string; text: string } | null
  onFilter: (value: string) => void
  onLaunch: (app: NativeApp) => void
}) {
  return (
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
        onChange={e => onFilter(e.target.value)}
        placeholder="설치된 앱 검색"
        className="mb-5 w-full rounded-xl border border-line bg-bg p-3"
      />
      <div className="grid grid-cols-3 gap-3">
        {filteredApps.map(a => (
          <button
            disabled={!!launching}
            key={a.id}
            onClick={() => onLaunch(a)}
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
  )
}
