import type { NativeApp } from '../../protected/types.ts'

const HERMES_BUNDLE = 'com.nousresearch.hermes'

/** Dismissible error notices and the "profile not ready" banner. */
export function StatusBanners({
  errors,
  ready,
  checking,
  diagnosis,
  apps,
  launching,
  onDismiss,
  onRefresh,
  onLaunch
}: {
  errors: string[]
  ready: boolean
  checking: boolean
  diagnosis: string
  apps: NativeApp[]
  launching: string
  onDismiss: (error: string) => void
  onRefresh: () => void
  onLaunch: (app: NativeApp) => void
}) {
  const hermes = apps.find(a => a.bundleId === HERMES_BUNDLE)
  return (
    <>
      {errors.map(error => (
        <div key={error} role="alert" className="agent-error">
          <span>{error}</span>
          <button aria-label="오류 안내 확인" onClick={() => onDismiss(error)}>
            확인
          </button>
        </div>
      ))}
      {!ready && !checking && (
        <div role="alert" className="border-b border-line px-8 py-3 text-xs">
          {diagnosis}
          <button onClick={onRefresh} className="ml-4 rounded border border-line px-3 py-2">
            다시 확인
          </button>
          {hermes && (
            <button
              onClick={() => onLaunch(hermes)}
              disabled={!!launching}
              className="ml-2 rounded border border-line px-3 py-2"
            >
              기존 Hermes 열기
            </button>
          )}
        </div>
      )}
    </>
  )
}
