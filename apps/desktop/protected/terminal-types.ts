export type TerminalSize = { cols: number; rows: number }
export type TerminalHandle = { id: string; pid: number; shell: string }
export type TerminalEvent = { id: string; type: 'data'; data: string } | { id: string; type: 'exit'; exitCode: number }
export interface TerminalBridge {
  open(size: TerminalSize): Promise<TerminalHandle>
  write(id: string, data: string): Promise<void>
  acknowledge(id: string, bytes: number): Promise<void>
  resize(id: string, size: TerminalSize): Promise<void>
  onEvent(listener: (event: TerminalEvent) => void): () => void
}
