import { IconX } from '@tabler/icons-react'
import type { AttachmentPreview } from '../../protected/types.ts'

export function AttachmentTray({
  attachments,
  locked,
  onRemove,
  onRange
}: {
  attachments: AttachmentPreview[]
  locked: boolean
  onRemove: (id: string) => void
  onRange: (item: AttachmentPreview, start: number, end: number, confirmed: boolean) => void
}) {
  return (
    <>
      {!!attachments.length && (
        <div className="agent-attachments" aria-label="선택한 첨부 · 아직 전송하지 않음">
          {attachments.map(item => (
            <div key={item.id} className="agent-attachment">
              <div className="agent-attachment-header">
                <span>
                  {item.name} · {(item.bytes / 1024).toFixed(1)}KiB ·{' '}
                  {item.kind === 'image' ? '이미지' : '실제 텍스트 내용'}
                </span>
                <button aria-label={`${item.name} 첨부 제거`} disabled={locked} onClick={() => onRemove(item.id)}>
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
                      disabled={locked}
                      onChange={e => void onRange(item, Number(e.target.value), item.rangeEnd!, false)}
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
                      disabled={locked}
                      onChange={e => void onRange(item, item.rangeStart!, Number(e.target.value), false)}
                    />
                  </label>
                  <details>
                    <summary>페이지·시트·슬라이드별 읽기 결과 / 범위 선택</summary>
                    {item.units?.map(unit => (
                      <button
                        key={`${unit.start}-${unit.label}`}
                        disabled={locked || unit.end === unit.start}
                        onClick={() => void onRange(item, unit.start, Math.min(unit.end, unit.start + 8000), false)}
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
                      disabled={locked}
                      onChange={e => void onRange(item, item.rangeStart!, item.rangeEnd!, e.target.checked)}
                    />{' '}
                    표시된 전송 범위와 제외된 내용을 확인했습니다.
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
