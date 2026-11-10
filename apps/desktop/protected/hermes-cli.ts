import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { homedir } from 'node:os'
import { join, isAbsolute, basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import { validSession } from './sessions.ts'
import { hermesProtection } from './sandbox.ts'
import { FileAcpLedger } from './acp-ledger'
import {
  LONG_REQUEST_NOTICE_MS,
  REQUEST_TIMEOUT_MS,
  longRequestReason,
  timeoutReason,
  interruptedReason
} from './request-wait'
import { executionDiagnostic, diagnosticReason } from './execution-diagnostic'
import type { DiagnosticBranch } from './execution-diagnostic'
import type { WorkDetail } from './types'
import type { HermesState, HermesOperation } from './types'
// Bound each JSONL frame and total work separately: ordinary multi-tool research
// legitimately exceeds the former 256KiB lifetime cap. Tool bodies are discarded.
const MAX_PROTOCOL_LINE_BYTES = 262144
const MAX_PROTOCOL_TOTAL_BYTES = 16 * 1024 * 1024
const MAX_PROTOCOL_EVENTS = 10000
export function hermesRoute(input: unknown): HermesOperation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid Hermes request')
  const v = input as Record<string, unknown>
  if (
    Object.keys(v).length !== 2 ||
    !['start', 'status', 'cancel'].includes(v.action as string) ||
    typeof v.workId !== 'string' ||
    !/^work_[a-f0-9]{32}$/.test(v.workId)
  )
    throw Error('Invalid Hermes request')
  return v as HermesOperation
}
export function hermesArguments(
  resumeSessionId?: string,
  imagePath?: string,
  purpose?: 'discovery_questions'
): string[] {
  if (purpose !== undefined && purpose !== 'discovery_questions') throw Error('Invalid purpose')
  if (purpose && (resumeSessionId || imagePath)) throw Error('AI questions must use a fresh text-only session')
  if (resumeSessionId && (!validSession(resumeSessionId) || resumeSessionId.startsWith('-')))
    throw Error('Invalid session')
  if (
    imagePath &&
    (!isAbsolute(imagePath) ||
      !/^work_[a-f0-9]{32}\.(png|jpe?g|webp)$/.test(basename(imagePath)) ||
      imagePath.includes('\0'))
  )
    throw Error('Invalid staged image')
  return [
    '--profile',
    'giselle',
    'chat',
    '--query-file',
    '-',
    '--oneshot',
    '--format',
    'stream-json',
    ...(purpose ? ['--ignore-rules'] : []),
    ...(resumeSessionId ? ['--resume', resumeSessionId, '--no-restore-cwd'] : []),
    ...(imagePath ? ['--image', imagePath] : [])
  ]
}
export class HermesCli {
  private cancelledBeforeLaunch = new Set<string>()
  private states = new Map<string, HermesState>()
  private active: {
    child: ChildProcess
    state: HermesState
    finish: Promise<void>
    stop: () => void
  } | null = null
  constructor(
    private ledger: FileAcpLedger,
    private ports: {
      detail: (id: string) => Promise<WorkDetail>
      policy: () => Promise<boolean>
      record: (id: string, text: string, session: string) => Promise<void>
      resume?: (workId: string) => Promise<string>
      launch?: (resumeSessionId?: string, imagePath?: string) => ChildProcess
      imagePolicy?: () => Promise<boolean>
      release?: (workId: string) => Promise<void>
      vaultLaunch?: () => Promise<ChildProcess>
      restoredVaultResult?: (id: string) => { sessionId: string; text: string }
      timeoutMs?: number
      noticeMs?: number
    }
  ) {}
  async request(input: unknown) {
    const r = hermesRoute(input)
    if (r.action === 'status') return this.view(r.workId)
    if (r.action === 'cancel') {
      this.cancelledBeforeLaunch.add(r.workId)
      if (this.active?.state.workId === r.workId) this.active.stop()
      return this.view(r.workId)
    }
    if (this.active) throw Error('A Giselle request is already running')
    if (this.ledger.lookup(r.workId)) return this.view(r.workId)
    if (!(await this.ports.policy()))
      throw Error('Giselle manual/single-query deny policy could not be confirmed; open official app')
    const w = await this.ports.detail(r.workId)
    if (
      w.adapter !== 'hermes' ||
      w.state !== 'awaiting_handoff' ||
      !w.instructions?.trim() ||
      w.instructions.length > 12000 ||
      w.instructions.includes('\0')
    )
      throw Error('Prepare a pending Hermes handoff first')
    if (w.image) {
      hermesArguments(undefined, w.image.path)
      if (!/^[a-f0-9]{64}$/.test(w.image.sha256) || !(await this.ports.imagePolicy?.()))
        throw Error('Image native model compatibility is unverified; no auxiliary service invoked')
      const bytes = await readFile(w.image.path)
      if (bytes.length > 5 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== w.image.sha256)
        throw Error('Staged image changed')
    }
    const resumeSessionId = w.resumeWorkId ? await this.ports.resume?.(w.resumeWorkId) : undefined
    if (w.resumeWorkId && (!validSession(resumeSessionId) || resumeSessionId !== w.resumeSessionId))
      throw Error('Selected session changed; select it again')
    if (this.active) throw Error('A Giselle request is already running')
    if (this.cancelledBeforeLaunch.has(w.work_id)) throw Error('Work cancelled before CLI launch')
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([w.work_id, w.instructions, 'giselle', resumeSessionId || '', w.image?.sha256 || '']))
      .digest('hex')
    if (!this.ledger.claim(w.work_id, fingerprint)) return this.view(w.work_id)
    const state: HermesState = {
      workId: w.work_id,
      status: 'running',
      sessionId: '',
      text: '',
      events: [],
      reason: 'Existing Giselle profile; dangerous actions denied, ordinary tools remain available'
    }
    if (resumeSessionId)
      this.ledger.settle(w.work_id, {
        status: 'unknown',
        sessionId: resumeSessionId,
        text: '',
        reason: 'Resume dispatch pending',
        verification: 'transport_only_unverified'
      })
    this.states.set(w.work_id, state)
    let child: ChildProcess
    try {
      if (w.purpose === 'vault_context')
        this.ledger.settle(w.work_id, {
          status: 'unknown',
          text: '',
          reason: '',
          verification: 'transport_only_unverified',
          executionMode: 'vault_context'
        })
      child =
        w.purpose === 'vault_context'
          ? await (this.ports.vaultLaunch?.() ?? Promise.reject(Error('Vault isolation unavailable')))
          : this.ports.launch
            ? this.ports.launch(resumeSessionId, w.image?.path)
            : spawn(
                '/usr/bin/sandbox-exec',
                [
                  '-p',
                  hermesProtection(),
                  join(homedir(), '.local/bin/hermes'),
                  ...hermesArguments(resumeSessionId, w.image?.path, w.purpose)
                ],
                {
                  cwd: homedir(),
                  env: {
                    ...process.env,
                    HERMES_YOLO_MODE: '0',
                    HERMES_DISABLE_LAZY_INSTALLS: '1',
                    HERMES_SINGLE_QUERY_SESSION: '1'
                  },
                  shell: false,
                  detached: true,
                  stdio: ['pipe', 'pipe', 'pipe']
                }
              )
    } catch (error) {
      state.status = 'failed'
      state.diagnostic = executionDiagnostic('startup_failed', 'startup')
      state.reason =
        w.purpose === 'vault_context'
          ? error instanceof Error && error.message.startsWith('볼트 근거 요청 차단:')
            ? error.message
            : '볼트 근거 요청 차단: 실행 경계를 확인하지 못했습니다. 일반 지젤로 우회/재시도하지 않습니다.'
          : 'CLI could not start; no retry'
      this.settle(state)
      await this.ports.release?.(w.work_id)
      return this.view(w.work_id)
    }
    let release!: () => void
    const finish = new Promise<void>(resolve => (release = resolve))
    let timeoutExpired = false
    let cancelled = false,
      stopped = false,
      invalid = false,
      terminal: Record<string, unknown> | null = null,
      buffer = '',
      bytes = 0,
      protocolEvents = 0,
      closed = false
    let initialized = false
    const confirmSession = (sessionId: string) => {
      state.sessionId = sessionId
      this.ledger.settle(state.workId, {
        status: 'unknown',
        text: '',
        reason: 'Session confirmed',
        verification: 'transport_only_unverified',
        sessionId
      })
    }
    const decoder = new StringDecoder('utf8')
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const signal = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig)
      } catch {
        try {
          child.kill(sig)
        } catch {
          /* owned child already exited */
        }
      }
    }
    const stop = (userRequested = true) => {
      if (closed || stopped) return
      stopped = true
      cancelled = userRequested
      if (userRequested) state.reason = 'Stop requested; effects and completion require manual verification'
      signal('SIGINT')
      killTimer = setTimeout(() => {
        signal('SIGTERM')
        killTimer = setTimeout(() => signal('SIGKILL'), 2000)
      }, 2000)
    }
    this.active = { child, state, finish, stop }
    const timer = setTimeout(() => {
      timeoutExpired = true
      stop()
      state.reason = timeoutReason
    }, this.ports.timeoutMs ?? REQUEST_TIMEOUT_MS)
    const noticeTimer = setTimeout(() => {
      if (!closed && !cancelled && !invalid) state.reason = longRequestReason
    }, this.ports.noticeMs ?? LONG_REQUEST_NOTICE_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_PROTOCOL_TOTAL_BYTES) {
        invalid = true
        state.diagnostic = executionDiagnostic('transport_invalid', 'transport', undefined, {
          branch: 'protocol_total_limit'
        })
        stop(false)
        return
      }
      buffer += decoder.write(chunk)
      let at: number
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        if (!line.trim()) continue
        let branch: DiagnosticBranch = 'protocol_frame_limit'
        try {
          if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) throw Error()
          branch = 'protocol_event_limit'
          if (++protocolEvents > MAX_PROTOCOL_EVENTS) throw Error()
          branch = 'invalid_json'
          const v = JSON.parse(line) as Record<string, unknown>
          branch = 'invalid_event'
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error()
          if (terminal) throw Error()
          branch = 'invalid_init'
          if (!initialized && !(v.type === 'system' && v.subtype === 'init')) throw Error()
          if (v.type === 'system' && v.subtype === 'init') {
            if (initialized || typeof v.session_id !== 'string' || (v.session_id !== '' && !validSession(v.session_id)))
              throw Error()
            initialized = true
            // Gateway init precedes connection; its terminal result carries the
            // session that the CLI subsequently bound internally.
            if (v.session_id) {
              confirmSession(v.session_id)
              state.events.push('request_started')
            } else state.events.push('connection_started')
          } else if (v.type === 'text') {
            branch = 'invalid_event'
            if (typeof v.text !== 'string' || state.text.length + v.text.length > 20000) throw Error()
            state.text += v.text
            state.events.push('response_delta')
          } else if (v.type === 'tool_use' || v.type === 'tool_result') {
            branch = 'invalid_event'
            if (typeof v.name !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(v.name)) throw Error()
            // Observe existing policy-controlled tools without granting permissions or retaining tool data.
            state.events.push(`${v.type === 'tool_use' ? 'tool_started' : 'tool_finished'}:${v.name}`)
          } else if (v.type === 'result') {
            branch = 'invalid_result'
            if (
              typeof v.session_id !== 'string' ||
              !Number.isInteger(v.exit_code) ||
              Number(v.exit_code) < 0 ||
              Number(v.exit_code) > 255 ||
              typeof v.text !== 'string' ||
              v.text.length > 20000 ||
              (v.session_id !== '' && !validSession(v.session_id)) ||
              (v.exit_code === 0 && !validSession(v.session_id))
            )
              throw Error()
            branch = 'session_mismatch'
            if (state.sessionId && v.session_id !== state.sessionId) throw Error()
            if (v.session_id && !state.sessionId) {
              confirmSession(v.session_id)
              state.events.push('session_confirmed')
            }
            terminal = v
            state.events.push(v.exit_code === 0 ? 'response_received' : 'response_failed')
          } else if (v.type === 'error' && w.purpose === 'vault_context') {
            state.diagnostic = executionDiagnostic(v.code ?? 'runtime_boundary', v.stage ?? 'initialization')
            state.events.push('runtime_error:' + state.diagnostic.code)
            invalid = true
            stop(false)
          } else {
            branch = 'invalid_event'
            throw Error()
          }
          state.events = state.events.slice(-40)
        } catch {
          invalid = true
          state.diagnostic ??= executionDiagnostic('transport_invalid', 'transport', undefined, { branch })
          stop(false)
          return
        }
      }
      if (Buffer.byteLength(buffer, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
        invalid = true
        state.diagnostic = executionDiagnostic('transport_invalid', 'transport', undefined, {
          branch: 'protocol_frame_limit'
        })
        stop(false)
      }
    })
    // Drain diagnostics without storing/logging credential-bearing error text.
    child.stderr?.on('data', () => {})
    child.on('error', () => {
      invalid = true
      state.diagnostic = executionDiagnostic('startup_failed', 'startup')
      state.reason = 'CLI startup/transport failed'
    })
    child.on('close', async code => {
      buffer += decoder.end()
      closed = true
      clearTimeout(timer)
      clearTimeout(noticeTimer)
      if (killTimer) clearTimeout(killTimer)
      if (cancelled || invalid || buffer.trim() || !terminal || code !== 0 || terminal.exit_code !== 0) {
        state.status = 'unknown'
        if (timeoutExpired) {
          state.interruption = 'timeout'
          state.reason = timeoutReason
        } else if (cancelled) {
          state.interruption = 'interrupted'
          state.reason = interruptedReason
        } else {
          const branch = buffer.trim()
            ? 'trailing_data'
            : !terminal
              ? 'missing_result'
              : terminal.exit_code !== 0
                ? 'cli_result'
                : 'process_exit'
          const cliFailure = branch === 'cli_result'
          state.diagnostic ??= executionDiagnostic(
            cliFailure ? 'provider_result_failed' : 'transport_invalid',
            cliFailure ? (state.sessionId ? 'model' : 'initialization') : 'transport',
            undefined,
            { branch }
          )
          const exitCode = cliFailure ? terminal!.exit_code : code
          if (typeof exitCode === 'number' && Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255) {
            state.diagnostic = executionDiagnostic(state.diagnostic.code, state.diagnostic.stage, state.diagnostic.at, {
              ...state.diagnostic,
              exitCode
            })
          }
          state.reason = diagnosticReason(state.diagnostic)
        }
      } else {
        state.text = terminal.text as string
        state.status = 'running'
        state.reason = 'CLI response observed; task effects and approval authority remain with Hermes/Giselle'
        try {
          await this.ports.record(state.workId, state.text, state.sessionId)
          state.status = 'completed'
        } catch {
          state.status = 'unknown'
          state.diagnostic = executionDiagnostic('result_record_failed', 'record')
          state.reason = diagnosticReason(state.diagnostic)
        }
      }
      try {
        await this.ports.release?.(w.work_id)
      } catch {
        state.status = 'unknown'
        state.reason = 'Attachment cleanup requires manual verification; no retry'
      }
      this.settle(state)
      if (this.active?.state === state) this.active = null
      release()
    })
    child.stdin?.on('error', () => {
      invalid = true
      state.diagnostic = executionDiagnostic('transport_invalid', 'transport', undefined, { branch: 'stdin_error' })
      stop(false)
    })
    child.stdin?.end(w.instructions)
    return this.view(w.work_id)
  }
  private settle(state: HermesState) {
    try {
      this.ledger.settle(state.workId, {
        status: ['running', 'idle'].includes(state.status)
          ? 'unknown'
          : (state.status as 'completed' | 'failed' | 'unknown'),
        text: '',
        reason: state.reason,
        verification: 'transport_only_unverified',
        sessionId: state.sessionId,
        ...(state.interruption ? { interruption: state.interruption } : {}),
        ...(state.diagnostic ? { diagnostic: state.diagnostic } : {})
      })
    } catch {
      state.status = 'unknown'
      state.reason = 'Durable receipt failed; do not resubmit'
    }
  }
  private view(workId: string): HermesState {
    const s = this.states.get(workId)
    if (s) return { ...s, events: [...s.events] }
    const saved = this.ledger.lookup(workId)
    const interruption = saved ? this.ledger.interruption(workId) : undefined
    const diagnostic = saved ? this.ledger.diagnostic(workId) : undefined
    if (saved && this.ledger.vaultContext(workId) && this.ledger.completed(workId) && this.ports.restoredVaultResult) {
      try {
        const result = this.ports.restoredVaultResult(workId)
        if (
          result.sessionId !== this.ledger.sessionReference(workId) ||
          typeof result.text !== 'string' ||
          result.text.length > 20000 ||
          result.text.includes('\0')
        )
          throw Error()
        return {
          workId,
          status: 'completed',
          sessionId: result.sessionId,
          text: result.text,
          events: ['response_received'],
          reason: '앱에 저장된 근거 실행 응답입니다. 일반 지젤 세션으로 이어가지 않습니다.'
        }
      } catch {
        /* Keep unknown if the app record cannot be validated. */
      }
    }
    return {
      workId,
      status: saved ? 'unknown' : 'idle',
      sessionId: saved ? this.ledger.sessionReference(workId) : '',
      text: '',
      events: [],
      reason:
        interruption === 'timeout'
          ? timeoutReason
          : interruption === 'interrupted'
            ? interruptedReason
            : diagnostic
              ? diagnosticReason(diagnostic)
              : saved
                ? 'A prior submission exists. Inspect the work receipt and Hermes session manually; no retry'
                : 'No submitted request',
      ...(diagnostic ? { diagnostic } : {}),
      ...(interruption ? { interruption } : {})
    }
  }
  get running() {
    return this.active !== null
  }
  async stop() {
    const current = this.active
    if (current) {
      current.stop()
      await current.finish
    }
  }
}
