const STORAGE_KEY = 'cribl-adoption-postadd-preference-v1'

export type PostAddDefaultChoice = 'wizard' | 'manual'

/**
 * If set, the "How do you want to get started?" step is skipped for new sources.
 */
export function getPostAddPreference(): PostAddDefaultChoice | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'wizard' || v === 'manual') {
      return v
    }
  } catch {
    /* localStorage unavailable */
  }
  return null
}

export function setPostAddPreference(choice: PostAddDefaultChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    /* ignore */
  }
}

export function clearPostAddPreference(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
