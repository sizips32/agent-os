export const failureCodes = ['runtime_boundary','sdk_changed','input_invalid','tools_blocked','context_blocked','network_blocked','transport_invalid','startup_failed','provider_result_failed','result_record_failed'] as const
const diagnosticBranches = ['protocol_total_limit','protocol_frame_limit','protocol_event_limit','invalid_json','invalid_init','invalid_event','invalid_result','session_mismatch','trailing_data','missing_result','process_exit','stdin_error','cli_result'] as const
export type DiagnosticBranch = typeof diagnosticBranches[number]
export type ExecutionDiagnostic = { code: typeof failureCodes[number]; stage: 'startup'|'initialization'|'model'|'transport'|'record'; at: string; branch?: DiagnosticBranch; exitCode?: number }
export function executionDiagnostic(code: unknown, stage: unknown, at = new Date().toISOString(), details?: {branch?:unknown;exitCode?:unknown}): ExecutionDiagnostic {
  if (!failureCodes.includes(code as ExecutionDiagnostic['code']) || !['startup','initialization','model','transport','record'].includes(stage as string) || !/^\d{4}-\d{2}-\d{2}T/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString()!==at) throw Error('Invalid diagnostic')
  if(details?.branch!==undefined&&!diagnosticBranches.includes(details.branch as DiagnosticBranch))throw Error('Invalid diagnostic branch')
  if(details?.exitCode!==undefined&&(!Number.isInteger(details.exitCode)||Number(details.exitCode)<0||Number(details.exitCode)>255))throw Error('Invalid diagnostic exit code')
  return {code: code as ExecutionDiagnostic['code'], stage: stage as ExecutionDiagnostic['stage'], at,
    ...(details?.branch!==undefined?{branch:details.branch as DiagnosticBranch}:{}),
    ...(details?.exitCode!==undefined?{exitCode:details.exitCode as number}:{})}
}
export function diagnosticReason(d: ExecutionDiagnostic): string {
  return `실행 오류 (${d.code} · ${d.stage} · ${d.at}${d.branch?` · ${d.branch}`:''}${d.exitCode!==undefined?` · exit=${d.exitCode}`:''}). 사용자 중단과 구분된 오류입니다. 외부 처리 여부는 미확정이며 같은 요청을 재전송하지 마세요.`
}
