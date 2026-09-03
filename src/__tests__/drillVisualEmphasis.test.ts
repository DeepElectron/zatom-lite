import { describe, expect, it } from 'vitest'
import { buildStructureLadder } from '../lib/biomolecule/structure-ladder'
import * as THREE from 'three'
import { drillEmphasisForLevel, fadeUnfocusedColors } from '../lib/biomolecule/drill-emphasis'
import { computeBioAtomColors } from '../lib/biomolecule/coloring'
import { adaptiveBioPresentation } from '../lib/biomolecule/default-presentation'
import type {
  BioAtom,
  BioChain,
  BioResidue,
  BioSecondaryStructure,
  BioStructure,
} from '../lib/biomolecule/types'

function atom(index: number, element = 'C'): BioAtom {
  return {
    id: `a${index}`,
    index,
    serial: index + 1,
    recordType: 'ATOM',
    name: 'CA',
    element,
    position: [index * 2, 0, 0],
    occupancy: 1,
  } as unknown as BioAtom
}

function residue(
  index: number,
  name: string,
  chainIndex: number,
  atomIndices: number[],
  secondaryStructure: BioSecondaryStructure,
  isStandard: boolean,
): BioResidue {
  return {
    id: `r${index}`,
    index,
    name,
    identity: { chainId: 'A', sequenceNumber: index + 1, insertionCode: '' },
    chainIndex,
    atomStart: atomIndices[0],
    atomEnd: atomIndices[atomIndices.length - 1],
    atomIndices,
    representativeAtomIndex: atomIndices[0],
    backboneOxygenIndex: null,
    isStandard,
    secondaryStructure,
    secondaryStructureSource: 'pdb-record',
  } as BioResidue
}

function structureOf(residues: BioResidue[], chains: BioChain[]): BioStructure {
  const atomCount = residues.reduce((total, r) => total + r.atomIndices.length, 0)
  return {
    id: 's',
    title: 'fixture',
    format: 'pdb',
    atoms: Array.from({ length: atomCount }, (_, i) => atom(i)),
    residues,
    chains,
    bonds: [],
    frames: [],
    ligands: [],
    center: [0, 0, 0],
    radius: 10,
    bFactorSemantics: 'temperature-factor',
    warnings: [],
  } as BioStructure
}

function chain(index: number, identifier: string, polymerType: string, residueIndices: number[]): BioChain {
  return { id: `c${index}`, index, identifier, polymerType, residueIndices } as unknown as BioChain
}

/**
 * One nucleic-acid chain with three bases and three waters.
 *
 * Nonstandard water receives coil secondary structure and can incorrectly merge with the terminal
 * polymer coil, which this fixture reproduces.
 */
function nucleicWithWater(): BioStructure {
  const residues = [
    residue(0, 'DC', 0, [0], 'coil', true),
    residue(1, 'DG', 0, [1], 'coil', true),
    residue(2, 'DA', 0, [2], 'coil', true),
    residue(3, 'HOH', 0, [3], 'coil', false),
    residue(4, 'HOH', 0, [4], 'coil', false),
    residue(5, 'HOH', 0, [5], 'coil', false),
  ]
  return structureOf(residues, [chain(0, 'A', 'nucleic', [0, 1, 2, 3, 4, 5])])
}

describe('阶梯的水分子折叠', () => {
  it('把水收进单个 Water 节点,而不是逐个铺在链下', () => {
    const ladder = buildStructureLadder(nucleicWithWater())
    const chainNode = ladder.nodes.get('chain:A')!

    // Three bases form one coil element and three waters collapse into one Water node.
    expect(chainNode.childIds).toHaveLength(2)

    const waterNode = chainNode.childIds
      .map((id) => ladder.nodes.get(id)!)
      .find((node) => node.label.startsWith('Water'))
    expect(waterNode).toBeDefined()
    expect(waterNode!.label).toBe('Water · 3')
  })

  it('水节点可展开可下钻:保留完整的子节点与原子索引', () => {
    const ladder = buildStructureLadder(nucleicWithWater())
    const waterNode = ladder.nodes.get('chain:A/element:water:0')!

    // Collapsing organizes water without discarding potentially relevant coordination.
    expect(waterNode.childIds).toHaveLength(3)
    expect(waterNode.atomIndices).toEqual([3, 4, 5])
    for (const childId of waterNode.childIds) {
      expect(ladder.nodes.get(childId)).toBeDefined()
    }
  })

  it('水不再污染二级结构元件的残基跨度', () => {
    const ladder = buildStructureLadder(nucleicWithWater())
    const polymerElement = ladder.nodes
      .get('chain:A')!
      .childIds.map((id) => ladder.nodes.get(id)!)
      .find((node) => !node.label.startsWith('Water'))!

    // Excluding water prevents a false span such as DC1-HOH102 across unrelated residues.
    expect(polymerElement.detail).not.toContain('HOH')
    expect(polymerElement.childIds).toHaveLength(3)
  })

  it('水节点不冒充二级结构', () => {
    const ladder = buildStructureLadder(nucleicWithWater())
    const waterNode = ladder.nodes.get('chain:A/element:water:0')!
    // Water must not receive coil coloring or a secondary-structure source badge.
    expect(waterNode.secondaryStructure).toBeNull()
    expect(waterNode.secondaryStructureSource).toBeNull()
  })
})

describe('下钻分层强调', () => {
  it('链/元件层只淡化其余部分,不叠原子几何', () => {
    for (const level of ['chain', 'element'] as const) {
      const emphasis = drillEmphasisForLevel(level)
      expect(emphasis.fadeOthers).toBe(true)
      // Chain and element levels can contain thousands of atoms; cartoon alone is clearer and faster.
      expect(emphasis.overlay).toBeNull()
    }
  })

  it('残基/原子层叠 ball-and-stick,让元素可辨', () => {
    for (const level of ['residue', 'atom'] as const) {
      const emphasis = drillEmphasisForLevel(level)
      expect(emphasis.fadeOthers).toBe(true)
      expect(emphasis.overlay).toBe('ball-and-stick')
    }
  })

  it('未下钻和装配体层完全不干预呈现', () => {
    for (const level of [null, 'assembly'] as const) {
      const emphasis = drillEmphasisForLevel(level)
      // Assembly level includes everything, so there is no unfocused remainder to fade.
      expect(emphasis.fadeOthers).toBe(false)
      expect(emphasis.overlay).toBeNull()
    }
  })

  /*
   * PDB drill-down once showed a large axis-aligned frame resembling a crystal cell despite
   * periodic=false. Spatial anchors are useful only at deep levels where few atoms remain visible.
   */
  it('只有残基/原子层画空间锚,浅层不画', () => {
    for (const level of ['residue', 'atom'] as const) {
      expect(drillEmphasisForLevel(level).spatialAnchor).toBe(true)
    }
    // Chain and element views already show their assembly context, so a frame adds only noise.
    for (const level of [null, 'assembly', 'chain', 'element'] as const) {
      expect(drillEmphasisForLevel(level).spatialAnchor).toBe(false)
    }
  })
})

describe('非聚焦部分淡化', () => {
  const RED = '#ff0000'

  it('聚焦条目原色不变,非聚焦条目被推离原色', () => {
    const faded = fadeUnfocusedColors([RED, RED], '#ffffff', .16, (index) => index === 0)
    // Focused colors remain byte-for-byte unchanged across drill levels.
    expect(faded[0]).toBe(RED)
    expect(faded[1]).not.toBe(RED)
  })

  it('混向的是实际背景色,而非固定灰', () => {
    // Fade toward the actual background; white would emphasize rather than recede on dark themes.
    const onLight = fadeUnfocusedColors([RED], '#ffffff', .16, () => false)[0]
    const onDark = fadeUnfocusedColors([RED], '#000000', .16, () => false)[0]
    expect(onLight).not.toBe(onDark)
    const lightness = (style: string) => {
      const [r, g, b] = style.match(/\d+/g)!.map(Number)
      return r + g + b
    }
    // Fading becomes lighter on light backgrounds and darker on dark backgrounds.
    expect(lightness(onLight)).toBeGreaterThan(lightness(onDark))
  })

  it('保留比例为 0 时完全并入背景', () => {
    const faded = fadeUnfocusedColors([RED], '#0000ff', 0, () => false)[0]
    expect(new THREE.Color(faded).getHex()).toBe(0x0000ff)
  })
})

describe('内容自适应默认观感', () => {
  function proteinChains(count: number): BioStructure {
    const residues: BioResidue[] = []
    const chains: BioChain[] = []
    for (let c = 0; c < count; c += 1) {
      residues.push(residue(c, 'ALA', c, [c], 'helix', true))
      chains.push(chain(c, String.fromCharCode(65 + c), 'protein', [c]))
    }
    return structureOf(residues, chains)
  }

  it('多链改用分链色板,让亚基分得开', () => {
    // Per-chain viridis normalization repeats blue-to-yellow on every chain and obscures subunits.
    expect(adaptiveBioPresentation(proteinChains(4)).bioColorScheme).toBe('chain-publication')
  })

  it('单链保留 viridis 的 N→C 方向提示', () => {
    expect(adaptiveBioPresentation(proteinChains(1)).bioColorScheme).toBe('viridis')
  })

  it('adds sticks for pure nucleic acid so bases remain visible', () => {
    // Nucleic cartoon shows only the backbone; sticks preserve bases and pairing.
    expect(adaptiveBioPresentation(nucleicWithWater()).bioShowSticks).toBe(true)
  })

  it('蛋白-核酸复合物不开 sticks', () => {
    const residues = [
      residue(0, 'ALA', 0, [0], 'helix', true),
      residue(1, 'DC', 1, [1], 'coil', true),
    ]
    const complex = structureOf(residues, [
      chain(0, 'A', 'protein', [0]),
      chain(1, 'B', 'nucleic', [1]),
    ])
    // Sticks affect the whole polymer channel and would overload mixed protein complexes.
    expect(adaptiveBioPresentation(complex).bioShowSticks).toBe(false)
  })

  it('预测结构按 pLDDT 上色,且多链时也不退回分链色板', () => {
    // Predicted structures prioritize per-atom confidence over chain count.
    const predicted = { ...proteinChains(3), bFactorSemantics: 'plddt' } as BioStructure
    expect(adaptiveBioPresentation(predicted).bioColorScheme).toBe('plddt')
  })

  it('实验结构不会被误判成 pLDDT', () => {
    // Experimental B-factors are temperature factors and must not use the pLDDT color scale.
    expect(adaptiveBioPresentation(proteinChains(1)).bioColorScheme).not.toBe('plddt')
  })

  it('自适应选出的配色方案一定能真的上色', () => {
    // coloring.ts rejects pLDDT coloring without matching semantics, so adaptive choices must be valid.
    const cases: BioStructure[] = [
      proteinChains(1),
      proteinChains(4),
      { ...proteinChains(2), bFactorSemantics: 'plddt' } as BioStructure,
    ]
    for (const structure of cases) {
      const { bioColorScheme } = adaptiveBioPresentation(structure)
      expect(() => computeBioAtomColors(structure, bioColorScheme)).not.toThrow()
    }
  })

  it('纯配体容器链不影响 cartoon 配色决策', () => {
    // `other` chains use ligand/ion channels and must not make a single cartoon chain look multichain.
    const residues = [
      residue(0, 'ALA', 0, [0], 'helix', true),
      residue(1, 'HEM', 1, [1], 'coil', false),
    ]
    const withLigand = structureOf(residues, [
      chain(0, 'A', 'protein', [0]),
      chain(1, 'B', 'other', [1]),
    ])
    expect(adaptiveBioPresentation(withLigand).bioColorScheme).toBe('viridis')
  })
})
