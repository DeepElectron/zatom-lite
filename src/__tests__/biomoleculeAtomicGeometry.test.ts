import { describe, expect, it } from 'vitest'
import {
  bioFocusOpacity,
  BIO_OUTLINE_PIXELS_PER_STEP,
  bioCartoonOutlineNdcWidth,
  resolveBioAtomicElementRadius,
  resolveBioAtomicGeometry,
} from '../lib/biomolecule/atomic-geometry'
import { getDefaultCrystalElementVisual } from '../lib/render/crystal-visuals'

const globals = {
  viewMode: 'ball-stick' as const,
  radiusScale: .45,
  bondRadius: .12,
  elementOverrides: { C: { color: '#ffffff', radius: 1.1 } },
}

describe('source-compatible biomolecule atomic geometry', () => {
  it('inherits atom style, radius scale and fixed bond radius together', () => {
    const inherited = resolveBioAtomicGeometry({ representation: 'inherit', scale: 1.5, globals })
    expect(inherited.representation).toBe('ball-and-stick')
    expect(inherited.bondRadius).toBeCloseTo(.18)
    expect(resolveBioAtomicElementRadius(inherited, 'C', .77)).toBeCloseTo(1.1 * .45 * 1.5)

    const inheritedStick = resolveBioAtomicGeometry({
      representation: 'inherit',
      scale: 2,
      bondScale: 3,
      globals: { ...globals, viewMode: 'stick' },
    })
    expect(inheritedStick.representation).toBe('sticks')
    expect(inheritedStick.hyperStick).toBe(false)
    expect(inheritedStick.bondRadius).toBeCloseTo(.36)
    expect(resolveBioAtomicElementRadius(inheritedStick, 'O', .74)).toBeCloseTo(.36)

    const inheritedHyperStick = resolveBioAtomicGeometry({
      representation: 'inherit', scale: 1, globals: { ...globals, viewMode: 'hyper-stick' },
    })
    expect(inheritedHyperStick.representation).toBe('sticks')
    expect(inheritedHyperStick.hyperStick).toBe(true)
  })

  it('keeps explicit ball-stick, stick, space-fill and line geometry source-exact', () => {
    const ball = resolveBioAtomicGeometry({ representation: 'ball-and-stick', scale: 2, bondScale: .5, globals })
    expect(resolveBioAtomicElementRadius(ball, 'N', .74)).toBeCloseTo(.74 * .45 * 2)
    expect(ball.bondRadius).toBeCloseTo(.06)
    expect(ball.drawAtoms).toBe(true)
    expect(ball.drawBonds).toBe(true)

    const stick = resolveBioAtomicGeometry({ representation: 'sticks', scale: 2, bondScale: .5, globals })
    expect(resolveBioAtomicElementRadius(stick, 'N', .74)).toBeCloseTo(.06)

    const spacefill = resolveBioAtomicGeometry({ representation: 'space-filling', scale: .55, globals })
    expect(resolveBioAtomicElementRadius(spacefill, 'Zn', getDefaultCrystalElementVisual('Zn').radius)).toBeCloseTo(1.22 * .55)
    expect(spacefill.drawBonds).toBe(false)

    const lines = resolveBioAtomicGeometry({ representation: 'lines', scale: 1, globals })
    expect(lines.drawAtoms).toBe(false)
    expect(lines.drawBonds).toBe(true)
  })

  it('dims every non-highlight pass without multiplying already transparent layers below the source floor', () => {
    expect(bioFocusOpacity(.8, true)).toBe(.16)
    expect(bioFocusOpacity(.08, true)).toBe(.08)
    expect(bioFocusOpacity(.8, false)).toBe(.8)
  })

  it('描边宽度按视口高度折算,像素宽度不随视口变化', () => {
    // The same pixel width requires different NDC values at different viewport heights.
    expect(bioCartoonOutlineNdcWidth(2, 900)).toBeCloseTo(2 * BIO_OUTLINE_PIXELS_PER_STEP * 2 / 900)
    expect(bioCartoonOutlineNdcWidth(2, 450)).toBeCloseTo(bioCartoonOutlineNdcWidth(2, 900) * 2)
  })

  it('宽度换算与层缩放无关', () => {
    // Expansion occurs in clip space after modelViewMatrix already includes layer scaling, so a
    // second layerScale factor would overcompensate.
    expect(bioCartoonOutlineNdcWidth.length).toBe(2)
  })

  it('非法输入退化为不外扩,而不是产生 NaN 顶点', () => {
    // A NaN uWidth would make every outline vertex NaN and remove the mesh from view.
    expect(bioCartoonOutlineNdcWidth(Number.NaN, 900)).toBe(0)
    expect(bioCartoonOutlineNdcWidth(-1, 900)).toBe(0)
    expect(Number.isFinite(bioCartoonOutlineNdcWidth(2, 0))).toBe(true)
  })
})
