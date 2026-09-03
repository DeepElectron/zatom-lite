import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applyBioRigidTransform,
  applyBioRigidTransformToPoint,
  BioSuperpositionError,
  pairBioRepresentativeAtoms,
  superposeBioStructures,
  type BioRigidTransform,
} from "../lib/biomolecule/superposition"
import type { BioStructure, BioVector3 } from "../lib/biomolecule/types"
import { alignRcsbPdbStructure } from "../services/biomolecule-alignment"

function structure(id: string, points: readonly BioVector3[], insertionCodes: readonly string[] = []): BioStructure {
  const atoms = points.map((position, index) => ({
    id: `${id}:atom:${index}`,
    index,
    serial: index + 1,
    recordType: "ATOM" as const,
    name: "CA",
    element: "C",
    position,
    occupancy: 1,
    bFactor: 0,
    formalCharge: null,
    alternateLocation: "",
    residueIndex: index,
  }))
  const center: BioVector3 = [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
    points.reduce((sum, point) => sum + point[2], 0) / points.length,
  ]
  return {
    id,
    title: id,
    format: "pdb",
    atoms,
    residues: atoms.map((_atom, index) => ({
      id: `${id}:residue:${index}`,
      index,
      name: "ALA",
      identity: { chainId: "A", sequenceNumber: index + 1, insertionCode: insertionCodes[index] ?? "" },
      chainIndex: 0,
      atomStart: index,
      atomEnd: index + 1,
      atomIndices: [index],
      representativeAtomIndex: index,
      backboneOxygenIndex: null,
      isStandard: true,
      secondaryStructure: "coil",
      secondaryStructureSource: "none",
    })),
    chains: [{ id: `${id}:chain:A`, index: 0, identifier: "A", polymerType: "protein", residueIndices: atoms.map((atom) => atom.index) }],
    bonds: [],
    frames: [{
      modelNumber: 1,
      positions: new Float32Array(points.flatMap((point) => [...point])),
    }],
    ligands: [],
    center,
    radius: Math.max(...points.map((point) => Math.hypot(point[0] - center[0], point[1] - center[1], point[2] - center[2]))),
    bFactorSemantics: "temperature-factor",
    warnings: [],
  }
}

function determinant(matrix: readonly number[]): number {
  return (
    matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) -
    matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) +
    matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6])
  )
}

function expectProperRotation(rotation: readonly number[]): void {
  expect(determinant(rotation)).toBeCloseTo(1, 10)
  for (let left = 0; left < 3; left += 1) {
    for (let right = 0; right < 3; right += 1) {
      let dot = 0
      for (let row = 0; row < 3; row += 1) dot += rotation[row * 3 + left] * rotation[row * 3 + right]
      expect(dot).toBeCloseTo(left === right ? 1 : 0, 10)
    }
  }
}

describe("biomolecular representative-atom superposition", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("recovers a rigid transform without mutating either structure", () => {
    const reference = structure("reference", [[0, 0, 0], [2, 0, 0], [0, 3, 0], [0, 0, 4]])
    const forward: BioRigidTransform = {
      rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1],
      translation: [7, -2, 5],
    }
    const moving = applyBioRigidTransform(reference, forward)
    const originalMovingPosition = [...moving.atoms[0].position]

    const result = superposeBioStructures(reference, moving)

    expect(result.pairCount).toBe(4)
    expect(result.rmsd).toBeLessThan(1e-10)
    expectProperRotation(result.transform.rotation)
    expect(moving.atoms[0].position).toEqual(originalMovingPosition)
    result.transformedStructure.atoms.forEach((atom, index) => {
      expect(atom.position[0]).toBeCloseTo(reference.atoms[index].position[0], 10)
      expect(atom.position[1]).toBeCloseTo(reference.atoms[index].position[1], 10)
      expect(atom.position[2]).toBeCloseTo(reference.atoms[index].position[2], 10)
    })
    expect(result.transformedStructure).not.toBe(moving)
    expect(result.transformedStructure.frames[0].positions).not.toBe(moving.frames[0].positions)
  })

  it("supports a non-collinear planar point set", () => {
    const reference = structure("reference", [[0, 0, 0], [2, 0, 0], [0, 1, 0], [3, 2, 0]])
    const moving = applyBioRigidTransform(reference, {
      rotation: [1, 0, 0, 0, 0, -1, 0, 1, 0],
      translation: [-4, 8, 3],
    })
    const result = superposeBioStructures(reference, moving)
    expect(result.rmsd).toBeLessThan(1e-10)
    expectProperRotation(result.transform.rotation)
  })

  it("does not turn a reflection into an improper rotation", () => {
    const reference = structure("reference", [[0, 0, 0], [2, 0, 0], [0, 3, 0], [0, 0, 4]])
    const reflected = structure("reflected", reference.atoms.map((atom) => [-atom.position[0], atom.position[1], atom.position[2]]))
    const result = superposeBioStructures(reference, reflected)
    expectProperRotation(result.transform.rotation)
    expect(result.rmsd).toBeGreaterThan(0.5)
  })

  it("fails closed for a collinear or insufficient point set", () => {
    const collinear = structure("collinear", [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3]])
    expect(() => superposeBioStructures(collinear, collinear)).toThrowError(BioSuperpositionError)
    expect(() => superposeBioStructures(
      structure("two-a", [[0, 0, 0], [1, 0, 0]]),
      structure("two-b", [[0, 0, 0], [1, 0, 0]]),
    )).toThrow(/At least 3/)
  })

  it("pairs exact chain, residue number and insertion code only", () => {
    const reference = structure("reference", [[0, 0, 0], [1, 0, 0], [0, 1, 0]], ["", "A", ""])
    const moving = structure("moving", [[0, 0, 0], [1, 0, 0], [0, 1, 0]], ["", "B", ""])
    const pairs = pairBioRepresentativeAtoms(reference, moving)
    expect(pairs.map((pair) => pair.identity.sequenceNumber)).toEqual([1, 3])
  })

  it("excludes identity-matched non-polymer residues from the Kabsch fit", () => {
    const reference = structure("reference", [[0, 0, 0], [1, 0, 0], [0, 1, 0]])
    const moving = structure("moving", [[0, 0, 0], [1, 0, 0], [0, 1, 0]])
    reference.residues[1].isStandard = false
    moving.residues[1].isStandard = false
    expect(pairBioRepresentativeAtoms(reference, moving).map((pair) => pair.identity.sequenceNumber)).toEqual([1, 3])
  })

  it("applies the documented row-major transform convention", () => {
    const point = applyBioRigidTransformToPoint({
      rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1],
      translation: [10, 20, 30],
    }, [2, 3, 4])
    expect(point).toEqual([7, 22, 34])
  })

  it("loads a secondary RCSB entry through the bounded path and returns an honest identity alignment", async () => {
    const reference = structure("reference", [[0, 0, 0], [2, 0, 0], [0, 3, 0], [0, 0, 4]])
    const moving = applyBioRigidTransform(reference, {
      rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1],
      translation: [7, -2, 5],
    })
    const pdb = moving.atoms.map((atom, index) => {
      const residue = moving.residues[index]
      const [x, y, z] = atom.position
      return `${"ATOM".padEnd(6)}${String(index + 1).padStart(5)}  CA  ALA A${String(residue.identity.sequenceNumber).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00           C`
    }).concat("END").join("\n")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(pdb, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })))

    const result = await alignRcsbPdbStructure(reference, "1abc")

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.sourceLabel).toBe("1ABC.pdb")
    expect(result.method).toBe("exact-residue-identity")
    expect(result.pairCount).toBe(4)
    expect(result.rmsd).toBeLessThan(1e-3)
    expect(result.structure.atoms[0].position[0]).toBeCloseTo(reference.atoms[0].position[0], 3)
  })

  it("surfaces insufficient identity pairs instead of reporting a misleading RMSD", async () => {
    const reference = structure("reference", [[0, 0, 0], [2, 0, 0], [0, 3, 0], [0, 0, 4]])
    const pdb = [
      "ATOM      1  CA  ALA B   1       0.000   0.000   0.000  1.00  0.00           C",
      "ATOM      2  CA  ALA B   2       2.000   0.000   0.000  1.00  0.00           C",
      "ATOM      3  CA  ALA B   3       0.000   3.000   0.000  1.00  0.00           C",
      "END",
    ].join("\n")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(pdb, {
      status: 200,
      headers: { "Content-Type": "chemical/x-pdb" },
    })))

    await expect(alignRcsbPdbStructure(reference, "1abc")).resolves.toEqual({
      success: false,
      error: "At least 3 matching representative atoms are required; found 0",
    })
  })
})
