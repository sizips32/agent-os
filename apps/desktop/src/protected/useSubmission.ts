import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { startStatusFeed } from '../../protected/status-feed.ts'
import { SubmissionFlow } from '../../protected/submission-flow.ts'
import type { HermesState } from '../../protected/types.ts'

export type SubmitRequest = {
  text: string
  resumeWorkId?: string
  attachmentIds: string[]
  evidenceIds: string[]
}

/**
 * Owns the single in-flight Giselle request: its state, the submit lock, status polling and cancel.
 * `selection` is the shared conversation-selection generation; results that arrive after the user
 * switched conversation are dropped.
 */
export function useSubmission({
  selection,
  reportError,
  onCancelled
}: {
  selection: MutableRefObject<number>
  reportError: (message: string) => void
  onCancelled: (message: string) => void
}) {
  const [state, setState] = useState<HermesState | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [observedResponse, setObservedResponse] = useState(false)
  const key = useRef(crypto.randomUUID())
  const lock = useRef(false)
  const poll = useRef<{ stop: () => void } | null>(null)
  const flow = useRef<SubmissionFlow | null>(null)

  function replaceState(next: HermesState | null) {
    poll.current?.stop()
    setState(next)
    setRevision(v => v + 1)
  }
  if (!flow.current) flow.current = new SubmissionFlow(window.protectedHerald, replaceState)

  useEffect(() => {
    if (!state || state.status !== 'running' || busy) return
    const feed = startStatusFeed({
      workId: state.workId,
      read: () => window.protectedHerald.request({ action: 'status', workId: state.workId }),
      publish: setState,
      failed: () => reportError('상태를 확인할 수 없습니다. 같은 요청을 재전송하지 마세요.'),
      subscribe: listener => window.protectedHerald.onHermesState(listener)
    })
    poll.current = feed
    return feed.stop
  }, [state?.workId, state?.status, busy, revision])

  useEffect(() => {
    if (state?.status === 'completed' && state.events.includes('response_received')) setObservedResponse(true)
  }, [state])

  async function cancel() {
    const generation = selection.current
    poll.current?.stop()
    try {
      await flow.current!.cancel()
      if (generation === selection.current)
        onCancelled('중단 요청을 전달했습니다. 결과 확인 전까지 동일 요청을 재전송하지 마세요.')
    } catch {
      if (generation === selection.current)
        reportError('중단을 확인할 수 없습니다. 동일 요청을 재전송하지 말고 기존 Hermes 세션을 확인하세요.')
    } finally {
      if (generation === selection.current) setRevision(v => v + 1)
    }
  }

  /** Sends one request. Eligibility is the caller's check; this holds the lock until it settles. */
  async function submit(
    request: SubmitRequest,
    after: { reloadHistory: () => Promise<void>; clearAttachments: () => Promise<void> }
  ) {
    poll.current?.stop()
    lock.current = true
    setBusy(true)
    try {
      await flow.current!.begin(
        request.text,
        key.current,
        request.resumeWorkId,
        request.attachmentIds,
        request.evidenceIds
      )
      await after.reloadHistory()
    } catch {
      reportError('전송을 확인할 수 없습니다. 동일 요청은 자동으로 재시도하지 않습니다. 기존 Hermes 세션을 확인하세요.')
    } finally {
      await after.clearAttachments()
      lock.current = false
      setBusy(false)
    }
  }

  /** Stops polling and drops the flow; used on unmount. */
  function dispose() {
    poll.current?.stop()
    flow.current?.reset()
  }

  return { state, busy, observedResponse, key, lock, flow, replaceState, cancel, submit, dispose }
}

export type Submission = ReturnType<typeof useSubmission>
