import { describe, test, expect } from 'vitest'
import { approvedPath, Apps } from './apps.ts'
import { prepareInput } from './input.ts'
import { hermesRoute } from './hermes-cli.ts'
import { readFileSync } from 'node:fs'
describe('protected boundaries', () => {
  test('only direct app bundles under known roots qualify', () => {
    expect(approvedPath('/Applications/Buzz.app', '/Applications')).toBe(true)
    for (const p of [
      '/tmp/Buzz.app',
      '/Applications/../tmp/Buzz.app',
      '/Applications/Buzz.app/Contents/MacOS/buzz',
      '/Applications/x.sh',
      '/Applications/Folder/Buzz.app'
    ])
      expect(approvedPath(p, '/Applications')).toBe(false)
  })
  test('renderer cannot invoke paths or shell commands', async () => {
    const a = new Apps(async () => {
      throw Error('must not open')
    })
    for (const id of ['/Applications/Buzz.app', '$(touch /tmp/test)', '../x', 'a'.repeat(64)])
      await expect(a.launch(id)).rejects.toThrow()
  })
  test('bounded prompts and stable submission identifiers', () => {
    const uuid = '12345678-1234-1234-1234-123456789012'
    expect(() => prepareInput('hello', uuid)).not.toThrow()
    for (const input of ['', '\0', 'x'.repeat(12001), null]) expect(() => prepareInput(input, uuid)).toThrow()
    expect(() => prepareInput('hello', '../bad')).toThrow()
  })
  test('CLI operations reject arbitrary profile, command and prompt fields', () => {
    const workId = 'work_' + 'a'.repeat(32)
    for (const value of [
      { action: 'shell', workId },
      { action: 'start', workId, profile: 'default' },
      { action: 'start', workId, text: 'override' },
      { action: 'status', workId: '../x' }
    ])
      expect(() => hermesRoute(value)).toThrow()
  })
  test('boot entry cannot run upstream initialization or bootstrap writes', () => {
    const main = readFileSync('protected/main.ts', 'utf8')
    for (const unsafe of [
      'ensureBridgePlugin(',
      'migrateLegacyData(',
      'BackendManager(',
      'syncHermesSkin(',
      'registerVoiceIpc(',
      'registerTerminalIpc('
    ])
      expect(main).not.toContain(unsafe)
    const bootstrap = readFileSync('../../scripts/bootstrap.sh', 'utf8')
    expect(bootstrap).not.toMatch(/plugins enable|tools enable|config set|rm -rf|hermes setup/)
  })
})
