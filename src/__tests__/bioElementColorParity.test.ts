import { describe, expect, it } from 'vitest'

import { computeBioAtomColors, computeBioResidueColors } from '../lib/biomolecule/coloring'
import { getElement } from '../lib/crystal/elements'
import type { BioStructure } from '../lib/biomolecule/types'

/**
 * Biomolecular rendering once used PyMOL green for carbon while crystal rendering used Jmol gray,
 * making color depend on the loader. The same element must now have the same color on both paths.
 */

function structureWith(elements: string[]): BioStructure {
  return {
    atoms: elements.map((element, index) => ({
      element,
      residueIndex: index,
      bFactor: 0,
      position: [0, 0, 0] as const,
    })),
    residues: elements.map(() => ({})),
  } as unknown as BioStructure
}

describe('生物侧元素着色与晶体侧一致', () => {
  it('碳是 Jmol 灰,不再是 PyMOL 绿', () => {
    const [carbon] = computeBioAtomColors(structureWith(['C']), 'element')
    expect(carbon.toLowerCase()).toBe('#909090')
    expect(carbon.toLowerCase()).not.toBe('#33ff33')
  })

  it('常见生物元素逐个对齐 ELEMENTS', () => {
    const elements = ['H', 'C', 'N', 'O', 'S', 'P', 'Fe', 'Zn', 'Mg', 'Se']
    const colors = computeBioAtomColors(structureWith(elements), 'element')
    elements.forEach((element, index) => {
      expect(colors[index].toLowerCase()).toBe(getElement(element).color.toLowerCase())
    })
  })

  it('未知元素落到 getElement 的品红兜底', () => {
    const [unknown] = computeBioAtomColors(structureWith(['Xx']), 'element')
    expect(unknown.toLowerCase()).toBe('#ff00ff')
  })

  it('残基粒度按碳色填充,同样是灰', () => {
    const colors = computeBioResidueColors(structureWith(['C', 'N']), 'element')
    expect(colors).toHaveLength(2)
    for (const color of colors) {
      expect(color.toLowerCase()).toBe(getElement('C').color.toLowerCase())
    }
  })
})
