import { createRequire } from 'node:module'
import { TaskInspector } from './task-inspector'
import { LocalTerminal, type SpawnPty } from './terminal'
import { app, BrowserWindow, ipcMain, shell, Menu, dialog, nativeImage, clipboard } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HermesCli } from './hermes-cli.ts'
import { FileAcpLedger } from './acp-ledger.ts'
import { Apps } from './apps.ts'
import { Sessions } from './sessions.ts'
import { policy, diagnose, diagnostic } from './policy.ts'
import { protectedRuntimePaths } from './runtime-paths.ts'
import { prepareInput } from './input.ts'
import { PreparationGate } from './preparation.ts'
import { Vault } from './vault.ts'
import { vaultCompose, VAULT_SYSTEM_PROMPT, type VaultCommand } from './vault-types.ts'
import type { DiscoveryCommand } from './discovery-state.ts'
import { vaultProtection } from './sandbox.ts'
import { VaultResults } from './vault-results.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ResultControls, copyResultText } from './result-controls.ts'
import { DiscoveryStore } from './discovery-store.ts'
import { Attachments, attachmentIds } from './attachments.ts'
import { PreparedRequests } from './prepared-requests.ts'
import { IPC, type IpcArgs, type IpcChannel } from './ipc-args.ts'
import type { WorkDetail } from './types.ts'
const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureMode = ['wait', 'invalid', 'preflight', 'stream-wait', 'complete'].includes(
  process.env.HERALD_TEST_TRANSPORT ?? ''
)
  ? process.env.HERALD_TEST_TRANSPORT
  : undefined
const runtime = protectedRuntimePaths(
  app.isPackaged,
  process.resourcesPath,
  here,
  app.getPath('appData'),
  !!fixtureMode
)
const data = runtime.data
const vaultDirectory =
  fixtureMode && process.env.HERALD_TEST_VAULT
    ? process.env.HERALD_TEST_VAULT
    : path.join(homedir(), 'Desktop/Obsidian-Syncthing/MyObsidianVault')
const vault = new Vault(
  vaultDirectory,
  path.join(data, 'vault-captures'),
  async uri => {
    if (!fixtureMode) await shell.openExternal(uri)
  },
  {
    writer: app.isPackaged
      ? path.join(process.resourcesPath, 'protected/vault-publish.py')
      : path.resolve(here, '../../protected/vault-publish.py')
  }
)
const vaultRunner = app.isPackaged
  ? path.join(process.resourcesPath, 'protected/vault-query.py')
  : path.resolve(here, '../../protected/vault-query.py')
const taskInspector = new TaskInspector({
  python: path.join(homedir(), '.hermes/hermes-agent/venv/bin/python'),
  reader: app.isPackaged
    ? path.join(process.resourcesPath, 'protected/task-inspect.py')
    : path.resolve(here, '../../protected/task-inspect.py'),
  state: fixtureMode
    ? path.join(data, 'task-fixtures')
    : path.join(homedir(), '.hermes/profiles/giselle/runtime/ohha-control'),
  vault: vaultDirectory,
  home: homedir()
})
const discoveryStore = new DiscoveryStore(path.join(data, 'discovery'))
// No Herald plugin, config migration, gateway, scheduler, theme, voice, permissions or auth setup.
process.env.HERMES_HOME = path.join(homedir(), '.hermes/profiles/giselle')
process.env.HERALD_OS_HERMES_ROOT = path.join(homedir(), '.hermes/hermes-agent')
app.setPath('userData', path.join(data, 'electron'))
app.setName('Agent OS')
const nativeHelper = (name: string) =>
  app.isPackaged ? path.join(process.resourcesPath, 'protected', name) : path.resolve(here, '../native', name)
const attachments = new Attachments(nativeHelper('document-reader'), undefined, nativeHelper('office-reader'))
const preparation = new PreparationGate<string>()
let filePickerOpen = false
const works = new Map<string, WorkDetail>()
const prepared = new PreparedRequests()
const apps = new Apps(p => shell.openPath(p))
const ledger = new FileAcpLedger(path.join(data, 'submissions'))
const vaultResults = new VaultResults(path.join(data, 'vault-results'))
const sessions = new Sessions(
  ledger,
  runtime.sessions,
  fixtureMode
    ? async sessionId => ({
        sessionId,
        limited: true,
        messages: ledger
          .recentKeys()
          .filter(k => ledger.sessionReference(k) === sessionId && ledger.completed(k))
          .flatMap(() => [
            { role: 'user', text: '로컬 시험 요청' },
            { role: 'assistant', text: 'fixture response' }
          ])
          .slice(-60)
      })
    : undefined,
  path.join(data, 'selected-sessions'),
  fixtureMode ? async () => ({ title: '로컬 시험 요청', startedAt: null }) : undefined,
  vaultResults
)
const hermes = new HermesCli(ledger, {
  policy: fixtureMode
    ? async () => {
        if (fixtureMode === 'preflight') await new Promise(resolve => setTimeout(resolve, 10000))
        return true
      }
    : () => policy(runtime.diagnostics),
  ...(fixtureMode
    ? {
        launch: sessionId =>
          spawn(
            path.join(homedir(), '.local/bin/node'),
            [runtime.fixture, fixtureMode, sessionId || `fixture_${randomUUID().replaceAll('-', '')}`],
            {
              shell: false,
              detached: true,
              stdio: ['pipe', 'pipe', 'pipe'],
              env: { PATH: '/usr/bin:/bin' }
            }
          )
      }
    : {}),
  resume: async workId => {
    const selected = await sessions.open(workId)
    if (!selected.canResume) throw Error('Unconfirmed submission cannot resume')
    return selected.sessionId
  },
  detail: async id => {
    const w = works.get(id)
    if (!w) throw Error('Unknown local request')
    return w
  },
  imagePolicy: async () => (fixtureMode ? false : (await diagnose(runtime.diagnostics)).nativeImageAllowed === true),
  onState: state => emitToRenderer('protected:hermes-event', state),
  release: async id => {
    try {
      await attachments.release(id)
    } finally {
      // The request is settled; the CLI no longer needs its instructions (record() runs before release).
      works.delete(id)
    }
  },
  vaultLaunch: async () => {
    if (fixtureMode)
      return spawn(
        path.join(homedir(), '.local/bin/node'),
        [runtime.fixture, fixtureMode, 'fixture_' + randomUUID().replaceAll('-', '')],
        { shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } }
      )
    const boundary = vaultProtection(await vault.root())
    const python = path.join(homedir(), '.hermes/hermes-agent/venv/bin/python')
    const { stdout } = await promisify(execFile)(
      '/usr/bin/sandbox-exec',
      ['-p', boundary, python, vaultRunner, '--check'],
      { timeout: 8000, maxBuffer: 4096 }
    )
    const checked = JSON.parse(stdout)
    if (checked.ready !== true)
      throw Error(
        checked.code === 'sdk_version_changed'
          ? '볼트 근거 요청 차단: 검증한 Hermes SDK 해시가 바뀌었습니다. 재검증 전에는 실행하거나 일반 지젤로 우회하지 않습니다.'
          : '볼트 근거 요청 차단: 지원되는 SDK 경계를 확인하지 못했습니다. 실행/우회하지 않습니다.'
      )
    return spawn('/usr/bin/sandbox-exec', ['-p', boundary, python, vaultRunner], {
      cwd: homedir(),
      shell: false,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', HOME: homedir(), HERMES_HOME: path.join(homedir(), '.hermes/profiles/giselle') }
    })
  },
  record: async (id, text, sessionId) => {
    const w = works.get(id)
    if (w?.purpose === 'vault_context') vaultResults.save(id, sessionId, w.question || '', text)
  },
  restoredVaultResult: id => {
    const result = vaultResults.read(id)
    return { sessionId: result.sessionId, text: result.answer }
  }
})
const resultControls = new ResultControls(path.join(data, 'result-view'), async workId => {
  if (workId.startsWith('selection_')) return (await sessions.open(workId)).canResume
  const status = await hermes.request({ action: 'status', workId })
  if (status.status === 'running') return false
  if (status.status === 'completed' || status.status === 'failed') return true
  return ledger.completed(workId) && (await sessions.open(workId)).canResume
})
let win: BrowserWindow | null = null
let quitting = false
let quitPending = false
/** Pushes to the app page only: the main frame, still on the packaged renderer URL. */
function emitToRenderer(channel: string, payload: unknown) {
  if (
    win &&
    !win.isDestroyed() &&
    win.webContents.mainFrame.url === pathToFileURL(path.join(here, '../renderer/index.html')).href
  ) {
    win.webContents.mainFrame.send(channel, payload)
  }
}
const localTerminal = new LocalTerminal(
  (file, args, options) => {
    const requirePty = createRequire(import.meta.url)
    const module = requirePty('node-pty') as { spawn: SpawnPty }
    return module.spawn(file, args, options)
  },
  event => emitToRenderer('protected:terminal-event', event),
  !!fixtureMode
)
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
    throw Error('Untrusted IPC sender')
  const url = event.senderFrame.url
  if (url !== pathToFileURL(path.join(here, '../renderer/index.html')).href) throw Error('Untrusted page')
}
function register() {
  const handle = <K extends IpcChannel>(channel: K, fn: (...args: IpcArgs<K>) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      trusted(event)
      return fn(...(IPC[channel](args) as IpcArgs<K>))
    })
  handle('protected:terminal-open', size => localTerminal.open(size))
  handle('protected:terminal-write', (id, text) => localTerminal.write(id, text))
  handle('protected:terminal-ack', (id, bytes) => localTerminal.acknowledge(id, bytes))
  handle('protected:terminal-resize', (id, size) => localTerminal.resize(id, size))
  handle('protected:task-report', taskId => taskInspector.report(taskId))
  // Command objects are validated field by field inside the consumer.
  handle('protected:vault', command => vault.execute(command as VaultCommand))
  handle('protected:copy-result', text => copyResultText(text, value => clipboard.writeText(value)))
  handle('protected:result-control', command => resultControls.execute(command))
  handle('protected:discovery', command => discoveryStore.execute(command as DiscoveryCommand))
  handle('protected:history', () =>
    Promise.all(ledger.recentKeys().map(workId => hermes.request({ action: 'status', workId })))
  )
  handle('protected:apps', () => apps.list())
  handle('protected:launch', id => apps.launch(id))
  handle('protected:profile', async () =>
    fixtureMode ? diagnostic(process.env.HERALD_TEST_DIAGNOSTIC || 'ready', true) : diagnose(runtime.diagnostics)
  )
  handle('protected:selected-conversations', () => sessions.references())
  handle('protected:select-conversation', sessionId => sessions.select(sessionId))
  handle('protected:conversation', workId => sessions.open(workId))
  handle('protected:conversation-summaries', workIds => sessions.summaries(workIds))
  handle('protected:pick-attachment', async () => {
    if (!win || hermes.running || filePickerOpen) return { error: 'busy' }
    filePickerOpen = true
    try {
      const choice =
        fixtureMode && process.env.HERALD_TEST_ATTACHMENT
          ? { canceled: false, filePaths: [process.env.HERALD_TEST_ATTACHMENT] }
          : await dialog.showOpenDialog(win, {
              title: '첨부 선택 · 로컬 추출 · 선택만으로 전송하지 않습니다',
              properties: ['openFile'],
              filters: [
                {
                  name: '문서·이미지',
                  extensions: [
                    'txt',
                    'md',
                    'csv',
                    'json',
                    'pdf',
                    'docx',
                    'xlsx',
                    'pptx',
                    'doc',
                    'xls',
                    'ppt',
                    'jpg',
                    'jpeg',
                    'png',
                    'webp'
                  ]
                }
              ]
            })
      if (choice.canceled || choice.filePaths.length !== 1) return {}
      let item
      try {
        item = await attachments.pickFile(choice.filePaths[0])
        if (item.kind === 'image' && nativeImage.createFromDataURL(item.dataUrl!).isEmpty()) {
          attachments.remove(item.id)
          return { error: 'invalid_image' }
        }
        return { item }
      } catch (error) {
        if (item) attachments.remove(item.id)
        const codes = [
          'attachment_limit',
          'protected_file',
          'unsupported_file',
          'one_image_only',
          'file_size',
          'utf8_required',
          'text_limit',
          'invalid_image',
          'legacy_document',
          'invalid_document',
          'document_limit',
          'no_text',
          'encrypted_file',
          'active_content',
          'extraction_failed',
          'extraction_unavailable',
          'ocr_failed',
          'ocr_unavailable',
          'extraction_timeout'
        ]
        return {
          name: path.basename(choice.filePaths[0]).slice(0, 100),
          error: error instanceof Error && codes.includes(error.message) ? error.message : 'file_read_failed'
        }
      }
    } finally {
      filePickerOpen = false
    }
  })
  handle('protected:remove-attachment', id => attachments.remove(id))
  handle('protected:cancel-attachment-read', () => attachments.cancelReads())
  handle('protected:attachment-range', (id, start, end, confirmed) => {
    if (hermes.running || filePickerOpen) throw Error('busy')
    return attachments.setRange(id, start, end, confirmed)
  })
  handle('protected:discard-prepared', async id => {
    if (typeof id !== 'string' || !/^work_[a-f0-9]{32}$/.test(id)) throw Error('Invalid work')
    // Submitted work belongs to the CLI lifecycle until the owned child closes.
    if (ledger.lookup(id)) return
    await attachments.release(id)
    works.delete(id)
    prepared.discard(id)
  })
  handle('protected:prepare', async (text, requestId, resumeWorkId, refs = [], purpose, evidenceIds = []) => {
    if (typeof text !== 'string' || text.length > 12000 || text.includes('\0')) throw Error('Invalid request')
    if (purpose !== undefined && purpose !== 'discovery_questions' && purpose !== 'vault_context')
      throw Error('Invalid purpose')
    const attachmentRefs = attachmentIds(refs)
    if (purpose === 'discovery_questions' && (resumeWorkId !== undefined || attachmentRefs.length))
      throw Error('AI questions cannot include sessions or attachments')
    if (purpose === 'vault_context' && resumeWorkId !== undefined) throw Error('Vault evidence uses a fresh session')
    if (purpose !== 'vault_context' && Array.isArray(evidenceIds) && evidenceIds.length)
      throw Error('Invalid evidence purpose')
    const evidence = await vault.resolve(evidenceIds)
    if (purpose === 'vault_context' && !evidence.length) throw Error('Select evidence first')
    const vaultText = text
    prepareInput(text.trim() ? text : attachmentRefs.length ? '첨부 요청' : '', requestId)
    return preparation.run(
      requestId,
      JSON.stringify([text, resumeWorkId, attachmentRefs, purpose, evidenceIds]),
      async () => {
        if (
          resumeWorkId !== undefined &&
          (typeof resumeWorkId !== 'string' || !/^(work|selection)_[a-f0-9]{32}$/.test(resumeWorkId))
        )
          throw Error('Invalid selected session')
        const selected = resumeWorkId ? await sessions.open(resumeWorkId) : undefined
        if (selected && !selected.canResume) throw Error('Unconfirmed submission cannot resume')
        const fingerprint = PreparedRequests.fingerprint([purpose, text, resumeWorkId, attachmentRefs])
        const previous = prepared.find(requestId, fingerprint)
        if (previous) return previous
        prepared.assertRoom(id => ledger.lookup(id))
        const id = `work_${randomUUID().replaceAll('-', '')}`
        const composed = attachments.compose(vaultText, attachmentRefs)
        prepareInput(
          vaultCompose(composed.instructions, evidence) + (evidence.length ? VAULT_SYSTEM_PROMPT : ''),
          requestId
        )
        if (
          purpose === 'vault_context' &&
          composed.items.some(item => item.view.kind === 'image' && item.view.readingMode !== 'ocr')
        )
          throw Error('Vault context is text-only')
        const allowImage = composed.items.some(item => item.view.kind === 'image' && item.view.readingMode !== 'ocr')
          ? !fixtureMode && (await diagnose(runtime.diagnostics)).nativeImageAllowed === true
          : false
        const staged = await attachments.stage(id, vaultText, attachmentRefs, allowImage)
        prepared.add(requestId, fingerprint, id)
        works.set(id, {
          work_id: id,
          instructions: vaultCompose(staged.instructions, evidence),
          ...(staged.image ? { image: staged.image } : {}),
          adapter: 'hermes',
          ...(purpose ? { purpose } : {}),
          ...(purpose === 'vault_context' ? { question: text } : {}),
          state: 'awaiting_handoff',
          ...(selected ? { resumeWorkId, resumeSessionId: selected.sessionId } : {})
        })
        return id
      }
    )
  })
  handle('protected:request', async operation => {
    try {
      return await hermes.request(operation)
    } catch (error) {
      const op = operation as { action?: unknown; workId?: unknown } | null
      if (op?.action === 'start' && typeof op.workId === 'string' && !ledger.lookup(op.workId))
        await attachments.release(op.workId)
      throw error
    }
  })
  handle('protected:quit', () => app.quit())
}
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    win?.show()
    win?.focus()
  })
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: 'Agent OS', submenu: [{ role: 'quit' }] },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' }
          ]
        },
        { label: 'View', submenu: [{ role: 'togglefullscreen' }] }
      ])
    )
    win = new BrowserWindow({
      width: fixtureMode && process.env.HERALD_TEST_WINDOW_SIZE === 'compact' ? 800 : 1320,
      height: fixtureMode && process.env.HERALD_TEST_WINDOW_SIZE === 'compact' ? 600 : 860,
      minWidth: 800,
      minHeight: 600,
      title: 'Agent OS',
      backgroundColor: '#101723',
      webPreferences: {
        preload: path.join(here, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    win.on('close', event => {
      if (!quitting) {
        event.preventDefault()
        app.quit()
      }
    })
    win.webContents.on('will-attach-webview', event => event.preventDefault())
    win.webContents.on('did-navigate', () => localTerminal.close())
    win.webContents.on('render-process-gone', () => localTerminal.close())
    win.webContents.once('destroyed', () => localTerminal.close())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    register()
    await win.loadFile(path.join(here, '../renderer/index.html'))
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    if (quitPending) return
    quitPending = true
    void (async () => {
      if (localTerminal.running && !fixtureMode && win) {
        const choice = await dialog.showMessageBox(win, {
          type: 'question',
          buttons: ['계속 사용', '터미널 종료 후 앱 종료'],
          defaultId: 0,
          cancelId: 0,
          message: '터미널 세션을 종료하고 Agent OS를 종료할까요?',
          detail: '이 앱에서 연 셸과 실행 중인 터미널 작업이 종료됩니다. 터미널 접기는 세션을 유지합니다.'
        })
        if (choice.response !== 1) {
          quitPending = false
          return
        }
      }
      quitting = true
      localTerminal.close()
      await hermes.stop()
      await attachments.dispose()
      app.quit()
    })().catch(() => {
      quitPending = false
    })
  })
}
