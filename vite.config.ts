import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

// Version shown in the status bar: package.json's version plus the commit it
// was built from (GITHUB_SHA in the deploy workflow, else the local checkout).
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
let commit = process.env.GITHUB_SHA ?? ''
if (!commit) {
  try {
    commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    commit = ''
  }
}
const repo = process.env.GITHUB_REPOSITORY ?? ''

// GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_REPO__: JSON.stringify(repo),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // The tokenizer (lazy-loaded) and syntax highlighters are large by nature.
    chunkSizeWarningLimit: 2500,
  },
})
