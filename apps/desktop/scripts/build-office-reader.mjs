// Builds the sandboxed Rust Office extractor into dist/native/office-reader.
// Also used as the vitest globalSetup so document tests run against the real binary.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export default function buildOfficeReader() {
  const target = path.join(root, '../../.local/cargo-target')
  execFileSync(
    'cargo',
    [
      'build',
      '--release',
      '--locked',
      '--manifest-path',
      path.join(root, 'native/office-reader/Cargo.toml'),
      '--target-dir',
      target
    ],
    { stdio: 'inherit', timeout: 600000 }
  )
  mkdirSync(path.join(root, 'dist/native'), { recursive: true })
  copyFileSync(path.join(target, 'release/office-reader'), path.join(root, 'dist/native/office-reader'))
}
