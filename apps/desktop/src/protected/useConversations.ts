import { useState, type MutableRefObject } from 'react'
import { SESSION_NOT_FOUND, VAULT_RECORD_UNAVAILABLE } from '../../protected/session-messages'
import type { Conversation, HermesState } from '../../protected/types.ts'
import type { Submission } from './useSubmission'

type Ports = {
  setSavedConversations: (items: { workId: string; sessionId: string }[]) => void
  clearEvidence: () => void
  clearAttachments: () => Promise<void>
  clearAttachmentNotice: () => void
  clearDictation: () => void
  clearText: () => void
  showChat: () => void
  setMessage: (message: string) => void
  reportError: (message: string) => void
}

function openedMessage(selected: Conversation) {
  if (selected.kind === 'vault_context')
    return '앱에 저장된 근거 실행 질문·응답입니다. 원문 근거 사본은 저장하지 않습니다. 텍스트 전용 실행이므로 일반 지젤 대화로 이어가지 않습니다.'
  return selected.canResume
    ? '선택한 지젤 대화의 최근 기록입니다. 입력 후 전송하면 이 대화를 이어갑니다.'
    : '이전 전송 결과가 불명입니다. 기록만 읽으며 이 대화에 추가 전송하지 않습니다.'
}

function openErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.includes(SESSION_NOT_FOUND)) return SESSION_NOT_FOUND
  if (error instanceof Error && error.message.includes(VAULT_RECORD_UNAVAILABLE)) return VAULT_RECORD_UNAVAILABLE
  return '선택한 대화를 읽지 못했습니다. 삭제·다른 프로필·정책·지원 인터페이스를 기존 Hermes 앱에서 확인하세요.'
}

/** Selecting, reading and resetting the conversation shown in the chat view. */
export function useConversations({
  submission,
  selection,
  discoveryAiLock,
  ports
}: {
  submission: Submission
  selection: MutableRefObject<number>
  discoveryAiLock: MutableRefObject<boolean>
  ports: Ports
}) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [reading, setReading] = useState(false)
  const { state, lock, flow, key, replaceState } = submission

  async function openConversation(workId: string, exactSession = false) {
    if (lock.current || state?.status === 'running') return
    const generation = ++selection.current
    setReading(true)
    try {
      const selected = exactSession
        ? await window.protectedHerald.selectConversation(workId)
        : await window.protectedHerald.conversation(workId)
      const references = await window.protectedHerald.selectedConversations()
      if (generation !== selection.current) return
      ports.setSavedConversations(references)
      flow.current!.reset()
      setConversation(selected)
      if (selected.kind !== 'vault_context') void ports.clearAttachments()
      ports.clearDictation()
      if (state && selected.kind !== 'vault_context') ports.clearText()
      replaceState(null)
      ports.showChat()
      key.current = crypto.randomUUID()
      ports.setMessage(openedMessage(selected))
    } catch (error) {
      if (generation === selection.current) ports.reportError(openErrorMessage(error))
    } finally {
      if (generation === selection.current) setReading(false)
    }
  }

  function newConversation() {
    ports.clearEvidence()
    if (lock.current || discoveryAiLock.current || reading || state?.status === 'running') return
    if (state) ports.clearText()
    flow.current!.reset()
    ++selection.current
    setReading(false)
    setConversation(null)
    void ports.clearAttachments()
    ports.clearAttachmentNotice()
    ports.clearDictation()
    ports.showChat()
    replaceState(null)
    key.current = crypto.randomUUID()
    ports.setMessage('새 지젤 대화입니다. 이전 요청이 불명이면 기존 Hermes 세션을 먼저 확인하세요.')
  }

  /** Activity row: open the session if there is one, otherwise show the receipt itself. */
  function openActivity(item: HermesState) {
    if (item.sessionId) return void openConversation(item.workId)
    flow.current!.reset()
    setConversation(null)
    replaceState(item)
    ports.showChat()
  }

  /** Conversation-list row: open the session, or show the matching receipt from `history`. */
  function openListItem(item: { workId: string; sessionId: string }, history: HermesState[]) {
    if (item.sessionId) return void openConversation(item.workId)
    const receipt = history.find(entry => entry.workId === item.workId)
    if (!receipt) return
    flow.current!.reset()
    replaceState(receipt)
    ports.showChat()
  }

  return { conversation, reading, openConversation, newConversation, openActivity, openListItem }
}
