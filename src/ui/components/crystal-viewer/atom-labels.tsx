/** Labels for source atoms and the same periodic image set used by atom rendering. */
import { useMemo } from 'react'
import { resolveViewportTheme } from '../../../host'
import type { AtomLabelContent, AtomLabelPosition } from '../../../lib/crystal/types'
import { applySelectionTransformPreviewToPosition } from '../../../lib/selection-transform-preview'
import { latticeShift } from '../../../lib/crystal/lattice-math'
import { isHomeImage } from '../../../lib/crystal/display-periodic-images'
import { useDisplayPositions } from './use-display-positions'
import { useDisplayImages } from './use-display-image-offsets'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { ViewerLabelSpriteGroup } from './viewer-label-sprite'

export const ATOM_LABEL_FULL_SCENE_LIMIT = 500

export const DARK_ATOM_LABEL_COLOR = '#dbe1e8'
export const LIGHT_ATOM_LABEL_COLOR = '#1b1a17'

export const DARK_MIRROR_LABEL_COLOR = '#7d8794'
export const LIGHT_MIRROR_LABEL_COLOR = '#a3a9b3'

export function resolveMirrorLabelColor(isDark: boolean): string {
  return isDark ? DARK_MIRROR_LABEL_COLOR : LIGHT_MIRROR_LABEL_COLOR
}

export function resolveAtomLabelColor(isDark: boolean, override: string | null): string {
  if (override) return override
  return isDark ? DARK_ATOM_LABEL_COLOR : LIGHT_ATOM_LABEL_COLOR
}

export function atomLabelText(element: string, ordinal: number, content: AtomLabelContent): string {
  if (content === 'number') return String(ordinal)
  if (content === 'element-number') return `${element}${ordinal}`
  return element
}

export function atomLabelVerticalOffset(
  clearance: number,
  position: AtomLabelPosition,
  gap: number,
): number {
  if (position === 'center') return 0
  const distance = clearance + gap
  return position === 'below' ? -distance : distance
}

export function AtomLabels({ hiddenAtomIds }: { hiddenAtomIds?: ReadonlySet<string> }) {
  const show = useCrystalStore((state) => state.showAtomLabels)
  const atoms = useCrystalStore((state) => state.atoms)
  const bonds = useCrystalStore((state) => state.bonds)
  const compactStructure = useCrystalStore((state) => state.compactStructure)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  const unwrapMap = useDisplayPositions(atoms, bonds)
  const displayImages = useDisplayImages(atoms)
  const translationPreview = useCrystalStore((state) => state.translationPreview)
  const rotationPreview = useCrystalStore((state) => state.rotationPreview)
  const selectionTransformOrigin = useCrystalStore((state) => state.selectionTransformOrigin)
  const atomScale = useCrystalStore((state) => state.atomScale)
  const viewMode = useCrystalStore((state) => state.viewMode)
  const labelSize = useCrystalStore((state) => state.atomLabelSize)
  const color = useCrystalStore((state) => state.atomLabelColor)
  const scope = useCrystalStore((state) => state.atomLabelScope)
  const content = useCrystalStore((state) => state.atomLabelContent)
  const outline = useCrystalStore((state) => state.atomLabelOutline)
  const labelPosition = useCrystalStore((state) => state.atomLabelPosition)
  const labelGap = useCrystalStore((state) => state.atomLabelGap)
  const background = useCrystalStore((state) => state.background)

  const groups = useMemo(() => {
    if (!show) return { home: [] as [string, [number, number, number][]][], mirror: [] as [string, [number, number, number][]][] }
    const selectedOnly = scope === 'selected'
      || Boolean(compactStructure)
      || atoms.length > ATOM_LABEL_FULL_SCENE_LIMIT
    const clearance = (viewMode === 'space-fill' ? .72 : .52) * atomScale + .12
    const verticalOffset = atomLabelVerticalOffset(clearance, labelPosition, labelGap)
    const positionsByText = new Map<string, [number, number, number][]>()
    const mirrorPositionsByText = new Map<string, [number, number, number][]>()

    const imageOffsets = displayImages.offsets
    const imageLattice = displayImages.displayBox
    const shiftCache = new Map<string, [number, number, number]>()
    let mirrorCount = 0
    const MIRROR_LABEL_LIMIT = 4000

    atoms.forEach((atom, atomIndex) => {
      if (!atom.cartesian || hiddenAtomIds?.has(atom.id)) return
      const selected = selectedAtomIds.has(atom.id)
      if (selectedOnly && !selected) return
      const position = applySelectionTransformPreviewToPosition(
        atom.cartesian,
        selected,
        selectionTransformOrigin,
        translationPreview,
        rotationPreview,
        unwrapMap?.get(atom.id) ?? null,
      )
      const text = atomLabelText(atom.element, atomIndex + 1, content)
      const labelWorldPosition: [number, number, number] = [
        position[0],
        position[1] + verticalOffset,
        position[2],
      ]
      const bucket = positionsByText.get(text)
      if (bucket) bucket.push(labelWorldPosition)
      else positionsByText.set(text, [labelWorldPosition])

      if (!imageOffsets || !imageLattice || mirrorCount >= MIRROR_LABEL_LIMIT) return
      for (const off of imageOffsets.get(atom.id) ?? []) {
        if (isHomeImage(off)) continue
        const k = `${off[0]},${off[1]},${off[2]}`
        let s = shiftCache.get(k)
        if (!s) {
          s = latticeShift(imageLattice, off[0], off[1], off[2]) as [number, number, number]
          shiftCache.set(k, s)
        }
        const mirrorPosition: [number, number, number] = [
          position[0] + s[0],
          position[1] + s[1] + verticalOffset,
          position[2] + s[2],
        ]
        const mirrorBucket = mirrorPositionsByText.get(text)
        if (mirrorBucket) mirrorBucket.push(mirrorPosition)
        else mirrorPositionsByText.set(text, [mirrorPosition])
        mirrorCount += 1
        if (mirrorCount >= MIRROR_LABEL_LIMIT) break
      }
    })

    const byText = (
      [left]: [string, unknown],
      [right]: [string, unknown],
    ) => left.localeCompare(right)
    return {
      home: [...positionsByText.entries()].sort(byText),
      mirror: [...mirrorPositionsByText.entries()].sort(byText),
    }
  }, [
    displayImages,
    atomScale,
    atoms,
    bonds,
    compactStructure,
    content,
    hiddenAtomIds,
    labelGap,
    labelPosition,
    rotationPreview,
    scope,
    selectedAtomIds,
    selectionTransformOrigin,
    show,
    translationPreview,
    unwrapMap,
    viewMode,
  ])

  if (!show || (groups.home.length === 0 && groups.mirror.length === 0)) return null
  const baseSize = .42 * labelSize
  const isDark = resolveViewportTheme(background) === 'dark'
  const resolvedColor = resolveAtomLabelColor(isDark, color)
  const mirrorColor = resolveMirrorLabelColor(isDark)
  return <group name="atom-labels">
    {groups.home.map(([text, positions]) => (
      <ViewerLabelSpriteGroup
        key={text}
        text={text}
        positions={positions}
        baseSize={baseSize}
        color={resolvedColor}
        outlineColor={background}
        outline={outline}
      />
    ))}
    {/* Image labels reuse the source text but are dimmed to signal periodic equivalence. */}
    {groups.mirror.map(([text, positions]) => (
      <ViewerLabelSpriteGroup
        key={`mirror-${text}`}
        text={text}
        positions={positions}
        baseSize={baseSize}
        color={mirrorColor}
        outlineColor={background}
        outline={outline}
      />
    ))}
  </group>
}
