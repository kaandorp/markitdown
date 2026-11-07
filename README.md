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
- **Edit files on your device** (Chrome, Edge, Opera on desktop, via the File System Access API):
  - **Open** or drag-and-drop `.md` files to edit them in place; **+ File** creates a new one. Linked files show a
    file icon in the sidebar, and **Save** / Ctrl+S on a browser document saves it as a file.
  - Ctrl+S / **Save** writes to the file; a ● marks unsaved changes. A per-file **Autosave** switch writes about
    1 s after you stop typing. Unsaved edits are also kept as a draft in the browser.
  - Line endings (CRLF/LF) and a UTF-8 BOM are preserved. Edits made by other apps are picked up when you return to
    the page (reloaded silently if you have no unsaved changes, otherwise you're asked), and Save never overwrites
    them without asking.
  - Closing a linked tab never deletes the file. After a browser restart, Chrome may ask once to allow access again.
  - Editing on the left normalizes the file's Markdown formatting (a one-time notice explains this); edits on the
    right change only what you type.
  - In Firefox and Safari these options are hidden; Open/Download work on copies as before.
- **Synced scrolling**: both panes stay aligned by content, block by block (a heading on the left sits level with its
  `##` line on the right), while you scroll either pane or type in it. Turn it off with **Sync scroll** in the Markdown
  pane's header.
- **Show or hide the Markdown source** with the pane button at the right end of the formatting toolbar, next to
  **Full width**; hidden, the rich-text pane takes the whole width.
- Resizable split view, light/dark theme (follows the OS, with a toggle), stacked layout on small screens.

Everything runs in the browser; no text leaves your machine.

## Design

The interface follows the Roche corporate brand: warm base tones (`neutral-4`, `grey-5`) with white space, Roche Blue
for actions and the active document, sentence case, and nothing smaller than 14px. Type uses **Roche Sans** and
**Roche Serif** when they are installed on your computer; otherwise the brand's approved fallback, **Noto Sans / Noto
Serif** (SIL Open Font License), bundled with the app. No Roche font files are included in this repository. The Roche logo (`public/roche-logo.svg`, the official file) appears top left, in Roche Blue or, on the dark theme, white.
The brand defines only a light theme; the dark theme is derived from its greys and blues and checked for WCAG AA
contrast. On narrow windows the actions fold into a **More** menu; on phones you switch between **Rich text** and
**Markdown**, with **Copy Markdown** at the bottom.

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
