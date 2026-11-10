import { useEffect, useState } from 'react'
import type { Conversation, ConversationSummary, HermesState } from '../../protected/types.ts'
import type { View } from './Sidebar'

type Ref = { workId: string; sessionId: string }

/** Fetches first-question titles for the visible conversations and formats list labels. */
export function useConversationSummaries({
  history,
  savedConversations,
  view,
  visiblePage,
  conversation,
  recentConversations,
  pageConversations
}: {
  history: HermesState[]
  savedConversations: Ref[]
  view: View
  visiblePage: number
  conversation: Conversation | null
  recentConversations: Ref[]
  pageConversations: Ref[]
}) {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([])
  const [titlesLoading, setTitlesLoading] = useState(false)
  useEffect(() => {
    let current = true
    const ids = [
      ...new Set(
        [...(conversation ? [conversation] : []), ...recentConversations, ...pageConversations]
          .filter(item => item.sessionId)
          .map(item => item.workId)
      )
    ].slice(0, 10)
    setSummaries([])
    if (!ids.length) {
      setTitlesLoading(false)
      return
    }
    setTitlesLoading(true)
    void window.protectedHerald
      .conversationSummaries(ids)
      .then(items => {
        if (current) setSummaries(items)
      })
      .catch(() => {
        if (current) setSummaries(ids.map(workId => ({ workId, title: null, startedAt: null, unavailable: true })))
      })
      .finally(() => {
        if (current) setTitlesLoading(false)
      })
    return () => {
      current = false
    }
  }, [history, savedConversations, view, visiblePage, conversation?.workId])
  function summaryLabel(workId: string, index: number) {
    const item = summaries.find(entry => entry.workId === workId)
    const date = item?.startedAt
      ? new Date(item.startedAt * 1000).toLocaleString('ko-KR', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '날짜 미확인'
    return {
      title: item?.title || '새 대화',
      detail: `${date} · 기록 ${index + 1}${titlesLoading ? ' · 질문 확인 중' : item?.unavailable || !item ? ' · 질문 확인 불가' : !item.title ? ' · 질문 없음/보호됨' : ''}`
    }
  }
  return summaryLabel
}
