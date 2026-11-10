import { homedir } from 'node:os'
import { realpathSync, readdirSync, lstatSync } from 'node:fs'
import path from 'node:path'
// Process-local restriction: does not alter macOS permissions or Hermes settings.
export function hermesProtection(userHome = homedir()): string {
  const home = path.join(realpathSync(userHome), '.hermes')
  const profile = path.join(home, 'profiles/giselle')
  const protectedPaths = [
    ...['config.yaml', '.env', 'auth.json', 'SOUL.md', 'memories', 'plugins', 'skills', 'skins'].flatMap(name => [
      path.join(home, name),
      path.join(profile, name)
    ]),
    path.join(home, 'active_profile'),
    path.join(userHome, '.codex/auth.json'),
    path.join(userHome, '.codex/config.toml'),
    path.join(userHome, 'Library/Application Support/Agent OS')
  ]
  const canonical = new Set(protectedPaths)
  for (const p of protectedPaths) {
    try {
      canonical.add(realpathSync(p))
      if (lstatSync(p).isDirectory())
        for (const entry of readdirSync(p)) canonical.add(realpathSync(path.join(p, entry)))
    } catch {
      /* Absent protected paths remain denied by their literal location. */
    }
  }
  return (
    '(version 1)\n(allow default)\n' +
    [...canonical].map(p => `(deny file-write* (subpath ${JSON.stringify(p)}))`).join('\n')
  )
}

export function vaultProtection(root: string, userHome = homedir()): string {
  if (!path.isAbsolute(root) || root.includes('\0') || root === '/' || root === userHome)
    throw Error('Invalid vault boundary')
  const paths = new Set([root, realpathSync(root)])
  return (
    hermesProtection(userHome) +
    '\n' +
    [...paths]
      .map(p => `(deny file-read* (subpath ${JSON.stringify(p)}))\n(deny file-write* (subpath ${JSON.stringify(p)}))`)
      .join('\n')
  )
}
