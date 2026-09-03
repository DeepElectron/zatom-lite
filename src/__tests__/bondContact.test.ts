import {
  calculateBondEndpointInset,
  outlinedAtomRadius,
  outlinedBondRadius,
} from '../lib/render/bond-contact'
import { assertTrue } from '../testing/assert'

function radialCoverage(atomRadius: number, inset: number): number {
  return Math.sqrt(Math.max(0, atomRadius * atomRadius - inset * inset))
}

function run() {
  const atomRadius = 0.34
  const bondRadius = 0.12

  const inset = calculateBondEndpointInset({ atomRadius, bondRadius })
  assertTrue(inset > 0 && inset < atomRadius, 'a normal bond must end inside the atom sphere')
  assertTrue(
    radialCoverage(atomRadius, inset) > bondRadius,
    'the sphere must cover the complete bond rim rather than only touch its centre line',
  )

  const outlineWidth = 2.4
  const outlinedInset = calculateBondEndpointInset({
    atomRadius,
    bondRadius,
    outline: true,
    outlineWidth,
  })
  const outerAtomRadius = outlinedAtomRadius(atomRadius, outlineWidth)
  const outerBondRadius = outlinedBondRadius(bondRadius, outlineWidth)
  assertTrue(
    radialCoverage(outerAtomRadius, outlinedInset) > outerBondRadius,
    'outlined atom and bond envelopes must overlap without a background halo',
  )

  const radialOffset = 0.075
  const offsetInset = calculateBondEndpointInset({
    atomRadius,
    bondRadius: bondRadius * 0.75,
    radialOffset,
    outline: true,
    outlineWidth,
  })
  assertTrue(
    radialCoverage(outerAtomRadius, offsetInset)
      > radialOffset + outlinedBondRadius(bondRadius * 0.75, outlineWidth),
    'offset double/triple-bond cylinders must also enter the sphere completely',
  )

  const wideInset = calculateBondEndpointInset({ atomRadius: 0.1, bondRadius: 0.2 })
  assertTrue(wideInset === 0, 'a bond wider than its atom must use the finite centre fallback')

  console.log('bond contact tests passed')
}

run()
