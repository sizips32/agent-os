import { StringDecoder } from 'node:string_decoder'
import { executionDiagnostic } from './execution-diagnostic'
import type { DiagnosticBranch } from './execution-diagnostic'
import { validSession } from './sessions.ts'
import type { HermesState } from './types'

// Bound each JSONL frame and total work separately: ordinary multi-tool research
// legitimately exceeds the former 256KiB lifetime cap. Tool bodies are discarded.
export const MAX_PROTOCOL_LINE_BYTES = 262144
export const MAX_PROTOCOL_TOTAL_BYTES = 16 * 1024 * 1024
export const MAX_PROTOCOL_EVENTS = 10000

export type StreamHooks = {
  /** A session id was observed; the caller persists it. */
  confirmSession(sessionId: string): void
  /** The stream violated the protocol; the caller marks the run invalid and stops the child. */
  onInvalid(): void
}

type Frame = Record<string, unknown>

/**
 * Parses the Hermes `stream-json` protocol into `state`. Pure with respect to processes:
 * feed it chunks, read `terminal`/`trailing` afterwards.
 */
export class HermesStreamParser {
  terminal: Frame | null = null
  private buffer = ''
  private bytes = 0
  private protocolEvents = 0
  private initialized = false
  private branch: DiagnosticBranch = 'protocol_frame_limit'
  private decoder = new StringDecoder('utf8')

  constructor(
    private state: HermesState,
    private vaultContext: boolean,
    private hooks: StreamHooks
  ) {}

  /** True when unterminated or unparsed data remains after the stream ended. */
  get trailing() {
    return this.buffer.trim() !== ''
  }

  end() {
    this.buffer += this.decoder.end()
  }

  push(chunk: Buffer) {
    this.bytes += chunk.length
    if (this.bytes > MAX_PROTOCOL_TOTAL_BYTES) return this.reject('protocol_total_limit')
    this.buffer += this.decoder.write(chunk)
    let at: number
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, at)
      this.buffer = this.buffer.slice(at + 1)
      if (!line.trim()) continue
      if (!this.accept(line)) return
    }
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_PROTOCOL_LINE_BYTES) this.reject('protocol_frame_limit')
  }

  private reject(branch: DiagnosticBranch) {
    this.state.diagnostic = executionDiagnostic('transport_invalid', 'transport', undefined, { branch })
    this.hooks.onInvalid()
  }

  /** Returns false when parsing must stop. */
  private accept(line: string): boolean {
    this.branch = 'protocol_frame_limit'
    try {
      this.frame(line)
      this.state.events = this.state.events.slice(-40)
      return true
    } catch {
      this.state.diagnostic ??= executionDiagnostic('transport_invalid', 'transport', undefined, {
        branch: this.branch
      })
      this.hooks.onInvalid()
      return false
    }
  }

  private frame(line: string) {
    if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) throw Error()
    this.branch = 'protocol_event_limit'
    if (++this.protocolEvents > MAX_PROTOCOL_EVENTS) throw Error()
    this.branch = 'invalid_json'
    const v = JSON.parse(line) as Frame
    this.branch = 'invalid_event'
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error()
    if (this.terminal) throw Error()
    this.branch = 'invalid_init'
    const isInit = v.type === 'system' && v.subtype === 'init'
    if (!this.initialized && !isInit) throw Error()
    if (isInit) return this.onInit(v)
    if (v.type === 'text') return this.onText(v)
    if (v.type === 'tool_use' || v.type === 'tool_result') return this.onTool(v)
    if (v.type === 'result') return this.onResult(v)
    if (v.type === 'error' && this.vaultContext) return this.onRuntimeError(v)
    this.branch = 'invalid_event'
    throw Error()
  }

  private onInit(v: Frame) {
    if (this.initialized || typeof v.session_id !== 'string' || (v.session_id !== '' && !validSession(v.session_id)))
      throw Error()
    this.initialized = true
    // Gateway init precedes connection; its terminal result carries the
    // session that the CLI subsequently bound internally.
    if (v.session_id) {
      this.hooks.confirmSession(v.session_id)
      this.state.events.push('request_started')
    } else this.state.events.push('connection_started')
  }

  private onText(v: Frame) {
    this.branch = 'invalid_event'
    if (typeof v.text !== 'string' || this.state.text.length + v.text.length > 20000) throw Error()
    this.state.text += v.text
    this.state.events.push('response_delta')
  }

  private onTool(v: Frame) {
    this.branch = 'invalid_event'
    if (typeof v.name !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(v.name)) throw Error()
    // Observe existing policy-controlled tools without granting permissions or retaining tool data.
    this.state.events.push(`${v.type === 'tool_use' ? 'tool_started' : 'tool_finished'}:${v.name}`)
  }

  private onResult(v: Frame) {
    this.branch = 'invalid_result'
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
    this.branch = 'session_mismatch'
    if (this.state.sessionId && v.session_id !== this.state.sessionId) throw Error()
    if (v.session_id && !this.state.sessionId) {
      this.hooks.confirmSession(v.session_id)
      this.state.events.push('session_confirmed')
    }
    this.terminal = v
    this.state.events.push(v.exit_code === 0 ? 'response_received' : 'response_failed')
  }

  private onRuntimeError(v: Frame) {
    this.state.diagnostic = executionDiagnostic(v.code ?? 'runtime_boundary', v.stage ?? 'initialization')
    this.state.events.push(`runtime_error:${this.state.diagnostic.code}`)
    // Parsing continues with later frames, as before; the caller stops the child.
    this.hooks.onInvalid()
  }
}
