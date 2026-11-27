/**
 * What the core takes from the place it runs in. It runs in browsers, in Node (the CLI) and, later,
 * on a server or in a worker, so it is compiled without the DOM's types or Node's: whatever it needs
 * from its host is listed here, and must exist in every one of them.
 */
interface Host {
  crypto: { getRandomValues<T extends Uint8Array>(array: T): T }
  /** What the profiler times spans with (`perf.ts`). */
  performance: { now(): number }
}

export const host = globalThis as unknown as Host
