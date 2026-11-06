import { createReadStream } from 'node:fs'
import { liveBackend, serve } from '@opencalque/cli/src/mcp'
import { standardRegistry } from '@opencalque/warehouse'

/**
 * `--mcp`: the installed app as an MCP server, for those with no copy of the source code. It serves
 * the drawing open in the app that is running, and nothing else. It takes no script and no path:
 * the shipped program stays one that cannot be borrowed to run other code (`after-pack.cjs`). It
 * can do nothing a program holding the token could not, and nothing at all until the person lets
 * agents in. Loaded only in that mode, so that starting the app does not pay for it.
 *
 * On Windows Electron writes an empty line to stdout before any of this runs, which nothing here
 * can stop. Clients skip it as a line that is not a message, as the protocol's SDKs do.
 */
export async function serveAgents(version: string, done: () => void): Promise<void> {
  // In Electron's main process on Windows, process.stdin is an empty stream that ends at once: the
  // pipe the client gave is file descriptor 0 all the same.
  const input = createReadStream('', { fd: 0, autoClose: false })
  // Electron keeps running after its input closes, as Node would not.
  input.on('end', done)
  input.on('error', done)
  await serve(liveBackend(), standardRegistry(), version, input)
}
