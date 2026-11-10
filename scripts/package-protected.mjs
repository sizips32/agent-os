// Minimal staged package only: no development dependencies, profiles, credentials or histories.
import { build, Platform, Arch } from 'electron-builder'
import { cp, mkdir, mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'))
// Version and target architecture follow the package and the machine, not literals in this script.
const { version } = await readJson('apps/desktop/package.json')
const ptyVersion = (await readJson('node_modules/node-pty/package.json')).version
const electronVersion = (await readJson('node_modules/electron/package.json')).version
const arch = { arm64: Arch.arm64, x64: Arch.x64 }[process.arch]
if (!arch) throw Error(`Unsupported packaging architecture: ${process.arch}`)
await mkdir(path.join(root, '.local'), { recursive: true })
const staged = await mkdtemp(path.join(root, '.local/package-input-'))
await cp(path.join(root, 'apps/desktop/dist'), path.join(staged, 'dist'), {
  recursive: true,
  filter: p => !p.endsWith('.map')
})
// Include only node-pty runtime JS and platform N-API binaries.
const ptyTarget = path.join(staged, 'node_modules/node-pty')
await mkdir(ptyTarget, { recursive: true })
for (const name of ['package.json', 'LICENSE', 'lib']) {
  await cp(path.join(root, 'node_modules/node-pty', name), path.join(ptyTarget, name), {
    recursive: true,
    filter: p => !p.endsWith('.map') && !p.endsWith('.test.js')
  })
}
await writeFile(
  path.join(ptyTarget, 'package.json'),
  JSON.stringify({ name: 'node-pty', version: ptyVersion, main: 'lib/index.js', license: 'MIT' })
)
const prebuild = `darwin-${process.arch}`
const nativePath = path.join(ptyTarget, 'prebuilds', prebuild)
await mkdir(nativePath, { recursive: true })
await cp(path.join(root, 'node_modules/node-pty/prebuilds', prebuild), nativePath, { recursive: true })
await chmod(path.join(nativePath, 'spawn-helper'), 0o755)
await writeFile(
  path.join(staged, 'package.json'),
  JSON.stringify({
    name: 'ohha-agent-os-protected',
    version,
    dependencies: { 'node-pty': ptyVersion },
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
  targets: Platform.MAC.createTarget('dir', arch),
  config: {
    ...config,
    electronVersion,
    asarUnpack: ['node_modules/node-pty/prebuilds/**'],
    files: ['dist/**', 'package.json', 'node_modules/node-pty/**'],
    mac: { ...config.mac, icon: path.join(root, 'apps/desktop/build/agent-os.png') },
    electronDist: path.join(root, 'node_modules/electron/dist'),
    directories: { output: path.join(root, 'apps/desktop/release/protected') },
    extraResources: [
      { from: path.join(root, 'apps/desktop/protected/task-inspect.py'), to: 'protected/task-inspect.py' },
      { from: path.join(root, 'apps/desktop/protected/task_report.py'), to: 'protected/task_report.py' },
      { from: path.join(root, 'apps/desktop/dist/native/document-reader'), to: 'protected/document-reader' },
      { from: path.join(root, 'apps/desktop/dist/native/office-reader'), to: 'protected/office-reader' },
      {
        from: path.join(root, 'apps/desktop/protected/document-third-party-licenses.txt'),
        to: 'protected/document-third-party-licenses.txt'
      },
      { from: path.join(root, 'apps/desktop/protected/vault-publish.py'), to: 'protected/vault-publish.py' },
      { from: path.join(root, 'apps/desktop/protected/vault-query.py'), to: 'protected/vault-query.py' },
      { from: path.join(root, 'apps/desktop/protected/diagnostics.py'), to: 'protected/diagnostics.py' },
      { from: path.join(root, 'apps/desktop/protected/sessions.py'), to: 'protected/sessions.py' },
      { from: path.join(root, 'apps/desktop/protected/admission.py'), to: 'protected/admission.py' },
      {
        from: path.join(root, 'apps/desktop/protected/hermes-cli.fixture.cjs'),
        to: 'protected/hermes-cli.fixture.cjs'
      },
      { from: path.join(root, 'LICENSE'), to: 'LICENSE' },
      { from: path.join(root, 'NOTICE'), to: 'NOTICE' }
    ]
  }
})
