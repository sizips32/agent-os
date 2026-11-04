// @vitest-environment jsdom
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {TaskPanel} from './TaskPanel'
import type {TaskReport} from '../../protected/task-types'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root:Root,host:HTMLDivElement,lookup:ReturnType<typeof vi.fn>
const task='synthetic_task',report:TaskReport={task_id:task,read_only:true,live_execution_enabled:false,phases:[{phase:'worker-paul',state:'uncertain',profile:'paul',session:'native-fixture',pane:'w2:p2'}],links:[{role:'specialist',profile:'paul',session:'native-profile'}],reviews:[],computed_verification:'unverified',note:{task_id:task,status:'moved',hash_matches:true,relative_path:'_giselle/OH-HA_Agent_OS/Records/AgentOS-fixture.md',sha256:'a'.repeat(64),declared_verification:'verified',source_count:0}}
async function render(visible=true){await act(async()=>root.render(createElement(TaskPanel,{visible})))}
async function input(value:string){await act(async()=>{const node=host.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))})}
async function submit(){await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))}
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);lookup=vi.fn(async()=>report);window.protectedHerald={taskReport:lookup} as any})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
test('manual lookup shows current path, uncertainty and separate hash-versus-fact verification',async()=>{
 await render();expect(lookup).not.toHaveBeenCalled();await input(task);await submit();expect(lookup).toHaveBeenCalledExactlyOnceWith(task);expect(host.textContent).toContain('이동된 최신 경로 확인');expect(host.textContent).toContain('결과 불명 · 재전송 금지');expect(host.textContent).toContain('사실 검증 미확정');expect(host.textContent).toContain('파일 해시 일치');expect(host.querySelectorAll('button')).toHaveLength(1)
})
test('invalid IDs stay local without submitting or reading files',async()=>{await render();await input('../private');await submit();expect(lookup).not.toHaveBeenCalled();expect(host.querySelector('[role=alert]')).not.toBeNull()})
test('late result for an edited ID is discarded',async()=>{let resolve!:(v:TaskReport)=>void;lookup.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await render();await input(task);await submit();await input('different_task');await act(async()=>resolve(report));expect(host.textContent).not.toContain('이동된 최신 경로 확인');expect(host.querySelector('input')!.value).toBe('different_task')})
test('lookup errors are visible and never retry automatically',async()=>{lookup.mockRejectedValueOnce(Error('raw private output'));await render();await input(task);await submit();expect(host.querySelector('[role=alert]')!.textContent).toContain('조회하지 못했습니다');expect(host.textContent).not.toContain('private');expect(lookup).toHaveBeenCalledOnce()})
test('synthetic completion is labelled, panel navigation preserves the queried result',async()=>{lookup.mockResolvedValueOnce({...report,synthetic:true,computed_verification:'synthetic_only'});await render();await input(task);await submit();expect(host.textContent).toContain('합성 시험 기록 · 실제 작업 아님');await render(false);expect(host.textContent).toBe('');await render();expect(host.textContent).toContain('합성 검수 통과');expect(lookup).toHaveBeenCalledOnce()})
