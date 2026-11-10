import { useEffect } from 'react'

type Shortcut = {
  id: string
  test: (e: KeyboardEvent) => boolean
  fromTerminal?: boolean
  /** Only fire when the event comes from inside this selector. */
  within?: string
}

const SHORTCUTS: Shortcut[] = [
  // Sending is external and cannot be retracted: only the composer itself may trigger it, never another field.
  { id: 'send', test: e => e.metaKey && e.key === 'Enter', within: '.agent-composer' },
  { id: 'new', test: e => e.metaKey && e.key.toLowerCase() === 'n' },
  { id: 'stop', test: e => e.metaKey && e.key === '.' },
  { id: 'vault', test: e => e.metaKey && e.key.toLowerCase() === 'k' },
  // The terminal's own collapse control stays reachable while the terminal has focus.
  { id: 'terminal', test: e => e.ctrlKey && !e.metaKey && e.key === '`', fromTerminal: true }
]

const target = (id: string) => document.querySelector<HTMLElement>(`[data-shortcut="${id}"]`)

/**
 * Keyboard shortcuts that press the real controls (marked with data-shortcut), so each one follows
 * that control's disabled state and no action logic is duplicated here. Terminal input wins.
 */
export function useShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Never interfere with IME composition (Korean input).
      if (event.isComposing || event.keyCode === 229 || event.shiftKey || event.altKey) return
      const shortcut = SHORTCUTS.find(s => s.test(event))
      if (!shortcut) return
      const inTerminal = event.target instanceof Element && !!event.target.closest('.xterm, .agent-terminal')
      if (inTerminal && !shortcut.fromTerminal) return
      if (shortcut.within && !(event.target instanceof Element && event.target.closest(shortcut.within))) return
      event.preventDefault()
      const control = target(shortcut.id)
      if (!control || (control as HTMLButtonElement).disabled) return
      control.click()
      if (shortcut.id === 'vault') setTimeout(() => target('vault-search')?.focus(), 0)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
