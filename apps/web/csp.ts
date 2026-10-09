import type { Plugin } from 'vite'

// connect-src is open to https and to local services because the assistant talks to whichever AI
// provider the user configures. font-src allows the fonts embedded in imported PDFs.
const POLICY =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; " +
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*"

/** Adds a Content-Security-Policy to production builds. Dev is exempt because Vite's HMR relies on inline scripts. */
export function csp(): Plugin {
  return {
    name: 'opencalque-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${POLICY}" />`),
  }
}
