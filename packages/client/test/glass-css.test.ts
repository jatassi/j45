import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// Strip CSS comments so a token mentioned in prose (this file's doc comment
// names every selector) can never satisfy a structural assertion.
const stripComments = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//g, '')

/** The body of the first rule whose selector matches `selector`, comments
 *  stripped — these rules have no nested braces, so `[^}]*` is exact. */
function ruleBody(css: string, selector: RegExp): string | undefined {
  const match = new RegExp(String.raw`${selector.source}\s*\{([^}]*)\}`).exec(stripComments(css))
  return match?.[1]
}

const glassCss = readFileSync(new URL('../src/glass/glass.css', import.meta.url), 'utf8')
const glassCode = stripComments(glassCss)
const indexCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const glassDir = new URL('../src/glass/', import.meta.url)

describe('glass.css — baseline tier', () => {
  it('frosts with backdrop-filter blur+saturate, isolates, and clips', () => {
    const body = ruleBody(glassCss, /\.glass-surface/)
    expect(body).toMatch(/backdrop-filter:\s*blur\([^)]*\)\s*saturate\(/)
    expect(body).toMatch(/isolation:\s*isolate/)
    expect(body).toMatch(/overflow:\s*hidden/)
  })

  it('layers a milky tint + top sheen (::before) and a masked-gradient rim (::after)', () => {
    expect(ruleBody(glassCss, /\.glass-surface::before/)).toMatch(/mix-blend-mode:\s*screen/)
    const rim = ruleBody(glassCss, /\.glass-surface::after/)
    expect(rim).toMatch(/linear-gradient/)
    expect(rim).toMatch(/mask-composite:\s*exclude/)
  })

  it('cuts its colours from the J45 dark tokens, not hard-coded whites', () => {
    expect(glassCode).toMatch(/var\(--foreground\)/)
    expect(glassCode).toMatch(/var\(--card\)/)
    expect(glassCode).toMatch(/var\(--border\)/)
  })
})

describe('glass.css — refract tier', () => {
  it('drops backdrop-filter and moves blur/saturate onto the layer canvas', () => {
    const surface = ruleBody(glassCss, /\.glass-surface\[data-glass-tier=["']refract["']\]/)
    expect(surface).toMatch(/backdrop-filter:\s*none/)
    const layer = ruleBody(
      glassCss,
      /\.glass-surface\[data-glass-tier=["']refract["']\]\s*>\s*\.glass-layer/,
    )
    // `[^;]*` spans the nested `blur(var(...))` parens up to the declaration end.
    expect(layer).toMatch(/filter:\s*blur\([^;]*saturate\(/)
  })
})

describe('glass.css — reduced transparency', () => {
  it('renders surfaces opaque with the rim only', () => {
    const query = /@media\s*\(prefers-reduced-transparency:\s*reduce\)\s*\{([\s\S]*)\}\s*$/.exec(
      glassCode,
    )
    expect(query?.[1]).toBeTypeOf('string')
    // Frost and the refraction layer are hidden; the surface goes opaque.
    expect(query?.[1]).toMatch(/\.glass-surface::before[\s\S]*?display:\s*none/)
    expect(query?.[1]).toMatch(/\.glass-layer[\s\S]*?display:\s*none/)
    expect(query?.[1]).toMatch(/background-color:\s*var\(--card\)/)
  })
})

describe('index.css', () => {
  it('imports the glass tier stack', () => {
    expect(indexCss).toMatch(/@import\s+["']\.\/glass\/glass\.css["']/)
  })
})

describe('glass module — static render contract', () => {
  it('contains no requestAnimationFrame anywhere under src/glass', () => {
    const sources = readdirSync(glassDir)
      .filter((name) => /\.(ts|tsx)$/.test(name))
      .map((name) => readFileSync(new URL(name, glassDir), 'utf8'))
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source).not.toContain('requestAnimationFrame')
    }
  })
})
