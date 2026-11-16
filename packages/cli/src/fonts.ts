import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * Where the fonts the app ships are: beside the bundle in the package published on npm
 * (`dist/cli.js` and `fonts/`, made by `build-package.ts`), at the root of the repository in a
 * checkout. The package carries only Noto Sans: the Chinese, Japanese and Korean fonts weigh 20 MB.
 */
export const FONTS: string = [new URL('../fonts/', import.meta.url), new URL('../../../fonts/', import.meta.url)].map((url) => fileURLToPath(url)).find((folder) => existsSync(folder)) ?? fileURLToPath(new URL('../fonts/', import.meta.url))
