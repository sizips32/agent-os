import { expect, test } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { HermesCli } from './hermes-cli'
import { FileAcpLedger } from './acp-ledger'

const python = join(homedir(), '.hermes/hermes-agent/venv/bin/python')

// Exercise the installed producer and the real app consumer together, without
// constructing an agent, loading credentials, or making a model/tool request.
test.skipIf(!existsSync(python))('quiet delegation completion diagnostics do not corrupt the JSONL response or resubmit work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ohha-delegation-stream-'))
  const workId = `work_${'d'.repeat(32)}`
  let launches = 0
  let records = 0
  const ledger = new FileAcpLedger(join(root, 'ledger'))
  const runner = new HermesCli(ledger, {
    detail: async () => ({ work_id: workId, adapter: 'hermes', state: 'awaiting_handoff', instructions: 'synthetic delegation only', artifacts: [] }),
    policy: async () => true,
    record: async () => { records++ },
    launch: () => {
      launches++
      return spawn(python, ['-I', '-B', '-c', `
import sys
from pathlib import Path
sys.path.insert(0, str(Path.home()/'.hermes/hermes-agent'))
from agent.status_output import StatusOutputMixin
from hermes_cli.cli_single_query import _configure_quiet_agent
from hermes_cli.stream_json import StreamJsonEmitter
from tools.delegate_tool_progress import _emit_parent_console, _print_completion_line

class FixtureParent(StatusOutputMixin):
    _print_fn = None

# Interactive/headless printer ownership must continue to work unchanged.
normal = FixtureParent()
received = []
normal._print_fn = received.append
_emit_parent_console(normal, 'normal fixture diagnostic')
assert received == ['normal fixture diagnostic']

sys.stdin.read()
parent = FixtureParent()
_configure_quiet_agent(parent)
emitter = StreamJsonEmitter(model='fixture-no-model-call', session_id='delegation_fixture')
emitter.attach(parent)
emitter.on_tool_progress('tool.started', 'delegate_task')
_print_completion_line(parent, None, '✓ [set 1] fixture completed (0.01s)')
_print_completion_line(parent, None, '⚠ fixture child failed', console_line='fixture failure diagnostic')
emitter.on_tool_progress('tool.completed', 'delegate_task', result='fixture tool body')
emitter.on_text_delta('fixture final response')
emitter.emit_result({'final_response':'fixture final response'}, session_id='delegation_fixture')
`], {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', HERMES_HOME: root, HERMES_DISABLE_LAZY_INSTALLS: '1' }
      })
    },
    timeoutMs: 10000
  })
  try {
    await runner.request({ action: 'start', workId })
    let result = await runner.request({ action: 'status', workId })
    const end = Date.now() + 12000
    while (result.status === 'running' && Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 20))
      result = await runner.request({ action: 'status', workId })
    }
    expect(result.status).toBe('completed')
    expect(result.text).toBe('fixture final response')
    expect(records).toBe(1)
    expect(result.events).toContain('tool_finished:delegate_task')
    expect(JSON.stringify(result)).not.toContain('fixture failure diagnostic')
    await runner.request({ action: 'start', workId })
    expect(launches).toBe(1)
  } finally {
    await runner.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
