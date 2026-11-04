import { test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { hermesProtection } from './sandbox.ts'
test('child sandbox denies config and memory writes while allowing owned session data', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'protected-herald-'))
  try {
    const profile = path.join(root, '.hermes/profiles/giselle')
    mkdirSync(path.join(profile, 'memories'), { recursive: true })
    mkdirSync(path.join(profile, 'sessions'))
    const config = path.join(profile, 'config.yaml')
    const memory = path.join(profile, 'memories/MEMORY.md')
    const session = path.join(profile, 'sessions/new.txt')
    writeFileSync(config, 'unchanged')
    writeFileSync(memory, 'unchanged')
    const deny = spawnSync('/usr/bin/sandbox-exec', [
      '-p',
      hermesProtection(root),
      '/bin/sh',
      '-c',
      'printf change > "$1"; printf change > "$2"',
      'protected-test',
      config,
      memory
    ])
    expect(deny.status).not.toBe(0)
    expect(readFileSync(config, 'utf8')).toBe('unchanged')
    expect(readFileSync(memory, 'utf8')).toBe('unchanged')
    const allow = spawnSync('/usr/bin/sandbox-exec', ['-p', hermesProtection(root), '/bin/sh', '-c', 'printf owned > "$1"', 'protected-test', session])
    expect(allow.status).toBe(0)
    expect(readFileSync(session, 'utf8')).toBe('owned')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
