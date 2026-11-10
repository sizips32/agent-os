import { useState } from 'react'
import type { NativeApp } from '../../protected/types.ts'

/** Opens an installed app through the bridge. Opening never sends a message. */
export function useLauncher({ reportError }: { reportError: (message: string) => void }) {
  const [launchNotice, setLaunchNotice] = useState<{ app: string; text: string } | null>(null)
  const [launching, setLaunching] = useState('')
  async function launch(app: NativeApp, purpose?: string) {
    if (launching) return
    setLaunching(app.id)
    try {
      await window.protectedHerald.launch(app.id)
      setLaunchNotice({
        app: app.name,
        text:
          purpose === 'Samantha'
            ? 'Samantha: ChatGPT 열기 요청을 macOS에 전달했습니다. 사만다 대화는 직접 선택해 주세요. 메시지는 전송하지 않았습니다.'
            : `${app.name} 열기 요청을 macOS에 전달했습니다. 보안 경고는 직접 확인해 주세요.`
      })
    } catch {
      setLaunchNotice({ app: app.name, text: `${purpose ?? app.name} 열기 실패` })
      reportError(`${purpose ?? app.name} 열기 실패. 앱 목록을 새로 확인해 주세요.`)
    } finally {
      setLaunching('')
    }
  }
  return { launching, launchNotice, launch }
}
