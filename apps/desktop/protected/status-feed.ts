import { StatusPoller } from './status-poller'
import type { HermesState } from './types'

/** With no pushed event for this long, read the status once to recover a lost event. */
export const QUIET_RECONCILE_MS = 5000
/** One early read covers events emitted before the subscription existed (e.g. a very fast run). */
export const CATCH_UP_MS = 250

/**
 * Follows one running work. Status arrives as pushed events; one early read covers events emitted
 * before the subscription, and a quiet period triggers a single reconciling read (never more than one
 * outstanding, via StatusPoller). The feed stops itself once the work is no longer running.
 */
export function startStatusFeed({
  workId,
  read,
  publish,
  failed,
  subscribe,
  quietMs = QUIET_RECONCILE_MS,
  catchUpMs = CATCH_UP_MS
}: {
  workId: string
  read: () => Promise<HermesState>
  publish: (state: HermesState) => void
  failed: () => void
  subscribe: (listener: (state: HermesState) => void) => () => void
  quietMs?: number
  catchUpMs?: number
}) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    unsubscribe()
    poller.stop()
  }
  const arm = (delay = quietMs) => {
    clearTimeout(timer)
    if (stopped) return
    timer = setTimeout(() => void poller.tick().finally(() => arm()), delay)
  }
  const accept = (next: HermesState) => {
    if (stopped) return
    publish(next)
    if (next.status !== 'running') stop()
    else arm()
  }
  const poller = new StatusPoller(workId, read, accept, failed)
  const unsubscribe = subscribe(event => {
    if (event.workId === workId) accept(event)
  })
  arm(catchUpMs)
  return { stop }
}
