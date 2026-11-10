import { test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Apps } from './apps.ts'
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'herald-apps-')))
  const bundle = path.join(root, 'Fixture.app')
  mkdirSync(path.join(bundle, 'Contents'), { recursive: true })
  writeFileSync(
    path.join(bundle, 'Contents/Info.plist'),
    '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.herald.fixture</string></dict></plist>'
  )
  return { root, bundle, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
test('repeat clicks coalesce and only selected discovered bundle reaches opener', async () => {
  const f = fixture()
  let count = 0
  let release!: () => void
  const waiting = new Promise<string>(r => {
    release = () => r('')
  })
  const apps = new Apps(
    async p => {
      expect(p).toBe(f.bundle)
      count++
      return waiting
    },
    [f.root]
  )
  try {
    const [entry] = await apps.list()
    const first = apps.launch(entry.id)
    await apps.launch(entry.id)
    for (let n = 0; n < 100 && count === 0; n++) await new Promise(r => setTimeout(r, 10))
    expect(count).toBe(1)
    release()
    await first
  } finally {
    release()
    f.cleanup()
  }
})
test('removed app is rejected and opener failure is surfaced without raw diagnostics', async () => {
  const f = fixture()
  const apps = new Apps(async () => 'potential private diagnostic', [f.root])
  try {
    const [entry] = await apps.list()
    await expect(apps.launch(entry.id)).rejects.toThrow('macOS could not open')
    rmSync(f.bundle, { recursive: true })
    await apps.list()
    await expect(apps.launch(entry.id)).rejects.toThrow('no longer available')
  } finally {
    f.cleanup()
  }
})
