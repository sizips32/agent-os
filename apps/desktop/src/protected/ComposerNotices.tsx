import { VAULT_SYSTEM_PROMPT, type VaultEvidence } from '../../protected/vault-types'
import type { AttachmentPreview } from '../../protected/types.ts'

export function ComposerNotices({
  evidence,
  attachments,
  text,
  composedText,
  overLimit,
  imageBlocked,
  rangeBlocked,
  attachmentNotice,
  picking,
  dictationNotice,
  onCancelRead
}: {
  evidence: VaultEvidence[]
  attachments: AttachmentPreview[]
  text: string
  composedText: string
  overLimit: boolean
  imageBlocked: boolean
  rangeBlocked: boolean
  attachmentNotice: string
  picking: boolean
  dictationNotice: string
  onCancelRead: () => void
}) {
  return (
    <>
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
          <button onClick={() => onCancelRead()}>첨부 읽기 취소</button>
        </p>
      )}
      {dictationNotice && (
        <p role="status" className="agent-dictation-notice">
          {dictationNotice}
        </p>
      )}
    </>
  )
}
