// Minimal staged package only: no development dependencies, profiles, credentials or histories.
import { build, Platform, Arch } from 'electron-builder'
import { cp, mkdir, mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(path.join(root, '.local'), { recursive: true })
const staged = await mkdtemp(path.join(root, '.local/package-input-'))
await cp(path.join(root, 'apps/desktop/dist'), path.join(staged, 'dist'), { recursive: true, filter: (p) => !p.endsWith('.map') })
// Include only node-pty runtime JS and platform N-API binaries.
const ptyTarget = path.join(staged, 'node_modules/node-pty')
await mkdir(ptyTarget, { recursive: true })
for (const name of ['package.json', 'LICENSE', 'lib']) {
  await cp(path.join(root, 'node_modules/node-pty', name), path.join(ptyTarget, name), { recursive: true, filter: p => !p.endsWith('.map') && !p.endsWith('.test.js') })
}
await writeFile(path.join(ptyTarget, 'package.json'), JSON.stringify({ name: 'node-pty', version: '1.1.0', main: 'lib/index.js', license: 'MIT' }))
const nativePath = path.join(ptyTarget, 'prebuilds/darwin-arm64')
await mkdir(nativePath, { recursive: true })
await cp(path.join(root, 'node_modules/node-pty/prebuilds/darwin-arm64'), nativePath, { recursive: true })
await chmod(path.join(nativePath, 'spawn-helper'), 0o755)
await writeFile(
  path.join(staged, 'package.json'),
  JSON.stringify({
    name: 'ohha-agent-os-protected',
    version: '0.1.3',
    dependencies: { 'node-pty': '1.1.0' },
    private: true,
    license: 'MIT',
    description: 'Protected local Agent OS desktop',
    author: 'OH-HA',
    main: 'dist/electron/main.mjs'
  })
)
const config = JSON.parse(await readFile(path.join(root, 'apps/desktop/build/protected.json'), 'utf8'))
await build({
  projectDir: staged,
  targets: Platform.MAC.createTarget('dir', Arch.arm64),
  config: {
    ...config,
    asarUnpack: ['node_modules/node-pty/prebuilds/**'],
    files: ['dist/**', 'package.json', 'node_modules/node-pty/**'],
    mac: { ...config.mac, icon: path.join(root, 'apps/desktop/build/agent-os.png') },
    electronDist: path.join(root, 'node_modules/electron/dist'),
    directories: { output: path.join(root, 'apps/desktop/release/protected') },
    extraResources: [
      { from: path.join(root, 'apps/desktop/protected/task-inspect.py'), to: 'protected/task-inspect.py' },
      { from: path.join(root, 'apps/desktop/protected/task_report.py'), to: 'protected/task_report.py' },
      { from: path.join(root, 'apps/desktop/dist/native/document-reader'), to: 'protected/document-reader' },
      { from: path.join(root, 'apps/desktop/protected/document-third-party-licenses.txt'), to: 'protected/document-third-party-licenses.txt' },
      { from: path.join(root, 'apps/desktop/protected/vault-publish.py'), to: 'protected/vault-publish.py' },
      { from: path.join(root, 'apps/desktop/protected/vault-query.py'), to: 'protected/vault-query.py' },
      { from: path.join(root, 'apps/desktop/protected/diagnostics.py'), to: 'protected/diagnostics.py' },
      { from: path.join(root, 'apps/desktop/protected/sessions.py'), to: 'protected/sessions.py' },
      { from: path.join(root, 'apps/desktop/protected/admission.py'), to: 'protected/admission.py' },
      { from: path.join(root, 'apps/desktop/protected/hermes-cli.fixture.cjs'), to: 'protected/hermes-cli.fixture.cjs' },
      { from: path.join(root, 'LICENSE'), to: 'LICENSE' },
      { from: path.join(root, 'NOTICE'), to: 'NOTICE' }
    ]
  }
})
