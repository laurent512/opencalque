import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { csp } from '../web/csp'

// The window shows the web app unchanged; this package only adds the native shell around it.
const web = resolve(__dirname, '../web')

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: web,
    plugins: [react(), csp()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: { input: resolve(web, 'index.html') },
    },
  },
})
