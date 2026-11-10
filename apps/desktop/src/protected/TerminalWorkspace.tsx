import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalEvent, TerminalHandle } from '../../protected/terminal-types'
import '@xterm/xterm/css/xterm.css'

const KEY = 'agentos.terminal-layout.v1'
export function readTerminalLayout(): { open: boolean; ratio: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (v && typeof v.open === 'boolean' && Number.isFinite(v.ratio))
      return { open: v.open, ratio: Math.max(0.2, Math.min(0.6, v.ratio)) }
  } catch {
    /* A disabled or corrupt preference must not stop the desktop. */
  }
  return { open: true, ratio: 0.36 }
}
export function TerminalWorkspace({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState(readTerminalLayout)
  const [started, setStarted] = useState(layout.open)
  const box = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const client = useRef<Terminal | null>(null)
  const handle = useRef<TerminalHandle | null>(null)
  const [status, setStatus] = useState('준비 중')
  const [connected, setConnected] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout))
    } catch {
      /* optional preference */
    }
  }, [layout])
  useEffect(() => {
    if (layout.open) setStarted(true)
  }, [layout.open])
  useEffect(() => {
    if (!started || !surface.current) return
    const api = window.protectedHerald.terminal
    if (!api) {
      setStatus('터미널 연결을 사용할 수 없습니다.')
      return
    }
    let disposed = false
    let active: TerminalHandle | null = null
    let ended = false
    const waiting: TerminalEvent[] = []
    const term = new Terminal({
      fontFamily: 'Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 3000,
      cursorBlink: true,
      allowProposedApi: false,
      theme: { background: '#0b1419', foreground: '#dce9e3', cursor: '#a2d6bc', selectionBackground: '#53796a88' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.parser.registerOscHandler(52, () => true)
    term.open(surface.current)
    client.current = term
    function resize() {
      if (disposed || !surface.current || surface.current.clientHeight < 20 || surface.current.clientWidth < 20) return
      fit.fit()
      if (active && !ended) void api.resize(active.id, { cols: term.cols, rows: term.rows }).catch(() => {})
    }
    const observer = new ResizeObserver(resize)
    observer.observe(surface.current)
    const input = term.onData(data => {
      if (active && !ended)
        void api.write(active.id, data).catch(() => {
          if (!disposed) setStatus('입력 연결을 확인해 주세요.')
        })
    })
    const render = (event: TerminalEvent) => {
      if (!active || event.id !== active.id || disposed) return
      if (event.type === 'data')
        term.write(event.data, () => {
          if (!disposed) void api.acknowledge(event.id, new TextEncoder().encode(event.data).length).catch(() => {})
        })
      else {
        ended = true
        handle.current = null
        setConnected(false)
        setStatus(`종료 · 코드 ${event.exitCode}`)
        term.write('\r\n[터미널 종료]\r\n')
      }
    }
    const off = api.onEvent(event => {
      if (!active) {
        if (waiting.length < 128) waiting.push(event)
      } else render(event)
    })
    resize()
    setStatus('연결 중')
    void api
      .open({ cols: Math.max(2, Math.min(500, term.cols)), rows: Math.max(1, Math.min(300, term.rows)) })
      .then(value => {
        if (disposed) return
        active = value
        handle.current = value
        setStatus('zsh · 로컬 Mac')
        setConnected(true)
        for (const event of waiting) render(event)
        waiting.length = 0
        resize()
      })
      .catch(() => {
        if (!disposed) {
          setStatus('터미널을 열지 못했습니다. 다시 열기를 눌러 주세요.')
          setConnected(false)
        }
      })
    return () => {
      disposed = true
      off()
      observer.disconnect()
      input.dispose()
      term.dispose()
      client.current = null
      handle.current = null
    }
  }, [started, generation])
  function toggle() {
    setLayout(v => ({ ...v, open: !v.open }))
  }
  function adjust(ratio: number) {
    setLayout(() => ({ open: true, ratio: Math.max(0.2, Math.min(0.6, ratio)) }))
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging || !box.current) return
    const bounds = box.current.getBoundingClientRect()
    adjust((bounds.bottom - event.clientY) / bounds.height)
  }
  return (
    <div
      className="agent-workspace"
      ref={box}
      data-terminal-open={layout.open}
      style={{ '--terminal-ratio': layout.ratio } as React.CSSProperties}
    >
      <div className="agent-workspace-top">{children}</div>
      <div
        className="agent-splitter"
        role="separator"
        aria-label="터미널 높이 조절"
        aria-orientation="horizontal"
        aria-valuemin={20}
        aria-valuemax={60}
        aria-valuenow={Math.round(layout.ratio * 100)}
        aria-controls="agent-local-terminal"
        tabIndex={0}
        onDoubleClick={() => adjust(0.36)}
        onPointerDown={event => {
          if (!layout.open) return
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
        }}
        onPointerMove={move}
        onPointerUp={event => {
          setDragging(false)
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={event => {
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            adjust(
              event.key === 'Home'
                ? 0.2
                : event.key === 'End'
                  ? 0.6
                  : layout.ratio + (event.key === 'ArrowUp' ? 0.03 : -0.03)
            )
          }
        }}
      />
      <section className="agent-terminal" id="agent-local-terminal" aria-label="로컬 터미널">
        <header className="agent-terminal-toolbar">
          <button type="button" aria-expanded={layout.open} aria-controls="agent-terminal-surface" onClick={toggle}>
            {layout.open ? '⌄ 터미널 접기' : '⌃ 터미널 펼치기'}
          </button>
          <span role="status">{started ? status : '로컬 Mac · 열기 대기'}</span>
          <div className="agent-terminal-actions">
            {connected ? (
              <button
                type="button"
                title="현재 터미널에 Ctrl+C 전달"
                onClick={() => {
                  if (handle.current)
                    void window.protectedHerald.terminal.write(handle.current.id, '\x03').catch(() => {})
                }}
              >
                중단 · Ctrl+C
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setStarted(true)
                  setGeneration(v => v + 1)
                  setLayout(v => ({ ...v, open: true }))
                }}
              >
                터미널 다시 열기
              </button>
            )}
          </div>
        </header>
        <div className="agent-terminal-body" hidden={!layout.open}>
          <div
            id="agent-terminal-surface"
            className="agent-terminal-surface"
            ref={surface}
            onPointerDown={() => client.current?.focus()}
          />
        </div>
      </section>
    </div>
  )
}
