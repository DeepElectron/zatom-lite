// Marching-squares contours as real 2D polylines. Geometry avoids screen-space
// undersampling and supports stable path-length-based dashes.

export type Polyline = Array<[number, number]> // uv space [0,1]²

/** Chaikin smoothing with preserved open endpoints and explicitly closed loops. */
export function chaikinSmooth(line: Polyline, iterations = 2): Polyline {
  let pts = line
  for (let it = 0; it < iterations; it++) {
    const n = pts.length
    if (n < 3) return pts
    const closed =
      Math.abs(pts[0][0] - pts[n - 1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[n - 1][1]) < 1e-9
    const src = closed ? pts.slice(0, n - 1) : pts
    const m = src.length
    const out: Polyline = []
    if (!closed) out.push(src[0]) // Open chain retains the starting point
    const last = closed ? m : m - 1
    for (let i = 0; i < last; i++) {
      const p = src[i]
      const q = src[(i + 1) % m]
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25])
      out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75])
    }
    if (closed) out.push([out[0][0], out[0][1]]) // Re-close
    else out.push(src[m - 1]) // Open chain retains the end point
    pts = out
  }
  return pts
}
/**
 * Linear interpolation intersection point on the edge of the cell
 */
function lerpPoint(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  v0: number,
  v1: number,
  level: number,
): [number, number] {
  const t = Math.abs(v1 - v0) < 1e-12 ? 0.5 : (level - v0) / (v1 - v0)
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]
}

/**
 * Extract all polylines (connected, including closed loops) at a single contour level.
 * sample(i, j) returns the grid point scalar value, NaN means outside the area.
 */
export function extractContour(
  sample: (i: number, j: number) => number,
  res: number,
  level: number,
): Polyline[] {
  // 1. Collect line segments
  const segs: Array<[number, number, number, number]> = []
  const inv = 1 / (res - 1)

  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      const v00 = sample(i, j)
      const v10 = sample(i + 1, j)
      const v11 = sample(i + 1, j + 1)
      const v01 = sample(i, j + 1)
      if (Number.isNaN(v00) || Number.isNaN(v10) || Number.isNaN(v11) || Number.isNaN(v01)) continue

      let idx = 0
      if (v00 >= level) idx |= 1
      if (v10 >= level) idx |= 2
      if (v11 >= level) idx |= 4
      if (v01 >= level) idx |= 8
      if (idx === 0 || idx === 15) continue

      const x = i * inv
      const y = j * inv
      const x1 = (i + 1) * inv
      const y1 = (j + 1) * inv

      // Intersection point of four edges (calculated only when needed)
      const bottom = () => lerpPoint(x, y, x1, y, v00, v10, level)
      const right = () => lerpPoint(x1, y, x1, y1, v10, v11, level)
      const top = () => lerpPoint(x, y1, x1, y1, v01, v11, level)
      const left = () => lerpPoint(x, y, x, y1, v00, v01, level)

      const add = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]])

      switch (idx) {
        case 1: add(left(), bottom()); break
        case 2: add(bottom(), right()); break
        case 3: add(left(), right()); break
        case 4: add(right(), top()); break
        case 6: add(bottom(), top()); break
        case 7: add(left(), top()); break
        case 8: add(top(), left()); break
        case 9: add(top(), bottom()); break
        case 11: add(top(), right()); break
        case 12: add(right(), left()); break
        case 13: add(right(), bottom()); break
        case 14: add(bottom(), left()); break
        case 5: {
          // Saddle point: Disambiguation based on central mean
          const c = (v00 + v10 + v11 + v01) / 4
          if (c >= level) { add(left(), top()); add(right(), bottom()) }
          else { add(left(), bottom()); add(right(), top()) }
          break
        }
        case 10: {
          const c = (v00 + v10 + v11 + v01) / 4
          if (c >= level) { add(bottom(), left()); add(top(), right()) }
          else { add(bottom(), right()); add(top(), left()) }
          break
        }
      }
    }
  }

  // 2. The endpoint hashes are connected into a polyline (the premise that the dotted line is continuous along the path)
  const key = (px: number, py: number) => `${Math.round(px * 1e5)},${Math.round(py * 1e5)}`
  const endpointMap = new Map<string, number[]>()
  segs.forEach((s, si) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const list = endpointMap.get(k)
      if (list) list.push(si)
      else endpointMap.set(k, [si])
    }
  })

  const used = new Uint8Array(segs.length)
  const polylines: Polyline[] = []

  const walk = (startSeg: number, reverse: boolean): Polyline => {
    const s = segs[startSeg]
    used[startSeg] = 1
    const line: Polyline = reverse
      ? [[s[2], s[3]], [s[0], s[1]]]
      : [[s[0], s[1]], [s[2], s[3]]]
    for (;;) {
      const tail = line[line.length - 1]
      const k = key(tail[0], tail[1])
      const candidates = endpointMap.get(k)
      let next = -1
      if (candidates) for (const c of candidates) if (!used[c]) { next = c; break }
      if (next < 0) break
      used[next] = 1
      const ns = segs[next]
      // Receive the other end that does not match
      if (key(ns[0], ns[1]) === k) line.push([ns[2], ns[3]])
      else line.push([ns[0], ns[1]])
    }
    return line
  }

  // First move away from the chain (endpoint degree is 1), then close the remaining closed loops
  for (let si = 0; si < segs.length; si++) {
    if (used[si]) continue
    const s = segs[si]
    const deg0 = endpointMap.get(key(s[0], s[1]))!.length
    const deg1 = endpointMap.get(key(s[2], s[3]))!.length
    if (deg0 === 1) polylines.push(walk(si, false))
    else if (deg1 === 1) polylines.push(walk(si, true))
  }
  for (let si = 0; si < segs.length; si++) {
    if (!used[si]) polylines.push(walk(si, false))
  }

  return polylines
}
