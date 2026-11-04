import { useEffect, useRef, useState } from 'react'
import { DiscoveryFollowup } from './DiscoveryFollowup'
import { followupAnswers, type Followup } from '../../protected/discovery-ai'
import { validDiscoveryView, type DiscoverySnapshot, type DiscoveryStoreView, type DiscoveryCommand, type SavedDiscovery, type DiscoveryDomain as Domain, type DiscoveryTopic as Topic, type DiscoveryReview as Review } from '../../protected/discovery-state'
const emptyReview = (): Review => ({ situation: '', problem: '', outcome: '', action: '', basis: '', interpretation: '' })
const questions = [
  '최근 실제로 있었던 경험 한 가지를 적어 주세요.',
  '그 경험에서 막혔거나 다시 생각해 보고 싶은 지점은 무엇인가요?',
  '어떤 변화나 이해를 원하나요?',
  '직접 확인하거나 해볼 다음 행동이 떠오르나요?'
]
const fields: [keyof Review, string][] = [['situation','상황'],['problem','해결할 문제 또는 생각할 주제'],['outcome','원하는 결과'],['action','다음 행동']]
export function discoveryDraft(domain: Domain, topic: Topic, review: Review, ai?: Followup): string {
  const labels = domain === 'work' ? '업무·자동화' : topic === 'faith' ? '신앙 생각 정리' : topic === 'invest' ? '투자 생각 정리' : '일상 생각 정리'
  const parts = fields.map(([key,label]) => `${label}: ${review[key].trim() || '(작성하지 않음)'}`)
  const extra=followupAnswers(ai);if(extra)parts.push(`사용자가 확인한 후속 질문 답변(자동 사실 해석 아님):\n${extra}`)
  if (domain === 'thought') parts.push(`직접 확인한 사실·출처: ${review.basis.trim() || '(제공하지 않음)'}`, `개인 해석·가정·의견: ${review.interpretation.trim() || '(제공하지 않음)'}`)
  return `[내가 확인·편집한 문제 발견 초안 · ${labels}]\n${parts.join('\n\n')}\n\n위 내용을 바탕으로 추가 확인 질문과 실행 계획을 제안해 주세요. 근거나 사실을 만들지 말고, 실제 실행·파일 변경·외부 전송 전에 제 확인을 기다려 주세요.`
}
export function Discovery({ visible, blocked, target, onClose, onApply, aiBlocked, onAiBusy, onAiReserve, onExport }: {
  onExport?: (text:string)=>void
  aiBlocked?: string; onAiBusy?: (busy:boolean)=>void; onAiReserve?: ()=>boolean
  visible: boolean; blocked: string; target: string; onClose: () => void
  onApply: (draft: string, previewOnly?: boolean) => { ok: boolean; message: string }
}) {
  const [ai,setAi] = useState<Followup|undefined>()
  const [aiActive,setAiActive] = useState(false)
  const [includeAi,setIncludeAi] = useState(false)
  const [id, setId] = useState<string>(() => crypto.randomUUID())
  const [stored, setStored] = useState<DiscoveryStoreView | null>(null)
  const [storageBusy, setStorageBusy] = useState(false)
  const storageLock = useRef(false)
  const [storageError, setStorageError] = useState('')
  const [storageNotice, setStorageNotice] = useState('')
  const [pendingRestore, setPendingRestore] = useState<SavedDiscovery | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SavedDiscovery | null>(null)
  const [saveReplace, setSaveReplace] = useState(false)
  const [domain, setDomain] = useState<Domain | null>(null)
  const [topic, setTopic] = useState<Topic>('daily')
  const [step, setStep] = useState(0)
  const [screen, setScreen] = useState<'questions'|'review'|'ready'|'none'>('questions')
  const [answers, setAnswers] = useState<string[]>(['','','',''])
  const [review, setReview] = useState<Review>(emptyReview)
  const [draft, setDraft] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [applied, setApplied] = useState(false)
  const appliedOnce = useRef(false)
  const [resetRequested, setResetRequested] = useState(false)
  const [status, setStatus] = useState('')
  const [restoreTick,setRestoreTick] = useState(0)
  const focus = useRef<HTMLHeadingElement>(null)
  const questionFocus = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (visible) { if (domain && screen === 'questions') questionFocus.current?.focus(); else focus.current?.focus() } }, [visible, domain, screen, step, restoreTick])
  function answer(value: string) { setAnswers(current => current.map((text,i) => i === step ? value : text)); setStatus('') }
  function advance(value?: string) {
    const next = answers.map((text,i) => i === step && value !== undefined ? value : text)
    setAnswers(next); setStatus('')
    if (step < questions.length - 1) setStep(step+1)
    else { setReview({ situation: next[0], problem: next[1], outcome: next[2], action: next[3], basis: review.basis, interpretation: review.interpretation }); setConfirmed(false); setScreen('review') }
  }
  function reset() { setAi(undefined);setIncludeAi(false);setId(crypto.randomUUID()); setStorageNotice(''); setSaveReplace(false); setPendingRestore(null); setPendingDelete(null); setDomain(null); setTopic('daily'); setStep(0); setScreen('questions'); setAnswers(['','','','']); setReview(emptyReview()); setDraft(''); setConfirmed(false); setApplied(false); appliedOnce.current=false; setResetRequested(false); setStatus('') }
  const snapshot = (): DiscoverySnapshot | null => domain ? { id, domain, topic, step, screen, answers, review, confirmed, applied, ...(ai?{ai,includeAi}: {}) } : null
  async function storage(command: DiscoveryCommand): Promise<DiscoveryStoreView | null> {
    if (storageLock.current) return null
    storageLock.current=true;setStorageBusy(true);setStorageError('')
    try {
      const next=await window.protectedHerald.discovery(command)
      if(!validDiscoveryView(next))throw Error('저장 응답을 확인할 수 없습니다. 기존 입력은 유지됩니다.')
      setStored(next);return next
    } catch(error) { setStorageError(error instanceof Error ? error.message : '맥북 저장을 확인할 수 없습니다. 입력을 유지했습니다.');return null }
    finally {storageLock.current=false;setStorageBusy(false)}
  }
  useEffect(()=>{ if(visible && !stored && !storageLock.current && !storageError) void storage({action:'load'}) },[visible])
  async function save() {
    const current=snapshot();if(!current || !stored)return
    const next=await storage({action:'save',revision:stored.revision,snapshot:current})
    if(next) {setStorageNotice('맥북에 저장했습니다. 이 분야는 마지막으로 직접 저장한 내용 1개를 유지합니다.');setSaveReplace(false)}
  }
  function restore(entry: SavedDiscovery) {
    const saved=entry.snapshot
    setAi(saved.ai ? {...structuredClone(saved.ai),phase:saved.ai.phase==='running'?'unknown':saved.ai.phase} : undefined);setIncludeAi(saved.includeAi===true)
    const marked=saved.applied || !!stored?.applied.includes(saved.id)
    setRestoreTick(t=>t+1);setId(saved.id);setDomain(saved.domain);setTopic(saved.topic);setStep(saved.step);setScreen(saved.screen);setAnswers([...saved.answers]);setReview({...saved.review});setConfirmed(saved.confirmed);setApplied(marked);appliedOnce.current=marked
    setDraft(saved.screen==='ready'?discoveryDraft(saved.domain,saved.topic,saved.review,saved.includeAi?saved.ai:undefined):'');setResetRequested(false);setPendingRestore(null);setSaveReplace(false);setStatus('');setStorageNotice(marked?'저장 내용을 이어갑니다. 이전에 적용한 초안은 다시 적용하지 않습니다.':'저장 내용을 이어갑니다. 대화 입력창과 첨부는 그대로 유지했습니다.')
  }
  async function remove(entry: SavedDiscovery) {
    if(!stored)return
    const next=await storage({action:'delete',revision:stored.revision,domain:entry.snapshot.domain,id:entry.snapshot.id})
    if(next){setPendingDelete(null);setStorageNotice('저장 목록에서 삭제했습니다. 같은 분야의 최근 삭제 1개는 앱을 다시 열어도 복구할 수 있습니다. 화면 입력은 유지했습니다.')}
  }
  async function undo(entry: SavedDiscovery) {
    if(!stored)return
    const next=await storage({action:'undo',revision:stored.revision,domain:entry.snapshot.domain,id:entry.snapshot.id})
    if(next)setStorageNotice('저장 목록에 복구했습니다. 이어하기를 누를 때만 화면에 가져옵니다.')
  }
  async function apply() {
    if(appliedOnce.current || storageLock.current || !stored)return
    const check=onApply(draft,true);if(!check.ok){setStatus(check.message);return}
    const next=await storage({action:'claim',revision:stored.revision,id})
    if(!next)return
    appliedOnce.current=true;setApplied(true)
    const result=onApply(draft);setStatus(result.ok?result.message:result.message+' 중복 방지 표시는 저장됐습니다. 새 문제로 시작해 주세요.')
  }
  const currentSnapshot=snapshot()
  const savedCurrent=domain?stored?.records[domain]:undefined
  const dirty=!!currentSnapshot && JSON.stringify(currentSnapshot)!==JSON.stringify(savedCurrent?.snapshot)
  const guidance = topic === 'faith' ? '성경 본문·공식 교리와 출처를 직접 확인한 내용, 개인의 해석을 구분해 주세요. 출처나 근거를 만들지 않습니다.'
    : topic === 'invest' ? '직접 확인한 사실·출처와 가정·의견을 구분해 주세요. 전망을 사실로 단정하거나 근거를 만들지 않습니다.'
    : '직접 겪거나 확인한 내용과 개인의 느낌·해석을 구분해 주세요.'

  return <section hidden={!visible} className="agent-discovery flex-1 overflow-auto" aria-label="문제 발견">
    <div className="agent-discovery-heading"><h3 ref={focus} tabIndex={-1}>문제 발견 · 생각 정리</h3><button disabled={aiActive} onClick={onClose}>대화로 돌아가기 · 내용 유지</button></div>
    <p className="agent-discovery-note">로컬 질문과 직접 작성·편집한 초안입니다. 기본 질문은 입력을 정해진 형식으로 정리합니다. 아래 선택 사항인 AI 맞춤 후속 질문은 전송 범위를 확인하고 직접 요청할 때만 외부 모델을 호출합니다. 자동 저장은 없습니다. 직접 저장한 답변·현재 단계·편집 결과만 이 맥북의 앱 전용 저장소에 보관합니다. 저장 파일의 외부 동기화는 없습니다. 첨부 원본·대화 입력창·지젤 기억과 설정은 저장하지 않습니다.</p>
    <fieldset disabled={aiActive} className="agent-discovery-local">
    {!domain && <div className="agent-discovery-domains"><button aria-label="업무·자동화 시작" onClick={() => setDomain('work')}><strong>업무·자동화</strong><span>최근 경험에서 반복 작업과 막힌 지점 살펴보기</span></button><button aria-label="신앙·투자·일상 시작" onClick={() => setDomain('thought')}><strong>신앙·투자·일상</strong><span>사실과 해석을 나누며 생각 정리하기</span></button></div>}
    <div className="agent-discovery-panel" aria-label="맥북 저장과 이어하기">
      <h4>맥북 저장 · 이어하기</h4><p>앱 전용 위치: ~/Library/Application Support/Agent OS/discovery/reflections.json · 암호화 저장은 아닙니다. 각 분야의 마지막 저장 1개와 최근 삭제 1개를 보관합니다.</p>
      <p role="status">{storageBusy?'저장 상태 확인 중…':!stored?'저장 상태 미확인':!domain?'저장 목록에서 이어가거나 새 분야를 선택하세요.':dirty?'저장하지 않은 변경이 있습니다. 앱 종료 전 직접 저장해 주세요.':'현재 내용은 맥북에 저장돼 있습니다.'}</p>
      <div className="agent-discovery-actions"><button disabled={!domain || !stored || storageBusy} onClick={()=>{if(savedCurrent && savedCurrent.snapshot.id!==id)setSaveReplace(true);else void save()}}>맥북에 저장</button><button disabled={storageBusy} onClick={()=>void storage({action:'load'})}>저장 목록 다시 확인</button></div>
      {storageError && <p role="alert">{storageError}</p>}{storageNotice && <p role="status">{storageNotice}</p>}
      {saveReplace && <div role="alert"><p>같은 분야의 기존 저장 내용을 이번 입력으로 바꿀까요? 저장 전 내용을 유지하려면 취소해 주세요.</p><button disabled={storageBusy} onClick={()=>void save()}>이 분야 저장 바꾸기</button><button disabled={storageBusy} onClick={()=>setSaveReplace(false)}>저장 교체 취소</button></div>}
      {(['work','thought'] as Domain[]).map(track=>{const entry=stored?.records[track],deleted=stored?.trash[track];return <div key={track} className="agent-discovery-saved"><strong>{track==='work'?'업무·자동화':'신앙·투자·일상'}</strong>{entry?<><p>마지막 저장: {new Date(entry.savedAt).toLocaleString()} · {entry.snapshot.screen==='questions'?`질문 ${entry.snapshot.step+1}/4`:entry.snapshot.screen==='ready'?'초안 검토':entry.snapshot.screen==='none'?'문제 없음':'답변 확인·수정'}</p><button disabled={storageBusy} onClick={()=>{if(domain)setPendingRestore(entry);else restore(entry)}}>{track==='work'?'업무 저장 이어하기':'생각 정리 저장 이어하기'}</button><button disabled={storageBusy} onClick={()=>setPendingDelete(entry)}>{track==='work'?'업무 저장 삭제':'생각 정리 저장 삭제'}</button></>:<p>저장한 내용 없음</p>}{deleted&&<><p>최근 삭제한 내용은 복구 전까지 이 맥북에 남습니다. 다음 같은 분야 삭제 때 이전 삭제본을 대체합니다.</p><button disabled={storageBusy||!!entry} onClick={()=>void undo(deleted)}>{track==='work'?'업무 삭제 실행 취소':'생각 정리 삭제 실행 취소'}</button>{entry&&<p>같은 분야의 현재 저장을 덮어쓰지 않으므로 복구를 보류합니다.</p>}</>}</div>})}
      {pendingRestore&&<div role="alert"><p>현재 화면의 회고 입력 대신 저장 내용을 가져올까요? 저장하지 않은 회고 변경은 사라집니다. 대화 입력창·첨부는 바꾸지 않습니다.</p><button disabled={storageBusy} onClick={()=>restore(pendingRestore)}>저장 내용으로 이어가기</button><button disabled={storageBusy} onClick={()=>setPendingRestore(null)}>현재 회고 유지</button></div>}
      {pendingDelete&&<div role="alert"><p>이 분야의 저장 내용을 목록에서 삭제할까요? 최근 삭제 1개는 실행 취소로 복구할 수 있습니다. 이 분야에 이전 삭제본이 있으면 이번 삭제로 대체되어 이전 삭제본은 복구할 수 없습니다. 화면의 회고 입력은 유지합니다.</p><button disabled={storageBusy} onClick={()=>void remove(pendingDelete)}>저장 삭제 확인</button><button disabled={storageBusy} onClick={()=>setPendingDelete(null)}>삭제 취소</button></div>}
      <p>초안 적용 시 중복 방지 표시만 함께 저장합니다. 적용한 초안은 앱 재실행·이어하기 후에도 중복 적용하지 않습니다.</p>
    </div>
    {resetRequested && <div role="alert" className="agent-discovery-note"><p>이번 회고의 답변·초안을 비우고 새로 시작할까요? 대화 입력창·첨부는 바꾸지 않습니다.</p><button onClick={reset}>회고만 비우고 새로 시작</button><button onClick={() => setResetRequested(false)}>이번 내용 유지</button></div>}
    {domain && <>
      <div className="agent-discovery-context"><span>{domain === 'work' ? '업무·자동화' : '신앙·투자·일상'}</span><button onClick={() => setResetRequested(true)}>새 문제 시작</button></div>
      {domain === 'thought' && <><label>생각 정리 분야(입력 유지) <select aria-label="생각 정리 분야" disabled={applied || screen === 'ready'} value={topic} onChange={e => { setTopic(e.target.value as Topic); setConfirmed(false) }}><option value="daily">일상</option><option value="faith">신앙</option><option value="invest">투자</option></select></label><p className="agent-discovery-note">{guidance}</p></>}
      {screen === 'questions' && <div className="agent-discovery-panel">
        <p role="status">질문 {step+1} / {questions.length} · 항목당 최대 2,000자 · 짧게 적거나 건너뛰어도 됩니다. 건너뛰기는 입력을 유지합니다. 기억 없음은 빈 입력에서 선택합니다.</p>
        <label htmlFor="discovery-answer">{questions[step]}</label>
        <textarea ref={questionFocus} id="discovery-answer" value={answers[step]} maxLength={2000} onChange={e => answer(e.target.value)} rows={5} />
        <div className="agent-discovery-actions"><button disabled={step===0} onClick={() => setStep(step-1)}>이전 질문</button><button onClick={() => advance()}>{step===questions.length-1 ? '내 답변 정리하기' : '다음 질문'}</button><button onClick={() => advance()}>건너뛰기</button><button disabled={!!answers[step].trim()} onClick={() => advance('기억나지 않음')}>기억나지 않음</button><button onClick={() => { setScreen('none'); setStatus('문제 없음은 유효한 결과입니다. 작업을 만들거나 전송하지 않았습니다.') }}>문제 없음</button></div>
      </div>}
      {screen === 'none' && <div className="agent-discovery-panel"><h4>지금은 문제 없음</h4><p>문제를 만들어 낼 필요는 없습니다. 작성한 답변은 이 앱 실행 동안 유지됩니다.</p><button onClick={() => { setScreen('questions'); setStatus('') }}>같은 질문으로 돌아가기</button><button onClick={onClose}>정리 마치고 대화로 돌아가기</button></div>}
      {screen === 'review' && <div className="agent-discovery-panel"><h4>내 답변 확인·수정</h4><p>사용자가 적은 답변만 옮겼습니다. 건너뛴 항목은 비워 두었습니다. 제안이나 원인을 자동 생성하지 않습니다.</p>
        {[...fields, ...(domain==='thought' ? [['basis','직접 확인한 사실·출처'],['interpretation','개인 해석·가정·의견']] as [keyof Review,string][] : [])].map(([key,label]) => <label key={key}>{label}<textarea aria-label={label} value={review[key]} maxLength={2000} rows={3} onChange={e => { setReview({...review,[key]:e.target.value}); setConfirmed(false) }} /></label>)}
        <label><input type="checkbox" aria-label="내 해석과 계획 확인" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> 내 해석·원하는 결과·다음 행동을 확인했습니다.</label>
        <div className="agent-discovery-actions"><button onClick={() => { setScreen('questions'); setStep(questions.length-1); setAnswers([review.situation,review.problem,review.outcome,review.action]); setStatus('') }}>질문으로 돌아가기</button><button disabled={!confirmed || !Object.values(review).some(value => value.trim() && value.trim() !== '기억나지 않음')} onClick={() => { setDraft(discoveryDraft(domain,topic,review,includeAi?ai:undefined)); setScreen('ready'); setStatus('전송할 초안을 확인해 주세요. 아직 대화 입력창에 적용하지 않았습니다.') }}>지젤에게 보낼 초안 만들기</button></div>
      </div>}
      {screen === 'ready' && <div className="agent-discovery-panel"><h4>초안 검토 · 자동 전송 없음</h4><label>지젤에게 보낼 초안<textarea aria-label="지젤에게 보낼 초안" value={draft} readOnly rows={9} /></label><p>{draft.length.toLocaleString()} / 12,000자 · 기존 입력과 첨부 내용까지 합쳐 한도가 적용됩니다.</p><p>적용 대상: {target}</p><p>수정은 확인 화면에서 하거나 적용 후 대화 입력창에서 해 주세요.</p><p>기존 입력창 내용 뒤에 덧붙이고 첨부를 유지합니다. 실제 전송은 대화 화면에서 직접 눌러 주세요.</p>{draft.length > 12000 && <p role="alert">초안 자체가 12,000자를 초과했습니다. 확인 화면에서 항목을 줄여 주세요. 자르거나 적용하지 않습니다.</p>}{blocked && <p role="status">{blocked}</p>}
        <div className="agent-discovery-actions"><button disabled={applied} onClick={() => { setScreen('review'); setStatus('') }}>확인 화면으로 돌아가기</button><button disabled={applied || storageBusy || !stored || !!blocked || !draft.trim() || draft.length > 12000} onClick={()=>void apply()}>{applied ? '이미 적용한 초안' : '기존 입력 뒤에 초안 적용'}</button>{onExport&&<button disabled={!!blocked||!draft.trim()} onClick={()=>onExport(draft)}>Obsidian 초안으로 검토</button>}</div>
      </div>}
    </>}
    </fieldset>
    {domain&&<DiscoveryFollowup key={id} id={id} domain={domain} topic={topic} context={screen==='questions'||screen==='none'?{situation:answers[0],problem:answers[1],outcome:answers[2],action:answers[3],basis:review.basis,interpretation:review.interpretation}:review} value={ai} onChange={next=>{setAi(next);if(includeAi&&!applied){setConfirmed(false);setScreen('review')}setIncludeAi(false)}} stored={stored} mutate={storage} blocked={aiBlocked??blocked} onBusy={busy=>{setAiActive(busy);onAiBusy?.(busy)}} onReserve={()=>onAiReserve?.()??true} onAnswers={()=>{if(applied){setStatus('이미 적용한 초안입니다. 새 문제로 분리해 주세요.');return}if(screen==='questions'||screen==='none')setReview({situation:answers[0],problem:answers[1],outcome:answers[2],action:answers[3],basis:review.basis,interpretation:review.interpretation});setIncludeAi(true);setConfirmed(false);setScreen('review');setStatus('내 추가 답변을 포함할 초안을 확인해 주세요. AI 해석은 사실 검증이 아닙니다.')}}/>}
    {status && <p role="status" className="agent-discovery-note">{status}</p>}
  </section>
}
