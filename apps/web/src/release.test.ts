import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { parseChangelog } from './release'

const root = resolve(__dirname, '../../..')
const versionOf = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8')).version

test('the changelog is read into versions, headings and changes', () => {
  const [latest, first] = parseChangelog('# Changelog\n\nIntro.\n\n## 1.2.0 — 2026-01-02\n\n### New\n- One\n- Two\n\n### Fixed\n- Three\n\n## 1.1.0 — 2025-12-01\n- Loose')
  expect(latest).toEqual({ version: '1.2.0', date: '2026-01-02', sections: [{ title: 'New', items: ['One', 'Two'] }, { title: 'Fixed', items: ['Three'] }] })
  expect(first.sections).toEqual([{ title: '', items: ['Loose'] }])
})

test('the newest version in the changelog is the version of the app', () => {
  const releases = parseChangelog(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'))
  expect(releases[0].sections.some((section) => section.items.length > 0)).toBe(true)
  // The installers take their version from the desktop package, and the release from the tag.
  expect(versionOf('package.json')).toBe(releases[0].version)
  expect(versionOf('apps/desktop/package.json')).toBe(releases[0].version)
})
