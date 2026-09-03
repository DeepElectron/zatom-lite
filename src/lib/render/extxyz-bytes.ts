/**
 * Byte-level extXYZ frame parsing — no split('\n'), no parseFloat, no string
 * garbage. Decoding a 650k-atom frame this way is ~5-10x faster than the
 * string path and produces zero intermediate allocations, which is what keeps
 * the playback decode worker ahead of the playhead.
 */

const NL = 10, SP = 32, TAB = 9, CR = 13

/** Parse one frame's bytes ("count\ncomment\nN×(El x y z ...)") into `out`. */
export function parseFrameBytes(bytes: Uint8Array, atomCount: number, out: Float32Array): void {
  let p = 0
  const len = bytes.length
  // skip count + comment lines
  for (let l = 0; l < 2; l++) { while (p < len && bytes[p] !== NL) p++; p++ }
  for (let i = 0; i < atomCount; i++) {
    // skip leading whitespace + element token
    while (p < len && (bytes[p] === SP || bytes[p] === TAB)) p++
    while (p < len && bytes[p] !== SP && bytes[p] !== TAB) p++
    for (let c = 0; c < 3; c++) {
      while (p < len && (bytes[p] === SP || bytes[p] === TAB)) p++
      // ascii float: [sign] int [.frac] [e[sign]exp]
      let sign = 1
      if (bytes[p] === 45) { sign = -1; p++ } else if (bytes[p] === 43) p++
      let v = 0
      while (p < len && bytes[p] >= 48 && bytes[p] <= 57) { v = v * 10 + (bytes[p] - 48); p++ }
      if (bytes[p] === 46) {
        p++
        let f = 0, scale = 1
        while (p < len && bytes[p] >= 48 && bytes[p] <= 57) { f = f * 10 + (bytes[p] - 48); scale *= 10; p++ }
        v += f / scale
      }
      if (bytes[p] === 101 || bytes[p] === 69) { // e / E
        p++
        let es = 1
        if (bytes[p] === 45) { es = -1; p++ } else if (bytes[p] === 43) p++
        let e = 0
        while (p < len && bytes[p] >= 48 && bytes[p] <= 57) { e = e * 10 + (bytes[p] - 48); p++ }
        v *= Math.pow(10, es * e)
      }
      out[i * 3 + c] = sign * v
    }
    // skip any extra columns to end of line
    while (p < len && bytes[p] !== NL) p++
    p++
  }
  // tolerate trailing \r before \n (CRLF) — handled implicitly: \r is skipped as
  // part of "extra columns"; coordinates themselves never contain \r.
  void CR
}
