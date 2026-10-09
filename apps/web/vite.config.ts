import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { csp } from './csp'

export default defineConfig({
  // Relative asset paths, so the build can be hosted under any URL and loaded from disk by the desktop shell.
  base: './',
  plugins: [react(), csp()],
})
