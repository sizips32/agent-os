import { useRef, useState } from 'react'
import type { HermesState, NativeApp } from '../../protected/types.ts'

/** Loads the app list, Giselle profile diagnosis, history and selected conversations. */
export function useProfile({ reportError }: { reportError: (message: string) => void }) {
  const [apps, setApps] = useState<NativeApp[]>([])
  const [appsLoaded, setAppsLoaded] = useState(false)
  const [fixtureMode, setFixtureMode] = useState(false)
  const [diagnosis, setDiagnosis] = useState('지젤 프로필 확인 중…')
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)
  const [nativeImageAllowed, setNativeImageAllowed] = useState(false)
  const [profileCode, setProfileCode] = useState('diagnostic_unavailable')
  const [history, setHistory] = useState<HermesState[]>([])
  const [savedConversations, setSavedConversations] = useState<{ workId: string; sessionId: string }[]>([])
  const refreshGeneration = useRef(0)
  async function refresh() {
    const generation = ++refreshGeneration.current
    setChecking(true)
    setReady(false)
    setNativeImageAllowed(false)
    setDiagnosis('지젤 프로필 확인 중…')
    try {
      const nextApps = await window.protectedHerald.apps()
      if (generation !== refreshGeneration.current) return
      setApps(nextApps)
      setAppsLoaded(true)
      const profile = await window.protectedHerald.profile()
      const nextHistory = await window.protectedHerald.history()
      const nextSelections = await window.protectedHerald.selectedConversations()
      if (generation !== refreshGeneration.current) return
      setReady(profile.ready)
      setNativeImageAllowed(profile.nativeImageAllowed === true)
      setProfileCode(profile.code)
      setDiagnosis(profile.message)
      setFixtureMode(!!profile.fixtureMode)
      setHistory(nextHistory)
      setSavedConversations(nextSelections)
    } catch {
      if (generation === refreshGeneration.current) {
        setDiagnosis('목록 또는 프로필 확인 실패 · 다시 확인하거나 기존 Hermes 앱을 열어 주세요.')
        reportError('연결 진단을 완료하지 못했습니다.')
      }
    } finally {
      if (generation === refreshGeneration.current) setChecking(false)
    }
  }

  async function reloadHistory() {
    setHistory(await window.protectedHerald.history())
  }
  /** Invalidates any refresh still in flight; used on unmount. */
  function dispose() {
    ++refreshGeneration.current
  }
  return {
    apps,
    appsLoaded,
    fixtureMode,
    diagnosis,
    checking,
    ready,
    nativeImageAllowed,
    profileCode,
    history,
    savedConversations,
    setSavedConversations,
    refresh,
    reloadHistory,
    dispose
  }
}
