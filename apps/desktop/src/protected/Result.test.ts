// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Result } from './Result'
import type { ProtectedBridge } from '../../protected/types'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const workId='work_'+'a'.repeat(32),text='한글 **Markdown**\n```js\n  const x = "값";\n```\n마지막  \n'
let root:Root,host:HTMLDivElement,hidden:boolean,bridge:ProtectedBridge
const button=(label:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===label)!
async function click(label:string){await act(async()=>button(label).click())}
async function render(protectedResult=false,value=text){await act(async()=>root.render(createElement(Result,{text:value,workId,protectedResult})))}
beforeEach(()=>{hidden=false;host=document.createElement('div');document.body.append(host);root=createRoot(host);bridge={copyResult:vi.fn(async()=>{}),resultControl:vi.fn(async c=>{if(c.action==='hide')hidden=true;if(c.action==='restore')hidden=false;return {hidden}})} as unknown as ProtectedBridge;window.protectedHerald=bridge})
afterEach(async()=>{await act(async()=>root.unmount());window.getSelection()?.removeAllRanges();host.remove();vi.restoreAllMocks()})
test('whole copy preserves Korean, Markdown, code, whitespace, multiline and long text',async()=>{
 for(const value of [text,text.repeat(300)]){await render(false,value);expect(host.querySelector('pre')!.textContent).toBe(value);await click('결과 전체 복사');expect(bridge.copyResult).toHaveBeenLastCalledWith(value)};expect(host.textContent).toContain('전체를 복사했습니다')
})
test('pointer click preserves selection; partial copy never falls back to full',async()=>{
 await render();const node=host.querySelector('pre')!.firstChild!,range=document.createRange();range.setStart(node,3);range.setEnd(node,34)
 await act(async()=>{window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'))})
 const part=text.slice(3,34),copy=button('선택 부분 복사');expect(copy.disabled).toBe(false)
 for(const type of ['pointerdown','mousedown']){const event=new MouseEvent(type,{bubbles:true,cancelable:true});copy.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)}
 await click('선택 부분 복사');expect(bridge.copyResult).toHaveBeenCalledExactlyOnceWith(part);expect(window.getSelection()!.toString()).toBe(part)
 await act(async()=>{window.getSelection()!.removeAllRanges();document.dispatchEvent(new Event('selectionchange'))});expect(copy.disabled).toBe(true);await click('선택 부분 복사');expect(bridge.copyResult).toHaveBeenCalledTimes(1)
})
test('outside selection rejected and native Cmd+C is not intercepted',async()=>{
 await render();const outside=document.createTextNode('outside');host.append(outside);const range=document.createRange();range.setStart(host.querySelector('pre')!.firstChild!,0);range.setEnd(outside,3)
 await act(async()=>{window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'))});expect(button('선택 부분 복사').disabled).toBe(true)
 const event=new KeyboardEvent('keydown',{key:'c',metaKey:true,bubbles:true,cancelable:true});host.querySelector('pre')!.dispatchEvent(event);expect(event.defaultPrevented).toBe(false)
})
test('confirm/cancel/hide/undo/restart preserves original content and scope',async()=>{
 await render();await click('결과 삭제…');expect(host.textContent).toContain('Hermes 원본 대화');await click('결과 삭제 취소');expect(hidden).toBe(false)
 await click('결과 삭제…');await click('이 결과만 숨기기 확인');expect(host.querySelector('pre')).toBeNull();expect(hidden).toBe(true)
 await act(async()=>root.unmount());root=createRoot(host);await render();expect(host.querySelector('pre')).toBeNull();await click('결과 삭제 되돌리기');expect(host.querySelector('pre')!.textContent).toBe(text);expect(hidden).toBe(false)
})
test('running/UNKNOWN stays visible with hide disabled even if saved hidden',async()=>{hidden=true;await render(true);expect(host.querySelector('pre')!.textContent).toBe(text);expect(button('결과 삭제…').disabled).toBe(true);await click('결과 전체 복사');expect(bridge.copyResult).toHaveBeenCalledWith(text)})
test('copy and persistent load/write failures retain result with feedback',async()=>{
 bridge.copyResult=vi.fn(async()=>{throw Error('fixture')});await render();await click('결과 전체 복사');expect(host.textContent).toContain('복사하지 못했습니다')
 bridge.resultControl=vi.fn(async c=>{if(c.action!=='load')throw Error('fixture');return {hidden:false}});await click('결과 삭제…');await click('이 결과만 숨기기 확인');expect(host.querySelector('pre')!.textContent).toBe(text);expect(host.textContent).toContain('저장하지 못했습니다')
 bridge.resultControl=vi.fn(async()=>{throw Error('fixture')});await render(false,text+'changed');expect(button('결과 삭제…').disabled).toBe(true);expect(host.textContent).toContain('삭제는 보류')
})
test('late old load cannot hide changed result',async()=>{
 let resolve!:(v:{hidden:boolean})=>void;bridge.resultControl=vi.fn().mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue({hidden:false});await render();await render(false,'new fixture');await act(async()=>resolve({hidden:true}));expect(host.querySelector('pre')!.textContent).toBe('new fixture')
})
