// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Discovery } from './Discovery'
import type { ProtectedBridge } from '../../protected/types'
import { validDiscoveryCommand, type DiscoveryCommand, type DiscoveryStoreView } from '../../protected/discovery-state'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root:Root,host:HTMLDivElement,state:DiscoveryStoreView,bridge:ProtectedBridge
let apply=vi.fn((_draft:string,_preview?:boolean)=>({ok:true,message:'applied only'})),close=vi.fn(()=>{})
const button=(text:string)=>{const result=host.querySelector<HTMLButtonElement>(`[aria-label="${text} 시작"]`) ?? [...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);if(!result)throw Error('missing '+text);return result}
const click=async(b:HTMLElement)=>{await act(async()=>{b.click()})}
async function field(selector:string,value:string){await act(async()=>{const el=host.querySelector<HTMLTextAreaElement>(selector)!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})}
async function mount(blocked=''){await act(async()=>{root.render(createElement(Discovery,{visible:true,blocked,target:'synthetic conversation',onClose:close,onApply:apply}))})}
async function restart(){await act(async()=>root.unmount());root=createRoot(host);await mount()}
async function ready(){await click(button('업무·자동화'));await field('#discovery-answer','synthetic experience');for(let i=0;i<4;i++)await click(button(i===3?'내 답변 정리하기':'다음 질문'));await field('[aria-label="원하는 결과"]','user edited result');await click(host.querySelector('[aria-label="내 해석과 계획 확인"]')!);await click(button('지젤에게 보낼 초안 만들기'))}
beforeEach(()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host);state={revision:0,records:{},trash:{},applied:[]};apply=vi.fn((_draft:string,_preview?:boolean)=>({ok:true,message:'applied only'}));close=vi.fn(()=>{})
 bridge={discovery:vi.fn(async(command:DiscoveryCommand)=>{
   if(!validDiscoveryCommand(command))throw Error('invalid')
   if(command.action!=='load'&&command.revision!==state.revision)throw Error('conflict')
   if(command.action==='save')state.records[command.snapshot.domain]={snapshot:structuredClone(command.snapshot),savedAt:'2026-10-11T00:00:00.000Z'}
   if(command.action==='ai-reserve'){state.requests??={};if(state.requests[command.id])throw Error('duplicate');state.requests[command.id]={requestId:command.requestId}}
   if(command.action==='ai-bind')state.requests![command.id].workId=command.workId
   if(command.action==='claim'){if(state.applied.includes(command.id))throw Error('already applied');state.applied.push(command.id)}
   if(command.action==='delete'){state.trash[command.domain]=state.records[command.domain];delete state.records[command.domain]}
   if(command.action==='undo'){state.records[command.domain]=state.trash[command.domain];delete state.trash[command.domain]}
   if(command.action!=='load')state.revision++;return structuredClone(state)
 })} as unknown as ProtectedBridge
 window.protectedHerald=bridge
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks()})
test('answers and question position save explicitly and restore after restart; no autosave or automatic apply',async()=>{
 await mount();expect(bridge.discovery).toHaveBeenCalledTimes(1);await click(button('업무·자동화'));await field('#discovery-answer','saved experience');await click(button('다음 질문'));await field('#discovery-answer','saved blockage');expect(state.records.work).toBeUndefined()
 await click(button('맥북에 저장'));await field('#discovery-answer','unsaved change');await restart();expect(host.querySelector('#discovery-answer')).toBeNull();await click(button('업무 저장 이어하기'))
 expect(host.querySelector<HTMLTextAreaElement>('#discovery-answer')!.value).toBe('saved blockage');expect(host.textContent).toContain('질문 2 / 4');expect(document.activeElement).toBe(host.querySelector('#discovery-answer'));expect(apply).not.toHaveBeenCalled()
 await click(button('이전 질문'));expect(host.querySelector<HTMLTextAreaElement>('#discovery-answer')!.value).toBe('saved experience')
})
test('two tracks retain separate topic and edited results; restore confirmation can cancel without changing current input',async()=>{
 await mount();await ready();await click(button('맥북에 저장'));await click(button('새 문제 시작'));await click(button('회고만 비우고 새로 시작'));await click(button('신앙·투자·일상'))
 await act(async()=>{const el=host.querySelector<HTMLSelectElement>('[aria-label="생각 정리 분야"]')!;el.value='faith';el.dispatchEvent(new Event('change',{bubbles:true}))});await field('#discovery-answer','personal reflection');await click(button('맥북에 저장'))
 await click(button('업무 저장 이어하기'));await click(button('현재 회고 유지'));expect(host.querySelector<HTMLTextAreaElement>('#discovery-answer')!.value).toBe('personal reflection')
 await click(button('업무 저장 이어하기'));await click(button('저장 내용으로 이어가기'));expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 초안"]')!.value).toContain('user edited result')
 await restart();await click(button('생각 정리 저장 이어하기'));expect(host.querySelector<HTMLSelectElement>('[aria-label="생각 정리 분야"]')!.value).toBe('faith');expect(apply).not.toHaveBeenCalled()
})
test('delete confirmation, cancellation and undo survive restart without applying or restoring automatically',async()=>{
 await mount();await ready();await click(button('맥북에 저장'));await click(button('업무 저장 삭제'));await click(button('삭제 취소'));expect(state.records.work).toBeDefined()
 await click(button('업무 저장 삭제'));await click(button('저장 삭제 확인'));expect(state.records.work).toBeUndefined();expect(host.querySelector('[aria-label="지젤에게 보낼 초안"]')).not.toBeNull()
 await restart();await click(button('업무 삭제 실행 취소'));expect(state.records.work).toBeDefined();expect(host.querySelector('[aria-label="지젤에게 보낼 초안"]')).toBeNull();expect(apply).not.toHaveBeenCalled()
 await click(button('업무 저장 이어하기'));expect(host.querySelector('[aria-label="지젤에게 보낼 초안"]')).not.toBeNull()
})
test('saved pre-apply snapshot cannot apply twice after restart or delete/undo',async()=>{
 await mount();await ready();await click(button('맥북에 저장'));const send=button('기존 입력 뒤에 초안 적용');await act(async()=>{send.click();send.click()});expect(apply.mock.calls.filter(c=>!c[1])).toHaveLength(1)
 await restart();await click(button('업무 저장 이어하기'));expect(button('이미 적용한 초안').disabled).toBe(true)
 await click(button('업무 저장 삭제'));await click(button('저장 삭제 확인'));await click(button('업무 삭제 실행 취소'));await click(button('업무 저장 이어하기'));await click(button('저장 내용으로 이어가기'));expect(button('이미 적용한 초안').disabled).toBe(true);expect(apply.mock.calls.filter(c=>!c[1])).toHaveLength(1)
})
test('storage failure preserves input, shows failure and never applies before durable claim',async()=>{
 await mount();await ready();bridge.discovery=vi.fn(async()=>{throw Error('synthetic disk failure')});await click(button('맥북에 저장'));expect(host.textContent).toContain('synthetic disk failure');expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 초안"]')!.value).toContain('synthetic experience')
 await click(button('기존 입력 뒤에 초안 적용'));expect(apply.mock.calls.filter(c=>!c[1])).toHaveLength(0)
})
test('corrupt store response fails closed; explicit retry may load but cannot auto restore',async()=>{
 bridge.discovery=vi.fn(async()=>({records:{}} as DiscoveryStoreView));await mount();expect(host.textContent).toContain('저장 응답을 확인할 수 없습니다');expect(button('맥북에 저장').disabled).toBe(true)
 bridge.discovery=vi.fn(async()=>structuredClone(state));await click(button('저장 목록 다시 확인'));await click(button('업무·자동화'));await field('#discovery-answer','local answer');expect(host.querySelector<HTMLTextAreaElement>('#discovery-answer')!.value).toBe('local answer')
})
test('save repeated clicks and close/back retain current inputs while a write is pending',async()=>{
 await mount();await click(button('업무·자동화'));await field('#discovery-answer','original');let resolve!:(view:DiscoveryStoreView)=>void;bridge.discovery=vi.fn(()=>new Promise<DiscoveryStoreView>(r=>{resolve=r}));const save=button('맥북에 저장');await act(async()=>{save.click();save.click()});expect(bridge.discovery).toHaveBeenCalledTimes(1)
 await click(button('대화로 돌아가기 · 내용 유지'));expect(close).toHaveBeenCalledTimes(1);await field('#discovery-answer','edited during save');await act(async()=>resolve({revision:1,records:{},trash:{},applied:[]}));expect(host.querySelector<HTMLTextAreaElement>('#discovery-answer')!.value).toBe('edited during save')
})
test('restored draft preflight rejection or UNKNOWN cannot consume durable application marker',async()=>{
 await mount();await ready();await click(button('맥북에 저장'));await restart();await click(button('업무 저장 이어하기'));apply.mockReturnValue({ok:false,message:'12001 > 12000'});await click(button('기존 입력 뒤에 초안 적용'));expect(host.textContent).toContain('12001 > 12000');expect(state.applied).toEqual([])
 await mount('UNKNOWN 차단');expect(button('기존 입력 뒤에 초안 적용').disabled).toBe(true);expect(state.applied).toEqual([])
})
test('replacing another reflection in the same track requires confirmation and cancellation preserves its saved snapshot',async()=>{
 await mount();await ready();await click(button('맥북에 저장'));const original=structuredClone(state.records.work)
 await click(button('새 문제 시작'));await click(button('회고만 비우고 새로 시작'));await click(button('업무·자동화'));await field('#discovery-answer','new reflection');await click(button('맥북에 저장'));await click(button('저장 교체 취소'));expect(state.records.work).toEqual(original)
 await click(button('맥북에 저장'));await click(button('이 분야 저장 바꾸기'));expect(state.records.work?.snapshot.answers[0]).toBe('new reflection')
})
test('an earlier question snapshot remains saveable but cannot replay the identity applied later',async()=>{
 await mount();await click(button('업무·자동화'));await field('#discovery-answer','saved first question');await click(button('맥북에 저장'))
 for(let i=0;i<4;i++)await click(button(i===3?'내 답변 정리하기':'다음 질문'));await click(host.querySelector('[aria-label="내 해석과 계획 확인"]')!);await click(button('지젤에게 보낼 초안 만들기'));await click(button('기존 입력 뒤에 초안 적용'))
 await restart();await click(button('업무 저장 이어하기'));await click(button('맥북에 저장'));expect(state.records.work?.snapshot.applied).toBe(true)
 for(let i=0;i<4;i++)await click(button(i===3?'내 답변 정리하기':'다음 질문'));await click(host.querySelector('[aria-label="내 해석과 계획 확인"]')!);await click(button('지젤에게 보낼 초안 만들기'));expect(button('이미 적용한 초안').disabled).toBe(true)
})

test('AI questions and supplied answers explicitly save, restore, and generate a reviewed draft without resending',async()=>{
 const workId='work_'+'a'.repeat(32),response=JSON.stringify({interpretation:'tentative synthetic',questions:['one synthetic question?']})
 bridge.prepare=vi.fn(async()=>workId);bridge.request=vi.fn(async()=>({workId,status:'completed' as const,sessionId:'fixture',events:[],reason:'fixture',text:response}));bridge.discardPrepared=vi.fn(async()=>{})
 await mount();await click(button('업무·자동화'));await field('#discovery-answer','synthetic current scope');await click(button('AI 질문 제안 준비 · 전송 범위 보기'));await click(host.querySelector('[aria-label="AI 외부 전송 범위 확인"]')!);await click(button('지젤에게 AI 질문 제안 요청'))
 await field('[aria-label="AI 후속 질문 답변"]','synthetic additional answer');await click(button('아니에요 · 해석 제외'));await click(button('추가 답변 확인'));await click(button('추가 답변을 초안 검토에 포함'));await click(host.querySelector('[aria-label="내 해석과 계획 확인"]')!);await click(button('지젤에게 보낼 초안 만들기'))
 expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 초안"]')!.value).toContain('synthetic additional answer');expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 초안"]')!.value).not.toContain('tentative synthetic')
 await click(button('맥북에 저장'));await restart();await click(button('업무 저장 이어하기'));expect(host.querySelector<HTMLTextAreaElement>('[aria-label="AI 후속 질문 답변"]')!.value).toBe('synthetic additional answer');expect(host.querySelector<HTMLTextAreaElement>('[aria-label="지젤에게 보낼 초안"]')!.value).toContain('synthetic additional answer');expect(bridge.prepare).toHaveBeenCalledOnce();expect(bridge.request).toHaveBeenCalledOnce();expect(apply).not.toHaveBeenCalled()
})

test('editing included AI answers invalidates the old ready draft for explicit confirmation',async()=>{
 const workId='work_'+'b'.repeat(32);bridge.prepare=vi.fn(async()=>workId);bridge.request=vi.fn(async()=>({workId,status:'completed' as const,sessionId:'fixture',events:[],reason:'mock',text:JSON.stringify({interpretation:'tentative',questions:['one?']})}))
 await mount();await click(button('업무·자동화'));await field('#discovery-answer','current');await click(button('AI 질문 제안 준비 · 전송 범위 보기'));await click(host.querySelector('[aria-label="AI 외부 전송 범위 확인"]')!);await click(button('지젤에게 AI 질문 제안 요청'));await field('[aria-label="AI 후속 질문 답변"]','first answer');await click(button('추가 답변 확인'));await click(button('추가 답변을 초안 검토에 포함'));await click(host.querySelector('[aria-label="내 해석과 계획 확인"]')!);await click(button('지젤에게 보낼 초안 만들기'));await field('[aria-label="AI 후속 질문 답변"]','changed answer');expect(host.querySelector('[aria-label="지젤에게 보낼 초안"]')).toBeNull();expect(button('지젤에게 보낼 초안 만들기').disabled).toBe(true);expect(apply).not.toHaveBeenCalled();expect(bridge.prepare).toHaveBeenCalledOnce()
})
