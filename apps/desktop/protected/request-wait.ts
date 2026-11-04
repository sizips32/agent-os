// Analysis/tool/delegation work can legitimately outlast a short chat response.
// The two-minute notice does not cancel or retry; explicit stop remains available.
export const LONG_REQUEST_NOTICE_MS = 2 * 60 * 1000
export const REQUEST_TIMEOUT_MS = 15 * 60 * 1000
export const longRequestReason = '지젤의 분석·도구 응답 대기가 길어지고 있습니다. 최대 15분까지 기다리며 중단할 수 있습니다. 요청을 다시 보내지 마세요.'
export const timeoutReason = '앱의 요청 대기 시간 제한에 도달했습니다. 이미 실행된 작업과 결과는 불명입니다. 기존 Hermes 세션을 확인하고 재전송하지 마세요.'
export const interruptedReason = '중단되거나 종료된 요청입니다. 이미 실행된 작업은 취소됐다고 보장할 수 없습니다. 기존 Hermes 세션을 확인하고 재전송하지 마세요.'
