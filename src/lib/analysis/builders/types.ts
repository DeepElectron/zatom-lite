/**
 * Generative crystal-building tools. Each builder produces an extended-XYZ
 * string that goes through the existing loadFromXYZ pipeline so the new
 * structure shows up in the viewport with bonds, periodicity, etc.
 */

export interface BuilderSiteSpec {
  element: string
  /** Fractional coordinates inside the unit cell. */
  frac: [number, number, number]
}

export interface BuilderResult {
  /** Extended-XYZ text ready for loadFromXYZ. */
  xyz: string
  /** Human-readable summary for the UI. */
  description: string
  n_atoms: number
  /** Element → count (Hill formula source). Optional —— added by builders that
  *  want the UI to preview composition before commit. */
  composition?: Record<string, number>
  /** Resulting cell parameters for the UI to sanity-check geometry before commit. */
  cellParams?: {
    aLen: number
    bLen: number
    cLen: number
    alphaDeg: number   // angle between b and c
    betaDeg: number    // angle between a and c
    gammaDeg: number   // angle between a and b
  }
  /** Cartesian bounding box of generated atoms — UI shows this to spot
  *  "atoms outside cell" issues (atoms should fit inside [origin, a+b+c]). */
  atomBBox?: {
    min: [number, number, number]
    max: [number, number, number]
  }
}
