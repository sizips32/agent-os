import { VAULT_SYSTEM_PROMPT, type VaultEvidence } from '../../protected/vault-types'

export function EvidenceTray({
  evidence,
  locked,
  consent,
  composedText,
  onRemove,
  onConsent
}: {
  evidence: VaultEvidence[]
  locked: boolean
  consent: boolean
  composedText: string
  onRemove: (id: string) => void
  onConsent: (checked: boolean) => void
}) {
  return (
    <>
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
              <button disabled={locked} onClick={() => onRemove(e.id)}>
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
              checked={consent}
              disabled={locked}
              onChange={e => onConsent(e.target.checked)}
            />{' '}
            이 실제 전송 범위와 새 세션을 확인했습니다. 전송 버튼을 직접 누를 때만 요청합니다.
          </label>
        </details>
      )}
    </>
  )
}
