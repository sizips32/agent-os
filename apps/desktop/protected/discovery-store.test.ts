import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, stat, readdir, symlink, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DiscoveryStore } from './discovery-store'
import { validDiscovery, validDiscoveryCommand, type DiscoverySnapshot, type DiscoveryCommand } from './discovery-state'
let directory: string
let store: DiscoveryStore
const snapshot=(domain: 'work'|'thought'='work'): DiscoverySnapshot=>({id:randomUUID(),domain,topic:domain==='work'?'daily':'faith',step:2,screen:'review',answers:['synthetic experience','blocked','',''],review:{situation:'edited synthetic',problem:'verify',outcome:'result',action:'review only',basis:domain==='thought'?'user provided source':'',interpretation:''},confirmed:false,applied:false})
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'discovery-store-'));store=new DiscoveryStore(directory)})
afterEach(async()=>{await rm(directory,{recursive:true,force:true})})
test('explicit save restores edited results and question position in two independent tracks after a new process store',async()=>{
  const work=snapshot(),thought=snapshot('thought')
  const first=await store.execute({action:'save',revision:0,snapshot:work})
  await store.execute({action:'save',revision:first.revision,snapshot:thought})
  const reopened=await new DiscoveryStore(directory).execute({action:'load'})
  expect(reopened.records.work?.snapshot).toEqual(work);expect(reopened.records.thought?.snapshot).toEqual(thought)
  expect((await stat(path.join(directory,'reflections.json'))).mode&0o777).toBe(0o600)
  expect(await readdir(directory)).toEqual(['reflections.json'])
})
test('load alone writes nothing and strict snapshot rejects attachment, path, credentials and oversized fields',async()=>{
  expect(await store.execute({action:'load'})).toEqual({revision:0,records:{},trash:{},applied:[]});expect(await readdir(directory)).toEqual([])
  for(const extra of ['attachments','credentials','path','draft'])expect(validDiscovery({...snapshot(),[extra]:'not accepted'})).toBe(false)
  expect(validDiscovery({...snapshot(),answers:['a'.repeat(2001),'','','']})).toBe(false)
  expect(validDiscovery({...snapshot(),domain:'../outside'})).toBe(false)
  expect(validDiscoveryCommand({action:'load',path:'/tmp/anything'})).toBe(false)
})
test('deletion and durable undo preserve current saved track and duplicate application marks across restart',async()=>{
  const work=snapshot();let view=await store.execute({action:'save',revision:0,snapshot:work})
  view=await store.execute({action:'claim',revision:view.revision,id:work.id})
  view=await store.execute({action:'delete',revision:view.revision,domain:'work',id:work.id})
  expect(view.records.work).toBeUndefined();expect(view.trash.work?.snapshot).toEqual(work)
  const reopened=new DiscoveryStore(directory);view=await reopened.execute({action:'load'})
  view=await reopened.execute({action:'undo',revision:view.revision,domain:'work',id:work.id})
  expect(view.records.work?.snapshot).toEqual(work);expect(view.trash.work).toBeUndefined()
  await expect(reopened.execute({action:'claim',revision:view.revision,id:work.id})).rejects.toThrow('이미 적용')
})
test('undo never overwrites a later save; repeated mutation has one durable effect',async()=>{
  const first=snapshot();let view=await store.execute({action:'save',revision:0,snapshot:first})
  const command: DiscoveryCommand={action:'delete',revision:view.revision,domain:'work',id:first.id}
  const result=await Promise.allSettled([store.execute(command),store.execute(command)])
  expect(result.map(x=>x.status)).toEqual(['fulfilled','rejected'])
  view=await store.execute({action:'load'});const later=snapshot();view=await store.execute({action:'save',revision:view.revision,snapshot:later})
  await expect(store.execute({action:'undo',revision:view.revision,domain:'work',id:first.id})).rejects.toThrow('덮어쓰지')
  expect((await store.execute({action:'load'})).records.work?.snapshot).toEqual(later)
})
test.each(['broken JSON','future schema','oversize','invalid utf8'])('damaged %s is rejected without replacing original file',async(kind)=>{
  const bytes=kind==='future schema'?Buffer.from(JSON.stringify({revision:0,records:{},trash:{},applied:[],newField:1})):kind==='oversize'?Buffer.alloc(512*1024+1,32):kind==='invalid utf8'?Buffer.from([0xff]):Buffer.from('{broken')
  const file=path.join(directory,'reflections.json');await writeFile(file,bytes)
  await expect(store.execute({action:'load'})).rejects.toThrow('기존 파일은 바꾸지')
  await expect(store.execute({action:'save',revision:0,snapshot:snapshot()})).rejects.toThrow('기존 파일은 바꾸지')
  expect(await readFile(file)).toEqual(bytes)
})
test('symlink document and symlink directory are refused; target is untouched',async()=>{
  const target=path.join(directory,'protected.txt');await writeFile(target,'synthetic unchanged')
  await symlink(target,path.join(directory,'reflections.json'))
  await expect(store.execute({action:'load'})).rejects.toThrow('기존 파일은 바꾸지')
  const link=path.join(directory,'linked');await symlink(directory,link)
  await expect(new DiscoveryStore(link).execute({action:'save',revision:0,snapshot:snapshot()})).rejects.toThrow('기존 파일은 바꾸지')
  expect(await readFile(target,'utf8')).toBe('synthetic unchanged')
})
test('write failure leaves old saved content and queue usable',async()=>{
  const work=snapshot();await store.execute({action:'save',revision:0,snapshot:work})
  const before=await readFile(path.join(directory,'reflections.json'))
  await chmod(directory,0o500)
  try { await expect(store.execute({action:'save',revision:1,snapshot:snapshot()})).rejects.toThrow('저장에 실패');expect(await readFile(path.join(directory,'reflections.json'))).toEqual(before) } finally { await chmod(directory,0o700) }
  expect((await store.execute({action:'load'})).records.work?.snapshot).toEqual(work)
})
test('AI reservation survives restart without storing answers and blocks duplicate sends even after delete/undo',async()=>{
 const work=snapshot(),requestId=randomUUID(),workId='work_'+ 'a'.repeat(32)
 let view=await store.execute({action:'ai-reserve',revision:0,id:work.id,requestId})
 expect(view.records).toEqual({});expect(view.requests?.[work.id]).toEqual({requestId})
 await expect(store.execute({action:'ai-reserve',revision:view.revision,id:work.id,requestId:randomUUID()})).rejects.toThrow()
 await expect(store.execute({action:'ai-bind',revision:view.revision,id:work.id,requestId:randomUUID(),workId})).rejects.toThrow()
 view=await store.execute({action:'ai-bind',revision:view.revision,id:work.id,requestId,workId})
 const reopened=new DiscoveryStore(directory);view=await reopened.execute({action:'load'});expect(view.requests?.[work.id]).toEqual({requestId,workId})
 view=await reopened.execute({action:'save',revision:view.revision,snapshot:work});view=await reopened.execute({action:'delete',revision:view.revision,domain:'work',id:work.id});view=await reopened.execute({action:'undo',revision:view.revision,domain:'work',id:work.id})
 await expect(reopened.execute({action:'ai-reserve',revision:view.revision,id:work.id,requestId:randomUUID()})).rejects.toThrow()
 for(const extra of ['path','prompt','attachments'])expect(validDiscoveryCommand({action:'ai-reserve',revision:0,id:work.id,requestId,[extra]:'private'})).toBe(false)
 expect(validDiscoveryCommand({action:'ai-bind',revision:0,id:work.id,requestId,workId:'other_session'})).toBe(false)
})
