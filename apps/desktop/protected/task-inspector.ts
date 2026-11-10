import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TaskLink, TaskPhase, TaskReport } from './task-types'
const identifier = /^[A-Za-z0-9_-]{1,90}$/
const metadata = /^[A-Za-z0-9_:.-]{1,110}$/
const sha = /^[a-f0-9]{64}$/
const notePath = /^(0_INBOX|_giselle\/OH-HA_Agent_OS\/Records)\/AgentOS-[a-f0-9-]{36}\.md$/
const noteStates = [
  'not_found',
  'unsafe_record',
  'invalid_record',
  'unsafe_note',
  'changed',
  'ambiguous',
  'missing',
  'resolved',
  'moved'
]
type Runner = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; cwd: string; env: Record<string, string> }
) => Promise<{ stdout: string }>
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid task projection')
  return value as Record<string, any>
}
function safeFields(value: unknown, keys: string[]) {
  const source = object(value),
    result: Record<string, string | number | boolean> = {}
  for (const key of keys) {
    const v = source[key]
    if (
      (typeof v === 'string' && metadata.test(v)) ||
      (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1e9) ||
      typeof v === 'boolean'
    )
      result[key] = v
  }
  return result
}
export function parseTaskReport(raw: string, task: string): TaskReport {
  const source = object(JSON.parse(raw)),
    note = object(source.note)
  if (
    source.task_id !== task ||
    source.read_only !== true ||
    source.live_execution_enabled !== false ||
    note.task_id !== task ||
    !noteStates.includes(note.status)
  )
    throw Error('Invalid task projection')
  for (const key of ['phases', 'links', 'reviews'])
    if (!Array.isArray(source[key]) || source[key].length > 100) throw Error('Invalid task projection')
  const current: TaskReport['note'] = { task_id: task, status: note.status, hash_matches: false }
  if (['resolved', 'moved'].includes(note.status)) {
    if (
      note.hash_matches !== true ||
      typeof note.relative_path !== 'string' ||
      !notePath.test(note.relative_path) ||
      typeof note.sha256 !== 'string' ||
      !sha.test(note.sha256)
    )
      throw Error('Invalid note projection')
    Object.assign(current, { hash_matches: true, relative_path: note.relative_path, sha256: note.sha256 })
    if (['verified', 'partial', 'unverified', 'blocked'].includes(note.declared_verification))
      current.declared_verification = note.declared_verification
    if (Number.isSafeInteger(note.source_count) && note.source_count >= 0 && note.source_count <= 100)
      current.source_count = note.source_count
  }
  const phases = source.phases.map((v: unknown) =>
    safeFields(v, [
      'phase',
      'state',
      'profile',
      'session',
      'session_id',
      'pane',
      'workspace',
      'aside_session_id',
      'user_id',
      'final_id',
      'sha256'
    ])
  )
  if (phases.some((v: Record<string, unknown>) => !v.phase || !v.state)) throw Error('Invalid phase projection')
  return {
    task_id: task,
    read_only: true,
    live_execution_enabled: false,
    note: current,
    ...(source.kind === 'local_check' || source.kind === 'public_research' ? { kind: source.kind } : {}),
    ...(typeof source.synthetic === 'boolean' ? { synthetic: source.synthetic } : {}),
    computed_verification:
      source.computed_verification === 'synthetic_only' && source.synthetic === true ? 'synthetic_only' : 'unverified',
    phases: phases as TaskPhase[],
    links: source.links.map((v: unknown) =>
      safeFields(v, [
        'role',
        'phase',
        'profile',
        'workspace',
        'pane',
        'session',
        'native_user_id',
        'native_final_id',
        'aside_session_id',
        'sha256',
        'source_kind'
      ])
    ) as TaskLink[],
    reviews: source.reviews.map((v: unknown) =>
      safeFields(v, ['revision', 'claim_count', 'decision', 'synthetic', 'reviewed_at', 'reviewer_kind'])
    )
  }
}
export class TaskInspector {
  private active = 0
  constructor(
    private options: { python: string; reader: string; state: string; vault: string; home: string },
    private run: Runner = promisify(execFile) as Runner
  ) {}
  async report(task: unknown): Promise<TaskReport> {
    if (typeof task !== 'string' || !identifier.test(task)) throw Error('Invalid task identifier')
    if (this.active >= 2) throw Error('Task inspection busy')
    this.active++
    try {
      const { stdout } = await this.run(
        '/usr/bin/sandbox-exec',
        [
          '-p',
          '(version 1)(allow default)(deny network*)(deny file-write*)',
          this.options.python,
          '-I',
          '-B',
          this.options.reader,
          '--task',
          task,
          '--state',
          this.options.state,
          '--vault',
          this.options.vault
        ],
        {
          timeout: 8000,
          maxBuffer: 65536,
          cwd: this.options.home,
          env: { HOME: this.options.home, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }
        }
      )
      return parseTaskReport(stdout, task)
    } catch {
      throw Error('작업 기록을 조회하지 못했습니다. 작업 ID와 로컬 기록 상태를 확인하세요.')
    } finally {
      this.active--
    }
  }
}
