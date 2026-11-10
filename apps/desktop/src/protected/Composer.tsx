import { IconArrowUp, IconMicrophone, IconPaperclip, IconSquare } from '@tabler/icons-react'
import type { ReactNode, RefObject } from 'react'
import type { Conversation, HermesState } from '../../protected/types.ts'

export function Composer({
  text,
  composerInput,
  caret,
  state,
  active,
  busy,
  conversation,
  canSend,
  errorCount,
  onText,
  onPick,
  onTypeless,
  onCancel,
  onSend,
  onOpenConversation,
  onNewConversation,
  children
}: {
  text: string
  composerInput: RefObject<HTMLTextAreaElement | null>
  caret: RefObject<{ start: number; end: number }>
  state: HermesState | null
  active: boolean
  busy: boolean
  conversation: Conversation | null
  /** Request is complete and within limits; the component adds state/conversation guards. */
  canSend: boolean
  errorCount: number
  onText: (value: string) => void
  onPick: () => void
  onTypeless: () => void
  onCancel: () => void
  onSend: () => void
  onOpenConversation: (workId: string) => void
  onNewConversation: () => void
  children: ReactNode
}) {
  return (
    <footer className="agent-composer">
      <div className="agent-input-wrap">
        <textarea
          ref={composerInput}
          aria-label="지젤에게 보낼 요청"
          disabled={!!state || active || (!!conversation && !conversation.canResume)}
          value={text}
          onChange={e => onText(e.target.value)}
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
            onClick={() => onPick()}
          >
            <IconPaperclip size={18} aria-hidden="true" />
          </button>
          <button
            aria-label="Typeless 음성 입력 안내"
            title="입력창 포커스 · 기존 Typeless 단축키를 직접 사용"
            disabled={active || !!state || (!!conversation && !conversation.canResume)}
            onPointerDown={event => event.preventDefault()}
            onClick={onTypeless}
          >
            <IconMicrophone size={18} aria-hidden="true" />
          </button>
        </div>
        {busy || state?.status === 'running' ? (
          <button
            aria-label="응답 대기 중단"
            data-shortcut="stop"
            title="중단 (⌘.)"
            onClick={() => onCancel()}
            className="agent-input-action agent-stop"
          >
            <IconSquare size={16} aria-hidden="true" />
            중단
          </button>
        ) : (
          <button
            aria-label="지젤에게 전송"
            data-shortcut="send"
            title="전송 (⌘Enter)"
            disabled={!!state || active || !canSend || (!!conversation && !conversation.canResume)}
            onClick={() => onSend()}
            className="agent-input-action bg-accent text-accent-fg"
          >
            <IconArrowUp size={17} aria-hidden="true" />
            전송
          </button>
        )}
      </div>
      {children}
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
                  : errorCount > 0
                    ? '오류 안내를 확인하세요. 자동 재전송하지 않습니다.'
                    : '직접 전송할 때만 요청을 보냅니다.'}
        </span>
        <div className="flex gap-3">
          {state && !active && state.sessionId && (
            <button
              onClick={() => onOpenConversation(state.workId)}
              className="rounded-lg border border-line px-4 py-2"
            >
              {state.status === 'unknown' ? '기록만 확인' : '기록 보기·이어가기'}
            </button>
          )}
          {(conversation || state) && !active && (
            <button onClick={onNewConversation} className="rounded-lg border border-line px-4 py-2">
              새 대화
            </button>
          )}
        </div>
      </div>
    </footer>
  )
}
