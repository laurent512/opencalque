import type { Command } from './commands'
import { t } from './i18n'

type Searched = Pick<Command, 'title' | 'category' | 'keywords'>

/**
 * Every word of the query must appear somewhere in the command's category or title. The English
 * names match too, whatever the language, so a shortcut learned from documentation still works.
 */
export function matchesCommand(command: Searched, query: string): boolean {
  const text = `${t(command.category)} ${t(command.title)} ${command.category} ${command.title} ${command.keywords ?? ''}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).every((word) => text.includes(word))
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** How well `word` is found among `words`: as a whole word, as the start of one, or inside one. */
function closeness(word: string, words: string[]): number {
  if (words.includes(word)) return 3
  if (words.some((one) => one.startsWith(word))) return 2
  return words.some((one) => one.includes(word)) ? 1 : 0
}

/**
 * How well a command answers a query: each word by how closely it is found, in the title people see
 * above all. That is the title in their language: its English name counts as a keyword does.
 */
function relevance(command: Searched, query: string[]): number {
  const title = wordsOf(t(command.title))
  const rest = wordsOf(`${command.title} ${t(command.category)} ${command.category} ${command.keywords ?? ''}`)
  return query.reduce((total, word) => total + Math.max(2 * closeness(word, title), closeness(word, rest)), 0)
}

/**
 * The commands that match a query, the closest first, so that Enter runs what was typed: "place
 * component" is the command of that name before one that merely has "placements" among its
 * keywords. Those as close as each other stay in the order of the list, as does everything when
 * nothing is typed.
 */
export function searchCommands<T extends Searched>(commands: T[], query: string): T[] {
  const found = commands.filter((command) => matchesCommand(command, query))
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return found
  return found
    .map((command) => ({ command, score: relevance(command, words) }))
    .sort((a, b) => b.score - a.score)
    .map(({ command }) => command)
}
