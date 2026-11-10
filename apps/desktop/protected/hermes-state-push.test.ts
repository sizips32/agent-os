import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { FileAcpLedger } from './acp-ledger'
import { HermesCli } from './hermes-cli'
import type { HermesState } from './types'

const script = `
const out = o => process.stdout.write(JSON.stringify(o) + '\\n')
process.stdin.resume()
process.stdin.on('end', () => {
  out({ type: 'system', subtype: 'init', session_id: 'sess_1' })
  for (let i = 0; i < 50; i++) out({ type: 'text', text: 'x' })
  setTimeout(() => out({ type: 'result', session_id: 'sess_1', exit_code: 0, text: 'x'.repeat(50) }), 300)
})
`

test('state is pushed coalesced while running, and the final pushed state is the settled one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ohha-push-'))
  const workId = `work_${'e'.repeat(32)}`
  const pushed: HermesState[] = []
  const runner = new HermesCli(new FileAcpLedger(join(root, 'ledger')), {
    detail: async () => ({
      work_id: workId,
      adapter: 'hermes',
      state: 'awaiting_handoff',
      instructions: 'synthetic',
      artifacts: []
    }),
    policy: async () => true,
    record: async () => {},
    launch: () => spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'], shell: false }),
    onState: state => pushed.push(state)
  })
  try {
    await runner.request({ action: 'start', workId })
    while (runner.running) await new Promise(resolve => setTimeout(resolve, 20)) // natural completion
    expect(pushed.length).toBeGreaterThan(0)
    expect(pushed.length).toBeLessThan(10) // 51 frames coalesce into a few publishes
    expect(pushed.every(s => s.workId === workId)).toBe(true)
    const last = pushed.at(-1)!
    expect(last.status).toBe('completed')
    expect(last.text).toBe('x'.repeat(50))
    const count = pushed.length
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(pushed).toHaveLength(count) // nothing pushed after close
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
