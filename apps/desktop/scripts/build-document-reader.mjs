import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform === 'darwin') {
  mkdirSync(path.join(root, 'dist/native'), { recursive: true })
  mkdirSync(path.join(root, '../../.local/swift-cache'), { recursive: true })
  // Keep the unoptimized variant verified with native bilingual/rotated fixtures.
  execFileSync('/usr/bin/swiftc', ['-module-cache-path', path.join(root, '../../.local/swift-cache'),
    path.join(root, 'protected/document-reader.swift'), '-o', path.join(root, 'dist/native/document-reader')], { stdio: 'inherit', timeout: 120000 })
}
