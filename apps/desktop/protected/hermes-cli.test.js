import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { test } from 'vitest'
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdtemp, rm, writeFile, readFile, stat } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
import { executionDiagnostic } from './execution-diagnostic.ts'
import { HermesCli, hermesRoute, hermesArguments } from './hermes-cli.ts'
import { FileAcpLedger } from './acp-ledger.ts'
import { LONG_REQUEST_NOTICE_MS, REQUEST_TIMEOUT_MS } from './request-wait.ts'
const id = 'work_' + '1'.repeat(32),
  work = {
    work_id: id,
    adapter: 'hermes',
    state: 'awaiting_handoff',
    instructions: 'fixture only',
    artifacts: []
  }
async function harness(mode, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ohha-hermes-'))
  let spawned = 0,
    records = 0
  const ledger = new FileAcpLedger(dir)
  const ports = {
    detail: async () => work,
    policy: async () => true,
    record: async () => {
      records++
    },
    launch: () => {
      spawned++
      return spawn(process.execPath, [join(__dirname, 'hermes-cli.fixture.cjs'), mode], {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    },
    timeoutMs: 2000,
    ...overrides
  }
  return {
    runner: new HermesCli(ledger, ports),
    ledger,
    ports,
    get spawned() {
      return spawned
    },
    get records() {
      return records
    },
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}
async function done(r) {
  for (let n = 0; n < 200; n++) {
    const s = await r.request({ action: 'status', workId: id })
    if (s.status !== 'running') return s
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw Error('fixture timeout')
}
test('gateway empty init is a connection notice; final nonempty session records exactly once', async () => {
  const h = await harness('gateway_success')
  try {
    await h.runner.request({ action: 'start', workId: id })
    const s = await done(h.runner)
    assert.equal(s.status, 'completed')
    assert.equal(s.sessionId, 'fixture_gateway_session')
    assert.equal(s.text, 'fixture gateway response')
    assert.ok(s.events.includes('connection_started'))
    assert.ok(s.events.includes('session_confirmed'))
    assert.ok(s.events.includes('tool_started:fixture_tool'))
    assert.equal(h.ledger.sessionReference(id), s.sessionId)
    assert.equal(h.records, 1)
    await new HermesCli(h.ledger, h.ports).request({ action: 'start', workId: id })
    assert.equal(h.spawned, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
test('empty init alone stays running without a confirmed session; timeout never records or retries', async () => {
  const h = await harness('gateway_wait', { timeoutMs: 300 })
  try {
    await h.runner.request({ action: 'start', workId: id })
    let s
    for (let n = 0; n < 100; n++) {
      s = await h.runner.request({ action: 'status', workId: id })
      if (s.events.includes('connection_started') || s.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(s.status, 'running')
    assert.equal(s.sessionId, '')
    assert.deepEqual(s.events, ['connection_started'])
    s = await done(h.runner)
    assert.equal(s.status, 'unknown')
    assert.equal(s.interruption, 'timeout')
    assert.equal(h.records, 0)
    await new HermesCli(h.ledger, h.ports).request({ action: 'start', workId: id })
    assert.equal(h.spawned, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
for (const mode of ['startup_failure', 'turn_failure'])
  test(`gateway ${mode} preserves safe exit diagnosis and never records a response`, async () => {
    const h = await harness('gateway_' + mode)
    try {
      await h.runner.request({ action: 'start', workId: id })
      const s = await done(h.runner)
      assert.equal(s.status, 'unknown')
      assert.equal(s.sessionId, mode === 'startup_failure' ? '' : 'fixture_gateway_session')
      assert.equal(s.diagnostic.code, 'provider_result_failed')
      assert.equal(s.diagnostic.stage, mode === 'startup_failure' ? 'initialization' : 'model')
      assert.equal(s.diagnostic.branch, 'cli_result')
      assert.equal(s.diagnostic.exitCode, 1)
      assert.ok(s.events.includes('response_failed'))
      assert.equal(s.events.includes('response_received'), false)
      assert.equal(h.records, 0)
      const restored = await new HermesCli(h.ledger, h.ports).request({ action: 'start', workId: id })
      assert.deepEqual(restored.diagnostic, s.diagnostic)
      assert.equal(JSON.stringify([s, restored]).includes('private diagnostic fixture'), false)
      assert.equal(h.spawned, 1)
    } finally {
      await h.runner.stop()
      await h.cleanup()
    }
  })
for (const [mode, branch] of [
  ['empty_success', 'invalid_result'],
  ['duplicate_init', 'invalid_init'],
  ['no_init', 'invalid_init']
])
  test(`gateway ${mode} is quarantined with its parser branch`, async () => {
    const h = await harness('gateway_' + mode)
    try {
      await h.runner.request({ action: 'start', workId: id })
      const s = await done(h.runner)
      assert.equal(s.status, 'unknown')
      assert.equal(s.diagnostic.code, 'transport_invalid')
      assert.equal(s.diagnostic.branch, branch)
      assert.equal(s.events.includes('response_received'), false)
      assert.equal(h.records, 0)
      await new HermesCli(h.ledger, h.ports).request({ action: 'start', workId: id })
      assert.equal(h.spawned, 1)
    } finally {
      await h.runner.stop()
      await h.cleanup()
    }
  })
test('diagnostic metadata accepts only fixed branches and bounded integer exit codes', () => {
  const at = '2026-10-22T00:00:00.000Z'
  assert.deepEqual(
    executionDiagnostic('transport_invalid', 'transport', at, {
      branch: 'invalid_init',
      exitCode: 2,
      secret: 'must not persist'
    }),
    { code: 'transport_invalid', stage: 'transport', at, branch: 'invalid_init', exitCode: 2 }
  )
  for (const detail of [
    { branch: 'credential-bearing text' },
    { exitCode: 256 },
    { exitCode: -1 },
    { exitCode: '1' },
    { exitCode: 1.5 }
  ])
    assert.throws(() => executionDiagnostic('transport_invalid', 'transport', at, detail))
})
test('Hermes IPC rejects arbitrary commands, profiles, paths and malformed work references', () => {
  for (const v of [
    null,
    {},
    { action: 'start', workId: id, prompt: 'override' },
    { action: 'start', workId: '../x' },
    { action: 'shell', workId: id }
  ])
    assert.throws(() => hermesRoute(v))
})
test('CLI response records once; same work cannot submit again after host restart', async () => {
  const h = await harness('complete')
  try {
    assert.equal((await h.runner.request({ action: 'start', workId: id })).status, 'running')
    const s = await done(h.runner)
    assert.equal(s.status, 'completed')
    assert.equal(s.text, 'fixture response')
    assert.equal(h.records, 1)
    await h.runner.request({ action: 'start', workId: id })
    assert.equal(h.spawned, 1)
    const restarted = new HermesCli(h.ledger, h.ports)
    assert.equal((await restarted.request({ action: 'start', workId: id })).status, 'unknown')
    assert.equal(h.spawned, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
for (const mode of ['tool', 'invalid', 'missing', 'mismatch', 'failure', 'duplicate'])
  test(`CLI ${mode} stays unknown, has no result record and cannot retry`, async () => {
    const h = await harness(mode)
    try {
      await h.runner.request({ action: 'start', workId: id })
      assert.equal((await done(h.runner)).status, 'unknown')
      assert.equal(h.records, 0)
      await h.runner.request({ action: 'start', workId: id })
      assert.equal(h.spawned, 1)
    } finally {
      await h.runner.stop()
      await h.cleanup()
    }
  })
test('cancel, timeout and app shutdown stop only owned fixture and never claim verified cancellation', async () => {
  for (const timeoutMs of [2000, 30]) {
    const h = await harness('wait', { timeoutMs })
    try {
      await h.runner.request({ action: 'start', workId: id })
      if (timeoutMs === 2000) {
        await h.runner.request({ action: 'cancel', workId: id })
        await h.runner.stop()
      }
      assert.equal((await done(h.runner)).status, 'unknown')
      assert.equal(h.records, 0)
    } finally {
      await h.runner.stop()
      await h.cleanup()
    }
  }
})
test('policy refusal and wrong work never launch; record failure cannot resubmit', async () => {
  for (const overrides of [{ policy: async () => false }, { detail: async () => ({ ...work, adapter: 'buzz' }) }]) {
    const h = await harness('complete', overrides)
    try {
      await assert.rejects(h.runner.request({ action: 'start', workId: id }))
      assert.equal(h.spawned, 0)
    } finally {
      await h.cleanup()
    }
  }
  const h = await harness('complete', {
    record: async () => {
      throw Error('offline')
    }
  })
  try {
    await h.runner.request({ action: 'start', workId: id })
    assert.equal((await done(h.runner)).status, 'unknown')
    await h.runner.request({ action: 'start', workId: id })
    assert.equal(h.spawned, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
test('cancel arriving during policy preflight prevents later launch', async () => {
  let release
  const h = await harness('complete', {
    policy: () => new Promise(r => (release = r))
  })
  try {
    const pending = h.runner.request({ action: 'start', workId: id })
    await h.runner.request({ action: 'cancel', workId: id })
    release(true)
    await assert.rejects(pending, /cancelled before/)
    assert.equal(h.spawned, 0)
  } finally {
    await h.cleanup()
  }
})

test('stream deltas are visible before terminal result; final reply replaces partial text', async () => {
  const h = await harness('stream')
  try {
    await h.runner.request({ action: 'start', workId: id })
    let partial
    for (let n = 0; n < 100; n++) {
      partial = await h.runner.request({ action: 'status', workId: id })
      if (partial.text) break
      await new Promise(r => setTimeout(r, 5))
    }
    assert.equal(partial.status, 'running')
    assert.equal(partial.text, 'partial ')
    const final = await done(h.runner)
    assert.equal(final.text, 'partial reply')
    assert.equal(final.status, 'completed')
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
test('existing tool events are observed without granting permissions or retaining private tool data', async () => {
  const h = await harness('tools_complete')
  try {
    await h.runner.request({ action: 'start', workId: id })
    const final = await done(h.runner)
    assert.equal(final.status, 'completed')
    assert.ok(final.events.includes('tool_started:skill_view'))
    assert.ok(final.events.includes('tool_finished:skill_view'))
    assert.ok(!JSON.stringify(final).includes('private not retained'))
    assert.ok(h.ledger.recentKeys().includes(id))
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})

test('cancel during partial stream retains partial text and terminates only owned child', async () => {
  const h = await harness('stream-wait', { timeoutMs: 5000 })
  try {
    await h.runner.request({ action: 'start', workId: id })
    for (let n = 0; n < 300; n++) {
      if ((await h.runner.request({ action: 'status', workId: id })).text) break
      await new Promise(r => setTimeout(r, 5))
    }
    assert.equal((await h.runner.request({ action: 'status', workId: id })).text, 'local partial response')
    await h.runner.request({ action: 'cancel', workId: id })
    const final = await done(h.runner)
    assert.equal(final.status, 'unknown')
    assert.equal(final.text, 'local partial response')
    assert.equal(h.records, 0)
    await h.runner.request({ action: 'start', workId: id })
    assert.equal(h.spawned, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
test('cancel after terminal child exit cannot overwrite a completed receipt', async () => {
  let enter, release
  const entered = new Promise(r => (enter = r))
  const record = new Promise(r => (release = r))
  const h = await harness('complete', {
    record: async () => {
      enter()
      await record
    }
  })
  try {
    await h.runner.request({ action: 'start', workId: id })
    await entered
    await h.runner.request({ action: 'cancel', workId: id })
    release()
    assert.equal((await done(h.runner)).status, 'completed')
    assert.equal((await h.runner.request({ action: 'cancel', workId: id })).status, 'completed')
    assert.equal(h.spawned, 1)
  } finally {
    release()
    await h.runner.stop()
    await h.cleanup()
  }
})
test('resume is validated again before dispatch and never accepts a changed or unknown session', async () => {
  for (const resume of [
    async () => 'changed_session',
    async () => {
      throw Error('unknown')
    }
  ]) {
    const h = await harness('complete', {
      detail: async () => ({
        ...work,
        resumeWorkId: id,
        resumeSessionId: 'selected_session'
      }),
      resume
    })
    try {
      await assert.rejects(h.runner.request({ action: 'start', workId: id }))
      assert.equal(h.spawned, 0)
    } finally {
      await h.cleanup()
    }
  }
  let selected = ''
  const h = await harness('complete', {
    detail: async () => ({
      ...work,
      resumeWorkId: id,
      resumeSessionId: 'selected_session'
    }),
    resume: async () => 'selected_session',
    launch: s => {
      selected = s
      return spawn(process.execPath, [join(__dirname, 'hermes-cli.fixture.cjs'), 'complete'], {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }
  })
  try {
    await h.runner.request({ action: 'start', workId: id })
    assert.equal((await done(h.runner)).status, 'completed')
    assert.equal(selected, 'selected_session')
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})

test('fixed CLI image arguments cannot become shell options or override resume/profile', () => {
  const file = `/tmp/agent-os-attachments-fixture/${id}.png`
  assert.deepEqual(hermesArguments('fixture_session', file), [
    '--profile',
    'giselle',
    'chat',
    '--query-file',
    '-',
    '--oneshot',
    '--format',
    'stream-json',
    '--resume',
    'fixture_session',
    '--no-restore-cwd',
    '--image',
    file
  ])
  for (const p of ['--profile', '../x.png', '/tmp/evil.png', file + '\0'])
    assert.throws(() => hermesArguments(undefined, p))
  assert.throws(() => hermesArguments('--yolo', file))
})
test('owned image bytes and actual text reach fixture transport once; close cleans image; changed or unverified images never launch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-os-image-transport-'))
  const imagePath = join(dir, `${id}.png`),
    bytes = Buffer.from('fixture image bytes')
  await writeFile(imagePath, bytes)
  const image = { path: imagePath, sha256: createHash('sha256').update(bytes).digest('hex') }
  let observed = false,
    released = 0
  const h = await harness('complete', {
    detail: async () => ({ ...work, instructions: 'actual text attachment fixture', image }),
    imagePolicy: async () => true,
    release: async () => {
      released++
      await rm(imagePath)
    },
    launch: (_session, actualPath) => {
      assert.equal(actualPath, imagePath)
      observed = true
      return spawn(
        process.execPath,
        [
          '-e',
          `let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{if(text!=='actual text attachment fixture'||require('node:fs').readFileSync(process.argv[1],'utf8')!=='fixture image bytes')process.exit(9);for(const v of [{type:'system',subtype:'init',session_id:'fixture'},{type:'result',session_id:'fixture',exit_code:0,text:'fixture verified text and image bytes'}])console.log(JSON.stringify(v))})`,
          actualPath
        ],
        { detached: true, stdio: ['pipe', 'pipe', 'pipe'] }
      )
    }
  })
  try {
    await h.runner.request({ action: 'start', workId: id })
    assert.equal((await done(h.runner)).status, 'completed')
    assert.equal(observed, true)
    assert.equal(released, 1)
    await assert.rejects(stat(imagePath))
    await h.runner.request({ action: 'start', workId: id })
    assert.equal(released, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
  for (const [allowed, content] of [
    [false, bytes],
    [true, Buffer.from('changed')]
  ]) {
    await writeFile(imagePath, content)
    const blocked = await harness('complete', {
      detail: async () => ({ ...work, image }),
      imagePolicy: async () => allowed
    })
    try {
      await assert.rejects(blocked.runner.request({ action: 'start', workId: id }))
      assert.equal(blocked.spawned, 0)
    } finally {
      await blocked.runner.stop()
      await blocked.cleanup()
    }
  }
  await rm(dir, { recursive: true, force: true })
})
test('image snapshot remains until an owned cancelled child closes and then releases once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-os-image-cancel-')),
    imagePath = join(dir, `${id}.png`),
    bytes = Buffer.from('fixture')
  await writeFile(imagePath, bytes)
  let released = 0
  const h = await harness('wait', {
    detail: async () => ({
      ...work,
      image: { path: imagePath, sha256: createHash('sha256').update(bytes).digest('hex') }
    }),
    imagePolicy: async () => true,
    release: async () => {
      released++
      await rm(imagePath)
    }
  })
  try {
    await h.runner.request({ action: 'start', workId: id })
    assert.equal((await stat(imagePath)).isFile(), true)
    await h.runner.request({ action: 'cancel', workId: id })
    await h.runner.stop()
    assert.equal(released, 1)
    await assert.rejects(stat(imagePath))
    assert.equal((await done(h.runner)).status, 'unknown')
  } finally {
    await h.runner.stop()
    await h.cleanup()
    await rm(dir, { recursive: true, force: true })
  }
})
test('long tool analysis survives two-minute notice; only the later hard deadline stops it', async () => {
  assert.equal(LONG_REQUEST_NOTICE_MS, 120000)
  assert.equal(REQUEST_TIMEOUT_MS, 900000)
  const h = await harness('delayed_complete', { noticeMs: 10, timeoutMs: 1500 })
  try {
    await h.runner.request({ action: 'start', workId: id })
    await new Promise(r => setTimeout(r, 50))
    const pending = await h.runner.request({ action: 'status', workId: id })
    assert.equal(pending.status, 'running')
    assert.match(pending.reason, /최대 15분/)
    assert.equal((await done(h.runner)).status, 'completed')
    assert.equal(h.spawned, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
test('hard timeout preserves its cause after restart and never retries a submitted request', async () => {
  const h = await harness('wait', { noticeMs: 10, timeoutMs: 80 })
  try {
    await h.runner.request({ action: 'start', workId: id })
    const result = await done(h.runner)
    assert.equal(result.status, 'unknown')
    assert.equal(result.interruption, 'timeout')
    assert.match(result.reason, /시간 제한/)
    const restarted = new HermesCli(h.ledger, h.ports)
    const restored = await restarted.request({ action: 'start', workId: id })
    assert.equal(restored.status, 'unknown')
    assert.equal(restored.interruption, 'timeout')
    assert.match(restored.reason, /재전송하지/)
    assert.equal(h.spawned, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
test('only scoped discovery questions skip context and memory in a fresh session under existing approvals', () => {
  assert.ok(hermesArguments(undefined, undefined, 'discovery_questions').includes('--ignore-rules'))
  assert.ok(!hermesArguments().includes('--ignore-rules'))
  assert.ok(!hermesArguments(undefined, undefined, 'discovery_questions').includes('--yolo'))
  assert.throws(() => hermesArguments('existing', undefined, 'discovery_questions'))
  assert.throws(() => hermesArguments(undefined, '/tmp/image.png', 'discovery_questions'))
  assert.throws(() => hermesArguments(undefined, undefined, 'arbitrary'))
})

test('protocol failure is not user cancellation; safe diagnostic persists and duplicate start is blocked', async () => {
  const h = await harness('invalid')
  try {
    await h.runner.request({ action: 'start', workId: id })
    const s = await done(h.runner)
    assert.equal(s.status, 'unknown')
    assert.equal(s.interruption, undefined)
    assert.equal(s.diagnostic.code, 'transport_invalid')
    assert.equal(s.diagnostic.stage, 'transport')
    assert.match(s.diagnostic.at, /Z$/)
    const restored = await new HermesCli(h.ledger, h.ports).request({ action: 'start', workId: id })
    assert.equal(restored.diagnostic.code, 'transport_invalid')
    assert.equal(h.spawned, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
test('isolated error has fixed code, is not user stop, survives restart and never retains private error text', async () => {
  const h = await harness('vault_error', { detail: async () => ({ ...work, purpose: 'vault_context' }) })
  h.ports.vaultLaunch = h.ports.launch
  try {
    await h.runner.request({ action: 'start', workId: id })
    const s = await done(h.runner)
    assert.equal(s.status, 'unknown')
    assert.equal(s.interruption, undefined)
    assert.equal(s.diagnostic.code, 'runtime_boundary')
    assert.equal(s.diagnostic.stage, 'initialization')
    assert.equal(h.ledger.vaultContext(id), true)
    assert.equal(s.events.includes('runtime_error:runtime_boundary'), true)
    const restored = await new HermesCli(h.ledger, h.ports).request({ action: 'start', workId: id })
    assert.equal(restored.diagnostic.code, 'runtime_boundary')
    assert.equal(h.spawned, 1)
    assert.equal(JSON.stringify(restored).includes('synthetic credential'), false)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
test('response record failure is distinct from model/protocol failure and cannot resubmit', async () => {
  const h = await harness('complete', {
    record: async () => {
      throw Error('secret fixture path')
    }
  })
  try {
    await h.runner.request({ action: 'start', workId: id })
    const s = await done(h.runner)
    assert.equal(s.status, 'unknown')
    assert.equal(s.diagnostic.code, 'result_record_failed')
    assert.equal(s.diagnostic.stage, 'record')
    assert.equal(s.events.includes('response_received'), true)
    assert.equal(s.reason.includes('secret fixture'), false)
    await h.runner.request({ action: 'start', workId: id })
    assert.equal(h.spawned, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
test('verified isolated app record restores completed response after host restart without another launch', async () => {
  const h = await harness('complete', {
    detail: async () => ({ ...work, purpose: 'vault_context' }),
    restoredVaultResult: () => ({ sessionId: 'fixture_session', text: 'fixture response' })
  })
  h.ports.vaultLaunch = h.ports.launch
  try {
    await h.runner.request({ action: 'start', workId: id })
    assert.equal((await done(h.runner)).status, 'completed')
    const restored = await new HermesCli(h.ledger, h.ports).request({ action: 'start', workId: id })
    assert.equal(restored.status, 'completed')
    assert.equal(restored.text, 'fixture response')
    assert.equal(h.spawned, 1)
    const absent = await new HermesCli(h.ledger, {
      ...h.ports,
      restoredVaultResult: () => {
        throw Error('absent')
      }
    }).request({ action: 'status', workId: id })
    assert.equal(absent.status, 'unknown')
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})

test('many bounded tool results above 256KiB complete without retaining tool output or replay', async () => {
  const h = await harness('many_tool_results', { timeoutMs: 4000 })
  try {
    await h.runner.request({ action: 'start', workId: id })
    const s = await done(h.runner)
    assert.equal(s.status, 'completed')
    assert.equal(s.text, 'fixture research completed')
    assert.equal(h.records, 1)
    assert.ok(s.events.length <= 40)
    assert.equal(JSON.stringify(s).includes('합성 자료'), false)
    await new HermesCli(h.ledger, h.ports).request({ action: 'start', workId: id })
    assert.equal(h.spawned, 1)
  } finally {
    await h.runner.stop()
    await h.cleanup()
  }
})
for (const mode of ['oversized_protocol_line', 'oversized_final_answer'])
  test(`${mode} remains unknown with no record or replay`, async () => {
    const h = await harness(mode)
    try {
      await h.runner.request({ action: 'start', workId: id })
      const s = await done(h.runner)
      assert.equal(s.status, 'unknown')
      assert.equal(h.records, 0)
      await new HermesCli(h.ledger, h.ports).request({ action: 'start', workId: id })
      assert.equal(h.spawned, 1)
    } finally {
      await h.runner.stop()
      await h.cleanup()
    }
  })

for (const mode of ['protocol_total_budget', 'protocol_event_budget'])
  test(`${mode} bounds research with unknown status and no duplicate`, async () => {
    const h = await harness(mode, { timeoutMs: 4000 })
    try {
      await h.runner.request({ action: 'start', workId: id })
      const s = await done(h.runner)
      assert.equal(s.status, 'unknown')
      assert.equal(s.interruption, undefined)
      assert.equal(s.diagnostic.code, 'transport_invalid')
      assert.equal(h.records, 0)
      await new HermesCli(h.ledger, h.ports).request({ action: 'start', workId: id })
      assert.equal(h.spawned, 1)
    } finally {
      await h.runner.stop()
      await h.cleanup()
    }
  })
