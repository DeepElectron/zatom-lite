import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import INDEX_HTML from '../../index.html?raw'
import PACKAGE_JSON from '../../package.json?raw'
import BRANDING_TERMS from '../../BRANDING.md?raw'
import ABOUT_SOURCE from '../ui/components/about-and-licenses-dialog.tsx?raw'
import BRAND_BUTTON_SOURCE from '../ui/components/zatom-brand-button.tsx?raw'
import SIDEBAR_SOURCE from '../ui/panels/sidebar-tabs.tsx?raw'

const ICON_FILES = [
  'zatom-favicon-32.png',
  'zatom-mark-180.png',
] as const

describe('web branding', () => {
  it('publishes the versioned icon set from the web entry point', () => {
    expect(INDEX_HTML).toContain('<meta name="application-name" content="Zatom" />')
    for (const file of ICON_FILES) expect(INDEX_HTML).toContain(`/src/assets/${file}`)
  })

  it('keeps the workspace mark accessible as the persistent About and licenses entry point', () => {
    expect(SIDEBAR_SOURCE).toContain('import { ZatomBrandButton } from "../components/zatom-brand-button"')
    expect(SIDEBAR_SOURCE.match(/<ZatomBrandButton/g)).toHaveLength(2)
    expect(BRAND_BUTTON_SOURCE).toContain("import zatomMarkUrl from '../../assets/zatom-mark-180.png'")
    expect(ABOUT_SOURCE).toContain("import zatomMarkUrl from '../../assets/zatom-mark-180.png'")
    expect(BRAND_BUTTON_SOURCE).toContain('aria-label="About Zatom, copyright, and licenses"')
  })

  it('advertises the public zatom-lite source while development may continue elsewhere', () => {
    const publicSource = 'https://github.com/DeepElectron/zatom-lite'
    expect(ABOUT_SOURCE).toContain(`href="${publicSource}"`)
    expect(BRANDING_TERMS).toContain(publicSource)
    expect(PACKAGE_JSON).toContain(publicSource)
  })

  it('ships real 32 px and Apple touch PNG fallbacks', () => {
    const pngSignature = '89504e470d0a1a0a'
    for (const file of ['zatom-favicon-32.png', 'zatom-mark-180.png']) {
      const bytes = readFileSync(`src/assets/${file}`)
      expect(bytes.subarray(0, 8).toString('hex')).toBe(pngSignature)
    }
  })
})
