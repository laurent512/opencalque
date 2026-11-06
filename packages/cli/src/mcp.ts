import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { DRAWING_TOOLS, drawingGuide, nodeTypes, nodeTypeSchema, type Registry, type ToolOutcome, type ToolSpec } from '@opencalque/core'

/*
 * The drawing tools (`DRAWING_TOOLS`) for agents outside the app, over MCP. A drawing is either a
 * file (`mcp-files.ts`), or the drawing open in the desktop app, which runs the tools itself so that
 * each edit is a step of its undo (`bridge.ts` in the desktop app). The desktop app bundles this
 * file to serve `--mcp`, so it holds nothing that only a checkout can run. Nothing but the protocol
 * may reach stdout.
 */

/** Where the desktop app says how to reach it while it lets agents in. */
export const BRIDGE_FILE = process.env.OPENCALQUE_BRIDGE_FILE ?? join(homedir(), '.opencalque', 'bridge.json')

const INSTRUCTIONS = `Tools to read and edit OpenCalque drawings: 2D architectural plans stored as JSON, in millimetres. Call read_guide once before your first edit: it explains the format and the operations. Then describe_drawing to see what is there, apply_operations to change it, and check_drawing, measure_drawing and view_drawing to see how it came out.`

export const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

const READ_GUIDE: ToolSpec = {
  name: 'read_guide',
  description: 'Explains how drawings are stored and edited: the types of node, the parametric objects there are, the operations, and what is not obvious from the schema. Read it once before your first edit. With "type", returns the JSON Schema of that type of node instead.',
  schema: schema({ type: { type: 'string', description: 'A type of node, such as wall or room, to get its JSON Schema.' } }),
}

export const text = (content: string, isError = false): ToolOutcome => ({ content, ...(isError ? { isError } : {}) })

/** The guide, short enough for a tool to return, or the schema of one type of node. */
function readGuide(input: { type?: unknown }, registry: Registry): ToolOutcome {
  if (input.type === undefined) return text(drawingGuide(registry, { schema: false }))
  const found = typeof input.type === 'string' ? nodeTypeSchema(input.type) : undefined
  return found ? text(JSON.stringify(found)) : text(`There is no type of node ${JSON.stringify(input.type)}. The types are ${nodeTypes().join(', ')}.`, true)
}

/** Where calls go: tools on a file, or on the drawing open in the app. */
export interface Backend {
  tools: ToolSpec[]
  call(name: string, input: unknown): Promise<ToolOutcome>
}

/** The drawing open in the desktop app, reached through what it wrote in `BRIDGE_FILE`. */
export function liveBackend(bridgeFile = BRIDGE_FILE): Backend {
  const closed = text('The desktop app is not letting agents in. Open OpenCalque and turn on Preferences › AI › "Let agents on this computer work on the open drawing".', true)
  return {
    tools: DRAWING_TOOLS,
    call: async (name, input) => {
      if (!existsSync(bridgeFile)) return closed
      const { port, token } = JSON.parse(readFileSync(bridgeFile, 'utf8')) as { port: number; token: string }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/tool`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ name, input }),
        })
        if (!response.ok) return text(`The desktop app answered: ${await response.text()}`, true)
        return (await response.json()) as ToolOutcome
      } catch {
        // The file outlives an app that crashed.
        return closed
      }
    },
  }
}

/** The MCP server over `backend`, to connect to a transport. */
export function mcpServer(backend: Backend, registry: Registry, version: string): Server {
  const server = new Server({ name: 'opencalque', version }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS })
  const tools = [READ_GUIDE, ...backend.tools]
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ name, description, schema }) => ({ name, description, inputSchema: schema as { type: 'object' } })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const { content, isError, image } = params.name === READ_GUIDE.name ? readGuide(params.arguments ?? {}, registry) : await backend.call(params.name, params.arguments ?? {}).catch((error: Error) => text(error.message, true))
    return {
      content: [{ type: 'text' as const, text: content }, ...(image ? [{ type: 'image' as const, data: image.data, mimeType: image.mime }] : [])],
      ...(isError ? { isError } : {}),
    }
  })
  return server
}

/** Serves the tools on stdin, or `input` where that is not it, and stdout until the client goes away. */
export async function serve(backend: Backend, registry: Registry, version: string, input?: Readable): Promise<void> {
  await mcpServer(backend, registry, version).connect(new StdioServerTransport(input))
}
