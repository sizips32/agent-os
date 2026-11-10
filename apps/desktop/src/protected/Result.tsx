import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProtectedBridge } from '../../protected/types'
import { Markdown } from './Markdown'
import { isPlain, parseMarkdown } from './markdown-parse'
export function Result({
  text,
  workId,
  occurrence = 0,
  protectedResult = false,
  allowDraft = false,
  onDraft
}: {
  text: string
  workId: string
  occurrence?: number
  protectedResult?: boolean
  allowDraft?: boolean
  onDraft?: (text: string) => void
}) {
  const body = useRef<HTMLDivElement>(null),
    alive = useRef(true),
    copyLock = useRef(false)
  const [selection, setSelection] = useState(''),
    [hidden, setHidden] = useState(false),
    [loaded, setLoaded] = useState(false),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [raw, setRaw] = useState(false)
  // Rendering is display only: copy-all, drafts and hiding keep using the original `text`.
  const blocks = useMemo(() => parseMarkdown(text), [text])
  const rich = !!text && !isPlain(blocks)
  const identity = useRef({ text, workId, occurrence })
  identity.current = { text, workId, occurrence }
  const bridge = () => window.protectedHerald as ProtectedBridge
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    let current = true
    setLoaded(false)
    setHidden(false)
    setConfirm(false)
    setSelection('')
    setNotice('')
    setRaw(false)
    if (!text) return
    void bridge()
      .resultControl({ action: 'load', workId, text, occurrence })
      .then(v => {
        if (current) {
          setHidden(v.hidden)
          setLoaded(true)
        }
      })
      .catch(() => {
        if (current) setNotice('결과 숨김 상태를 확인하지 못했습니다. 복사는 가능하며 삭제는 보류합니다.')
      })
    return () => {
      current = false
    }
  }, [text, workId, occurrence])
  useEffect(() => {
    function selected() {
      const s = window.getSelection(),
        el = body.current
      setSelection(
        s &&
          el &&
          !s.isCollapsed &&
          s.anchorNode &&
          s.focusNode &&
          el.contains(s.anchorNode) &&
          el.contains(s.focusNode)
          ? s.toString()
          : ''
      )
    }
    document.addEventListener('selectionchange', selected)
    return () => document.removeEventListener('selectionchange', selected)
  }, [hidden])
  async function copy(part: boolean) {
    const selected = window.getSelection(),
      el = body.current
    const valid =
      selected &&
      el &&
      !selected.isCollapsed &&
      selected.anchorNode &&
      selected.focusNode &&
      el.contains(selected.anchorNode) &&
      el.contains(selected.focusNode)
    const value = part ? (valid ? selected!.toString() : '') : text
    if (!value || copyLock.current) return
    copyLock.current = true
    try {
      await bridge().copyResult(value)
      if (alive.current) setNotice(part ? '선택한 부분을 복사했습니다.' : '결과 전체를 복사했습니다.')
    } catch {
      if (alive.current) setNotice('복사하지 못했습니다. 결과를 선택하고 ⌘C로 복사해 주세요.')
    } finally {
      copyLock.current = false
    }
  }
  async function visibility(action: 'hide' | 'restore') {
    if (busy || !loaded || (action === 'hide' && protectedResult)) return
    const before = identity.current
    setBusy(true)
    try {
      const v = await bridge().resultControl({ action, ...before })
      if (
        alive.current &&
        identity.current.text === before.text &&
        identity.current.workId === before.workId &&
        identity.current.occurrence === before.occurrence
      ) {
        setHidden(v.hidden)
        setConfirm(false)
        setNotice(
          v.hidden ? '이 결과만 앱에서 숨겼습니다. 원본 대화·실행 기록은 그대로입니다.' : '결과 숨김을 되돌렸습니다.'
        )
      }
    } catch {
      if (alive.current) setNotice('숨김 변경을 저장하지 못했습니다. 기존 결과와 입력은 유지됩니다.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <div className="agent-result" aria-label="지젤 결과">
      {hidden && !protectedResult ? (
        <div className="agent-result-hidden">
          <p>
            이 결과는 이 앱의 해당 작업 보기에서 숨겨져 있습니다. 재시작 후에도 유지하며 Hermes 원본은 삭제하지
            않습니다.
          </p>
          <button disabled={busy} onClick={() => void visibility('restore')}>
            결과 삭제 되돌리기
          </button>
        </div>
      ) : (
        <>
          <div ref={body} className="agent-result-body">
            {rich && !raw ? (
              <div tabIndex={0} aria-label="복사할 지젤 결과" className="agent-result-md">
                <Markdown blocks={blocks} />
              </div>
            ) : (
              <pre tabIndex={0} aria-label="복사할 지젤 결과" className="agent-result-text">
                {text || '아직 확인된 응답이 없습니다.'}
              </pre>
            )}
          </div>
          {text && (
            <div className="agent-result-actions">
              {rich && (
                <button
                  aria-pressed={raw}
                  disabled={busy}
                  onClick={() => {
                    setRaw(v => !v)
                    setSelection('')
                  }}
                >
                  {raw ? '서식 보기' : '원문 보기'}
                </button>
              )}
              <button disabled={busy} onClick={() => void copy(false)}>
                결과 전체 복사
              </button>
              <button
                disabled={!selection || busy}
                onPointerDown={e => e.preventDefault()}
                onMouseDown={e => e.preventDefault()}
                onClick={() => void copy(true)}
              >
                선택 부분 복사
              </button>
              {onDraft && (
                <>
                  <button disabled={busy || (protectedResult && !allowDraft)} onClick={() => onDraft(text)}>
                    결과 전체를 INBOX 초안으로
                  </button>
                  <button
                    disabled={busy || (protectedResult && !allowDraft) || !selection}
                    onPointerDown={e => e.preventDefault()}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      const s = window.getSelection()
                      if (
                        s &&
                        !s.isCollapsed &&
                        body.current?.contains(s.anchorNode) &&
                        body.current.contains(s.focusNode)
                      )
                        onDraft(s.toString())
                    }}
                  >
                    선택 부분을 INBOX 초안으로
                  </button>
                </>
              )}
              <button disabled={protectedResult || !loaded || busy} onClick={() => setConfirm(true)}>
                결과 삭제…
              </button>
            </div>
          )}
          {text && (
            <p className="agent-result-hint">
              본문을 드래그한 뒤 선택 부분 복사 또는 ⌘C · 삭제는 이 작업 보기의 결과만 숨깁니다.
            </p>
          )}
          {rich && !raw && (
            <p className="agent-result-hint">
              서식 보기 중입니다. 전체 복사·초안·숨김은 원문 기준이고, 선택 부분은 화면에 보이는 글자를 복사합니다.
            </p>
          )}
          {protectedResult && text && (
            <p className="agent-result-hint">
              실행 중·UNKNOWN·미확인 결과는 삭제할 수 없습니다. 추적·중복 제출 방지 기록을 유지합니다.
            </p>
          )}
          {confirm && !protectedResult && (
            <div
              className="agent-result-confirm"
              role="alert"
              onKeyDown={e => {
                if (e.key === 'Escape' && !busy) {
                  e.preventDefault()
                  setConfirm(false)
                }
              }}
            >
              <p>
                이 결과만 앱에서 숨길까요? 사용자 입력·첨부와 Hermes 원본 대화·기억·설정·실행 기록은 유지됩니다. 앱
                재시작 후에도 숨겨지며 되돌릴 수 있습니다.
              </p>
              <button disabled={busy} onClick={() => void visibility('hide')}>
                이 결과만 숨기기 확인
              </button>
              <button disabled={busy} onClick={() => setConfirm(false)}>
                결과 삭제 취소
              </button>
            </div>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
