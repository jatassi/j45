import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

describe('main.tsx / theme-provider removal', () => {
  it('deletes theme-provider.tsx and renders the app in main.tsx without a ThemeProvider', () => {
    const themeProviderPath = path.join(srcDir, 'components/theme-provider.tsx')
    expect(fs.existsSync(themeProviderPath)).toBe(false)

    const mainSource = fs.readFileSync(path.join(srcDir, 'main.tsx'), 'utf8')
    expect(mainSource).not.toMatch(/ThemeProvider/)
    expect(mainSource).toMatch(/<App\s*\/>/)
  })
})
