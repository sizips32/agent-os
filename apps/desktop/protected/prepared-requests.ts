import { createHash } from 'node:crypto'

export const MAX_UNSUBMITTED = 200

/**
 * Remembers which work id a request id was prepared as, so a repeated prepare returns the same work
 * (and can never create a second submission). Entries stay after submission as small tombstones;
 * only work that has not been submitted counts toward the limit.
 */
export class PreparedRequests {
  private items = new Map<string, { id: string; fingerprint: string; discarded: boolean }>()

  static fingerprint(parts: unknown[]) {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  }

  /** Existing work id for this request id; throws if the same id now carries different content. */
  find(requestId: string, fingerprint: string): string | undefined {
    const previous = this.items.get(requestId)
    if (!previous) return undefined
    if (previous.fingerprint !== fingerprint) throw Error('Request identifier conflict')
    return previous.id
  }

  /** Throws when too many prepared requests are still waiting to be submitted. */
  assertRoom(isSubmitted: (id: string) => boolean) {
    let waiting = 0
    for (const { id, discarded } of this.items.values())
      if (!discarded && !isSubmitted(id) && ++waiting >= MAX_UNSUBMITTED) {
        throw Error('Local request limit reached; discard unsent requests or restart the app')
      }
  }

  add(requestId: string, fingerprint: string, id: string) {
    this.items.set(requestId, { id, fingerprint, discarded: false })
  }

  /**
   * Work that was discarded unsent no longer counts toward the limit. Its request id still resolves to
   * the same (now unknown) work, so a repeated prepare fails closed instead of creating a new submission.
   */
  discard(id: string) {
    for (const item of this.items.values()) if (item.id === id) item.discarded = true
  }
}
