import type { ReactNode } from 'react'
import type { Block, Inline } from './markdown-parse'

// React elements only: no dangerouslySetInnerHTML, no href, no src. Text is escaped by React.

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, i) => {
    const key = `${node.t}:${i}`
    switch (node.t) {
      case 'text':
        return node.v
      case 'code':
        return <code key={key}>{node.v}</code>
      case 'strong':
        return (
          <strong key={key}>
            <Inlines nodes={node.c} />
          </strong>
        )
      case 'em':
        return (
          <em key={key}>
            <Inlines nodes={node.c} />
          </em>
        )
      case 'link':
        return (
          <span key={key} className="agent-md-link">
            {node.image ? '[이미지] ' : ''}
            {node.label || node.url}
            {node.label && node.url ? ` (${node.url})` : ''}
          </span>
        )
      default:
        return null
    }
  })
}

function Blocks({ blocks }: { blocks: Block[] }): ReactNode {
  return blocks.map((block, i) => {
    const key = `${block.t}:${i}`
    switch (block.t) {
      case 'p':
        return (
          <p key={key}>
            <Inlines nodes={block.c} />
          </p>
        )
      case 'h': {
        // Answers sit inside a page that already has h1/h2; keep the document outline below them.
        const Tag = `h${Math.min(6, block.level + 2)}` as 'h3' | 'h4' | 'h5' | 'h6'
        return (
          <Tag key={key}>
            <Inlines nodes={block.c} />
          </Tag>
        )
      }
      case 'code':
        return (
          <pre key={key} className="agent-md-code" data-lang={block.lang || undefined}>
            <code>{block.v}</code>
          </pre>
        )
      case 'quote':
        return (
          <blockquote key={key}>
            <Blocks blocks={block.c} />
          </blockquote>
        )
      case 'list': {
        const List = block.ordered ? 'ol' : 'ul'
        return (
          <List key={key}>
            {block.items.map((item, n) => (
              <li key={`${key}:${n}`}>
                <Blocks blocks={item} />
              </li>
            ))}
          </List>
        )
      }
      case 'table':
        return (
          <div key={key} className="agent-md-table">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, n) => (
                    <th key={`${key}:h${n}`}>
                      <Inlines nodes={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={`${key}:r${r}`}>
                    {row.map((cell, n) => (
                      <td key={`${key}:r${r}c${n}`}>
                        <Inlines nodes={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case 'hr':
        return <hr key={key} />
      default:
        return null
    }
  })
}

export function Markdown({ blocks }: { blocks: Block[] }) {
  return <Blocks blocks={blocks} />
}
