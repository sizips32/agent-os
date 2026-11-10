import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProfileDiagnostic } from './types'
export const diagnosticLabels = {
  ready: '지젤 연결 준비 완료 · 인증 로컬 확인 · 실제 모델 응답 미검증',
  cli_missing: 'Hermes CLI가 없거나 실행할 수 없습니다. 기존 Hermes 설치를 확인한 뒤 다시 확인하세요.',
  python_missing: 'Hermes Python 환경이 없거나 실행할 수 없습니다. 기존 Hermes 설치를 확인하세요.',
  profile_unavailable: 'giselle 프로필을 읽을 수 없습니다. 프로필 경로·설정 파일을 기존 Hermes에서 확인하세요.',
  policy_mismatch: '기존 지젤의 제공자·수동 승인·단일 요청 거부 정책이 일치하지 않습니다. 자동으로 변경하지 않습니다.',
  memory_unavailable: '기존 지젤의 기억 활성화 또는 기억 파일 존재를 확인하지 못했습니다. 기존 Hermes에서 확인하세요.',
  auth_required: '기존 Hermes 인증이 필요하거나 만료되었습니다. Hermes 앱에서 직접 확인한 뒤 다시 확인하세요.',
  auth_unavailable: '인증 상태를 읽기 전용으로 확인하지 못했습니다. 인증을 갱신하거나 복사하지 않았습니다.',
  diagnostic_unavailable: '연결 진단을 완료하지 못했습니다. 기존 Hermes 앱에서 확인한 뒤 다시 확인하세요.'
}
export function diagnostic(code: unknown, fixtureMode = false): ProfileDiagnostic {
  const key =
    typeof code === 'string' && Object.hasOwn(diagnosticLabels, code)
      ? (code as keyof typeof diagnosticLabels)
      : 'diagnostic_unavailable'
  return {
    profile: 'giselle',
    ready: key === 'ready',
    code: key,
    message: fixtureMode && key === 'ready' ? '로컬 가상 CLI · 실제 지젤 아님' : diagnosticLabels[key],
    fixtureMode
  }
}
export async function diagnose(
  helper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../protected/diagnostics.py'),
  ports = {
    access: async (p: string) => access(p, constants.X_OK),
    read: async (python: string, helper: string) =>
      (
        await promisify(execFile)(
          '/usr/bin/sandbox-exec',
          ['-p', '(version 1) (allow default) (deny file-write*) (deny network*)', python, '-I', '-B', helper],
          {
            shell: false,
            timeout: 8000,
            maxBuffer: 4096,
            env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }
          }
        )
      ).stdout
  }
): Promise<ProfileDiagnostic> {
  const python = path.join(homedir(), '.hermes/hermes-agent/venv/bin/python')
  try {
    await ports.access(path.join(homedir(), '.local/bin/hermes'))
  } catch {
    return diagnostic('cli_missing')
  }
  try {
    await ports.access(python)
  } catch {
    return diagnostic('python_missing')
  }
  try {
    const v = JSON.parse(await ports.read(python, helper))
    return { ...diagnostic(v.code), nativeImageAllowed: v.code === 'ready' && v.nativeImageAllowed === true }
  } catch {
    return diagnostic('diagnostic_unavailable')
  }
}
export async function policy(helper?: string): Promise<boolean> {
  return (await diagnose(helper)).ready
}
