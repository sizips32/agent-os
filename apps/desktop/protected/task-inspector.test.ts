import { expect, test, vi } from 'vitest'
import { TaskInspector, parseTaskReport } from './task-inspector'
const task = 'synthetic_task',
  report = {
    task_id: task,
    read_only: true,
    live_execution_enabled: false,
    phases: [],
    links: [],
    reviews: [],
    computed_verification: 'unverified',
    note: { task_id: task, status: 'not_found', hash_matches: false }
  }
const options = {
  python: '/fixed/python',
  reader: '/bundled/task-inspect.py',
  state: '/fixed/state',
  vault: '/fixed/vault',
  home: '/fixed/home'
}
test('only bounded task IDs reach a bundled isolated read-only process with fixed roots', async () => {
  const run = vi.fn(async () => ({ stdout: JSON.stringify(report) })),
    inspector = new TaskInspector(options, run)
  for (const id of ['../secret', 'id;touch x', '/absolute', {}, null, 'a'.repeat(91)])
    await expect(inspector.report(id)).rejects.toThrow()
  expect(run).not.toHaveBeenCalled()
  expect(await inspector.report(task)).toMatchObject(report)
  const [binary, args, env] = run.mock.calls[0] as unknown as [string, string[], any]
  expect(binary).toBe('/usr/bin/sandbox-exec')
  expect(args).toEqual([
    '-p',
    '(version 1)(allow default)(deny network*)(deny file-write*)',
    options.python,
    '-I',
    '-B',
    options.reader,
    '--task',
    task,
    '--state',
    options.state,
    '--vault',
    options.vault
  ])
  expect(env.env).toEqual({ HOME: options.home, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' })
  expect(env.timeout).toBe(8000)
})
test('arbitrary metadata, raw transcript and unsupported verification are excluded', () => {
  const value = parseTaskReport(
    JSON.stringify({
      ...report,
      computed_verification: 'verified',
      private_prompt: 'secret',
      phases: [{ phase: 'worker-paul', state: 'uncertain', result: 'secret', session: 'native-session' }],
      links: [{ role: 'specialist', session: 'private transcript text', profile: 'paul', text: 'secret' }]
    }),
    task
  )
  expect(value.computed_verification).toBe('unverified')
  expect(JSON.stringify(value)).not.toContain('secret')
  expect(value.links[0].session).toBeUndefined()
})
test('wrong task, executable projections, external paths, bad hashes and oversized records fail closed', () => {
  const changes = [
    { task_id: 'wrong' },
    { read_only: false },
    { live_execution_enabled: true },
    { phases: Array.from({ length: 101 }, () => ({ phase: 'p', state: 'reserved' })) },
    {
      note: {
        task_id: task,
        status: 'resolved',
        hash_matches: true,
        relative_path: '../../.env',
        sha256: 'a'.repeat(64)
      }
    },
    {
      note: {
        task_id: task,
        status: 'moved',
        hash_matches: true,
        relative_path: '0_INBOX/AgentOS-11111111-1111-1111-1111-111111111111.md',
        sha256: 'wrong'
      }
    }
  ]
  for (const change of changes) expect(() => parseTaskReport(JSON.stringify({ ...report, ...change }), task)).toThrow()
})
test('moved paths are preserved; synthetic completion never becomes verified', () => {
  const note = {
    task_id: task,
    status: 'moved',
    hash_matches: true,
    relative_path: '_giselle/OH-HA_Agent_OS/Records/AgentOS-11111111-1111-1111-1111-111111111111.md',
    sha256: 'a'.repeat(64),
    declared_verification: 'verified',
    source_count: 0
  }
  const v = parseTaskReport(
    JSON.stringify({ ...report, note, synthetic: true, computed_verification: 'synthetic_only' }),
    task
  )
  expect(v.note).toEqual(note)
  expect(v.computed_verification).toBe('synthetic_only')
})
test('failures hide raw process output and release the concurrency slot', async () => {
  const run = vi.fn(async () => {
    throw Error('access_token=private')
  })
  const inspector = new TaskInspector(options, run)
  await expect(inspector.report(task)).rejects.toThrow('작업 기록')
  await expect(inspector.report(task)).rejects.not.toThrow('access_token')
  expect(run).toHaveBeenCalledTimes(2)
})
test('concurrent lookups are bounded and do not cancel or submit any work', async () => {
  const releases: ((v: { stdout: string }) => void)[] = []
  const run = vi.fn(
      () =>
        new Promise<{ stdout: string }>(r => {
          releases.push(r)
        })
    ),
    inspector = new TaskInspector(options, run)
  const a = inspector.report(task),
    b = inspector.report(task)
  await expect(inspector.report(task)).rejects.toThrow('busy')
  expect(run).toHaveBeenCalledTimes(2)
  for (const release of releases) release({ stdout: JSON.stringify(report) })
  await Promise.all([a, b])
})
