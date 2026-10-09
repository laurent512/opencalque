import changelog from '../../../CHANGELOG.md?raw'

export interface Release {
  version: string
  date: string
  /** The changes under each heading ("New", "Improved", "Fixed"), in the order written. */
  sections: { title: string; items: string[] }[]
}

/**
 * Reads the versions out of CHANGELOG.md: a `## version — date` heading for each, then `###`
 * headings with one `- ` line per change. Anything else (the introduction) is skipped.
 */
export function parseChangelog(text: string): Release[] {
  const releases: Release[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const release = releases[releases.length - 1]
    const version = /^## +v?(\d+\.\d+\.\d+\S*)(?:\s+\S\s+(.+))?$/.exec(line)
    if (version) releases.push({ version: version[1], date: version[2] ?? '', sections: [] })
    else if (!release) continue
    else if (line.startsWith('### ')) release.sections.push({ title: line.slice(4).trim(), items: [] })
    else if (line.startsWith('- ')) {
      if (release.sections.length === 0) release.sections.push({ title: '', items: [] })
      release.sections[release.sections.length - 1].items.push(line.slice(2).trim())
    }
  }
  return releases
}

/** Every version, newest first. */
export const RELEASES = parseChangelog(changelog)

/** The version of the app: the newest one in the changelog, which a test keeps equal to the packages'. */
export const VERSION = RELEASES[0]?.version ?? ''

export const REPOSITORY = 'https://github.com/laurent512/opencalque'
