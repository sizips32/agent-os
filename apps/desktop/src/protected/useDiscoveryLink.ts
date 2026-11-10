import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { attachmentInstructions, REQUEST_LIMIT } from '../../protected/attachment-content.ts'
import type { AttachmentPreview, Conversation, HermesState } from '../../protected/types.ts'
import { vaultCompose, VAULT_SYSTEM_PROMPT, type VaultEvidence } from '../../protected/vault-types'
import type { View } from './Sidebar'

type Reply = { ok: boolean; message: string }

/**
 * Connects the discovery view to the composer: where focus returns, whether input is blocked,
 * and the one-time, size-checked draft application. It never sends a request.
 */
export function useDiscoveryLink({
  view,
  setView,
  composerInput,
  text,
  setText,
  attachments,
  evidence,
  state,
  conversation,
  ready,
  active,
  lock,
  aiLock,
  setAiBusy
}: {
  view: View
  setView: (view: View) => void
  composerInput: RefObject<HTMLTextAreaElement | null>
  text: string
  setText: (text: string) => void
  attachments: AttachmentPreview[]
  evidence: VaultEvidence[]
  state: HermesState | null
  conversation: Conversation | null
  ready: boolean
  active: boolean
  lock: MutableRefObject<boolean>
  aiLock: MutableRefObject<boolean>
  setAiBusy: (busy: boolean) => void
}) {
  const focusPending = useRef<'composer' | 'entry' | null>(null)
  const entry = useRef<HTMLButtonElement>(null)
  const nav = useRef<HTMLButtonElement>(null)
  const origin = useRef<'entry' | 'nav'>('entry')
  const readOnlyConversation = !!conversation && !conversation.canResume

  useEffect(() => {
    if (view === 'chat' && focusPending.current) {
      const target =
        focusPending.current === 'entry'
          ? origin.current === 'entry'
            ? entry.current
            : nav.current
          : composerInput.current
      target?.focus()
      focusPending.current = null
    }
  }, [view])

  const blocked = active
    ? '현재 요청·첨부 읽기가 진행 중입니다. 끝난 뒤 적용해 주세요.'
    : state || readOnlyConversation
      ? '현재 대화는 입력할 수 없습니다. UNKNOWN은 재전송하지 않고 새 대화나 계속 가능한 대화를 직접 선택해 주세요.'
      : ''

  function apply(draft: string, previewOnly = false): Reply {
    if (lock.current || active || state || readOnlyConversation)
      return { ok: false, message: '대화 상태가 바뀌어 적용하지 않았습니다. 실행 중·결과 불명 기록을 확인해 주세요.' }
    const next = text + (text ? '\n\n' : '') + draft
    const count =
      vaultCompose(attachmentInstructions(next, attachments), evidence).length +
      (evidence.length ? VAULT_SYSTEM_PROMPT.length : 0)
    if (count > REQUEST_LIMIT || next.includes('\0'))
      return {
        ok: false,
        message: `기존 입력·첨부·초안 합계 ${count.toLocaleString()} / 12,000자입니다. 내용을 줄인 뒤 다시 적용해 주세요. 자르거나 덮어쓰지 않았습니다.`
      }
    if (!previewOnly) {
      setText(next)
      focusPending.current = 'composer'
      setView('chat')
    }
    return { ok: true, message: '기존 입력 뒤에 초안을 한 번 적용했습니다. 첨부는 유지했고 전송하지 않았습니다.' }
  }

  return {
    entry,
    nav,
    blocked,
    apply,
    openFromEntry: () => {
      origin.current = 'entry'
      setView('discovery')
    },
    openFromNav: () => {
      origin.current = 'nav'
      setView('discovery')
    },
    close: () => {
      focusPending.current = 'entry'
      setView('chat')
    },
    onAiBusy: (busy: boolean) => {
      aiLock.current = busy
      setAiBusy(busy)
    },
    onAiReserve: () => {
      if (lock.current || aiLock.current || active || !ready || state || readOnlyConversation) return false
      aiLock.current = true
      setAiBusy(true)
      return true
    }
  }
}
