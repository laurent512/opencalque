/**
 * What was kept in this browser while the project was called OpenCAD (preferences, shortcuts, panel
 * layout, conversations) is carried over to the new names, once. This module must be the first one
 * loaded, because the others read their settings as they load.
 */
const FORMER = 'opencad'
for (const key of ['prefs', 'shortcuts', 'layout', 'chats']) {
  try {
    const old = localStorage.getItem(`${FORMER}.${key}`)
    if (old !== null && localStorage.getItem(`opencalque.${key}`) === null) {
      // Extensions were named after the project too.
      localStorage.setItem(`opencalque.${key}`, key === 'prefs' ? old.replaceAll(`"${FORMER}.`, '"opencalque.') : old)
    }
  } catch {
    // Storage can be unavailable (private windows); there is then nothing to carry over.
  }
}

export {}
