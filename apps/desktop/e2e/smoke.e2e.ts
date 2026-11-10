// Launches the built app against the offline fixture transport (no Hermes, no model, no real vault).
// Data goes to <repo>/.local/protected-herald-fixture, which is wiped before every launch.
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterEach, expect, test } from 'vitest'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureData = path.resolve(desktop, '../../.local/protected-herald-fixture')
let app: ElectronApplication | undefined

async function launch(transport: 'complete' | 'wait'): Promise<Page> {
  rmSync(fixtureData, { recursive: true, force: true })
  // E2E_APP points the same smoke tests at the packaged app instead of the dev build.
  const packaged = process.env.E2E_APP
  app = await electron.launch({
    ...(packaged ? { executablePath: packaged } : { args: ['.'] }),
    cwd: desktop,
    env: { ...process.env, HERALD_TEST_TRANSPORT: transport } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[aria-label="지젤에게 보낼 요청"]')
  return page
}

afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
})

const compose = '[aria-label="지젤에게 보낼 요청"]'
const ready = (page: Page) =>
  expect.poll(() => page.locator('.agent-status-badges').innerText(), { timeout: 20000 }).toContain('지젤 · 준비')

test('starts with a ready diagnosis and a live terminal', async () => {
  const page = await launch('complete')
  await ready(page)
  // xterm is a separately loaded chunk: this fails if the app's CSP or packaging blocks it.
  await expect.poll(() => page.locator('.xterm').count(), { timeout: 20000 }).toBeGreaterThan(0)
  // The shell must actually start: a non-executable node-pty spawn-helper fails here (posix_spawnp).
  await expect
    .poll(() => page.locator('.agent-terminal-toolbar [role="status"]').innerText(), { timeout: 20000 })
    .toContain('로컬 Mac')
})

test('a request is answered by the fixture transport', async () => {
  const page = await launch('complete')
  await ready(page)
  await page.fill(compose, 'smoke request')
  await page.click('[aria-label="지젤에게 전송"]')
  await expect
    .poll(() => page.locator('.agent-result').first().innerText(), { timeout: 20000 })
    .toContain('fixture response')
  await expect.poll(() => page.locator('main').innerText()).toContain('응답 수신')
})

test('stopping a running request ends as unknown, with no way to resend', async () => {
  const page = await launch('wait')
  await ready(page)
  await page.fill(compose, 'smoke request')
  await page.click('[aria-label="지젤에게 전송"]')
  await page.click('[aria-label="응답 대기 중단"]')
  await expect.poll(() => page.locator('main').innerText(), { timeout: 20000 }).toContain('결과 불명 · 재전송 금지')
  expect(await page.locator(compose).isDisabled()).toBe(true)
  expect(await page.locator('[aria-label="지젤에게 전송"]').isDisabled()).toBe(true)
})
