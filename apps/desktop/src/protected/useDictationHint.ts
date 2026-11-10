import { useState, type RefObject } from 'react'
import type { NativeApp } from '../../protected/types.ts'

/**
 * Typeless dictation hint: restores the caret in the composer and explains how to dictate.
 * The app never records audio or sends shortcuts.
 */
export function useDictationHint({
  composerInput,
  caret,
  apps
}: {
  composerInput: RefObject<HTMLTextAreaElement | null>
  caret: RefObject<{ start: number; end: number }>
  apps: NativeApp[]
}) {
  const [dictationNotice, setDictationNotice] = useState('')
  function typelessInput() {
    const input = composerInput.current
    if (!input || input.disabled) return
    const position =
      document.activeElement === input ? { start: input.selectionStart, end: input.selectionEnd } : caret.current
    input.focus()
    input.setSelectionRange(position.start, position.end)
    setDictationNotice(
      apps.some(app => app.bundleId === 'now.typeless.desktop')
        ? '입력 위치를 유지했습니다. 기존 Typeless 단축키를 직접 눌러 말해 주세요. 정리된 텍스트는 초안에만 반영됩니다. 이 앱은 녹음을 시작하지 않습니다. Typeless는 음성을 클라우드에서 처리합니다.'
        : 'Typeless 앱을 먼저 실행한 뒤 입력창에서 기존 단축키를 직접 사용하세요. 이 앱은 녹음을 시작하거나 요청을 전송하지 않습니다.'
    )
  }
  return { dictationNotice, setDictationNotice, typelessInput }
}
