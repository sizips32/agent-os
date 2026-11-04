import {test,expect,afterEach,vi} from 'vitest'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises'
import {tmpdir,homedir} from 'node:os'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {Vault} from './vault'
import {vaultCompose,type VaultDraft} from './vault-types'
import {vaultProtection} from './sandbox'
const roots:string[]=[]
const note='---\ntitle: 합성 지식\ntags:\n  - alpha\n  - beta\n---\n# 합성 경험\n반복 작업 근거입니다.\n[[숨긴 노트]] ![[첨부]]\n## 코드\nconst value = "한글";\n'
async function fixture(){const temp=await mkdtemp(path.join(tmpdir(),'agent-vault-'));roots.push(temp);const root=path.join(temp,'vault'),storage=path.join(temp,'store');await mkdir(path.join(root,'0_INBOX'),{recursive:true});await mkdir(path.join(root,'1_SEMANTIC_LAYER/Concepts/Technical'),{recursive:true});await writeFile(path.join(root,'0_INBOX/source.md'),note);await writeFile(path.join(root,'1_SEMANTIC_LAYER/Concepts/Technical/Concept.md'),note);await writeFile(path.join(root,'1_SEMANTIC_LAYER/1_SEMANTIC_LAYER MOC.md'),'# 합성 MOC\n');const openUri=vi.fn(async(_uri:string)=>{});return {temp,root,storage,openUri,vault:new Vault(root,storage,openUri)}}
const search={action:'search' as const,query:'합성',folder:'0_INBOX' as const,tag:'',topic:''}
const draft=():VaultDraft=>({captureId:randomUUID(),title:'합성 결과',body:'# 결과\n한글 **Markdown**\n```ts\nconst value=1;\n```',tags:'agent-os alpha',sourceIds:[]})
afterEach(async()=>{await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})))})
test('bounded local title/tag/body search, URI encoding and no link traversal',async()=>{const {vault,openUri}=await fixture();const r=await vault.execute({...search,tag:'alpha'});expect(r.hits).toHaveLength(1);const hit=r.hits![0];const preview=(await vault.execute({action:'preview',id:hit.id})).preview!;expect(preview.text).toBe(note);expect(preview.headings).toHaveLength(2);await vault.execute({action:'open',id:hit.id});expect(new URL(openUri.mock.calls[0][0]).searchParams.get('path')).toContain('0_INBOX/source.md')})
test('exact selection only, trusted framing, release prevents reuse',async()=>{const {vault}=await fixture();const hit=(await vault.execute(search)).hits![0],start=note.indexOf('반복'),end=start+9;const e=(await vault.execute({action:'select',id:hit.id,hash:hit.hash,start,end})).evidence!;expect(e.text).toBe(note.slice(start,end));const prompt=vaultCompose('질문',[e]);expect(prompt).toContain(e.text);expect(prompt).not.toContain('const value');expect(prompt).not.toContain('![[첨부]]');expect(prompt).toContain('신뢰하지 않는 자료');await vault.execute({action:'release',id:e.id});await expect(vault.resolve([e.id])).rejects.toThrow()})
test('source change blocks preview and send without overwriting',async()=>{const {vault,root}=await fixture();const hit=(await vault.execute(search)).hits![0],e=(await vault.execute({action:'select',id:hit.id,hash:hit.hash,start:0,end:10})).evidence!;await writeFile(path.join(root,'0_INBOX/source.md'),'external edit');await expect(vault.execute({action:'preview',id:hit.id})).rejects.toThrow('변경');await expect(vault.resolve([e.id])).rejects.toThrow('바뀌');expect(await readFile(path.join(root,'0_INBOX/source.md'),'utf8')).toBe('external edit')})
test('hidden/secret/conflict/symlink and unsupported folders excluded',async()=>{const {vault,root,temp}=await fixture();for(const name of ['.hidden.md','auth.md','source.sync-conflict-fake.md'])await writeFile(path.join(root,'0_INBOX',name),note);await writeFile(path.join(root,'0_INBOX/sensitive.md'),'api_key: '+ 'x'.repeat(24));const outside=path.join(temp,'outside.md');await writeFile(outside,note);await symlink(outside,path.join(root,'0_INBOX/link.md'));expect((await vault.execute(search)).hits).toHaveLength(1);await expect(vault.execute({...search,folder:'../other' as any})).rejects.toThrow();await expect(vault.execute({action:'preview',id:'../outside'})).rejects.toThrow();expect(await readFile(outside,'utf8')).toBe(note)})
test('preview/cancel no write; concurrent save and restart deduplicate',async()=>{const {vault,root,storage,openUri}=await fixture();const d=draft();expect((await vault.execute({action:'save-preview',draft:d})).markdown).toContain('classification: INBOX');expect(await readdir(path.join(root,'0_INBOX'))).toEqual(['source.md']);const [a,b]=await Promise.all([vault.execute({action:'save',draft:d}),vault.execute({action:'save',draft:d})]);expect(a.saved).toEqual(b.saved);expect((await new Vault(root,storage,openUri).execute({action:'save',draft:{...d,captureId:randomUUID()}})).saved).toEqual(a.saved);expect((await readdir(path.join(root,'0_INBOX'))).filter(x=>x.startsWith('AgentOS-'))).toHaveLength(1);expect(await readFile(path.join(root,'0_INBOX/source.md'),'utf8')).toBe(note)})
test('same-name collision and external saved edit never overwritten',async()=>{const {vault,root}=await fixture();const d=draft(),p=path.join(root,'0_INBOX/AgentOS-'+d.captureId+'.md');await writeFile(p,'original');await expect(vault.execute({action:'save',draft:d})).rejects.toThrow('동명');expect(await readFile(p,'utf8')).toBe('original');const saved=(await vault.execute({action:'save',draft:{...draft(),title:'independent external edit test'}})).saved!;await writeFile(path.join(root,saved.path),'external edit');await expect(vault.execute({action:'suggest',saved})).rejects.toThrow('변경')})
test('link preview no write; confirmed new version leaves original draft/MOC intact',async()=>{const {vault,root}=await fixture();const saved=(await vault.execute({action:'save',draft:draft()})).saved!,original=await readFile(path.join(root,saved.path),'utf8'),hits=(await vault.execute({...search,folder:'1_SEMANTIC_LAYER'})).hits!,concept=hits.find(h=>h.path.endsWith('Concept.md'))!,moc=hits.find(h=>h.path.endsWith('MOC.md'))!,captureId=randomUUID();const before=await readdir(path.join(root,'0_INBOX'));expect((await vault.execute({action:'links-preview',saved,linkIds:[concept.id],captureId})).markdown).toContain('[[1_SEMANTIC_LAYER/Concepts/Technical/Concept.md]]');expect(await readdir(path.join(root,'0_INBOX'))).toEqual(before);const result=await vault.execute({action:'links-save',saved,linkIds:[concept.id],captureId});expect(result.saved!.path).not.toBe(saved.path);expect(await readFile(path.join(root,saved.path),'utf8')).toBe(original);expect((await vault.execute({action:'moc-preview',saved:result.saved!,id:moc.id})).diff).toContain('원문 변경 없음');expect(await readFile(path.join(root,moc.path),'utf8')).toBe('# 합성 MOC\n')})
test.each([{start:-1,end:1},{start:1,end:1},{start:0,end:9000},{start:1.5,end:4}])('invalid selection %j rejected',async bounds=>{const {vault}=await fixture();const hit=(await vault.execute(search)).hits![0];await expect(vault.execute({action:'select',id:hit.id,hash:hit.hash,...bounds})).rejects.toThrow()})
test('oversized note signals bounded/incomplete results',async()=>{const {vault,root}=await fixture();await writeFile(path.join(root,'0_INBOX/oversized.md'),'x'.repeat(65537));const r=await vault.execute(search);expect(r.limited).toBe(true);expect(r.scan!.oversized).toBe(1);expect(r.hits).toHaveLength(1)})
test('sandbox prevents synthetic read/write and descendant read; original hash intact',async()=>{if(process.platform!=='darwin')return;const {root}=await fixture(),file=path.join(root,'0_INBOX/source.md'),before=createHash('sha256').update(await readFile(file)).digest('hex'),profile=vaultProtection(root);for(const cmd of [['/bin/cat',file],['/bin/sh','-c','printf x > "$1"','_',file],['/bin/sh','-c','/bin/cat "$1"','_',file]])expect(()=>execFileSync('/usr/bin/sandbox-exec',['-p',profile,...cmd],{stdio:'pipe'})).toThrow();expect(createHash('sha256').update(await readFile(file)).digest('hex')).toBe(before)})
test('official SDK no-model contract reports exact supported runtime or closes safely on SDK drift',()=>{const r=JSON.parse(execFileSync(path.join(homedir(), '.hermes/hermes-agent/venv/bin/python'),['protected/vault-query.py','--check'],{encoding:'utf8'}));if(r.ready)expect(r.mode).toBe('fresh-text-no-tools');else expect(r.code).toBe('sdk_version_changed')})
test('SDK effective tool guard refuses nonempty schemas before query',()=>{
 const output=execFileSync(path.join(homedir(), '.hermes/hermes-agent/venv/bin/python'),['-c',`import runpy,types
m=runpy.run_path('protected/vault-query.py')
for tools,ok in [([],True),([{'function':{'name':'read_file'}}],False)]:
 cli=types.SimpleNamespace(enabled_toolsets=[],ignore_rules=True,agent=types.SimpleNamespace(tools=tools,valid_tool_names=set() if ok else {'read_file'},_execute_tool_calls=lambda *a:None,_build_system_prompt=lambda *a:'old context'))
 wrapped=m['guarded_init'](lambda **kw: True,cli)
 try:
  wrapped()
  assert ok
 except RuntimeError:
  assert not ok
print('guard passed')`],{encoding:'utf8'});expect(output.trim()).toBe('guard passed')
})

test('INBOX replacement between path check and publication cannot create outside note',async()=>{const {root,storage,temp,openUri}=await fixture();const outside=path.join(temp,'outside');await mkdir(outside);const v=new Vault(root,storage,openUri,{beforePublish:async()=>{const {rename}=await import('node:fs/promises');await rename(path.join(root,'0_INBOX'),path.join(root,'original-INBOX'));await symlink(outside,path.join(root,'0_INBOX'))}});await expect(v.execute({action:'save',draft:draft()})).rejects.toThrow('경계');expect(await readdir(outside)).toEqual([]);expect(await readdir(path.join(root,'original-INBOX'))).toEqual(['source.md'])})
test('private prefill/personality/cache are stripped and actual execution method blocked',()=>{const result=execFileSync(path.join(homedir(), '.hermes/hermes-agent/venv/bin/python'),['-c',`import runpy,types
m=runpy.run_path('protected/vault-query.py')
config={'prefill':'synthetic private marker'}
agent=types.SimpleNamespace(tools=[],valid_tool_names=set(),prefill_messages=['synthetic secret'],ephemeral_system_prompt='synthetic persona',_cached_system_prompt='synthetic cache',_execute_tool_calls=lambda *a:None,_build_system_prompt=lambda *a:'synthetic overlay')
cli=types.SimpleNamespace(enabled_toolsets=[],ignore_rules=True,agent=agent,prefill_messages=['synthetic prefill'],system_prompt='synthetic persona',conversation_history=['old turn'])
m['guarded_init'](lambda **kw:True,cli)()
assert cli.prefill_messages==[] and cli.system_prompt=='' and cli.conversation_history==[]
assert agent.prefill_messages==[] and agent.ephemeral_system_prompt is None
assert agent._build_system_prompt()==m['SYSTEM_PROMPT'] and 'synthetic' not in agent._build_system_prompt()
try:agent._execute_tool_calls([]);raise AssertionError('not blocked')
except RuntimeError:pass
assert config['prefill']=='synthetic private marker'
print('clean')`],{encoding:'utf8'});expect(result.trim()).toBe('clean')})
test('runtime structure mismatch fails before the query',()=>{const result=execFileSync(path.join(homedir(), '.hermes/hermes-agent/venv/bin/python'),['-c',`import runpy,types
m=runpy.run_path('protected/vault-query.py')
cli=types.SimpleNamespace(enabled_toolsets=[],ignore_rules=True,agent=types.SimpleNamespace(tools=[],valid_tool_names=set()))
try:m['guarded_init'](lambda **kw:True,cli)();raise AssertionError('not blocked')
except RuntimeError:print('blocked')`],{encoding:'utf8'});expect(result.trim()).toBe('blocked')})
test('private provider request overrides are refused without initialization',()=>{const result=execFileSync(path.join(homedir(), '.hermes/hermes-agent/venv/bin/python'),['-c',`import runpy,types
m=runpy.run_path('protected/vault-query.py')
cli=types.SimpleNamespace()
def initialize(**kw):raise AssertionError('must not initialize')
try:m['guarded_init'](initialize,cli)(request_overrides={'messages':['synthetic private context']});raise AssertionError('not blocked')
except RuntimeError:print('blocked')`],{encoding:'utf8'});expect(result.trim()).toBe('blocked')})
test('SDK source hash drift is rejected by no-model check',()=>{const result=execFileSync(path.join(homedir(), '.hermes/hermes-agent/venv/bin/python'),['-c',`import runpy,pathlib
m=runpy.run_path('protected/vault-query.py')
m['contract'].__globals__['SDK_PINS']['cli.py']='0'*64
try:m['contract'](pathlib.Path.home()/'.hermes/hermes-agent');raise AssertionError('must fail')
except RuntimeError:print('blocked')`],{encoding:'utf8'});expect(result.trim()).toBe('blocked')})

test('all YAML tag items and explicit Inbox domain are searchable',async()=>{const {vault,root}=await fixture();await writeFile(path.join(root,'0_INBOX/topic.md'),'---\ntitle: 합성 주제\ntags:\n  - first\n  - finance\n  - third\n---\nbody');const r=await vault.execute({...search,query:'',tag:'third',topic:'Financial'});expect(r.hits).toHaveLength(1);expect(r.hits![0].tags).toEqual(['first','finance','third'])})

test.each(['<% tp.user.exec() %>','```dataviewjs\napp.exec()\n```','`$= app.exec()`','<script>alert(1)</script>'])('executable Obsidian text is rejected before writing',async body=>{const {vault,root}=await fixture();await expect(vault.execute({action:'save',draft:{...draft(),body}})).rejects.toThrow('실행형');expect(await readdir(path.join(root,'0_INBOX'))).toEqual(['source.md'])})

test('uncertain publication reservation prevents duplicate creation after restart',async()=>{const {root,storage,openUri}=await fixture();const d=draft(),v=new Vault(root,storage,openUri,{beforePublish:async()=>{throw Error('synthetic interrupted publication')}});await expect(v.execute({action:'save',draft:d})).rejects.toThrow();const restarted=new Vault(root,storage,openUri);await expect(restarted.execute({action:'save',draft:{...d,captureId:randomUUID()}})).rejects.toThrow('미확정');expect(await readdir(path.join(root,'0_INBOX'))).toEqual(['source.md'])})

test('whole folder is scanned past the former 100-file cap; subtree still narrows',async()=>{const {vault,root}=await fixture();for(let i=0;i<110;i++)await writeFile(path.join(root,'1_SEMANTIC_LAYER',String(i).padStart(3,'0')+'.md'),'unrelated');const r=await vault.execute({...search,folder:'1_SEMANTIC_LAYER'});expect(r.hits!.map(h=>h.path).sort()).toEqual(['1_SEMANTIC_LAYER/1_SEMANTIC_LAYER MOC.md','1_SEMANTIC_LAYER/Concepts/Technical/Concept.md']);expect(r.scan).toMatchObject({notes:112,matched:2,truncated:false});expect(r.limited).toBe(false);expect((await vault.execute({...search,folder:'1_SEMANTIC_LAYER',subfolder:'Concepts/Technical'})).hits).toHaveLength(1)})
test('notes up to 10 path levels deep are searched; deeper ones mark the scan truncated',async()=>{const {vault,root}=await fixture();const deep=path.join(root,'1_SEMANTIC_LAYER/a/b/c/d/e/f');await mkdir(deep,{recursive:true});await writeFile(path.join(deep,'deep.md'),'# 깊은 합성');const tooDeep=path.join(root,'1_SEMANTIC_LAYER/a/b/c/d/e/f/g/h/i/j');await mkdir(tooDeep,{recursive:true});await writeFile(path.join(tooDeep,'hidden-deep.md'),'# 너무 깊은 합성');const r=await vault.execute({...search,folder:'1_SEMANTIC_LAYER'});const paths=r.hits!.map(h=>h.path);expect(paths).toContain('1_SEMANTIC_LAYER/a/b/c/d/e/f/deep.md');expect(paths.some(p=>p.endsWith('hidden-deep.md'))).toBe(false);expect(r.scan!.truncated).toBe(true)})
test('ranking puts title matches before tag and body matches, then path order',async()=>{const {vault,root}=await fixture();const dir=path.join(root,'_giselle');await mkdir(dir);await writeFile(path.join(dir,'a-body.md'),'# 기타\n본문에 열쇠말');await writeFile(path.join(dir,'b-tag.md'),'---\ntags:\n  - 열쇠말\n---\n# 태그만');await writeFile(path.join(dir,'c-title.md'),'# 열쇠말 제목');const r=await vault.execute({...search,query:'열쇠말',folder:'_giselle'});expect(r.hits!.map(h=>path.basename(h.path))).toEqual(['c-title.md','b-tag.md','a-body.md'])})
test('only the top 30 matches get ids; matched count and limited report the rest',async()=>{const {vault,root}=await fixture();for(let i=0;i<40;i++)await writeFile(path.join(root,'0_INBOX','n'+String(i).padStart(2,'0')+'.md'),'합성 '+i);const r=await vault.execute(search);expect(r.hits).toHaveLength(30);expect(r.scan).toMatchObject({matched:41,notes:41});expect(r.limited).toBe(true)})
test('time budget stops the scan and reports truncation instead of hanging',async()=>{const {root,storage,openUri}=await fixture();const vault=new Vault(root,storage,openUri,{searchBudgetMs:-1});const r=await vault.execute(search);expect(r.hits).toHaveLength(0);expect(r.scan!.truncated).toBe(true);expect(r.limited).toBe(true)})
test.each(['../0_INBOX','/tmp','.obsidian','Concepts//Technical','Concepts/./Technical','Concepts/../Technical','Concepts\\Technical'])('unsafe search subtree %s rejected',async subfolder=>{const {vault}=await fixture();await expect(vault.execute({...search,subfolder})).rejects.toThrow()})

test('runner diagnostic classifier emits fixed categories without leaking error details',()=>{const result=execFileSync('python3',['-B','-c',`import runpy
m=runpy.run_path('protected/vault-query.py')
for error,code in [(RuntimeError('SDK version changed; private fixture'),'sdk_changed'),(RuntimeError('tools forbidden in vault context'),'tools_blocked'),(PermissionError('local network forbidden'),'network_blocked'),(RuntimeError('private fixture token /secret/path'),'runtime_boundary')]:
 assert m['safe_failure'](error)==code
print('fixed codes only')`],{encoding:'utf8'});expect(result.trim()).toBe('fixed codes only')})

test('official selector never enters changed interactive TUI path for isolated quiet oneshot even on a TTY',()=>{const result=execFileSync('python3',['-B','-c',`import ast,types,pathlib
source=ast.parse((pathlib.Path.home()/'.hermes/hermes-agent/cli.py').read_text())
f=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='_should_seed_interactive')
ns={'sys':types.SimpleNamespace(stdin=types.SimpleNamespace(isatty=lambda:True),stdout=types.SimpleNamespace(isatty=lambda:True))}
exec(compile(ast.Module(body=[f],type_ignores=[]),'public SDK selector','exec'),ns)
assert ns['_should_seed_interactive']('synthetic question',None,True,True) is False
print('oneshot excludes interactive TUI')`],{encoding:'utf8'});expect(result.trim()).toBe('oneshot excludes interactive TUI')})


test('_giselle notes are searchable and selectable without following links; saves stay in INBOX',async()=>{
 const {vault,root}=await fixture();await mkdir(path.join(root,'_giselle'));await writeFile(path.join(root,'_giselle/guide.md'),note);
 const result=await vault.execute({...search,folder:'_giselle'});expect(result.hits).toHaveLength(1);const hit=result.hits![0];expect(hit.path).toBe('_giselle/guide.md');
 expect((await vault.execute({action:'preview',id:hit.id})).preview?.text).toBe(note);
 const evidence=(await vault.execute({action:'select',id:hit.id,hash:hit.hash,start:0,end:10})).evidence!;expect((await vault.resolve([evidence.id]))[0].text).toBe(note.slice(0,10));
 const saved=(await vault.execute({action:'save',draft:{...draft(),sourceIds:[evidence.id]}})).saved!;expect(saved.path.startsWith('0_INBOX/AgentOS-')).toBe(true);
 expect(await readdir(path.join(root,'_giselle'))).toEqual(['guide.md']);expect(await readFile(path.join(root,'_giselle/guide.md'),'utf8')).toBe(note);
 for(const folder of ['_other','_giselle/../private'])await expect(vault.execute({...search,folder:folder as any})).rejects.toThrow('검색 범위');
})
