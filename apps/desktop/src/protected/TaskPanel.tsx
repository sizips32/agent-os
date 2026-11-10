import { useEffect, useRef, useState } from 'react'
import type { TaskReport } from '../../protected/task-types'
const statuses: Record<string, string> = {
  not_found: '등록된 노트 없음',
  unsafe_record: '기록 경로 확인 필요',
  invalid_record: '기록 확인 필요',
  unsafe_note: '노트 경로 확인 필요',
  changed: '파일 변경 감지 · 확인 필요',
  ambiguous: '동일 노트가 여러 경로에 있음',
  missing: '기록의 노트가 없음',
  resolved: '현재 경로 확인',
  moved: '이동된 최신 경로 확인'
}
const states: Record<string, string> = {
  reserved: '전송 예약 · 결과 확인 필요',
  uncertain: '결과 불명 · 재전송 금지',
  returned_unverified: '응답 수신 · 검수 전',
  native_final_unverified: '최종 응답 수신 · 검수 전',
  native_reply_collected: '응답 수집 · 검수 전',
  native_reply_format_mismatch: '응답 형식 확인 필요',
  blocked: '차단됨',
  child_started: '하위 작업 시작 기록',
  running: '실행 중 기록',
  completed: '완료 기록 · 근거 별도 확인',
  failed: '실패 기록',
  unknown: '상태 확인 필요'
}
export function TaskPanel({ visible }: { visible: boolean }) {
  const [task, setTask] = useState(''),
    [report, setReport] = useState<TaskReport | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    []
  )
  async function lookup(event: React.FormEvent) {
    event.preventDefault()
    const id = task.trim(),
      current = ++generation.current
    if (!/^[A-Za-z0-9_-]{1,90}$/.test(id)) {
      setError('영문·숫자·밑줄·하이픈으로 된 작업 ID를 입력하세요.')
      setReport(null)
      return
    }
    setBusy(true)
    setError('')
    setReport(null)
    try {
      const value = await window.protectedHerald.taskReport(id)
      if (current === generation.current) setReport(value)
    } catch {
      if (current === generation.current)
        setError('작업 기록을 조회하지 못했습니다. 작업 ID와 로컬 기록 상태를 확인하세요.')
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  if (!visible) return null
  return (
    <section className="task-panel" aria-label="작업 연결과 저장 경로">
      <p>작업 ID로 기존 연결·검수 기록과 현재 노트 경로를 확인합니다. 조회는 읽기 전용입니다.</p>
      <form onSubmit={lookup}>
        <label>
          작업 ID
          <input
            aria-label="작업 조회 ID"
            value={task}
            maxLength={90}
            onChange={e => {
              generation.current++
              setTask(e.target.value)
              setReport(null)
              setError('')
              setBusy(false)
            }}
            placeholder="ohha-publicwork-…"
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? '조회 중…' : '작업 조회'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {report && (
        <div aria-live="polite">
          <h3>{report.task_id}</h3>
          <p>
            {report.synthetic ? '합성 시험 기록 · 실제 작업 아님' : '기존 작업 기록'} ·{' '}
            {report.computed_verification === 'synthetic_only' ? '합성 검수 통과' : '사실 검증 미확정'}
          </p>
          <h4>현재 저장 경로</h4>
          <p>{statuses[report.note.status] || '노트 상태 확인 필요'}</p>
          {report.note.relative_path && (
            <>
              <code className="task-path">{report.note.relative_path}</code>
              <p>저장 파일 해시 일치 · 내용의 사실 검증은 별도입니다.</p>
              <details>
                <summary>파일 해시와 기존 표기</summary>
                <code>{report.note.sha256}</code>
                <p>
                  기존 노트의 검증 표기: {report.note.declared_verification || '없음'} · 출처{' '}
                  {report.note.source_count ?? 0}개
                </p>
              </details>
            </>
          )}
          <h4>단계별 상태</h4>
          {!report.phases.length ? (
            <p>기록된 실행 단계 없음</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>단계</th>
                  <th>상태</th>
                  <th>세션·페인</th>
                </tr>
              </thead>
              <tbody>
                {report.phases.map(p => (
                  <tr key={p.phase}>
                    <td>
                      {p.phase}
                      {p.profile && ` · ${p.profile}`}
                    </td>
                    <td>{states[p.state] || '상태 확인 필요'}</td>
                    <td>
                      {[p.session || p.session_id, p.workspace, p.pane, p.aside_session_id]
                        .filter(Boolean)
                        .join(' · ') || '미기록'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4>작업 연결</h4>
          {!report.links.length ? (
            <p>공통 작업 ID의 연결 증거 없음</p>
          ) : (
            <ul>
              {report.links.map((link, index) => (
                <li key={index}>
                  <strong>{link.role}</strong> ·{' '}
                  {[
                    link.profile,
                    link.phase,
                    link.workspace,
                    link.pane,
                    link.session,
                    link.aside_session_id,
                    link.native_final_id
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </li>
              ))}
            </ul>
          )}
          <h4>주장별 근거 검수</h4>
          {!report.reviews.length ? (
            <p>주장별 원문 대조 기록 없음</p>
          ) : (
            <ul>
              {report.reviews.map((r, i) => (
                <li key={i}>
                  {r.synthetic ? '합성 원문 대조' : '검수 기록'} · 주장 {r.claim_count ?? 0}개 · {r.decision}
                </li>
              ))}
            </ul>
          )}
          <p>
            이전 대화의 경로 표기는 그대로 보존됩니다. 위 단계 상태는 장부 기록이며 현재 프로세스 실행 여부는 별도로
            확인해야 합니다.
          </p>
        </div>
      )}
    </section>
  )
}
