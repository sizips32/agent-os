import { readdir, realpath, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { homedir } from 'node:os'
import type { NativeApp } from './types.ts'
const roots = ['/Applications', '/System/Applications', path.join(homedir(), 'Applications')]
export function approvedPath(candidate: string, root: string): boolean {
  return path.dirname(candidate) === root && candidate.endsWith('.app') && !candidate.includes('\0')
}
export class Apps {
  private entries = new Map<string, { view: NativeApp; path: string; root: string }>()
  private launching = new Set<string>()
  constructor(
    private open: (p: string) => Promise<string>,
    private directories: string[] = roots
  ) {}
  async list(): Promise<NativeApp[]> {
    const next = new Map<string, { view: NativeApp; path: string; root: string }>()
    for (const root of this.directories) {
      let names: string[]
      try {
        names = await readdir(root)
      } catch {
        continue
      }
      for (const name of names.filter((n) => n.endsWith('.app'))) {
        try {
          const p = path.join(root, name)
          const actual = await realpath(p)
          if (!approvedPath(actual, root) || (await stat(actual)).isDirectory() === false) continue
          const { stdout } = await promisify(execFile)(
            '/usr/bin/plutil',
            ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(actual, 'Contents/Info.plist')],
            { shell: false, timeout: 2000, maxBuffer: 1000 }
          )
          const bundleId = stdout.trim()
          if (!/^[A-Za-z0-9_.-]{3,160}$/.test(bundleId)) continue
          const id = createHash('sha256')
            .update(actual + '\0' + bundleId)
            .digest('hex')
          next.set(id, { view: { id, name: name.slice(0, -4), bundleId }, path: actual, root })
        } catch {
          /* Invalid or inaccessible bundle is not offered. */
        }
      }
    }
    this.entries = next
    return [...next.values()].map((e) => e.view).sort((a, b) => a.name.localeCompare(b.name))
  }
  async launch(id: unknown): Promise<void> {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid application selection')
    const e = this.entries.get(id)
    if (!e) throw Error('App is no longer available; refresh the list')
    if (this.launching.has(id)) return
    this.launching.add(id)
    try {
      if ((await realpath(e.path)) !== e.path || !approvedPath(e.path, e.root)) throw Error('App path changed; refresh the list')
      const { stdout } = await promisify(execFile)(
        '/usr/bin/plutil',
        ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(e.path, 'Contents/Info.plist')],
        { shell: false, timeout: 2000, maxBuffer: 1000 }
      )
      if (stdout.trim() !== e.view.bundleId) throw Error('App identity changed; refresh the list')
      if (await this.open(e.path)) throw Error('macOS could not open the app. Check its security prompt directly.')
    } finally {
      this.launching.delete(id)
    }
  }
}
