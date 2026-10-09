// Prints the part of CHANGELOG.md about one version, to be used as the text of its release.
// Usage: node scripts/release-notes.mjs 0.2.0   (fails when the changelog has no such version)
import { readFileSync } from 'node:fs'

const version = (process.argv[2] ?? '').replace(/^v/, '')
const lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split(/\r?\n/)
const start = lines.findIndex((line) => line.startsWith(`## ${version} `) || line.trim() === `## ${version}`)
if (!version || start < 0) {
  console.error(`CHANGELOG.md has no section for version "${version}". Add one before tagging.`)
  process.exit(1)
}
const rest = lines.slice(start + 1)
const end = rest.findIndex((line) => line.startsWith('## '))
console.log((end < 0 ? rest : rest.slice(0, end)).join('\n').trim())
