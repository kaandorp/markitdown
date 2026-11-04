/**
 * String-level Markdown helpers. Every transform skips fenced code blocks so
 * code is never altered.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Apply `fn` to each run of lines that is outside fenced code blocks. */
function mapOutsideCode(md: string, fn: (text: string) => string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let buf: string[] = []
  let fence: string | null = null

  const flush = () => {
    if (buf.length) out.push(fn(buf.join('\n')))
    buf = []
  }

  for (const line of lines) {
    const m = line.match(FENCE)
    if (fence === null) {
      if (m) {
        flush()
        fence = m[1]
        out.push(line)
      } else {
        buf.push(line)
      }
    } else {
      out.push(line)
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null
    }
  }
  flush()
  return out.join('\n')
}

export function collapseBlankLines(md: string): string {
  const out: string[] = []
  let fence: string | null = null
  for (const line of md.split('\n')) {
    const m = line.match(FENCE)
    if (fence !== null) {
      out.push(line)
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null
      continue
    }
    if (m) fence = m[1]
    const blank = line.trim() === ''
    // Drop leading blanks and any blank that follows another blank.
    if (blank && (out.length === 0 || out[out.length - 1].trim() === '')) continue
    out.push(line)
  }
  return out.join('\n')
}

export function trimTrailingWhitespace(md: string): string {
  return mapOutsideCode(md, (t) => t.replace(/[ \t]+$/gm, ''))
}

/** Output of the WYSIWYG serializer, tidied for LLM consumption. */
export function tidyMarkdown(md: string): string {
  // Tiptap writes `&nbsp;` for consecutive empty paragraphs; drop them.
  // Whitespace-only lines are blank lines; a single trailing space means nothing
  // (two or more is a hard break, which is kept).
  const cleaned = mapOutsideCode(md, (t) =>
    t
      .replace(/^(?:&nbsp;|\u00a0)[ \t]*$/gm, '')
      .replace(/^[ \t]+$/gm, '')
      .replace(/(\S)[ \t]$/gm, '$1'),
  )
  return collapseBlankLines(cleaned).replace(/\s+$/, '') + (cleaned.trim() ? '\n' : '')
}

/** Rough plain-text rendering for "Copy plain text". */
export function markdownToPlainText(md: string): string {
  return mapOutsideCode(md, (t) =>
    t
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^ {0,3}#{1,6}\s+/gm, '')
      .replace(/^ {0,3}>\s?/gm, '')
      .replace(/^(\s*)[-*+]\s+\[( |x|X)\]\s+/gm, (_m, i, c) => `${i}${c === ' ' ? '☐' : '☑'} `)
      .replace(/^(\s*)[-*+]\s+/gm, '$1• ')
      .replace(/^ {0,3}([-*_])(\s*\1){2,}\s*$/gm, '')
      .replace(/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, '')
      .replace(/^\|\s?(.*?)\s?\|$/gm, (_m, row: string) => row.split(/\s*\|\s*/).join('\t'))
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w*])/g, '$2')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, '$1'),
  )
    .replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
