/* eslint-disable react-refresh/only-export-components */
import * as React from 'react'

type Theme = 'dark' | 'light' | 'system'
type ResolvedTheme = 'dark' | 'light'
type SetThemeState = React.Dispatch<React.SetStateAction<Theme>>

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'
const THEME_VALUES: ReadonlySet<Theme> = new Set(['dark', 'light', 'system'])

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(undefined)

function isTheme(value: string | null): value is Theme {
  if (value === null) {
    return false
  }

  return THEME_VALUES.has(value as Theme)
}

function readStoredTheme(storageKey: string, defaultTheme: Theme): Theme {
  const storedTheme = localStorage.getItem(storageKey)
  if (isTheme(storedTheme)) {
    return storedTheme
  }

  return defaultTheme
}

function getSystemTheme(): ResolvedTheme {
  if (globalThis.matchMedia(COLOR_SCHEME_QUERY).matches) {
    return 'dark'
  }

  return 'light'
}

function toggledTheme(currentTheme: Theme): Theme {
  if (currentTheme === 'dark') {
    return 'light'
  }
  if (currentTheme === 'light') {
    return 'dark'
  }

  return getSystemTheme() === 'dark' ? 'light' : 'dark'
}

function disableTransitionsTemporarily() {
  const style = document.createElement('style')
  style.append(
    document.createTextNode(
      '*,*::before,*::after{-webkit-transition:none!important;transition:none!important}',
    ),
  )
  document.head.append(style)

  return () => {
    globalThis.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        style.remove()
      })
    })
  }
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const editableParent = target.closest("input, textarea, select, [contenteditable='true']")
  if (editableParent) {
    return true
  }

  return false
}

function shouldIgnoreThemeShortcut(event: KeyboardEvent) {
  return (
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isEditableTarget(event.target) ||
    event.key.toLowerCase() !== 'd'
  )
}

/** Applies `theme` to <html>, tracking the OS scheme while it is "system". */
function useApplyTheme(theme: Theme, disableTransitionOnChange: boolean) {
  const applyTheme = React.useCallback(
    (nextTheme: Theme) => {
      const root = document.documentElement
      const resolvedTheme = nextTheme === 'system' ? getSystemTheme() : nextTheme
      const restoreTransitions = disableTransitionOnChange ? disableTransitionsTemporarily() : null

      root.classList.remove('light', 'dark')
      root.classList.add(resolvedTheme)

      if (restoreTransitions) {
        restoreTransitions()
      }
    },
    [disableTransitionOnChange],
  )

  React.useEffect(() => {
    applyTheme(theme)

    if (theme !== 'system') {
      return undefined
    }

    const mediaQuery = globalThis.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => {
      applyTheme('system')
    }

    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme, applyTheme])
}

/** Toggles dark/light on the bare "d" key (outside editable targets). */
function useThemeToggleShortcut(storageKey: string, setThemeState: SetThemeState) {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreThemeShortcut(event)) {
        return
      }

      setThemeState((currentTheme) => {
        const nextTheme = toggledTheme(currentTheme)
        localStorage.setItem(storageKey, nextTheme)
        return nextTheme
      })
    }

    globalThis.addEventListener('keydown', handleKeyDown)

    return () => {
      globalThis.removeEventListener('keydown', handleKeyDown)
    }
  }, [storageKey, setThemeState])
}

/** Follows theme changes made in other tabs via the storage event. */
function useStorageSync(storageKey: string, defaultTheme: Theme, setThemeState: SetThemeState) {
  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== storageKey) {
        return
      }

      setThemeState(isTheme(event.newValue) ? event.newValue : defaultTheme)
    }

    globalThis.addEventListener('storage', handleStorageChange)

    return () => {
      globalThis.removeEventListener('storage', handleStorageChange)
    }
  }, [defaultTheme, storageKey, setThemeState])
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'theme',
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() =>
    readStoredTheme(storageKey, defaultTheme),
  )

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      localStorage.setItem(storageKey, nextTheme)
      setThemeState(nextTheme)
    },
    [storageKey],
  )

  useApplyTheme(theme, disableTransitionOnChange)
  useThemeToggleShortcut(storageKey, setThemeState)
  useStorageSync(storageKey, defaultTheme, setThemeState)

  const value = React.useMemo(
    () => ({
      theme,
      setTheme,
    }),
    [theme, setTheme],
  )

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext)

  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }

  return context
}
