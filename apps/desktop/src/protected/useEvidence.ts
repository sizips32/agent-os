import { useState } from 'react'
import { vaultCompose, VAULT_SYSTEM_PROMPT, type VaultEvidence } from '../../protected/vault-types'

const EVIDENCE_LIMIT = 8
const REQUEST_CHARS = 12000

/** Vault evidence attached to the next request. `locked` and `instructions` are read at call time. */
export function useEvidence({ locked, instructions }: { locked: () => boolean; instructions: () => string }) {
  const [evidence, setEvidence] = useState<VaultEvidence[]>([])
  const [consent, setConsent] = useState(false)
  function addEvidence(item: VaultEvidence) {
    if (locked() || evidence.length >= EVIDENCE_LIMIT)
      return { ok: false, message: '현재 요청/결과를 마무리하거나 근거 개수를 줄여 주세요.' }
    if (
      evidence.some(e => e.path === item.path && e.hash === item.hash && e.start === item.start && e.end === item.end)
    )
      return { ok: false, message: '이미 같은 원문 구간을 근거에 담았습니다. 중복 추가하지 않습니다.' }
    const next = [...evidence, item]
    if (vaultCompose(instructions(), next).length + VAULT_SYSTEM_PROMPT.length > REQUEST_CHARS)
      return { ok: false, message: '질문·첨부·근거·구분자 합계가 12,000자를 넘습니다. 구간을 줄여 주세요.' }
    setEvidence(next)
    setConsent(false)
    return { ok: true, message: '근거를 질문에 담았습니다. 아직 전송하지 않았습니다.' }
  }
  function removeEvidence(id: string) {
    setEvidence(v => v.filter(x => x.id !== id))
    void window.protectedHerald.vault({ action: 'release', id })
  }
  /** Releases every held evidence item on the main side and resets consent. */
  function clearEvidence() {
    for (const item of evidence) void window.protectedHerald.vault({ action: 'release', id: item.id })
    setEvidence([])
    setConsent(false)
  }
  return { evidence, consent, setConsent, addEvidence, removeEvidence, clearEvidence }
}
