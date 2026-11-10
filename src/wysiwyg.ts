import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import { TaskList, TaskItem, OrderedList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Paragraph from '@tiptap/extension-paragraph'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import type { Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { InsertMenu } from './insertMenu'
import { tidyMarkdown } from './markdown'

const lowlight = createLowlight(common)

/**
 * Links whose text is just the URL (or email) are written bare, since GFM
 * autolinks them anyway: `https://x.com` instead of `[https://x.com](https://x.com)`.
 */
const CleanLink = Link.extend({
  renderMarkdown(node, h, ctx) {
    const href: string = node.attrs?.href ?? ''
    const title: string = node.attrs?.title ?? ''
    const text = h.renderChildren(node)
    // Marks are rendered around a placeholder; the real text is in meta.markText.
    const raw = String((ctx?.meta as { markText?: string } | undefined)?.markText ?? text)
    const bare = [raw, `mailto:${raw}`, `http://${raw}`, `https://${raw}`]
    if (!title && bare.includes(href) && !/[\s<>()[\]]/.test(raw)) return text
    return title ? `[${text}](${href} "${title}")` : `[${text}](${href})`
  },
}).configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' })

/**
 * Escape characters at the start of a paragraph line that would otherwise turn
 * the text into a heading, list, quote or rule when the Markdown is re-read.
 */
function escapeLineStarts(md: string): string {
  return md
    .split('\n')
    .map((line, i) =>
      line
        .replace(/^(\s*)(#{1,6})(?=\s|$)/, '$1\\$2')
        .replace(/^(\s*)([-+])(?=\s)/, '$1\\$2')
        .replace(/^(\s*)(\d{1,9})([.)])(?=\s|$)/, '$1$2\\$3')
        .replace(/^(\s*)>/, '$1\\>')
        .replace(i === 0 ? /^(\s*)(-{3,})\s*$/ : /^(\s*)(-+|=+)\s*$/, '$1\\$2'),
    )
    .join('\n')
}

/**
 * Numbered lists only, as in CommonMark and GitHub. Tiptap also reads lettered
 * and Roman markers ("A.", "f.", "IV.") as lists, so ordinary text such as
 * "F. Hoffmann-La Roche Ltd …" or "I. Introduction" became a list. Lists pasted
 * as HTML with letters or Roman numerals become plain numbered lists, so they
 * never produce Markdown that other tools would read as a paragraph.
 */
const NumberedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      type: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    }
  },
  markdownTokenizer: {
    ...OrderedList.config.markdownTokenizer!,
    tokenize: (src, tokens, lexer) => {
      const token = OrderedList.config.markdownTokenizer!.tokenize(src, tokens, lexer)
      // Standard Markdown lists start with 1–9 digits and "." or ")"; anything
      // else ("F.", "IV.", "Dr.") is ordinary text.
      return token && /^ {0,3}\d{1,9}[.)](?:[ \t]|$)/.test(token.raw ?? '') ? token : undefined
    },
  },
})

const SafeParagraph = Paragraph.extend({
  renderMarkdown(node, h, ctx) {
    const out: string = this.parent?.(node, h, ctx) ?? ''
    return out === '&nbsp;' ? out : escapeLineStarts(out)
  },
})

/** Inline HTML tags the parser would turn into formatting; everything else stays literal. */
const INLINE_TAG = /<(?=\/?(?:a|b|i|u|s|em|strong|del|strike|code|kbd|mark|sub|sup|span|br|img|p|div)\b)/gi

/** Code block with a small editable language label in the corner. */
const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('pre')
      const lang = document.createElement('input')
      lang.className = 'code-lang'
      lang.placeholder = 'language'
      lang.spellcheck = false
      lang.value = node.attrs.language ?? ''
      lang.contentEditable = 'false'
      const code = document.createElement('code')
      dom.append(lang, code)

      lang.addEventListener('change', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (pos == null) return
        editor.view.dispatch(
          editor.view.state.tr.setNodeAttribute(pos, 'language', lang.value.trim() || null),
        )
      })
      lang.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          lang.blur()
          editor.commands.focus()
        }
      })

      return {
        dom,
        contentDOM: code,
        update(updated) {
          if (updated.type !== node.type) return false
          node = updated
          const value = updated.attrs.language ?? ''
          if (document.activeElement !== lang && lang.value !== value) lang.value = value
          return true
        },
        stopEvent: (e) => e.target === lang,
        ignoreMutation: (m) => m.type !== 'selection' && lang.contains(m.target as Node),
      }
    }
  },
}).configure({ lowlight, defaultLanguage: null })

export function createWysiwyg(el: HTMLElement, initialMarkdown: string, onChange: () => void) {
  let editor: Editor

  /** Serialize a clipboard slice to Markdown so Ctrl+C yields Markdown text. */
  const sliceToMarkdown = (slice: Slice): string => {
    try {
      const md = editor.markdown!.serialize({ type: 'doc', content: slice.content.toJSON() ?? [] })
      return tidyMarkdown(md)
    } catch {
      return slice.content.textBetween(0, slice.content.size, '\n\n')
    }
  }

  const writeClipboard = (view: EditorView, event: ClipboardEvent, cut: boolean) => {
    const { selection } = view.state
    if (selection.empty || !event.clipboardData) return false
    event.preventDefault()
    event.clipboardData.clearData()
    event.clipboardData.setData('text/plain', sliceToMarkdown(selection.content()))
    if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'))
    return true
  }

  editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        underline: false, // not representable in Markdown
        link: false,
        paragraph: false,
        orderedList: false,
      }),
      NumberedList,
      SafeParagraph,
      CleanLink,
      CodeBlock,
      TableKit.configure({ table: { resizable: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: true }),
      Placeholder.configure({ placeholder: 'Paste or type here… (type @ for blocks)' }),
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
      InsertMenu,
    ],
    content: initialMarkdown,
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      handleDOMEvents: {
        copy: (view, e) => writeClipboard(view, e, false),
        cut: (view, e) => writeClipboard(view, e, true),
      },
      // Plain-text pastes (e.g. Markdown from a chat window) are parsed as
      // Markdown. HTML pastes go through the schema, which keeps structure and
      // drops styling. Inside code blocks text is pasted verbatim.
      handlePaste: (view, event) => {
        const data = event.clipboardData
        if (!data) return false
        const html = data.getData('text/html')
        const text = data.getData('text/plain')
        if (html || !text) return false
        if (view.state.selection.$from.parent.type.spec.code) return false
        event.preventDefault()
        editor.commands.insertContent(text, { contentType: 'markdown' })
        return true
      },
    },
    onUpdate: () => onChange(),
  })

  // Keep `<document>`, `&` etc. literal (common in LLM prompts) instead of
  // HTML-encoding them; only escape tags that would be parsed as formatting.
  const manager = editor.markdown as unknown as {
    codeTypes: Set<string>
    escapeMarkdownSyntax: (t: string) => string
    encodeTextForMarkdown: (text: string, node: { marks?: (string | { type: string })[] }, parent?: { type?: string }) => string
  }
  manager.encodeTextForMarkdown = function (text, node, parent) {
    const inCode =
      (parent?.type != null && this.codeTypes.has(parent.type)) ||
      (node.marks ?? []).some((m) => this.codeTypes.has(typeof m === 'string' ? m : m.type))
    if (inCode) return text
    return this.escapeMarkdownSyntax(text).replace(INLINE_TAG, '\\<')
  }

  return editor
}
