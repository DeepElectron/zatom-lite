/** Complete finite XYZ/extXYZ real token; the format permits Fortran D exponents.
 * https://github.com/libAtoms/extxyz#floating-point-number
 * Never use parseFloat here: `1D+2` would become 1, and `1junk` would become 1.
 */
export function parseXyzReal(value: string): number | undefined {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(value)) return undefined
  const parsed = Number(value.replace(/[dD]/, 'e'))
  return Number.isFinite(parsed) ? parsed : undefined
}
