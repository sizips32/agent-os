// node-pty spawns shells through prebuilds/<platform>/spawn-helper, which must be executable.
// Installs that skip node-pty's own postinstall (or unpack it without the mode bit) leave it
// non-executable and every terminal open fails with "posix_spawnp failed". Safe to run repeatedly.
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prebuilds = path.join(root, 'node_modules/node-pty/prebuilds')
if (existsSync(prebuilds)) {
  for (const platform of readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, platform, 'spawn-helper')
    if (existsSync(helper) && (statSync(helper).mode & 0o111) !== 0o111) chmodSync(helper, 0o755)
  }
}
