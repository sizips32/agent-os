import { test, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sessions, conversationResult } from './sessions'
import { FileAcpLedger } from './acp-ledger'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
const id = 'work_' + 'c'.repeat(32),
  body = {
    sessionId: 'selected_cli',
    limited: true,
    messages: [
      { role: 'user', text: 'local fixture' },
      { role: 'assistant', text: 'local answer' }
    ]
  }
test('summary reads are bounded and authorized, preserve references and never persist questions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-title-'))
  try {
    const ledger = new FileAcpLedger(root)
    ledger.claim(id, 'a'.repeat(64))
    ledger.settle(id, { status: 'completed', sessionId: 'selected_cli', text: '', reason: '', verification: '' })
    const before = readFileSync(join(root, id + '.json'), 'utf8')
    const calls: string[] = []
    const sessions = new Sessions(
      ledger,
      '',
      async () => body,
      undefined,
      async session => {
        calls.push(session)
        return { title: '오늘 한국어 질문을 정리해 줘', startedAt: 1700000000 }
      }
    )
    for (const invalid of [[id, 'work_' + 'd'.repeat(32)], ['latest'], Array(11).fill(id), null])
      await expect(sessions.summaries(invalid)).rejects.toThrow()
    expect(calls).toEqual([])
    expect(await sessions.summaries([id, id])).toEqual([
      { workId: id, title: '오늘 한국어 질문을 정리해 줘', startedAt: 1700000000, unavailable: false }
    ])
    expect(calls).toEqual(['selected_cli'])
    expect((await sessions.open(id)).sessionId).toBe('selected_cli')
    expect(readFileSync(join(root, id + '.json'), 'utf8')).toBe(before)
    expect(readdirSync(root)).toEqual([id + '.json'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test.each([
  null,
  { title: 'x'.repeat(201), startedAt: null },
  { title: 'bad\ncontrol', startedAt: null },
  { title: 'safe', startedAt: 'wrong' }
])('malformed summary becomes honest unavailable fallback', async value => {
  const root = mkdtempSync(join(tmpdir(), 'agent-title-invalid-'))
  try {
    const ledger = new FileAcpLedger(root)
    ledger.claim(id, 'a'.repeat(64))
    ledger.settle(id, { status: 'completed', sessionId: 'selected_cli', text: '', reason: '', verification: '' })
    expect(await new Sessions(ledger, '', undefined, undefined, async () => value).summaries([id])).toEqual([
      { workId: id, title: null, startedAt: null, unavailable: true }
    ])
    expect(
      await new Sessions(ledger, '', undefined, undefined, async () => {
        throw Error('private failure')
      }).summaries([id])
    ).toEqual([{ workId: id, title: null, startedAt: null, unavailable: true }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('first question helper is chronological, Korean-safe, bounded, redacted and excludes summaries/system/tool/assistant', () => {
  const result = execFileSync(
    'python3',
    [
      '-B',
      '-c',
      `import sys,importlib.util
s=importlib.util.spec_from_file_location('reader','protected/sessions.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class DB:
 def __init__(self,rows):self.rows=rows
 def _read_one(self,sql,args):
  assert 'system_prompt' not in sql and 'title' not in sql
  return {'id':args[0],'source':'cli','model_config':'{}'}
 def session_yolo_enabled(self,row):return False
 def session_gateway_runtime(self,row):return {'provider':'openai-codex'}
 def _resume_lineage_ids(self,s):return ['root',s]
 def get_compression_chain(self,s):assert s=='root';return ['root','tip']
 def get_messages(self,s,**kw):
  assert kw=={'limit':61,'latest':False,'include_compacted':True}
  return self.rows if s=='root' else [{'role':'user','content':'later question'}]
def redact(text,force):assert force;return text.replace('secret fixture','[REDACTED]')
prefix=[{'role':r,'content':'private should not display'} for r in ['system','tool','assistant']]+[{'role':'user','content':'compression summary','_compressed_summary':True}]
q='오늘 할 일을 정리해 줘 '
r=m.read_summary(DB(prefix+[{'role':'user','content':q*20,'timestamp':1700000000}]),'tip',redact)
assert r['title'].startswith(q) and r['title'].endswith('…') and len(r['title'])==81 and r['startedAt']==1700000000
for text in ['', 'secret fixture']:
 assert m.read_summary(DB([{'role':'user','content':text}]),'tip',redact)['title'] is None
assert m.read_summary(DB([{'role':'system','content':'x'}]*61),'tip',redact)['title'] is None
assert m.read_summary(DB([{'role':'user','content':'first question'},{'role':'user','content':'later'}]),'tip',redact)['title']=='first question'
print('first-question-only / bounded / redacted')`
    ],
    { encoding: 'utf8' }
  )
  expect(result.trim()).toBe('first-question-only / bounded / redacted')
})
test('only an app-owned exact work receipt can read, and restart restores by reference only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-sessions-'))
  try {
    const ledger = new FileAcpLedger(root)
    ledger.claim(id, 'a'.repeat(64))
    ledger.settle(id, {
      status: 'completed',
      sessionId: 'selected_cli',
      text: 'must not persist',
      reason: '',
      verification: ''
    })
    let reads = 0
    const reader = async (s: string) => {
      expect(s).toBe('selected_cli')
      reads++
      return body
    }
    for (const invalid of ['../bad', 'latest', 'selected_cli', 'work_' + 'd'.repeat(32), null])
      await expect(new Sessions(ledger, '', reader).open(invalid)).rejects.toThrow()
    expect(reads).toBe(0)
    const restored = await new Sessions(new FileAcpLedger(root), '', reader).open(id)
    expect(restored).toMatchObject({ ...body, workId: id, canResume: true })
    expect(readFileSync(join(root, id + '.json'), 'utf8')).not.toMatch(/local fixture|local answer|must not persist/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('unknown outcome is readable but cannot resume; linked receipt denied', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-session-'))
  try {
    const l = new FileAcpLedger(root)
    l.claim(id, 'a'.repeat(64))
    l.settle(id, {
      status: 'unknown',
      sessionId: 'selected_cli',
      text: '',
      reason: '',
      verification: ''
    })
    expect((await new Sessions(l, '', async () => body).open(id)).canResume).toBe(false)
    symlinkSync(join(root, id + '.json'), join(root, 'work_' + 'e'.repeat(32) + '.json'))
    await expect(new Sessions(l, '', async () => body).open('work_' + 'e'.repeat(32))).rejects.toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test.each([
  null,
  { ...body, sessionId: 'latest' },
  { ...body, sessionId: '../bad' },
  { ...body, messages: [{ role: 'system', text: 'memory' }] },
  { ...body, messages: [{ role: 'user', text: 'x'.repeat(12001) }] },
  { ...body, messages: Array(61).fill(body.messages[0]) }
])('malformed helper output fails closed', v => expect(() => conversationResult(v)).toThrow())
test('official read helper uses only selected lineage, bounded messages and forced redaction', () => {
  const result = execFileSync(
    'python3',
    [
      '-B',
      '-c',
      `import sys,importlib.util,json
spec=importlib.util.spec_from_file_location('session_reader','protected/sessions.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class DB:
 def _read_one(self,sql,args):
  assert 'system_prompt' not in sql
  assert args[0] in ('chosen','tip')
  return {'id':args[0],'source':'cli','model_config':'{}'}
 def session_yolo_enabled(self,row):return False
 def session_gateway_runtime(self,row):return {'provider':'openai-codex'}
 def _resume_lineage_ids(self,s):return [s]
 def get_compression_chain(self,s):assert s=='chosen';return ['chosen','tip']
 def get_messages(self,s,**kw):
  assert kw=={'limit':61,'latest':True}
  return [{'role':'system','content':'private memory'},{'role':'tool','content':'secret tool'}, {'role':'assistant','content':'token fixture'}]
def redact(text,force):assert force;return text.replace('token','[REDACTED]')
r=mod.read_selected(DB(),'chosen',redact)
assert r['sessionId']=='tip' and len(r['messages'])==2
assert all(x['text']=='[REDACTED] fixture' for x in r['messages'])
print('selected-only/redacted/bounded')`
    ],
    { encoding: 'utf8' }
  )
  expect(result.trim()).toBe('selected-only/redacted/bounded')
})
test('an exact user-selected existing Giselle conversation survives restart with reference-only storage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-select-'))
  try {
    const l = new FileAcpLedger(join(root, 'receipts')),
      store = join(root, 'selected'),
      calls: string[] = []
    const reader = async (s: string) => {
      calls.push(s)
      if (s === 'other_profile') throw Error('not in Giselle')
      return { ...body, sessionId: s }
    }
    const first = new Sessions(l, '', reader, store)
    await expect(first.select('latest')).rejects.toThrow()
    await expect(first.select('../x')).rejects.toThrow()
    await expect(first.select('other_profile')).rejects.toThrow()
    expect(first.references()).toEqual([])
    const selected = await first.select('chosen_desktop')
    expect(selected.canResume).toBe(true)
    const restarted = new Sessions(new FileAcpLedger(join(root, 'receipts')), '', reader, store)
    expect(restarted.references()).toEqual([{ workId: selected.workId, sessionId: 'chosen_desktop' }])
    expect((await restarted.open(selected.workId)).messages).toEqual(body.messages)
    const saved = readFileSync(join(store, selected.workId + '.json'), 'utf8')
    expect(JSON.parse(saved)).toEqual({
      profile: 'giselle',
      sessionId: 'chosen_desktop'
    })
    expect(saved).not.toMatch(/local fixture|local answer/)
    l.claim(id, 'a'.repeat(64))
    l.settle(id, {
      status: 'unknown',
      sessionId: 'chosen_desktop',
      text: '',
      reason: '',
      verification: ''
    })
    expect((await first.open(selected.workId)).canResume).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('older unknown receipt cannot be hidden by fifty newer completed receipts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-unsettled-'))
  try {
    const l = new FileAcpLedger(root)
    l.claim(id, 'a'.repeat(64))
    l.settle(id, {
      status: 'unknown',
      sessionId: 'selected_cli',
      text: '',
      reason: '',
      verification: ''
    })
    for (let n = 1; n < 55; n++) {
      const k = 'work_' + n.toString(16).padStart(32, '0')
      l.claim(k, 'a'.repeat(64))
      l.settle(k, {
        status: 'completed',
        sessionId: 'unrelated',
        text: '',
        reason: '',
        verification: ''
      })
    }
    expect(l.hasUnsettledSession(['selected_cli'])).toBe(true)
    expect((await new Sessions(l, '', async () => body).open(id)).canResume).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('resumed session cannot restore YOLO, a different provider or custom endpoint', () => {
  const result = execFileSync(
    'python3',
    [
      '-B',
      '-c',
      `import importlib.util
s=importlib.util.spec_from_file_location('sessions','protected/sessions.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class DB:
 def session_yolo_enabled(self,v):return v.get('yolo',False)
 def session_gateway_runtime(self,v):return v
for bad in [{'yolo':True},{'provider':'other-provider'},{'base_url':'https://example.invalid'}]:
 try:m.safe_route(DB(),bad)
 except ValueError:pass
 else:raise AssertionError('unsafe resume accepted')
m.safe_route(DB(),{'provider':'openai-codex','base_url':'https://chatgpt.com/backend-api/codex'})
print('safe route')`
    ],
    { encoding: 'utf8' }
  )
  expect(result.trim()).toBe('safe route')
})
