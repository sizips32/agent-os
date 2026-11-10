import { test, expect } from 'vitest'
import { diagnose, diagnostic, diagnosticLabels } from './policy'
test.each(Object.keys(diagnosticLabels))('diagnostic %s has a safe, actionable label', code => {
  const d = diagnostic(code)
  expect(d.code).toBe(code)
  expect(d.ready).toBe(code === 'ready')
  expect(d.message.length).toBeGreaterThan(10)
})
test('CLI and Python missing are distinguished without running the helper', async () => {
  let n = 0
  const read = async () => {
    throw Error('must not call')
  }
  expect(
    (
      await diagnose('fixed', {
        access: async () => {
          throw Error('missing')
        },
        read
      })
    ).code
  ).toBe('cli_missing')
  expect(
    (
      await diagnose('fixed', {
        access: async () => {
          if (++n === 2) throw Error('missing')
        },
        read
      })
    ).code
  ).toBe('python_missing')
})
test.each([
  'auth_required',
  'policy_mismatch',
  'profile_unavailable',
  'memory_unavailable',
  'auth_unavailable',
  'ready'
])('helper %s strips all extra fields', async code => {
  const d = await diagnose('fixed', {
    access: async () => {},
    read: async () =>
      JSON.stringify({
        code,
        token: 'private fixture',
        config: 'private fixture'
      })
  })
  expect(JSON.stringify(d)).not.toContain('private fixture')
  expect(d.code).toBe(code)
})
test('malformed, unknown or failing helper does not expose diagnostics', async () => {
  for (const read of [
    async () => 'not-json-secret',
    async () => JSON.stringify({ code: 'secret-code' }),
    async () => {
      throw Error('credential fixture')
    }
  ]) {
    const d = await diagnose('fixed', { access: async () => {}, read })
    expect(d.code).toBe('diagnostic_unavailable')
    expect(JSON.stringify(d)).not.toMatch(/secret|credential/)
  }
})

test('image support is a strict native declaration; readiness alone never enables it', async () => {
  for (const [code, value, expected] of [
    ['ready', true, true],
    ['ready', false, false],
    ['ready', 'true', false],
    ['auth_required', true, false]
  ]) {
    const d = await diagnose('fixed', {
      access: async () => {},
      read: async () => JSON.stringify({ code, nativeImageAllowed: value })
    })
    expect(d.nativeImageAllowed).toBe(expected)
  }
})
