/** Canonical adsorption-site colors shared by panel dots and 3D markers. */

import type { SiteKind } from '../analysis/builders/adsorbate-types'

export const SITE_KIND_COLORS: Record<SiteKind, string> = {
  top: '#0A84FF',
  bridge: '#FF9F0A',
  hollow: '#30D158',
}

/** Inaccessible sites use a neutral gray regardless of geometry class. */
export const SITE_BLOCKED_COLOR = '#8E8E93'

export function siteDotColor(kind: SiteKind, blocked: boolean): string {
  return blocked ? SITE_BLOCKED_COLOR : SITE_KIND_COLORS[kind]
}
