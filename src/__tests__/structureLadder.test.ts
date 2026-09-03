import { describe, expect, it } from 'vitest'
import {
  buildStructureLadder,
  ladderNode,
  ladderNodeAtomIds,
  ladderPath,
} from '../lib/biomolecule/structure-ladder'
import {
  DRILL_MAX_DURATION_MS,
  DRILL_MIN_DURATION_MS,
  drillLegDurationMs,
  drillStopsAreEquivalent,
  planDrillFlight,
  type DrillStop,
} from '../lib/render/drill-choreography'
import { runDrillFlight } from '../orchestration/drillNavigator'
import type {
  BioAtom,
  BioResidue,
  BioSecondaryStructure,
  BioStructure,
} from '../lib/biomolecule/types'

function atom(index: number, position: [number, number, number]): BioAtom {
  return {
    id: `a${index}`,
    index,
    serial: index + 1,
    recordType: 'ATOM',
    name: 'CA',
    element: 'C',
    position,
    occupancy: 1,
  } as unknown as BioAtom
}

function residue(
  index: number,
  chainIndex: number,
  sequenceNumber: number,
  atomIndices: number[],
  secondaryStructure: BioSecondaryStructure,
  source = 'pdb-record',
): BioResidue {
  return {
    id: `r${index}`,
    index,
    name: 'ALA',
    identity: { chainId: 'A', sequenceNumber, insertionCode: '' },
    chainIndex,
    atomStart: atomIndices[0],
    atomEnd: atomIndices[atomIndices.length - 1],
    atomIndices,
    representativeAtomIndex: atomIndices[0],
    backboneOxygenIndex: null,
    isStandard: true,
    secondaryStructure,
    secondaryStructureSource: source,
  } as BioResidue
}

/**
 * One six-residue chain with helix x3, coil x1, and helix x2. The element level should merge these
 * into three segments rather than six residues.
 */
function makeStructure(): BioStructure {
  const atoms: BioAtom[] = []
  for (let i = 0; i < 6; i += 1) atoms.push(atom(i, [i * 2, 0, 0]))
  const kinds: BioSecondaryStructure[] = ['helix', 'helix', 'helix', 'coil', 'helix', 'helix']
  const residues = kinds.map((kind, i) => residue(i, 0, 100 + i, [i], kind))
  return {
    id: 's1',
    title: '测试结构',
    format: 'pdb',
    atoms,
    residues,
    chains: [
      {
        id: 'c0',
        index: 0,
        identifier: 'A',
        polymerType: 'protein',
        residueIndices: [0, 1, 2, 3, 4, 5],
      },
    ],
    bonds: [],
    frames: [],
    ligands: [],
    center: [5, 0, 0],
    radius: 6,
    bFactorSemantics: 'temperature-factor',
    warnings: [],
  } as BioStructure
}

describe('buildStructureLadder', () => {
  it('把连续同类残基合并成一个元件,而不是每残基一段', () => {
    const ladder = buildStructureLadder(makeStructure())
    const chain = ladder.nodes.get('chain:A')
    expect(chain).toBeDefined()
    // helix(3) + coil(1) + helix(2) gives three segments.
    expect(chain!.childIds).toHaveLength(3)
    const kinds = chain!.childIds.map((id) => ladder.nodes.get(id)!.secondaryStructure)
    expect(kinds).toEqual(['helix', 'coil', 'helix'])
  })

  it('层级链自上而下完整,且原子层可现算', () => {
    const structure = makeStructure()
    const ladder = buildStructureLadder(structure)
    const firstElement = ladder.nodes.get('chain:A')!.childIds[0]
    const firstResidue = ladder.nodes.get(firstElement)!.childIds[0]
    const firstAtom = ladder.nodes.get(firstResidue)!.childIds[0]

    // Atom nodes are generated on demand rather than prebuilt.
    expect(ladder.nodes.has(firstAtom)).toBe(false)
    expect(ladderNode(structure, ladder, firstAtom)).not.toBeNull()

    const path = ladderPath(structure, ladder, firstAtom)
    expect(path.map((n) => n.level)).toEqual([
      'assembly',
      'chain',
      'element',
      'residue',
      'atom',
    ])
  })

  it('半径有非零下限,避免相机 spread 收敛到 0', () => {
    const structure = makeStructure()
    const ladder = buildStructureLadder(structure)
    for (const node of ladder.nodes.values()) {
      expect(node.radius).toBeGreaterThan(0)
    }
    const residueId = ladderPath(structure, ladder, 'chain:A').at(-1)!.childIds[0]
    const single = ladderNode(structure, ladder, ladder.nodes.get(residueId)!.childIds[0])
    // Clamp a single-atom residue's zero bounding radius to the minimum.
    expect(single!.radius).toBeGreaterThan(0)
  })

  it('原子 id 与结构一致,可直接交给 3D 选中', () => {
    const structure = makeStructure()
    const ladder = buildStructureLadder(structure)
    const ids = ladderNodeAtomIds(structure, ladder.nodes.get('assembly')!)
    expect(ids).toEqual(structure.atoms.map((a) => a.id))
  })

  it('一段内混合标注来源时降级为 mixed,不谎称 PDB 记录', () => {
    const structure = makeStructure()
    // Mark the second residue in one helix segment as geometry-estimated.
    structure.residues[1].secondaryStructureSource = 'geometry-estimate'
    const ladder = buildStructureLadder(structure)
    const firstElement = ladder.nodes.get('chain:A')!.childIds[0]
    expect(ladder.nodes.get(firstElement)!.secondaryStructureSource).toBe('mixed')
  })

  it('原子标签用 PDB 原子名而非元素符号,元素与序号降为副标题', () => {
    const structure = makeStructure()
    const ladder = buildStructureLadder(structure)
    // Follow first children to atom level without coupling to a fixed number of hierarchy levels.
    let node = ladderNode(structure, ladder, 'chain:A')!
    while (node.level !== 'atom') {
      node = ladderNode(structure, ladder, node.childIds[0])!
    }
    const atom = node
    // Atom name CA, not element C, distinguishes alpha from beta carbons.
    expect(atom.label).toBe('CA')
    expect(atom.detail).toContain('C')
    expect(atom.childIds).toEqual([])
  })

  it('空白链标识符不产生空标签', () => {
    const structure = makeStructure()
    structure.chains[0].identifier = ''
    const ladder = buildStructureLadder(structure)
    expect(ladder.nodes.get('chain:_')!.label).toContain('blank')
  })
})

describe('drillLegDurationMs', () => {
  it('跨度越大时长越长,但都在钳位区间内', () => {
    const big = drillLegDurationMs(40, 2)
    const small = drillLegDurationMs(4, 3.5)
    expect(big).toBeGreaterThan(small)
    for (const d of [big, small, drillLegDurationMs(1e6, 1e-6)]) {
      expect(d).toBeGreaterThanOrEqual(DRILL_MIN_DURATION_MS)
      expect(d).toBeLessThanOrEqual(DRILL_MAX_DURATION_MS)
    }
  })

  it('方向无关:放大与缩小同跨度同时长', () => {
    expect(drillLegDurationMs(40, 4)).toBeCloseTo(drillLegDurationMs(4, 40), 6)
  })

  it('零半径不产生 NaN/Infinity', () => {
    expect(Number.isFinite(drillLegDurationMs(0, 0))).toBe(true)
  })
})

describe('planDrillFlight', () => {
  const stop = (radius: number, x = 0): DrillStop => ({
    center: [x, 0, 0],
    radius,
    label: `r${radius}`,
  })

  it('跨多级压成一次连续飞行,而不是逐级停顿', () => {
    const legs = planDrillFlight([stop(40), stop(12, 5), stop(4, 8), stop(1.5, 10)])
    // A four-level path produces one continuous flight rather than staged stops.
    expect(legs).toHaveLength(1)
    expect(legs[0].center[0]).toBe(10)
  })

  it('时长按首尾总跨度算,不是相邻级跨度', () => {
    const full = planDrillFlight([stop(40), stop(1.5, 10)])[0]
    expect(full.durationMs).toBeCloseTo(drillLegDurationMs(40, 1.5), 6)
  })

  it('减弱动效下仍到达同一终点,只是 0ms', () => {
    const legs = planDrillFlight([stop(40), stop(1.5, 10)], { reducedMotion: true })
    expect(legs).toHaveLength(1)
    expect(legs[0].durationMs).toBe(0)
    // Reduced motion still lands at the target.
    expect(legs[0].center[0]).toBe(10)
  })

  it('取景留余量,不把周边参照物全切掉', () => {
    const legs = planDrillFlight([stop(40), stop(2, 10)])
    expect(legs[0].spread).toBeGreaterThan(2)
  })

  it('路径不足两级时不产生飞行', () => {
    expect(planDrillFlight([stop(10)])).toEqual([])
  })
})

describe('drillStopsAreEquivalent', () => {
  it('噪声级差异视为同一落点,避免无意义抖动', () => {
    expect(drillStopsAreEquivalent(
      { center: [0, 0, 0], radius: 10, label: 'a' },
      { center: [0.05, 0, 0], radius: 10.01, label: 'b' },
    )).toBe(true)
  })

  it('真实位移不被误判为等价', () => {
    expect(drillStopsAreEquivalent(
      { center: [0, 0, 0], radius: 10, label: 'a' },
      { center: [8, 0, 0], radius: 2, label: 'b' },
    )).toBe(false)
  })
})

describe('runDrillFlight 手动接管', () => {
  /**
   * Minimal store implementing only navigator inputs. focusOnPoint immediately ends animation so
   * tests do not wait for the real 1.2-second flight.
   */
  function makeApi(onFocus: (legIndex: number) => void) {
    let legIndex = 0
    const state = {
      isAnimatingCamera: false,
      cameraFlightInterruptions: 0,
      focusOnPoint: () => {
        onFocus(legIndex)
        legIndex += 1
      },
    }
    return {
      getState: () => state,
      state,
    }
  }

  const path: DrillStop[] = [
    { center: [0, 0, 0], radius: 40, label: '装配体' },
    { center: [10, 0, 0], radius: 12, label: 'A链' },
    { center: [12, 1, 0], radius: 4, label: '螺旋' },
    { center: [12, 1.5, 0], radius: 1.2, label: '残基' },
  ]

  it('跨四级压成一次连续飞行,并如实上报落地', async () => {
    const focused: number[] = []
    const settled: string[] = []
    const api = makeApi((index) => focused.push(index))
    const outcome = await runDrillFlight(api as never, {
      path,
      onLegSettled: (stop) => settled.push(stop.label),
    })

    expect(outcome).toBe('completed')
    // Emit one focus; intermediate levels guide framing without creating stop-start motion.
    expect(focused).toEqual([0])
    // The landing callback carries the final target for correct breadcrumbs.
    expect(settled).toEqual(['残基'])
  })

  it('被手动接管时不谎报落地', async () => {
    const settled: string[] = []
    const api = makeApi(() => {
      // Simulate pointer takeover interrupting the camera flight.
      api.state.cameraFlightInterruptions += 1
    })

    const outcome = await runDrillFlight(api as never, {
      path,
      onLegSettled: (stop) => settled.push(stop.label),
    })

    expect(outcome).toBe('interrupted')
    // Interrupted flights must not report landing or advance breadcrumbs to a false location.
    expect(settled).toEqual([])
  })
})
