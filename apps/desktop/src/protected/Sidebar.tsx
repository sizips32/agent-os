import {
  IconApps,
  IconExternalLink,
  IconMessageCircle,
  IconPlus,
  IconRobot,
  IconSparkles,
  IconBolt,
  IconWaveSine
} from '@tabler/icons-react'
import type { RefObject } from 'react'
import { HermesAvatar } from '../components/app-icon.tsx'
import type { Conversation, HermesState, NativeApp } from '../../protected/types.ts'

export type View = 'chat' | 'apps' | 'conversations' | 'activity' | 'discovery' | 'vault' | 'tasks'

export const shortcuts = [
  { name: 'Samantha', bundle: 'com.openai.codex', Icon: IconMessageCircle, detail: '앱 열기 · 대화 직접 선택' },
  { name: 'Hermes', bundle: 'com.nousresearch.hermes', Icon: IconRobot },
  { name: 'Buzz', bundle: 'xyz.block.buzz.app', Icon: IconWaveSine },
  { name: 'Muse', bundle: 'com.meta.endo', Icon: IconSparkles },
  { name: 'Grok Bot', bundle: 'com.anysphere.sand', Icon: IconBolt }
]

export function Sidebar({
  fixtureMode,
  view,
  active,
  needsReview,
  recentConversations,
  history,
  conversation,
  apps,
  appsLoaded,
  launching,
  launchNotice,
  discoveryNav,
  summaryLabel,
  onView,
  onNewConversation,
  onOpenConversation,
  onDiscovery,
  onAllConversations,
  onLaunch
}: {
  fixtureMode: boolean
  view: View
  active: boolean
  needsReview: number
  recentConversations: HermesState[]
  history: HermesState[]
  conversation: Conversation | null
  apps: NativeApp[]
  appsLoaded: boolean
  launching: string
  launchNotice: { app: string; text: string } | null
  discoveryNav: RefObject<HTMLButtonElement | null>
  summaryLabel: (workId: string, index: number) => { title: string; detail: string }
  onView: (view: View) => void
  onNewConversation: () => void
  onOpenConversation: (workId: string) => void
  onDiscovery: () => void
  onAllConversations: () => void
  onLaunch: (app: NativeApp, purpose?: string) => void
}) {
  return (
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
            onClick={() => onView('chat')}
            className="agent-nav-row"
          >
            <IconMessageCircle size={18} aria-hidden="true" />
            지젤 대화
          </button>
          <button
            disabled={active}
            data-shortcut="new"
            title="새 대화 (⌘N)"
            onClick={onNewConversation}
            className="agent-nav-row"
          >
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
              onClick={() => onOpenConversation(item.workId)}
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
            onClick={() => onView('tasks')}
          >
            작업 연결·저장 경로
          </button>
          <button
            disabled={active}
            aria-current={view === 'vault' ? 'page' : undefined}
            data-shortcut="vault"
            title="Obsidian 근거 검색 (⌘K)"
            className="agent-nav-row"
            onClick={() => onView('vault')}
          >
            Obsidian 근거와 초안
          </button>
          <button
            disabled={active}
            aria-current={view === 'discovery' ? 'page' : undefined}
            ref={discoveryNav}
            aria-label="문제 발견 열기"
            className="agent-nav-row"
            onClick={onDiscovery}
          >
            <IconSparkles size={18} aria-hidden="true" />
            문제 발견
          </button>
          <button
            disabled={active}
            aria-current={view === 'conversations' ? 'page' : undefined}
            className="agent-nav-row"
            onClick={onAllConversations}
          >
            전체 대화 보기
          </button>
          <button
            disabled={active}
            aria-current={view === 'activity' ? 'page' : undefined}
            className="agent-nav-row agent-activity-link"
            onClick={() => onView('activity')}
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
              onClick={() => found && onLaunch(found, shortcut.name)}
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
          onClick={() => onView('apps')}
          className="agent-nav-row"
        >
          <IconApps size={19} />앱 실행
        </button>
        <button className="agent-quit" onClick={() => void window.protectedHerald.quit()}>
          Agent OS 종료
        </button>
      </div>
    </aside>
  )
}
