# Markitdown

A browser-based Markdown editor for preparing text before pasting it into an LLM.
Rich-text (WYSIWYG) editing on the left, Markdown source on the right, and the two stay in sync.

## Features

- **Two-way live sync.** Edit either side. The pane you're typing in is never rewritten, so the cursor never jumps.
  Markdown generated from the rich-text side is normalized to one consistent style.
- **Paste anything.** Rich content from web pages, Google Docs, Word or chat apps becomes clean Markdown, keeping
  headings, lists, links, tables and code while dropping fonts, colors and styling. Plain-text Markdown pasted
  into the left pane is parsed as Markdown.
- **Copy as Markdown.** Selecting text on the left and pressing Ctrl/⌘+C puts Markdown (plain text only) on the clipboard.
  The **Copy Markdown** and **Copy plain text** buttons copy the whole document.
- **GFM:** tables, task lists, strikethrough, and fenced code blocks with language + syntax highlighting.
- **Formatting:** toolbar, keyboard shortcuts, Markdown input rules (`## `, `- `, `1. `, `> `, ```` ``` ````), and an
  **@ insert menu**. Type `@` at the start of a line or after a space, then filter (`@tab` → Table). Email addresses
  don't trigger it; Esc or a space dismisses it.
- **LLM helpers:** live chars / words / ≈tokens counter (o200k tokenizer, an estimate for other models), plus
  cleanup tools (collapse blank lines, trim trailing whitespace, remove images, remove links, demote headings,
  normalize). XML-style tags such as `<document>` stay literal.
- **Multiple documents** in a sidebar of tabs on the left: **+ New**, click to switch, **×** to delete, double-click
  (or F2) to rename. You can also name the open document in the field at the top. Unnamed documents are titled by
  their first heading. Each document has its own undo history.
- **Autosave** of every document to the browser's localStorage. **Open** `.md` files (button or drag-and-drop;
  several at once, each as a new document) and **download** the open one as `.md`, named after the document.
- Resizable split view, light/dark theme (follows the OS, with a toggle), stacked layout on small screens.

Everything runs in the browser; no text leaves your machine.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Deployment

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main`.
Enable it once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Pages is free for public repositories.

Built with [Tiptap](https://tiptap.dev) (ProseMirror) + `@tiptap/markdown`, [CodeMirror 6](https://codemirror.net), and Vite.
