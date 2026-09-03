/**
 * Shared Boltz endpoint constants keep Vite proxy targets and browser URL rewriting aligned.
 * This module contains pure constants and imports neither browser nor Node APIs.
 */

/** Job API origin. */
export const BOLTZ_API_ORIGIN = 'https://api.boltz.bio'

/**
 * Observed presigned mmCIF and tar.gz artifact URLs use this fixed storage host:
 * boltz-platform-prod-compute-api-storage.s3.us-east-1.amazonaws.com
 * Pinning the host keeps the development proxy narrowly scoped. If Boltz changes storage hosts,
 * transport validation reports it explicitly instead of silently building an invalid URL.
 */
export const BOLTZ_ARTIFACT_ORIGIN = 'https://boltz-platform-prod-compute-api-storage.s3.us-east-1.amazonaws.com'

/** Same-origin development proxy prefixes. */
export const BOLTZ_API_PROXY_PREFIX = '/boltz-api'
export const BOLTZ_ARTIFACT_PROXY_PREFIX = '/boltz-artifact'

/** API version prefix shared by every pipeline. */
export const BOLTZ_API_VERSION_PATH = '/compute/v1'
