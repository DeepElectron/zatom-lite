import type { DetectSitesResult } from '../../lib/analysis/builders/adsorbate'
import type { DetectedSite } from '../../lib/analysis/builders/adsorbate-types'

/**
 * Test helper that asserts successful detection and returns sites.
 *
 * detectSites rejects bulk structures through a discriminated result. Tests expecting sites should
 * fail immediately with the rejection reason rather than silently receiving an empty array.
 */
export function unwrapSites(result: DetectSitesResult): DetectedSite[] {
  if (!result.ok) {
    throw new Error(`detectSites 被拒绝 (${result.reason}): ${result.message}`)
  }
  return result.sites
}
