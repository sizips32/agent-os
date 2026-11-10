export type HermesOperation = {
  action: 'start' | 'status' | 'cancel'
  workId: string
}
export type HermesState = {
  workId: string
  status: 'idle' | 'running' | 'completed' | 'failed' | 'unknown'
  sessionId: string
  text: string
  events: string[]
  reason: string
  interruption?: 'timeout' | 'interrupted'
  diagnostic?: import('./execution-diagnostic').ExecutionDiagnostic
}
export type WorkDetail = {
  work_id: string
  instructions: string
  adapter: string
  state: string
  purpose?: 'discovery_questions' | 'vault_context'
  question?: string
  resumeWorkId?: string
  resumeSessionId?: string
  image?: WorkImage
}
export type WorkImage = { path: string; sha256: string }
export type AttachmentPreview = {
  id: string
  kind: 'text' | 'image'
  name: string
  bytes: number
  text?: string
  dataUrl?: string
  readingMode?: 'ocr' | 'native'
  fullText?: string
  rangeStart?: number
  rangeEnd?: number
  rangeConfirmed?: boolean
  truncated?: boolean
  partial?: boolean
  totalUnits?: number
  units?: { label: string; method: string; start: number; end: number }[]
  warnings?: string[]
}
export type AttachmentSelection = { item?: AttachmentPreview; error?: string; name?: string }
export type AcpOutcome = {
  status: 'completed' | 'failed' | 'unknown'
  text: string
  reason: string
  verification: string
  sessionId?: string
  interruption?: 'timeout' | 'interrupted'
  diagnostic?: import('./execution-diagnostic').ExecutionDiagnostic
  executionMode?: 'vault_context'
}
export interface AcpLedger {
  claim(key: string, fingerprint: string): boolean
  lookup(key: string): boolean
  settle(key: string, outcome: AcpOutcome): void
}
export type ProfileDiagnostic = {
  profile: 'giselle'
  ready: boolean
  code: string
  message: string
  fixtureMode?: boolean
  nativeImageAllowed?: boolean
}
export type Conversation = {
  workId: string
  sessionId: string
  messages: { role: 'user' | 'assistant'; text: string }[]
  limited: boolean
  canResume: boolean
  kind?: 'vault_context'
}
export type NativeApp = { id: string; name: string; bundleId: string }
export type ConversationSummary = {
  workId: string
  title: string | null
  startedAt: number | null
  unavailable: boolean
}
export interface ProtectedBridge {
  taskReport(taskId: string): Promise<import('./task-types').TaskReport>
  terminal: import('./terminal-types').TerminalBridge
  vault(command: import('./vault-types').VaultCommand): Promise<import('./vault-types').VaultReply>
  copyResult(text: string): Promise<void>
  resultControl(command: import('./result-controls').ResultCommand): Promise<{ hidden: boolean }>
  discovery(
    command: import('./discovery-state').DiscoveryCommand
  ): Promise<import('./discovery-state').DiscoveryStoreView>
  history(): Promise<HermesState[]>
  apps(): Promise<NativeApp[]>
  launch(id: string): Promise<void>
  selectedConversations(): Promise<{ workId: string; sessionId: string }[]>
  selectConversation(sessionId: string): Promise<Conversation>
  conversation(workId: string): Promise<Conversation>
  conversationSummaries(workIds: string[]): Promise<ConversationSummary[]>
  pickAttachment(): Promise<AttachmentSelection>
  removeAttachment(id: string): Promise<void>
  cancelAttachmentRead(): Promise<void>
  setAttachmentRange(id: string, start: number, end: number, confirmed: boolean): Promise<AttachmentPreview>
  discardPrepared(workId: string): Promise<void>
  prepare(
    text: string,
    requestId: string,
    resumeWorkId?: string,
    attachmentIds?: string[],
    purpose?: 'discovery_questions' | 'vault_context',
    evidenceIds?: string[]
  ): Promise<string>
  request(operation: HermesOperation): Promise<HermesState>
  /** Pushed state of the running request. Returns an unsubscribe function. */
  onHermesState(listener: (state: HermesState) => void): () => void
  profile(): Promise<ProfileDiagnostic>
  quit(): Promise<void>
}
