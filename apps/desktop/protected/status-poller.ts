import type { HermesState } from './types'
// One outstanding query per view. Disposing also invalidates its pending promise.
export class StatusPoller {
  private disposed = false
  private pending = false
  constructor(
    private workId: string,
    private read: () => Promise<HermesState>,
    private publish: (state: HermesState) => void,
    private failed: () => void
  ) {}
  async tick() {
    if (this.disposed || this.pending) return
    this.pending = true
    try {
      const state = await this.read()
      if (!this.disposed && state.workId === this.workId) this.publish(state)
    } catch {
      if (!this.disposed) this.failed()
    } finally {
      this.pending = false
    }
  }
  stop() {
    this.disposed = true
  }
}
