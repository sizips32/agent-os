// Argument shape of every renderer -> main IPC channel. The renderer is untrusted: each channel is
// checked for arity (and primitive type where trivial) before any handler runs. Values typed `unknown`
// are validated by the module that consumes them.
export type Args<T extends unknown[]> = (args: unknown[]) => T

const fail = (): never => {
  throw Error('Invalid IPC arguments')
}

const none: Args<[]> = args => (args.length === 0 ? [] : fail())
const one: Args<[unknown]> = args => (args.length === 1 ? [args[0]] : fail())
const two: Args<[unknown, unknown]> = args => (args.length === 2 ? [args[0], args[1]] : fail())
const four: Args<[unknown, unknown, unknown, unknown]> = args =>
  args.length === 4 ? [args[0], args[1], args[2], args[3]] : fail()
// (text, requestId, resumeWorkId?, attachmentIds?, purpose?, evidenceIds?): trailing arguments may be omitted.
const prepare: Args<[string, string, unknown, unknown, unknown, unknown]> = args =>
  args.length >= 2 && args.length <= 6 && typeof args[0] === 'string' && typeof args[1] === 'string'
    ? [args[0], args[1], args[2], args[3], args[4], args[5]]
    : fail()

export const IPC = {
  'protected:terminal-open': one,
  'protected:terminal-write': two,
  'protected:terminal-ack': two,
  'protected:terminal-resize': two,
  'protected:task-report': one,
  'protected:vault': one,
  'protected:copy-result': one,
  'protected:result-control': one,
  'protected:discovery': one,
  'protected:history': none,
  'protected:apps': none,
  'protected:launch': one,
  'protected:profile': none,
  'protected:selected-conversations': none,
  'protected:select-conversation': one,
  'protected:conversation': one,
  'protected:conversation-summaries': one,
  'protected:pick-attachment': none,
  'protected:remove-attachment': one,
  'protected:cancel-attachment-read': none,
  'protected:attachment-range': four,
  'protected:discard-prepared': one,
  'protected:prepare': prepare,
  'protected:request': one,
  'protected:quit': none
} as const

export type IpcChannel = keyof typeof IPC
export type IpcArgs<K extends IpcChannel> = ReturnType<(typeof IPC)[K]>
