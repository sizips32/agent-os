import { test, expect } from 'vitest'
import { protectedRuntimePaths } from './runtime-paths'
test('packaged helpers use Resources and writable app data, never app.asar for persistent state', () => {
  const p = protectedRuntimePaths(
    true,
    '/Applications/Agent OS.app/Contents/Resources',
    '/Applications/Agent OS.app/Contents/Resources/app.asar/dist/electron',
    '/Users/test/Library/Application Support',
    false
  )
  expect(p.admission).toBe('/Applications/Agent OS.app/Contents/Resources/protected/admission.py')
  expect(p.data).toBe('/Users/test/Library/Application Support/Agent OS')
  expect(p.data).not.toContain('app.asar')
  expect(protectedRuntimePaths(true, '/resources', '/main', '/data', true).data).toBe('/data/Agent OS Local Tests')
})
test('development and fixture state remain isolated', () => {
  const p = protectedRuntimePaths(false, '/unused', '/repo/apps/desktop/dist/electron', '/unused', false)
  expect(p.admission).toBe('/repo/apps/desktop/protected/admission.py')
  expect(p.data).toBe('/repo/.local/protected-herald')
  expect(protectedRuntimePaths(false, '/unused', '/repo/apps/desktop/dist/electron', '/unused', true).data).toBe('/repo/.local/protected-herald-fixture')
})
