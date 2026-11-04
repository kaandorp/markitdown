import { defineConfig } from 'vite'

// GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: {
    // The tokenizer (lazy-loaded) and syntax highlighters are large by nature.
    chunkSizeWarningLimit: 2500,
  },
})
