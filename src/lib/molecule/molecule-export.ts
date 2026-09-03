/** Export 2D-editor molecules to MDL V2000, XYZ, or rasterized PNG. */

import type { Molecule2D, Bond2D } from './smiles-parser'

/** Map editor bond type to MDL order; aromatic is V2000 order 4. */
function bondTypeToOrder(type: Bond2D['type']): number {
  switch (type) {
    case 'double':
      return 2
    case 'triple':
      return 3
    case 'aromatic':
      return 4
    default:
      return 1
  }
}

/** Right-align a value in a fixed-width V2000 field. */
function pad(value: string | number, width: number): string {
  return String(value).padStart(width, ' ')
}

/** Format a ten-character V2000 coordinate with four decimals. */
function fmtCoord(v: number): string {
  return v.toFixed(4).padStart(10, ' ')
}

/** Generate a planar MDL V2000 molfile from editor coordinates. */
export function moleculeToMolfile(molecule: Molecule2D, title = 'Molecule'): string {
  const atoms = molecule.atoms
  const bonds = molecule.bonds
  // atom id → 1-based sequence number
  const idToIndex = new Map<string, number>()
  atoms.forEach((a, i) => idToIndex.set(a.id, i + 1))

  const lines: string[] = []
  // Header block (3 lines): name/program-timestamp/comment
  lines.push(title.slice(0, 80))
  lines.push('  Zatom2D')
  lines.push('')
  // Counts line：aaabbb...V2000
  lines.push(`${pad(atoms.length, 3)}${pad(bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`)
  // Atom block
  for (const a of atoms) {
    lines.push(
      `${fmtCoord(a.x)}${fmtCoord(a.y)}${fmtCoord(0)} ${a.element.padEnd(3, ' ')} 0  0  0  0  0  0  0  0  0  0  0  0`,
    )
  }
  // Bond block
  for (const b of bonds) {
    const i1 = idToIndex.get(b.atom1Id)
    const i2 = idToIndex.get(b.atom2Id)
    if (!i1 || !i2) continue
    lines.push(`${pad(i1, 3)}${pad(i2, 3)}${pad(bondTypeToOrder(b.type), 3)}  0  0  0  0`)
  }
  lines.push('M  END')
  return lines.join('\n') + '\n'
}

/** Generate XYZ with editor x/y coordinates and z=0. */
export function moleculeToXYZ(molecule: Molecule2D, comment = 'Molecule from Zatom 2D drawer'): string {
  const atoms = molecule.atoms
  let out = `${atoms.length}\n${comment}\n`
  for (const a of atoms) {
    out += `${a.element.padEnd(3)} ${a.x.toFixed(6)} ${a.y.toFixed(6)} ${(0).toFixed(6)}\n`
  }
  return out
}

/** Download a Blob through a temporary anchor and revoke its URL after dispatch. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Give the browser one frame to trigger the download and then recycle the URL
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

/** Download text through the shared Blob path. */
export function downloadTextFile(fileName: string, text: string, mimeType = 'text/plain'): void {
  downloadBlob(fileName, new Blob([text], { type: mimeType }))
}

/** Rasterize an SVG element to PNG with an explicit background. */
export async function exportSvgToPng(
  svg: SVGSVGElement,
  fileName = 'molecule.png',
  options: { scale?: number; background?: string } = {},
): Promise<void> {
  const scale = options.scale ?? 2
  const background = options.background ?? '#1a1a1e'

  // Read SVG size (give priority to viewBox / width-height properties, fall back to bounding box)
  const rect = svg.getBoundingClientRect()
  const width = svg.width?.baseVal?.value || rect.width || 400
  const height = svg.height?.baseVal?.value || rect.height || 400

  // Clone a copy and explicitly write the size + xmlns to ensure independent rendering
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const svgString = new XMLSerializer().serializeToString(clone)
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)

  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG image decode failed'))
      img.src = svgUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get a canvas 2D context')

    // Background fill (to prevent transparent PNGs from being unclear in light-colored environments)
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('PNG toBlob returned empty')
    downloadBlob(fileName, blob)
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}
