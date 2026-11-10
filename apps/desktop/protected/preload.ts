import { contextBridge, ipcRenderer } from 'electron'
import type { ProtectedBridge } from './types.ts'
const bridge: ProtectedBridge = {
  taskReport: taskId => ipcRenderer.invoke('protected:task-report', taskId),
  terminal: Object.freeze({
    open: (size: import('./terminal-types').TerminalSize) => ipcRenderer.invoke('protected:terminal-open', size),
    write: (id: string, data: string) => ipcRenderer.invoke('protected:terminal-write', id, data),
    acknowledge: (id: string, bytes: number) => ipcRenderer.invoke('protected:terminal-ack', id, bytes),
    resize: (id: string, size: import('./terminal-types').TerminalSize) =>
      ipcRenderer.invoke('protected:terminal-resize', id, size),
    onEvent: (listener: (event: import('./terminal-types').TerminalEvent) => void) => {
      const receive = (_event: Electron.IpcRendererEvent, value: import('./terminal-types').TerminalEvent) =>
        listener(value)
      ipcRenderer.on('protected:terminal-event', receive)
      return () => {
        ipcRenderer.removeListener('protected:terminal-event', receive)
      }
    }
  }),
  vault: command => ipcRenderer.invoke('protected:vault', command),
  copyResult: text => ipcRenderer.invoke('protected:copy-result', text),
  resultControl: command => ipcRenderer.invoke('protected:result-control', command),
  discovery: command => ipcRenderer.invoke('protected:discovery', command),
  history: () => ipcRenderer.invoke('protected:history'),
  apps: () => ipcRenderer.invoke('protected:apps'),
  launch: id => ipcRenderer.invoke('protected:launch', id),
  selectedConversations: () => ipcRenderer.invoke('protected:selected-conversations'),
  selectConversation: sessionId => ipcRenderer.invoke('protected:select-conversation', sessionId),
  conversation: workId => ipcRenderer.invoke('protected:conversation', workId),
  conversationSummaries: workIds => ipcRenderer.invoke('protected:conversation-summaries', workIds),
  pickAttachment: () => ipcRenderer.invoke('protected:pick-attachment'),
  removeAttachment: id => ipcRenderer.invoke('protected:remove-attachment', id),
  cancelAttachmentRead: () => ipcRenderer.invoke('protected:cancel-attachment-read'),
  setAttachmentRange: (id, start, end, confirmed) =>
    ipcRenderer.invoke('protected:attachment-range', id, start, end, confirmed),
  discardPrepared: workId => ipcRenderer.invoke('protected:discard-prepared', workId),
  prepare: (text, requestId, resumeWorkId, attachmentIds, purpose, evidenceIds) =>
    ipcRenderer.invoke('protected:prepare', text, requestId, resumeWorkId, attachmentIds, purpose, evidenceIds),
  request: operation => ipcRenderer.invoke('protected:request', operation),
  profile: () => ipcRenderer.invoke('protected:profile'),
  quit: () => ipcRenderer.invoke('protected:quit')
}
contextBridge.exposeInMainWorld('protectedHerald', Object.freeze(bridge))
