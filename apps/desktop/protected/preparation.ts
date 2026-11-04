// Keep a repeated IPC request on one preparation while an async session/model check runs.
export class PreparationGate<T> {
  private pending = new Map<string, { fingerprint: string; promise: Promise<T> }>()
  async run(key: string, fingerprint: string, prepare: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw Error('Request identifier conflict')
      return previous.promise
    }
    const promise = Promise.resolve().then(prepare)
    this.pending.set(key, { fingerprint, promise })
    try { return await promise } finally { this.pending.delete(key) }
  }
}
