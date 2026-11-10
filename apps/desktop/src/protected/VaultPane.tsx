import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  VaultHit,
  VaultPreview,
  VaultEvidence,
  VaultDraft,
  VaultSaved,
  VaultSuggestion,
  VaultCommand,
  VaultReply,
  VaultScan
} from '../../protected/vault-types'
export type VaultSeed = { text: string; label: string }
export function VaultPane({
  visible,
  evidence,
  onEvidence,
  seed,
  composer,
  blocked,
  submissionStatus
}: {
  visible: boolean
  evidence: VaultEvidence[]
  onEvidence: (e: VaultEvidence) => { ok: boolean; message: string }
  seed: VaultSeed | null
  composer: ReactNode
  blocked: boolean
  submissionStatus?: 'idle' | 'running' | 'completed' | 'failed' | 'unknown'
}) {
  const [available, setAvailable] = useState<boolean | null>(null),
    [query, setQuery] = useState(''),
    [subfolder, setSubfolder] = useState(''),
    [folder, setFolder] = useState<'0_INBOX' | '1_SEMANTIC_LAYER' | '_giselle'>('0_INBOX'),
    [tag, setTag] = useState(''),
    [topic, setTopic] = useState(''),
    [hits, setHits] = useState<VaultHit[]>([]),
    [limited, setLimited] = useState(false),
    [scan, setScan] = useState<VaultScan | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [panel, setPanel] = useState<'source' | 'save' | 'links' | 'moc' | null>(null),
    [preview, setPreview] = useState<VaultPreview | null>(null),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(0),
    [rangeConfirmed, setRangeConfirmed] = useState(false)
  const [draft, setDraft] = useState<VaultDraft>({
      captureId: crypto.randomUUID(),
      title: '',
      body: '',
      tags: 'agent-os draft',
      sourceIds: []
    }),
    [draftPreview, setDraftPreview] = useState(''),
    [saved, setSaved] = useState<VaultSaved | null>(null),
    [suggestions, setSuggestions] = useState<VaultSuggestion[]>([]),
    [chosen, setChosen] = useState<string[]>([]),
    [linkPreview, setLinkPreview] = useState(''),
    [linkCapture, setLinkCapture] = useState(crypto.randomUUID()),
    [diff, setDiff] = useState('')
  const generation = useRef(0),
    lock = useRef(false),
    mounted = useRef(true)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const draftRevision = useRef(0),
    linkRevision = useRef(0)
  const draftApproval = useRef<VaultDraft | null>(null)
  const linkApproval = useRef<{ saved: VaultSaved; linkIds: string[]; captureId: string } | null>(null)
  const [pendingSeed, setPendingSeed] = useState<VaultSeed | null>(null),
    [previousDraft, setPreviousDraft] = useState<VaultDraft | null>(null),
    [seedLabel, setSeedLabel] = useState('')
  function invalidate() {
    draftRevision.current++
    linkRevision.current++
    draftApproval.current = null
    linkApproval.current = null
    setDraftPreview('')
    setLinkPreview('')
  }
  function useSeed(value: VaultSeed) {
    invalidate()
    setDraft({ captureId: crypto.randomUUID(), title: '', body: value.text, tags: 'agent-os draft', sourceIds: [] })
    setSeedLabel(value.label)
    setSaved(null)
    setPanel('save')
    setComposerOpen(false)
    setPendingSeed(null)
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current++
    }
  }, [])
  async function call(command: VaultCommand): Promise<VaultReply | null> {
    if (lock.current) return null
    lock.current = true
    setBusy(true)
    const run = ++generation.current
    try {
      const reply = await window.protectedHerald.vault(command)
      return mounted.current && run === generation.current ? reply : null
    } catch (e) {
      if (mounted.current) setNotice(e instanceof Error ? e.message : '로컬 볼트 작업 실패 · 원문 변경 없음')
      return null
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }
  useEffect(() => {
    let live = true
    if (visible && available === null)
      void window.protectedHerald
        .vault({ action: 'info' })
        .then(v => {
          if (live) setAvailable(v.available === true)
        })
        .catch(() => {
          if (live) setAvailable(false)
        })
    return () => {
      live = false
    }
  }, [visible, available])
  useEffect(() => {
    if (seed) {
      const v = draftRef.current
      if (v.title.trim() || v.body.trim() || v.sourceIds.length || v.tags !== 'agent-os draft') setPendingSeed(seed)
      else useSeed(seed)
    }
  }, [seed])
  function edit(change: Partial<VaultDraft>) {
    draftRevision.current++
    draftApproval.current = null
    setDraft(v => ({ ...v, ...change }))
    setDraftPreview('')
  }
  async function previewDraft() {
    const version = draftRevision.current,
      payload = structuredClone(draftRef.current)
    const r = await call({ action: 'save-preview', draft: payload })
    if (
      r?.markdown &&
      version === draftRevision.current &&
      JSON.stringify(payload) === JSON.stringify(draftRef.current)
    ) {
      draftApproval.current = payload
      setDraftPreview(r.markdown)
    }
  }
  async function previewLinks() {
    if (!saved) return
    const version = linkRevision.current,
      payload = { saved: structuredClone(saved), linkIds: [...chosen], captureId: linkCapture }
    const r = await call({ action: 'links-preview', ...payload })
    if (r?.markdown && version === linkRevision.current) {
      linkApproval.current = payload
      setLinkPreview(r.markdown)
    }
  }
  async function search() {
    const r = await call({ action: 'search', query, folder, tag, topic, subfolder })
    if (r) {
      setHits(r.hits || [])
      setLimited(r.limited === true)
      setScan(r.scan || null)
      setNotice('로컬 검색 완료 · 모델 호출 없음')
    }
  }
  async function source(id: string) {
    const r = await call({ action: 'preview', id })
    if (r?.preview) {
      setPreview(r.preview)
      setStart(0)
      setEnd(Math.min(2000, r.preview.text.length))
      setRangeConfirmed(false)
      setPanel('source')
    }
  }
  async function add() {
    if (!preview || !rangeConfirmed || blocked) return
    const r = await call({ action: 'select', id: preview.id, hash: preview.hash, start, end })
    if (r?.evidence) {
      const result = onEvidence(r.evidence)
      setNotice(result.message)
      if (result.ok) {
        setPanel(null)
        setComposerOpen(true)
      }
      if (!result.ok) void window.protectedHerald.vault({ action: 'release', id: r.evidence.id })
    }
  }
  async function save() {
    const approved = draftApproval.current
    if (!draftPreview || !approved || JSON.stringify(approved) !== JSON.stringify(draftRef.current)) return
    const r = await call({ action: 'save', draft: structuredClone(approved) })
    if (r?.saved) {
      setSaved(r.saved)
      setDraftPreview('')
      draftApproval.current = null
      setPanel('links')
      setChosen([])
      setLinkPreview('')
      linkApproval.current = null
      linkRevision.current++
      setLinkCapture(crypto.randomUUID())
      setNotice('이 Mac에 새 INBOX 초안을 저장했습니다. Syncthing 완료는 확인하지 않았습니다.')
    }
  }
  async function suggest() {
    if (!saved) return
    const r = await call({ action: 'suggest', saved })
    if (r) {
      setSuggestions(r.suggestions || [])
      setNotice('제목·태그 기반 로컬 연결 후보 · 선택 여부는 직접 검토하세요.')
    }
  }
  async function applyLinks() {
    const approved = linkApproval.current
    if (
      !saved ||
      !linkPreview ||
      !approved ||
      JSON.stringify(approved) !== JSON.stringify({ saved, linkIds: chosen, captureId: linkCapture })
    )
      return
    const r = await call({ action: 'links-save', ...structuredClone(approved) })
    if (r?.saved) {
      setSaved(r.saved)
      setLinkPreview('')
      linkApproval.current = null
      linkRevision.current++
      setLinkCapture(crypto.randomUUID())
      setNotice('확인한 링크를 새 버전 INBOX 초안으로 저장했습니다. 이전 초안·기존 MOC는 그대로입니다.')
    }
  }
  if (!visible) return null
  const controlsDisabled = busy || blocked
  return (
    <section className="agent-vault" aria-label="Obsidian 근거와 초안">
      {pendingSeed && (
        <aside role="alertdialog" aria-label="작성 중인 초안 보호">
          <p>작성 중인 제목·본문·태그·출처가 있습니다. 새 결과로 바꾸기 전에 현재 초안을 보관합니다.</p>
          <button
            disabled={busy}
            onClick={() => {
              setPreviousDraft(structuredClone(draftRef.current))
              useSeed(pendingSeed)
            }}
          >
            현재 초안 보관 후 새 결과로 전환
          </button>
          <button onClick={() => setPendingSeed(null)}>전환 취소 · 현재 초안 유지</button>
        </aside>
      )}
      {previousDraft && (
        <button
          disabled={busy}
          onClick={() => {
            const current = structuredClone(draftRef.current)
            invalidate()
            setDraft(structuredClone(previousDraft))
            setPreviousDraft(current)
            setSeedLabel('보관한 작성 초안')
            setPanel('save')
          }}
        >
          이전 작성 초안 복원 · 현재 초안도 보관
        </button>
      )}
      <div className={'vault-shell ' + (panel ? 'has-panel' : '')}>
        <div className="vault-library">
          <div className="vault-kicker">LOCAL KNOWLEDGE · 읽기 전용 검색</div>
          <h2>생각에 근거를 연결하세요</h2>
          <p>선택한 구간만 질문에 담습니다. 검색·미리보기는 모델을 호출하지 않습니다.</p>
          <p className="vault-limit">
            일반 지젤 채팅은 기존 도구 권한을 유지합니다. 근거 칩이 있는 요청만 새 텍스트 전용 격리 경로를 사용합니다.
            공급자 실통신은 별도 미검증입니다.
          </p>
          {available === false && <p role="alert">볼트 위치를 확인할 수 없습니다. 경로·권한은 변경하지 않았습니다.</p>}
          <form
            onSubmit={e => {
              e.preventDefault()
              void search()
            }}
            className="vault-search"
          >
            <label>
              검색어
              <input
                aria-label="볼트 검색어"
                data-shortcut="vault-search"
                value={query}
                maxLength={100}
                onChange={e => setQuery(e.target.value)}
                placeholder="제목 또는 원문에서 찾기"
              />
            </label>
            <div className="vault-filters">
              <label>
                폴더
                <select
                  aria-label="볼트 폴더"
                  value={folder}
                  onChange={e => setFolder(e.target.value as typeof folder)}
                >
                  <option>0_INBOX</option>
                  <option>1_SEMANTIC_LAYER</option>
                  <option>_giselle</option>
                </select>
              </label>
              <label>
                주제
                <select aria-label="볼트 주제" value={topic} onChange={e => setTopic(e.target.value)}>
                  <option value="">모든 주제</option>
                  {['Financial', 'Spiritual', 'Technical', 'General'].map(t => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                태그
                <input aria-label="볼트 태그" value={tag} maxLength={60} onChange={e => setTag(e.target.value)} />
              </label>
            </div>
            <label>
              검색 하위 폴더 · 선택
              <input
                aria-label="볼트 검색 하위 폴더"
                value={subfolder}
                maxLength={250}
                onChange={e => setSubfolder(e.target.value)}
                placeholder="예: Concepts/Technical/Knowledge_Management"
              />
            </label>
            <button disabled={busy || available !== true} type="submit">
              로컬 노트 검색
            </button>
          </form>
          <p className="vault-limit">한 번에 최대 100개 노트·1MiB·30개 결과 · 숨김/비밀/충돌사본/링크 자동 추적 제외</p>
          {scan && (
            <p role="status">
              {`${scan.notes.toLocaleString()}개 노트 검색 · ${scan.matched.toLocaleString()}개 일치` +
                (scan.matched > hits.length ? ` · 상위 ${hits.length}개 표시` : '') +
                (scan.oversized ? ` · ${scan.oversized}개 64KiB 초과로 제외` : '') +
                (scan.unreadable ? ` · ${scan.unreadable}개 제외(민감정보 의심·인코딩·읽기 오류)` : '') +
                (scan.truncated
                  ? ' · 검색 한도(개수·용량·깊이·2초)에 도달해 나머지 제외, 폴더/검색어를 좁혀 주세요'
                  : '')}
            </p>
          )}
          {limited && !scan && (
            <p role="status">범위·읽기 한도로 일부 노트가 제외됐습니다. 폴더/검색어를 좁혀 주세요.</p>
          )}
          <div className="vault-results" aria-label="볼트 검색 결과">
            {hits.map(hit => (
              <article key={hit.id}>
                <small>원문 · {hit.path}</small>
                <h3>{hit.title}</h3>
                <div className="vault-tags">
                  {hit.tags.map(t => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
                <p>{hit.context}</p>
                <button disabled={busy} onClick={() => void source(hit.id)}>
                  원문 미리보기
                </button>
                <button disabled={busy} onClick={() => void call({ action: 'open', id: hit.id })}>
                  Obsidian에서 열기
                </button>
              </article>
            ))}
            {!hits.length && <p>검색 결과는 여기에 표시됩니다. 전체 볼트를 자동으로 읽지 않습니다.</p>}
          </div>
          <button
            disabled={busy}
            onClick={() => {
              setPanel('save')
              setComposerOpen(false)
              setDraftPreview('')
            }}
          >
            INBOX 초안 검토 열기
          </button>
        </div>
        {panel && (
          <aside className="vault-panel" aria-label="Obsidian 보조 패널">
            <button
              className="vault-back"
              onClick={() => {
                setPanel(null)
                setRangeConfirmed(false)
              }}
            >
              검색으로 돌아가기 · 입력 유지
            </button>
            {panel === 'source' && preview && (
              <>
                <div className="vault-kicker">원문 · 아직 전송하지 않음</div>
                <h3>{preview.title}</h3>
                <small>{preview.path}</small>
                <pre className="vault-original">{preview.text}</pre>
                <label>
                  시작
                  <input
                    type="number"
                    aria-label="근거 시작"
                    min={0}
                    max={preview.text.length - 1}
                    value={start}
                    onChange={e => {
                      setStart(Number(e.target.value))
                      setRangeConfirmed(false)
                    }}
                  />
                </label>
                <label>
                  끝
                  <input
                    type="number"
                    aria-label="근거 끝"
                    min={1}
                    max={preview.text.length}
                    value={end}
                    onChange={e => {
                      setEnd(Number(e.target.value))
                      setRangeConfirmed(false)
                    }}
                  />
                </label>
                <details>
                  <summary>제목별 구간 선택</summary>
                  {preview.headings.map(h => (
                    <button
                      key={h.start}
                      onClick={() => {
                        setStart(h.start)
                        setEnd(Math.min(h.end, h.start + 8000))
                        setRangeConfirmed(false)
                      }}
                    >
                      {h.title}
                    </button>
                  ))}
                </details>
                <p>
                  선택 {start}~{end}자 · 최대 8,000자 · 원문 해시 변경 시 적용/전송 중단
                </p>
                <pre className="vault-selected">{preview.text.slice(start, end)}</pre>
                <label className="vault-check">
                  <input
                    type="checkbox"
                    aria-label="선택 근거 구간 확인"
                    checked={rangeConfirmed}
                    onChange={e => setRangeConfirmed(e.target.checked)}
                  />{' '}
                  표시된 구간만 질문에 포함합니다.
                </label>
                <button
                  disabled={
                    controlsDisabled ||
                    !rangeConfirmed ||
                    start < 0 ||
                    end <= start ||
                    end > preview.text.length ||
                    end - start > 8000
                  }
                  onClick={() => void add()}
                >
                  선택 구간을 질문에 담기
                </button>
                {blocked && <p>현재 요청/결과를 먼저 마무리하고 새 질문에서 근거를 담아 주세요.</p>}
              </>
            )}
            {panel === 'save' && (
              <>
                <div className="vault-kicker">검토 전 초안 · 원문 변경 없음</div>
                <h3>새 INBOX 노트</h3>
                {seedLabel && <p>{seedLabel} · AI 답변은 검증된 사실이 아닙니다.</p>}
                <label>
                  제목
                  <input
                    aria-label="INBOX 초안 제목"
                    maxLength={150}
                    value={draft.title}
                    onChange={e => edit({ title: e.target.value })}
                  />
                </label>
                <label>
                  본문
                  <textarea
                    aria-label="INBOX 초안 본문"
                    maxLength={12000}
                    rows={8}
                    value={draft.body}
                    onChange={e => edit({ body: e.target.value })}
                  />
                </label>
                <label>
                  태그
                  <input
                    aria-label="INBOX 초안 태그"
                    maxLength={300}
                    value={draft.tags}
                    onChange={e => edit({ tags: e.target.value })}
                  />
                </label>
                <fieldset>
                  <legend>출처 편집 · 포함할 근거만 선택</legend>
                  {evidence.map(e => (
                    <label key={e.id} className="vault-check">
                      <input
                        type="checkbox"
                        checked={draft.sourceIds.includes(e.id)}
                        onChange={event =>
                          edit({
                            sourceIds: event.target.checked
                              ? [...draft.sourceIds, e.id]
                              : draft.sourceIds.filter(id => id !== e.id)
                          })
                        }
                      />
                      {e.title} · {e.start}~{e.end}
                    </label>
                  ))}
                  {!evidence.length && <p>출처가 지정되지 않았습니다. 출처 설명은 본문에 직접 편집할 수 있습니다.</p>}
                </fieldset>
                <button
                  disabled={busy || !draft.title.trim() || !draft.body.trim()}
                  onClick={() => void previewDraft()}
                >
                  저장 내용 미리보기
                </button>
                {draftPreview && (
                  <>
                    <pre aria-label="INBOX 저장 미리보기">{draftPreview}</pre>
                    <p>
                      0_INBOX 새 파일만 생성 · 동일 내용 중복 방지 · 로컬 저장 후 Syncthing 공유 기기로 전파될 수
                      있습니다.
                    </p>
                    <button disabled={busy} onClick={() => void save()}>
                      확인 · 새 INBOX 초안 저장
                    </button>
                    <button disabled={busy} onClick={() => setDraftPreview('')}>
                      저장 취소 · 파일 생성 없음
                    </button>
                  </>
                )}
              </>
            )}
            {panel === 'links' && saved && (
              <>
                <div className="vault-kicker">연결 검토 · 자동 분류 없음</div>
                <h3>{saved.path}</h3>
                <button disabled={busy} onClick={() => void suggest()}>
                  관련 개념·MOC 제안 보기
                </button>
                {suggestions.map(s => (
                  <div className="vault-link-candidate" key={s.note.id}>
                    <label className="vault-check">
                      <input
                        type="checkbox"
                        checked={chosen.includes(s.note.id)}
                        onChange={e => {
                          setChosen(v => (e.target.checked ? [...v, s.note.id] : v.filter(id => id !== s.note.id)))
                          linkRevision.current++
                          linkApproval.current = null
                          setLinkPreview('')
                        }}
                      />
                      {s.note.title}
                    </label>
                    <p>{s.reason}</p>
                    <small>{s.note.path}</small>
                    {/MOC/i.test(s.note.path) && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void call({ action: 'moc-preview', saved, id: s.note.id }).then(r => {
                            if (r?.diff) {
                              setDiff(r.diff)
                              setPanel('moc')
                            }
                          })
                        }
                      >
                        기존 MOC 변경차이 검토
                      </button>
                    )}
                  </div>
                ))}
                <button disabled={busy || !chosen.length} onClick={() => void previewLinks()}>
                  선택 링크 반영 미리보기
                </button>
                {linkPreview && (
                  <>
                    <pre aria-label="링크 반영 미리보기">{linkPreview}</pre>
                    <p>링크 반영은 새 버전 초안을 생성합니다. 기존 초안/MOC 덮어쓰기 없음.</p>
                    <button disabled={busy} onClick={() => void applyLinks()}>
                      확인 · 링크 포함 새 버전 저장
                    </button>
                    <button onClick={() => setLinkPreview('')}>링크 반영 취소</button>
                  </>
                )}
              </>
            )}
            {panel === 'moc' && (
              <>
                <div className="vault-kicker">기존 MOC · 읽기 전용 변경안</div>
                <pre aria-label="MOC 변경차이">{diff}</pre>
                <p>
                  기존 MOC 쓰기는 이번 초기 범위 밖입니다. 별도 사용자 승인과 차이 확인이 필요하며 자동 반영하지
                  않습니다.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void window.protectedHerald
                      .copyResult(diff)
                      .then(() => setNotice('MOC 변경안을 복사했습니다. 원문은 변경하지 않았습니다.'))
                      .catch(() => setNotice('변경안 복사 실패'))
                  }
                >
                  MOC 변경안 복사
                </button>
                <button onClick={() => setPanel('links')}>연결 검토로 돌아가기</button>
              </>
            )}
          </aside>
        )}
      </div>
      {notice && (
        <p className="vault-notice" role="status">
          {notice === '근거를 질문에 담았습니다. 아직 전송하지 않았습니다.'
            ? submissionStatus === 'running'
              ? '근거 실행을 제출했습니다. 응답을 기다리는 동안 같은 요청을 다시 보내지 마세요.'
              : submissionStatus === 'unknown' || submissionStatus === 'failed'
                ? '제출된 근거 실행의 결과가 미확정이거나 실행 오류가 있습니다. 현재 질문·근거를 유지하며 재전송하지 않습니다.'
                : submissionStatus === 'completed'
                  ? '근거 실행의 응답을 확인했습니다. INBOX 저장은 별도로 검토하고 확인해야 합니다.'
                  : notice
            : notice}
        </p>
      )}
      {busy && <p role="status">로컬 작업 중 · 원문 덮어쓰기 없음</p>}
      <details
        className="vault-question-shelf"
        open={composerOpen}
        onToggle={e => setComposerOpen(e.currentTarget.open)}
      >
        <summary>질문·첨부 보관 · 근거 {evidence.length}개 · 전송 범위 검토 열기</summary>
        {composer}
      </details>
    </section>
  )
}
