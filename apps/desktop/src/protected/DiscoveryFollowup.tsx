import { useEffect, useRef, useState } from 'react'
import { StatusPoller } from '../../protected/status-poller'
import { SubmissionFlow } from '../../protected/submission-flow'
import { followupPrompt, parseFollowup, type Followup } from '../../protected/discovery-ai'
import type { DiscoveryCommand, DiscoveryDomain, DiscoveryReview, DiscoveryStoreView, DiscoveryTopic } from '../../protected/discovery-state'
import type { HermesState } from '../../protected/types'
export function DiscoveryFollowup({id,domain,topic,context,value,onChange,stored,mutate,blocked,onBusy,onReserve,onAnswers}: {
  id:string;domain:DiscoveryDomain;topic:DiscoveryTopic;context:DiscoveryReview;value?:Followup
  onChange:(value:Followup)=>void;stored:DiscoveryStoreView|null
  mutate:(command:DiscoveryCommand)=>Promise<DiscoveryStoreView|null>;blocked:string
  onBusy:(busy:boolean)=>void;onReserve:()=>boolean;onAnswers:()=>void
}) {
  const [busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[notice,setNotice]=useState('')
  const cancelRequested=useRef(false),expectedWork=useRef<string|undefined>(undefined),poll=useRef<StatusPoller|null>(null)
  const [pollRevision,setPollRevision]=useState(0)
  const lock=useRef(false),latest=useRef(value),state=useRef<HermesState|null>(null),flow=useRef<SubmissionFlow|null>(null)
  const interpretation=useRef<HTMLTextAreaElement>(null)
  const heading=useRef<HTMLHeadingElement>(null),answer=useRef<HTMLTextAreaElement>(null)
  latest.current=value
  function change(next:Followup){latest.current=next;onChange(next)}
  function blank(input:DiscoveryReview):Followup{return {phase:'preview',input:structuredClone(input),interpretation:'',decision:null,questions:[],cursor:0}}
  const record=stored?.requests?.[id]
  const active=busy||value?.phase==='running'
  const prompt=value?followupPrompt(domain,topic,value.input):''
  useEffect(()=>{if(value?.phase==='questions')answer.current?.focus();else if(value)heading.current?.focus()},[value?.phase,value?.cursor])
  useEffect(()=>()=>{poll.current?.stop();flow.current?.reset()},[])
  useEffect(()=>{
    const workId=record?.workId
    if(busy||value?.phase!=='running'||!workId||state.current?.workId!==workId||state.current.status!=='running')return
    const current=new StatusPoller(workId,async()=>{
      const next=await window.protectedHerald.request({action:'status',workId})
      if(next.workId!==workId)throw Error('Unexpected work result')
      return next
    },next=>{if(next.status!=='running')current.stop();publish(next)},()=>{
      current.stop()
      const saved=latest.current
      if(saved){change({...saved,phase:'unknown'});onBusy(false)}
      setNotice('기존 요청 상태를 확인하지 못했습니다. 자동 조회를 멈췄으며 재전송하지 않습니다. 기존 요청 상태·결과만 직접 확인해 주세요.')
    })
    poll.current=current
    const timer=setInterval(()=>void current.tick(),500)
    return ()=>{current.stop();clearInterval(timer);if(poll.current===current)poll.current=null}
  },[busy,value?.phase,record?.workId,pollRevision])
  function publish(next:HermesState) {
    if(expectedWork.current&&next.workId!==expectedWork.current)return
    state.current=next
    const current=latest.current;if(!current)return
    if(next.status==='running'){change({...current,phase:'running'});return}
    if(next.status==='completed') {
      try {if(next.events.some(e=>e.startsWith('tool_started:')))throw Error('도구 실행이 관측돼 질문 제안으로 사용하지 않았습니다. 기록을 확인해 주세요.');change({...current,...parseFollowup(next.text),phase:'questions',cursor:0});setNotice('AI의 잠정 제안입니다. 사실·공식 교리·투자 성과로 확정하지 않습니다.')}
      catch(error){change({...current,phase:'failed'});setNotice(error instanceof Error?error.message:'질문 제안 형식을 확인하지 못했습니다. 재전송하지 않습니다.')}
    } else {change({...current,phase:next.status==='unknown'?'unknown':'failed'});setNotice(next.reason+' 동일 요청을 재전송하지 않습니다.')}
    onBusy(false)
  }
  async function request() {
    if(lock.current||record||!value||value.phase!=='preview'||!consent||blocked||!stored||prompt.length>12000)return
    if(!onReserve()){setNotice('대화 상태가 바뀌어 요청하지 않았습니다.');return}
    cancelRequested.current=false;lock.current=true;setBusy(true);onBusy(true);setNotice('')
    const requestId=crypto.randomUUID()
    const reserved=await mutate({action:'ai-reserve',revision:stored.revision,id,requestId})
    if(!reserved){lock.current=false;setBusy(false);onBusy(false);return}
    if(cancelRequested.current){change({...value,phase:'cancelled'});lock.current=false;setBusy(false);onBusy(false);setNotice('제출 전에 취소했습니다. 같은 회고에서 재전송하지 않습니다.');return}
    change({...value,phase:'running'})
    flow.current=new SubmissionFlow({
      prepare:async(text,key)=>{
        const workId=await window.protectedHerald.prepare(text,key,undefined,[], 'discovery_questions')
        const bound=await mutate({action:'ai-bind',revision:reserved.revision,id,requestId,workId})
        if(!bound){await window.protectedHerald.discardPrepared(workId);throw Error('요청 기록 저장에 실패해 실제 제출하지 않았습니다.')}
        expectedWork.current=workId
        return workId
      },request:operation=>window.protectedHerald.request(operation),discardPrepared:workId=>window.protectedHerald.discardPrepared(workId)
    },publish)
    try {await flow.current.begin(prompt,requestId)}
    catch {if(latest.current)change({...latest.current,phase:'unknown'});setNotice('전송 결과를 확인하지 못했습니다. 자동 재전송하지 않고 기존 요청 상태만 확인해 주세요.')}
    finally {lock.current=false;setBusy(false);if(latest.current?.phase!=='running')onBusy(false)}
  }
  async function stop() {
    cancelRequested.current=true;poll.current?.stop()
    if(!flow.current&&!record?.workId)return
    try {if(flow.current)await flow.current.cancel();else if(record?.workId)publish(await window.protectedHerald.request({action:'cancel',workId:record.workId}));setNotice('중단을 요청했습니다. 이미 제출됐을 수 있으므로 같은 요청을 재전송하지 않습니다.')}
    catch {if(latest.current)change({...latest.current,phase:'unknown'});onBusy(false);setNotice('중단을 확인하지 못했습니다. 기존 요청만 조회하고 재전송하지 않습니다.')}
    finally {setPollRevision(v=>v+1)}
  }
  async function recover() {
    if(lock.current||busy||!record?.workId)return
    lock.current=true;setBusy(true);poll.current?.stop();expectedWork.current=record.workId
    try {
      const next=await window.protectedHerald.request({action:'status',workId:record.workId})
      if(next.workId!==record.workId)throw Error('기존 작업과 다른 응답이라 사용하지 않았습니다.')
      if(next.status==='running'){state.current=next;onBusy(true);change({...latest.current??blank({situation:'',problem:'',outcome:'',action:'',basis:'',interpretation:''}),phase:'running'});setNotice('기존 요청이 실행 중입니다. 재전송하지 않습니다.');return}
      onBusy(false)
      const conversation=await window.protectedHerald.conversation(record.workId)
      if(!conversation.canResume)throw Error('기존 요청 결과가 불명입니다. 질문을 사용하거나 재전송하지 않았습니다.')
      const response=[...conversation.messages].reverse().find(m=>m.role==='assistant')
      if(!response)throw Error('확인할 응답이 없습니다. 재전송하지 않습니다.')
      const base=latest.current??blank({situation:'',problem:'',outcome:'',action:'',basis:'',interpretation:''})
      change({...base,...parseFollowup(response.text),phase:'questions',cursor:0});setNotice('이 회고의 기존 AI 요청 결과만 불러왔습니다. 현재 답변이 달라져도 새 요청은 보내지 않습니다.')
    } catch(error){if(latest.current?.phase==='running')change({...latest.current,phase:'unknown'});onBusy(false);setNotice(error instanceof Error?error.message:'기존 결과를 확인하지 못했습니다. 재전송하지 않습니다.')}
    finally {lock.current=false;setBusy(false);setPollRevision(v=>v+1)}
  }
  const question=value?.questions[value.cursor]
  function updateQuestion(key:'question'|'answer',text:string){if(!value)return;change({...value,questions:value.questions.map((q,i)=>i===value.cursor?{...q,[key]:text}:q)})}
  function next(skip=false){if(!value)return;const questions=value.questions.map((q,i)=>i===value.cursor?{...q,skipped:skip}:q);change({...value,questions,cursor:Math.min(value.cursor+1,questions.length-1),phase:value.cursor===questions.length-1?'done':'questions'})}
  return <div className="agent-discovery-panel agent-followup" aria-label="AI 맞춤 후속 질문">
    <h4 ref={heading} tabIndex={-1}>AI 맞춤 후속 질문 · 선택 사항</h4>
    <p>현재 회고 답변을 기준으로 최대 3개 질문을 한 번 제안받습니다. 추가 답변은 자동으로 전송하지 않습니다. AI의 해석은 제안이며 확인된 사실이 아닙니다.</p>
    {blocked&&!active&&<p role="status">{blocked}</p>}
    {!record&&<button disabled={active||!!blocked||!stored||!Object.values(context).some(t=>t.trim()&&t.trim()!=='기억나지 않음')} onClick={()=>{change(blank(context));setConsent(false);setNotice('')}}>AI 질문 제안 준비 · 전송 범위 보기</button>}
    {record&&!value&&<p>이 회고는 이미 AI 질문을 요청했습니다. 저장·복원·열기로 재전송하지 않습니다.</p>}
    {value?.phase==='preview'&&!record&&<>
      <label>실제로 전송할 현재 답변과 요청<textarea aria-label="AI 전송 범위" value={prompt} readOnly rows={7}/></label><p>{prompt.length.toLocaleString()} / 12,000자 · 초과하면 답변을 줄인 뒤 범위를 다시 준비해 주세요.</p>
      <p>기존 지젤의 외부 모델로 전송하며 비용·사용량이 발생할 수 있습니다. 새 텍스트 세션이며 첨부·다른 대화·기억/로컬 규칙 주입을 포함하지 않습니다. 기존 수동 승인과 공급자는 유지합니다. 요청 식별자·세션 참조만 중복 방지를 위해 맥북에 기록합니다. 답변과 질문은 직접 저장할 때만 회고 파일에 보관합니다.</p>
      <label><input type="checkbox" aria-label="AI 외부 전송 범위 확인" checked={consent} disabled={active} onChange={e=>setConsent(e.target.checked)}/> 이 전송 범위와 외부 모델 사용을 확인했습니다.</label>
      <button disabled={!consent||active||!!blocked||!stored||prompt.length>12000} onClick={()=>void request()}>지젤에게 AI 질문 제안 요청</button>
      <button disabled={active} onClick={()=>{change({...value,phase:'cancelled'});setConsent(false);setNotice('요청 준비를 취소했습니다. 전송하지 않았습니다.')}}>AI 요청 준비 취소</button>
    </>}
    {active&&<><p role="status">AI 질문 응답 대기 중 · 재전송 없음 · 기존 요청 최대 15분 제한</p><button onClick={()=>void stop()}>AI 질문 요청 중단</button></>}
    {record&&<><p>이 회고의 요청: {record.workId??'세션 연결 전 · 재전송 금지'}</p><button disabled={busy||!record.workId} onClick={()=>void recover()}>기존 AI 요청 상태·결과 확인</button>{!record.workId&&<p>요청 기록은 있으나 세션 참조가 없습니다. 자동 복구·재전송하지 않습니다. 다른 회고는 새 문제 시작으로 분리합니다.</p>}</>}
    {['unknown','failed'].includes(value?.phase??'')&&<p role="alert">AI 질문 결과 미확인 또는 실패입니다. 기존 입력과 첨부는 유지하며 같은 요청을 다시 보내지 않습니다.</p>}
    {(value?.phase==='questions'||value?.phase==='done')&&<>
      <label>AI의 잠정 해석 · 수정 가능<textarea ref={interpretation} aria-label="AI 잠정 해석" maxLength={400} value={value.interpretation} onChange={e=>change({...value,interpretation:e.target.value,decision:'edit'})}/></label>
      <div className="agent-discovery-actions"><button aria-pressed={value.decision==='yes'} onClick={()=>change({...value,decision:'yes'})}>맞아요 · 제안 확인</button><button aria-pressed={value.decision==='edit'} onClick={()=>{change({...value,decision:'edit'});interpretation.current?.focus()}}>수정할게요</button><button aria-pressed={value.decision==='no'} onClick={()=>change({...value,decision:'no'})}>아니에요 · 해석 제외</button></div>
      {question&&<><p>후속 질문 {value.cursor+1} / {value.questions.length}</p><label>질문 · 직접 수정 가능<textarea aria-label="AI 후속 질문" maxLength={400} value={question.question} onChange={e=>updateQuestion('question',e.target.value)}/></label><label>내 추가 답변<textarea ref={answer} aria-label="AI 후속 질문 답변" maxLength={2000} value={question.answer} onChange={e=>updateQuestion('answer',e.target.value)}/></label>
      <div className="agent-discovery-actions"><button disabled={value.cursor===0} onClick={()=>change({...value,cursor:value.cursor-1,phase:'questions'})}>이전 AI 질문</button><button disabled={!question.question.trim()} onClick={()=>next()}>{value.cursor===value.questions.length-1?'추가 답변 확인':'다음 AI 질문'}</button><button onClick={()=>next(true)}>AI 질문 건너뛰기</button><button onClick={()=>change({...value,phase:'cancelled'})}>후속 질문 그만하기 · 답변 유지</button></div></>}
      {value.phase==='done'&&<button onClick={onAnswers}>추가 답변을 초안 검토에 포함</button>}
    </>}
    {value?.phase==='cancelled'&&value.questions.length>0&&<button onClick={()=>change({...value,phase:'questions'})}>같은 AI 질문 이어하기</button>}
    {notice&&<p role="status">{notice}</p>}
    <p>입력 보관은 위의 맥북에 저장을 직접 누릅니다. 저장·복원·삭제 복구만으로 모델을 호출하지 않습니다.</p>
  </div>
}
