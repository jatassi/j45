import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/index.css')

describe('index.css dark-only tokens', () => {
  it('collapses to a single :root block holding the former dark palette, with the light block and @custom-variant dark removed', () => {
    const css = fs.readFileSync(cssPath, 'utf8')

    const rootBlocks = css.match(/:root\s*\{/g) ?? []
    const darkClassBlocks = css.match(/\.dark\s*\{/g) ?? []
    const rootBlockMatch = /:root\s*\{([^}]*)\}/.exec(css)

    expect(rootBlocks).toHaveLength(1)
    expect(darkClassBlocks).toHaveLength(0)
    expect(css).not.toMatch(/@custom-variant\s+dark/)

    expect(rootBlockMatch).not.toBeNull()
    const rootBody = rootBlockMatch?.[1] ?? ''

    // The backdrop gradient base colour every glass tier colours against.
    expect(rootBody).toMatch(/--background:\s*#08090b\s*;/)

    // Palette-independent tokens must survive the collapse: every @theme
    // --radius-* token is calc(var(--radius) * X), so losing this squares
    // every corner client-wide.
    expect(rootBody).toMatch(/--radius:\s*0\.625rem\s*;/)

    // Proves the block holds the *dark* palette (not the light one it
    // replaced): the former `.dark` foreground/card values, not the
    // former `:root` (light) ones.
    expect(rootBody).toContain('--foreground: oklch(0.987 0.002 197.1)')
    expect(rootBody).toContain('--card: oklch(0.218 0.008 223.9)')
    expect(rootBody).not.toContain('--foreground: oklch(0.148 0.004 228.8)')
  })
})
