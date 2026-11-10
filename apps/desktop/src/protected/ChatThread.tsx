import type { ReactNode, RefObject } from 'react'
import type { Conversation, HermesState } from '../../protected/types.ts'
import { Result } from './Result'

export function ChatThread({
  conversation,
  message,
  emptyConversation,
  composer,
  discoveryEntry,
  reading,
  busy,
  state,
  active,
  onExample,
  onDiscoveryEntry,
  onExport
}: {
  conversation: Conversation | null
  message: string
  emptyConversation: boolean
  composer: ReactNode
  discoveryEntry: RefObject<HTMLButtonElement | null>
  reading: boolean
  busy: boolean
  state: HermesState | null
  active: boolean
  onExample: (text: string) => void
  onDiscoveryEntry: () => void
  onExport: (body: string, label: string) => void
}) {
  return (
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
                <button key={example.label} onClick={() => onExample(example.text)}>
                  {example.label}
                </button>
              ))}
            </div>
            <button ref={discoveryEntry} className="agent-discovery-entry" onClick={onDiscoveryEntry}>
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
                      conversation.messages.slice(0, i).filter(m => m.role === 'assistant' && m.text === item.text)
                        .length
                    }
                    protectedResult={active || !conversation.canResume}
                    allowDraft={!active && conversation.kind === 'vault_context'}
                    onDraft={body => onExport(body, 'AI 답변 · 검토 전')}
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
                conversation?.messages.filter(m => m.role === 'assistant' && m.text === state.text).length ?? 0
              }
              protectedResult={active || !['completed', 'failed'].includes(state.status)}
              onDraft={body => onExport(body, 'AI 답변 · 검토 전')}
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
  )
}
