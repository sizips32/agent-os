import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, isAbsolute, basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import { validSession } from './sessions.ts'
import { hermesProtection } from './sandbox.ts'
import type { FileAcpLedger } from './acp-ledger'
import {
  LONG_REQUEST_NOTICE_MS,
  REQUEST_TIMEOUT_MS,
  longRequestReason,
  timeoutReason,
  interruptedReason
} from './request-wait'
import { executionDiagnostic, diagnosticReason } from './execution-diagnostic'
import { HermesStreamParser } from './hermes-stream'
import type { WorkDetail } from './types'
import type { HermesState, HermesOperation } from './types'
type Run = {
  closed: boolean
  stopped: boolean
  cancelled: boolean
  invalid: boolean
  timeoutExpired: boolean
  killTimer?: ReturnType<typeof setTimeout>
}
const STATE_PUSH_MS = 100
/** Coalesces bursts of changes into one trailing publish; `flush` publishes immediately. */
function coalesced(publish: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
    publish()
  }
  return {
    emit: () => {
      timer ??= setTimeout(() => {
        timer = undefined
        publish()
      }, STATE_PUSH_MS)
    },
    flush
  }
}
function signalGroup(child: ChildProcess, sig: NodeJS.Signals) {
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
      /** Called (coalesced) whenever the running request's state changes. */
      onState?: (state: HermesState) => void
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
    return this.start(r.workId)
  }
  private async start(workId: string) {
    if (this.active) throw Error('A Giselle request is already running')
    if (this.ledger.lookup(workId)) return this.view(workId)
    if (!(await this.ports.policy()))
      throw Error('Giselle manual/single-query deny policy could not be confirmed; open official app')
    const w = await this.validateWork(workId)
    const resumeSessionId = await this.resolveResume(w)
    // No await between this re-check and claim(): only one request can pass.
    if (this.active) throw Error('A Giselle request is already running')
    if (this.cancelledBeforeLaunch.has(w.work_id)) throw Error('Work cancelled before CLI launch')
    const state = this.claim(w, resumeSessionId)
    if (!state) return this.view(w.work_id)
    let child: ChildProcess
    try {
      child = await this.launch(w, resumeSessionId)
    } catch (error) {
      return this.failStart(w, state, error)
    }
    this.supervise(w, state, child)
    return this.view(w.work_id)
  }
  private async validateWork(workId: string): Promise<WorkDetail> {
    const w = await this.ports.detail(workId)
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
    return w
  }
  private async resolveResume(w: WorkDetail) {
    const resumeSessionId = w.resumeWorkId ? await this.ports.resume?.(w.resumeWorkId) : undefined
    if (w.resumeWorkId && (!validSession(resumeSessionId) || resumeSessionId !== w.resumeSessionId))
      throw Error('Selected session changed; select it again')
    return resumeSessionId
  }
  /** Reserves the work in the durable ledger. Returns null when it was already claimed. */
  private claim(w: WorkDetail, resumeSessionId?: string): HermesState | null {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([w.work_id, w.instructions, 'giselle', resumeSessionId || '', w.image?.sha256 || '']))
      .digest('hex')
    if (!this.ledger.claim(w.work_id, fingerprint)) return null
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
    return state
  }
  private async launch(w: WorkDetail, resumeSessionId?: string): Promise<ChildProcess> {
    if (w.purpose === 'vault_context') {
      this.ledger.settle(w.work_id, {
        status: 'unknown',
        text: '',
        reason: '',
        verification: 'transport_only_unverified',
        executionMode: 'vault_context'
      })
      return await (this.ports.vaultLaunch?.() ?? Promise.reject(Error('Vault isolation unavailable')))
    }
    if (this.ports.launch) return this.ports.launch(resumeSessionId, w.image?.path)
    return spawn(
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
  }
  private async failStart(w: WorkDetail, state: HermesState, error: unknown) {
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
  /** Owns the child until it closes: protocol parsing, timers, stop escalation and final settlement. */
  private supervise(w: WorkDetail, state: HermesState, child: ChildProcess) {
    let release!: () => void
    const finish = new Promise<void>(resolve => (release = resolve))
    const push = coalesced(() => this.ports.onState?.(this.view(state.workId)))
    const run: Run = { closed: false, stopped: false, cancelled: false, invalid: false, timeoutExpired: false }
    const stop = (userRequested = true) => {
      if (run.closed || run.stopped) return
      run.stopped = true
      run.cancelled = userRequested
      if (userRequested) {
        state.reason = 'Stop requested; effects and completion require manual verification'
        push.emit()
      }
      signalGroup(child, 'SIGINT')
      run.killTimer = setTimeout(() => {
        signalGroup(child, 'SIGTERM')
        run.killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), 2000)
      }, 2000)
    }
    const parser = new HermesStreamParser(state, w.purpose === 'vault_context', {
      confirmSession: sessionId => this.confirmSession(state, sessionId),
      onInvalid: () => {
        run.invalid = true
        stop(false)
      }
    })
    this.active = { child, state, finish, stop }
    const timers = this.armTimers(run, state, stop, push.emit)
    child.stdout?.on('data', (chunk: Buffer) => {
      parser.push(chunk)
      push.emit()
    })
    // Drain diagnostics without storing/logging credential-bearing error text.
    child.stderr?.on('data', () => {})
    child.on('error', () => {
      run.invalid = true
      state.diagnostic = executionDiagnostic('startup_failed', 'startup')
      state.reason = 'CLI startup/transport failed'
      push.emit()
    })
    child.on('close', async code => {
      parser.end()
      run.closed = true
      for (const timer of [...timers, run.killTimer]) if (timer) clearTimeout(timer)
      await this.conclude(state, run, parser, code)
      try {
        await this.ports.release?.(w.work_id)
      } catch {
        state.status = 'unknown'
        state.reason = 'Attachment cleanup requires manual verification; no retry'
      }
      this.settle(state)
      if (this.active?.state === state) this.active = null
      push.emit()
      push.flush()
      release()
    })
    child.stdin?.on('error', () => {
      state.diagnostic = executionDiagnostic('transport_invalid', 'transport', undefined, { branch: 'stdin_error' })
      run.invalid = true
      stop(false)
    })
    child.stdin?.end(w.instructions)
  }
  private confirmSession(state: HermesState, sessionId: string) {
    state.sessionId = sessionId
    this.ledger.settle(state.workId, {
      status: 'unknown',
      text: '',
      reason: 'Session confirmed',
      verification: 'transport_only_unverified',
      sessionId
    })
  }
  private armTimers(run: Run, state: HermesState, stop: () => void, changed: () => void) {
    const timer = setTimeout(() => {
      run.timeoutExpired = true
      stop()
      state.reason = timeoutReason
      changed()
    }, this.ports.timeoutMs ?? REQUEST_TIMEOUT_MS)
    const noticeTimer = setTimeout(() => {
      if (!run.closed && !run.cancelled && !run.invalid) {
        state.reason = longRequestReason
        changed()
      }
    }, this.ports.noticeMs ?? LONG_REQUEST_NOTICE_MS)
    return [timer, noticeTimer]
  }
  /** Decides the final status once the child has closed. Anything not a clean, recorded result stays unknown. */
  private async conclude(state: HermesState, run: Run, parser: HermesStreamParser, code: number | null) {
    const terminal = parser.terminal
    if (run.cancelled || run.invalid || parser.trailing || !terminal || code !== 0 || terminal.exit_code !== 0) {
      state.status = 'unknown'
      if (run.timeoutExpired) {
        state.interruption = 'timeout'
        state.reason = timeoutReason
      } else if (run.cancelled) {
        state.interruption = 'interrupted'
        state.reason = interruptedReason
      } else this.explainFailure(state, parser, code)
      return
    }
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
  private explainFailure(state: HermesState, parser: HermesStreamParser, code: number | null) {
    const terminal = parser.terminal
    const branch = parser.trailing
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
    const exitCode = cliFailure ? terminal?.exit_code : code
    if (typeof exitCode === 'number' && Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255) {
      state.diagnostic = executionDiagnostic(state.diagnostic.code, state.diagnostic.stage, state.diagnostic.at, {
        ...state.diagnostic,
        exitCode
      })
    }
    state.reason = diagnosticReason(state.diagnostic)
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
