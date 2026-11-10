import { IconRefresh } from '@tabler/icons-react'
import type { Conversation } from '../../protected/types.ts'
import type { View } from './Sidebar.tsx'

export function StageHeader({
  view,
  conversation,
  ready,
  checking,
  profileCode,
  fixtureMode,
  observedResponse,
  diagnosis,
  summaryLabel,
  onRefresh
}: {
  view: View
  conversation: Conversation | null
  ready: boolean
  checking: boolean
  profileCode: string
  fixtureMode: boolean
  observedResponse: boolean
  diagnosis: string
  summaryLabel: (workId: string, index: number) => { title: string; detail: string }
  onRefresh: () => void
}) {
  return (
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
            기존 지젤의 기억과 승인 정책을 사용합니다. 설정·인증·기억을 복사하거나 변경하지 않습니다. 시스템 bridge·기억
            편집·직접 녹음 기능은 제공하지 않습니다.
          </p>
          <p>
            파일 첨부는 TXT·MD·CSV·JSON의 실제 UTF-8 내용과 이미지 1개 JPEG·PNG·WebP(5MiB 이내)입니다. 텍스트 파일은
            64KiB·전체 요청 12,000자 이내입니다. PDF·DOCX·XLSX·PPTX(16MiB)와 이미지 글자 OCR을 로컬에서 읽습니다. PDF
            최대 40페이지·스캔 20페이지, 추출 최대 200,000자. 구형·암호화·손상·활성 콘텐츠는 거부합니다. 긴 문서는
            표시된 범위를 확인한 뒤 전체 요청 12,000자 이내에서 전송합니다. OCR은 이미지 의미 분석이 아닙니다.
            선택만으로 전송하지 않습니다. 이미지 모델 경로가 미확인이면 전송하지 않습니다.
          </p>
          <p>
            마이크 버튼은 입력창 포커스와 기존 Typeless 단축키 안내만 제공합니다. 이 앱은 녹음·오디오 업로드·단축키
            송신을 하지 않습니다.
          </p>
          <p>
            앱 열기는 메시지 전송과 별개입니다. 앱에서 전송하거나 직접 선택한 대화 참조만 읽습니다. 제목은 첫 질문에서
            확인하며 대화 본문을 앱에 복제하지 않습니다.
          </p>
          <p>
            응답 수신은 작업 효과 검증이 아닙니다. 중단 뒤 일부 텍스트는 최종 응답이 아니며 결과 불명 대화는 기록만 읽을
            수 있습니다.
          </p>
        </details>
      </div>
      <button disabled={checking} aria-label="목록과 프로필 새로 확인" onClick={() => onRefresh()}>
        <IconRefresh size={19} />
      </button>
    </header>
  )
}
