// Minimal Markdown subset for model answers. It produces a data tree only: there is no HTML path,
// links and images are never active, and unsupported syntax stays visible as plain text.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  // Shown as "label (url)" text; never rendered as an anchor or an image.
  | { t: 'link'; label: string; url: string; image: boolean }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; items: Block[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^\n`]*$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^ {0,3}([-*_])(?: *\1){2,}\s*$/
const QUOTE = /^ {0,3}>/
const LIST = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/
// Sticky and length-bounded so an unclosed "[" cannot make parsing quadratic.
const LINK = /(!?)\[([^\]\n]{0,300})\]\(([^)\s]{0,2000})(?:\s+"[^"\n]{0,300}")?\)/y
// Emphasis never spans more than this many characters; unclosed markers stay literal text.
const EMPHASIS_REACH = 400

const isBlank = (line: string) => line.trim() === ''

function startsBlock(lines: string[], i: number) {
  const line = lines[i]
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST.test(line) ||
    isTableStart(lines, i)
  )
}

function isTableStart(lines: string[], i: number) {
  return (
    lines[i].includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes('-')
  )
}

function cells(line: string) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
}

export function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      i++
      // An unclosed fence runs to the end, so nothing after it is silently reinterpreted.
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i]))
        body.push(lines[i++])
      i++
      blocks.push({ t: 'code', lang: fence[2], v: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ t: 'h', level: heading[1].length, c: parseInline(heading[2]) })
      i++
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ t: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(/^ {0,3}> ?/, ''))
      blocks.push({ t: 'quote', c: parseBlocks(body) })
      continue
    }
    if (isTableStart(lines, i)) {
      const head = cells(line).map(parseInline)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        const row = cells(lines[i++]).map(parseInline)
        while (row.length < head.length) row.push([])
        rows.push(row.slice(0, head.length))
      }
      blocks.push({ t: 'table', head, rows })
      continue
    }
    const list = LIST.exec(line)
    if (list) {
      const parsed = parseList(lines, i)
      blocks.push(parsed.block)
      i = parsed.next
      continue
    }
    const body: string[] = []
    while (i < lines.length && !isBlank(lines[i]) && (body.length === 0 || !startsBlock(lines, i)))
      body.push(lines[i++])
    blocks.push({ t: 'p', c: parseInline(body.map(l => l.trim()).join('\n')) })
  }
  return blocks
}

function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = LIST.exec(lines[start])!
  const base = first[1].length
  const ordered = /\d/.test(first[2])
  const items: string[][] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    const m = LIST.exec(line)
    if (m && m[1].length <= base + 1) {
      if (/\d/.test(m[2]) !== ordered) break
      items.push([m[3]])
      i++
      continue
    }
    if (isBlank(line)) {
      // A blank line keeps the list going only when the next content belongs to it.
      let j = i + 1
      while (j < lines.length && isBlank(lines[j])) j++
      if (j >= lines.length) break
      const next = LIST.exec(lines[j])
      const indented = lines[j].length - lines[j].trimStart().length > base
      if (!(indented || (next && next[1].length <= base + 1 && /\d/.test(next[2]) === ordered))) break
      if (items.length && indented) for (let k = i; k < j; k++) items[items.length - 1].push('')
      i = j
      continue
    }
    const indent = line.length - line.trimStart().length
    if (indent > base && items.length) {
      items[items.length - 1].push(line.slice(Math.min(indent, base + 2)))
      i++
      continue
    }
    break
  }
  return { block: { t: 'list', ordered, items: items.map(parseBlocks) }, next: i }
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|>~]/
const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch)

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) out.push({ t: 'text', v: buffer })
    buffer = ''
  }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) {
      buffer += s[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      let k = 1
      while (s[i + k] === '`') k++
      const close = s.indexOf('`'.repeat(k), i + k)
      if (close > i + k) {
        flush()
        out.push({ t: 'code', v: s.slice(i + k, close).replace(/^ (.*) $/s, '$1') })
        i = close + k
      } else {
        buffer += '`'.repeat(k)
        i += k
      }
      continue
    }
    if (ch === '!' || ch === '[') {
      LINK.lastIndex = i
      const link = LINK.exec(s)
      if (link) {
        flush()
        out.push({ t: 'link', label: link[2], url: link[3], image: link[1] === '!' })
        i += link[0].length
        continue
      }
    }
    if (ch === '*' || ch === '_') {
      const double = s[i + 1] === ch
      const marker = double ? ch + ch : ch
      const open = i + marker.length
      const boundary = ch === '_' && isWord(s[i - 1])
      if (!boundary && open < s.length && !/\s/.test(s[open])) {
        const reach = open + EMPHASIS_REACH
        let close = s.indexOf(marker, open)
        while (
          close > open &&
          close < reach &&
          (/\s/.test(s[close - 1]) || (ch === '_' && isWord(s[close + marker.length])))
        ) {
          close = s.indexOf(marker, close + 1)
        }
        if (close > open && close < reach) {
          flush()
          const inner = parseInline(s.slice(open, close))
          out.push(double ? { t: 'strong', c: inner } : { t: 'em', c: inner })
          i = close + marker.length
          continue
        }
      }
      buffer += marker
      i += marker.length
      continue
    }
    buffer += ch
    i++
  }
  flush()
  return out
}

export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'))
}

/** True when rendering adds nothing over the raw text (only plain paragraphs). */
export function isPlain(blocks: Block[]) {
  return blocks.every(block => block.t === 'p' && block.c.every(inline => inline.t === 'text'))
}
