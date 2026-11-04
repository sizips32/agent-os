import type { HermesState, ProtectedBridge } from './types'
type Token = { cancelled: boolean; workId?: string; started: boolean }
export class SubmissionFlow {
  private token: Token | null = null
  constructor(
    private bridge: Pick<ProtectedBridge, 'prepare' | 'request'> & Partial<Pick<ProtectedBridge, 'discardPrepared'>>,
    private publish: (state: HermesState) => void
  ) {}
  reset() {
    this.token = null
  }
  async begin(text: string, requestId: string, resumeWorkId?: string, attachmentIds?: string[], evidenceIds?: string[]) {
    const token: Token = { cancelled: false, started: false }
    this.token = token
    const workId = evidenceIds?.length ? await this.bridge.prepare(text, requestId, undefined, attachmentIds || [], 'vault_context', evidenceIds) : attachmentIds?.length ? await this.bridge.prepare(text, requestId, resumeWorkId, attachmentIds) : await this.bridge.prepare(text, requestId, resumeWorkId)
    if (this.token !== token) { await this.bridge.discardPrepared?.(workId); return }
    token.workId = workId
    const pending: HermesState = {
      workId,
      status: 'running',
      sessionId: '',
      text: '',
      events: [],
      reason: '프로필 확인 및 전송 준비 중'
    }
    const stopped = () => ({
      ...pending,
      status: 'unknown' as const,
      reason: '중단 요청 뒤 결과 불명입니다. 동일 요청을 재전송하지 마세요.'
    })
    if (token.cancelled) {
      await this.bridge.discardPrepared?.(workId)
      this.publish(stopped())
      return
    }
    this.publish(pending)
    token.started = true
    try {
      const result = await this.bridge.request({ action: 'start', workId })
      if (this.token === token && !(token.cancelled && ['running', 'idle'].includes(result.status))) this.publish(result)
    } catch (error) {
      await this.bridge.discardPrepared?.(workId)
      if (this.token !== token) return
      if (token.cancelled) this.publish(stopped())
      else {
        this.publish({
          ...pending,
          status: 'unknown',
          reason: '전송을 확인할 수 없습니다. 동일 요청을 재전송하지 마세요.'
        })
        throw error
      }
    }
  }
  async cancel() {
    const token = this.token
    if (!token) return
    token.cancelled = true
    if (!token.workId || !token.started) return
    const result = await this.bridge.request({
      action: 'cancel',
      workId: token.workId
    })
    // During backend preflight there is no running state yet. Keep the pending UI
    // until start rejects, rather than hiding the stop control with idle state.
    if (this.token === token && result.status !== 'idle') this.publish(result)
  }
}
