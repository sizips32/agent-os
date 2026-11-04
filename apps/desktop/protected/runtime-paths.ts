import path from 'node:path'
export function protectedRuntimePaths(packaged: boolean, resources: string, mainDirectory: string, appData: string, fixture: boolean) {
  return {
    data: packaged
      ? path.join(appData, fixture ? 'Agent OS Local Tests' : 'Agent OS')
      : path.resolve(mainDirectory, fixture ? '../../../../.local/protected-herald-fixture' : '../../../../.local/protected-herald'),
    admission: packaged ? path.join(resources, 'protected/admission.py') : path.resolve(mainDirectory, '../../protected/admission.py'),
    diagnostics: packaged ? path.join(resources, 'protected/diagnostics.py') : path.resolve(mainDirectory, '../../protected/diagnostics.py'),
    sessions: packaged ? path.join(resources, 'protected/sessions.py') : path.resolve(mainDirectory, '../../protected/sessions.py'),
    fixture: packaged ? path.join(resources, 'protected/hermes-cli.fixture.cjs') : path.resolve(mainDirectory, '../../protected/hermes-cli.fixture.cjs')
  }
}
