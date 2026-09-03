import { describe, expect, it } from "vitest"
import {
  collectQualitativeResiduePointCharges,
  computeBioAtomColors,
  computeQualitativeCoulombPotentialAtAtoms,
} from "../lib/biomolecule/coloring"
import { detectBioCandidateInteractions } from "../lib/biomolecule/interactions"
import { capBioCandidateInteractions } from "../ui/components/crystal-viewer/biomolecule-layer"
import { parseLegacyPdb } from "../lib/biomolecule/pdb"

function atomLine(options: {
  record?: "ATOM" | "HETATM"
  serial: number
  name: string
  residue: string
  chain: string
  sequence: number
  x: number
  y: number
  z: number
  bFactor?: number
  element: string
}): string {
  return `${(options.record ?? "ATOM").padEnd(6)}${String(options.serial).padStart(5)} ${options.name.padStart(4)} ${options.residue.padStart(3)} ${options.chain}${String(options.sequence).padStart(4)}    ${options.x.toFixed(3).padStart(8)}${options.y.toFixed(3).padStart(8)}${options.z.toFixed(3).padStart(8)}${"1.00".padStart(6)}${(options.bFactor ?? 0).toFixed(2).padStart(6)}          ${options.element.padStart(2)}`
}

function conect(source: number, ...targets: number[]): string {
  return `CONECT${String(source).padStart(5)}${targets.map((target) => String(target).padStart(5)).join("")}`
}

describe("honest biomolecular science contracts", () => {
  it("caps candidate contact rendering deterministically", () => {
    const contacts = [
      { type: "salt-bridge-candidate" as const, distance: 4, atomIndex1: 4, atomIndex2: 5, residueIndex1: 1, residueIndex2: 2, start: [0, 0, 0] as const, end: [4, 0, 0] as const, qualification: "distance-and-atom-type-only" as const },
      { type: "hydrogen-bond-candidate" as const, distance: 3.4, atomIndex1: 2, atomIndex2: 3, residueIndex1: 1, residueIndex2: 2, start: [0, 0, 0] as const, end: [3.4, 0, 0] as const, qualification: "distance-and-atom-type-only" as const },
      { type: "hydrogen-bond-candidate" as const, distance: 2.8, atomIndex1: 0, atomIndex2: 1, residueIndex1: 0, residueIndex2: 1, start: [0, 0, 0] as const, end: [2.8, 0, 0] as const, qualification: "distance-and-atom-type-only" as const },
    ]
    const capped = capBioCandidateInteractions(contacts, 2)
    expect(capped).toMatchObject({ total: 3, truncated: 1 })
    expect(capped.items.map((contact) => contact.distance)).toEqual([2.8, 3.4])
  })
  it("requires pLDDT provenance before using confidence colors", () => {
    const pdb = atomLine({ serial: 1, name: "CA", residue: "ALA", chain: "A", sequence: 1, x: 0, y: 0, z: 0, bFactor: 95, element: "C" })
    const temperature = parseLegacyPdb(pdb, { id: "1ABC", inferBonds: false })
    expect(() => computeBioAtomColors(temperature, "plddt")).toThrow(/requires/)
    const predicted = parseLegacyPdb(pdb, { id: "AF-TEST", inferBonds: false })
    expect(computeBioAtomColors(predicted, "plddt")).toEqual(["#0053d6"])
  })

  it("keeps qualitative charge deliberately residue-scoped and sign-consistent", () => {
    const structure = parseLegacyPdb(
      [
        atomLine({ serial: 1, name: "OD1", residue: "ASP", chain: "A", sequence: 1, x: -4, y: 0, z: 0, element: "O" }),
        atomLine({ serial: 2, name: "OD2", residue: "ASP", chain: "A", sequence: 1, x: -3, y: 0, z: 0, element: "O" }),
        atomLine({ serial: 3, name: "NZ", residue: "LYS", chain: "B", sequence: 2, x: 4, y: 0, z: 0, element: "N" }),
      ].join("\n"),
      { inferBonds: false },
    )
    const charges = collectQualitativeResiduePointCharges(structure)
    expect(charges.reduce((sum, charge) => sum + charge.charge, 0)).toBeCloseTo(0)
    const potential = computeQualitativeCoulombPotentialAtAtoms(structure)
    expect(potential[0]).toBeLessThan(0)
    expect(potential[2]).toBeGreaterThan(0)
    const colors = computeBioAtomColors(structure, "qualitative-coulomb-potential")
    expect(Number.parseInt(colors[0].slice(1, 3), 16)).toBeGreaterThan(Number.parseInt(colors[0].slice(5, 7), 16))
    expect(Number.parseInt(colors[2].slice(5, 7), 16)).toBeGreaterThan(Number.parseInt(colors[2].slice(1, 3), 16))
  })

  it("keeps all six N-to-C palettes distinct and endpoint-stable", () => {
    const structure = parseLegacyPdb(
      Array.from({ length: 5 }, (_, index) => atomLine({
        serial: index + 1,
        name: "CA",
        residue: "ALA",
        chain: "A",
        sequence: index + 1,
        x: index * 3.8,
        y: 0,
        z: 0,
        element: "C",
      })).join("\n"),
      { inferBonds: false },
    )
    const schemes = [
      "viridis", "sequence-sunset", "sequence-ocean", "sequence-muted", "sequence-mono", "sequence-spectrum",
    ] as const
    const ramps = schemes.map((scheme) => computeBioAtomColors(structure, scheme))
    expect(new Set(ramps.map((ramp) => ramp.join(","))).size).toBe(schemes.length)
    expect(ramps[0]).toEqual(["#440154", "#3a528b", "#20918d", "#5ec962", "#fde725"])
    expect(ramps[4][0]).toBe("#252628")
    expect(ramps[4][4]).toBe("#e8e9ea")
    expect(ramps[5][0]).toBe("#2b2bee")
    expect(ramps[5][2]).toBe("#2bee2b")
    expect(ramps[5][4]).toBe("#ee2b2b")
  })

  it("keeps the publication chain palette per-chain and disjoint from the analysis palette", () => {
    // Three chains with two residues each test both within-chain and between-chain colors.
    const structure = parseLegacyPdb(
      ["A", "B", "C"].flatMap((chain, chainOffset) => [0, 1].map((residueOffset) => atomLine({
        serial: chainOffset * 2 + residueOffset + 1,
        name: "CA",
        residue: "ALA",
        chain,
        sequence: residueOffset + 1,
        x: chainOffset * 10 + residueOffset,
        y: 0,
        z: 0,
        element: "C",
      }))).join("\n"),
      { inferBonds: false },
    )
    const publication = computeBioAtomColors(structure, "chain-publication")
    const analysis = computeBioAtomColors(structure, "chain")

    // Publication colors remain constant within a chain rather than forming a sequence gradient.
    expect(publication[0]).toBe(publication[1])
    expect(publication[2]).toBe(publication[3])
    // Distinct chains must remain distinguishable in publication figures.
    expect(new Set([publication[0], publication[2], publication[4]]).size).toBe(3)
    // The publication palette is additive and must not replace the analysis palette.
    expect(new Set(publication).size).toBe(3)
    for (const index of [0, 2, 4]) expect(publication[index]).not.toBe(analysis[index])
  })

  it("keeps source-specific B-factor, hydrophobicity and residue-charge palettes separate", () => {
    const structure = parseLegacyPdb([
      atomLine({ serial: 1, name: "CA", residue: "ASP", chain: "A", sequence: 1, x: 0, y: 0, z: 0, bFactor: 0, element: "C" }),
      atomLine({ serial: 2, name: "CA", residue: "GLY", chain: "A", sequence: 2, x: 3.8, y: 0, z: 0, bFactor: 50, element: "C" }),
      atomLine({ serial: 3, name: "CA", residue: "LYS", chain: "A", sequence: 3, x: 7.6, y: 0, z: 0, bFactor: 100, element: "C" }),
    ].join("\n"), { inferBonds: false })
    expect(computeBioAtomColors(structure, "b-factor")).toEqual(["#334dff", "#ffffff", "#ff4d33"])
    expect(computeBioAtomColors(structure, "qualitative-residue-charge")).toEqual(["#cc2a1e", "#f0f0f0", "#2757c9"])
    expect(computeBioAtomColors(structure, "hydrophobicity")[1]).toBe("#eef1fa")
  })

  it("reports only ligand-protein candidates for ligand-protein scope", () => {
    const structure = parseLegacyPdb(
      [
        atomLine({ serial: 1, name: "NZ", residue: "LYS", chain: "A", sequence: 1, x: 0, y: 0, z: 0, element: "N" }),
        atomLine({ record: "HETATM", serial: 2, name: "O1", residue: "LIG", chain: "A", sequence: 2, x: 3, y: 0, z: 0, element: "O" }),
        atomLine({ record: "HETATM", serial: 3, name: "C1", residue: "LIG", chain: "A", sequence: 2, x: 3.5, y: 0, z: 0, element: "C" }),
        atomLine({ record: "HETATM", serial: 4, name: "O1", residue: "DRG", chain: "A", sequence: 3, x: 0, y: 3, z: 0, element: "O" }),
        atomLine({ record: "HETATM", serial: 5, name: "C1", residue: "DRG", chain: "A", sequence: 3, x: 0, y: 3.5, z: 0, element: "C" }),
      ].join("\n"),
      { inferBonds: false },
    )
    const candidates = detectBioCandidateInteractions(structure, {
      hydrogenBonds: true,
      saltBridges: false,
      piStacking: false,
      scope: "ligand-protein",
    })
    expect(candidates).toHaveLength(2)
    expect(candidates.every((candidate) => candidate.qualification === "distance-and-atom-type-only")).toBe(true)
    expect(candidates.every((candidate) => [candidate.residueIndex1, candidate.residueIndex2].includes(0))).toBe(true)
  })

  it("keeps ligand-protein salt bridges reachable without overstating their provenance", () => {
    const structure = parseLegacyPdb(
      [
        atomLine({ serial: 1, name: "NZ", residue: "LYS", chain: "A", sequence: 1, x: 0, y: 0, z: 0, element: "N" }),
        atomLine({ record: "HETATM", serial: 2, name: "O1", residue: "LIG", chain: "L", sequence: 1, x: 3.2, y: 0, z: 0, element: "O" }),
        atomLine({ record: "HETATM", serial: 3, name: "C1", residue: "LIG", chain: "L", sequence: 1, x: 4.4, y: 0, z: 0, element: "C" }),
      ].join("\n"),
      { inferBonds: false },
    )
    const candidates = detectBioCandidateInteractions(structure, {
      hydrogenBonds: true,
      saltBridges: true,
      piStacking: false,
      scope: "ligand-protein",
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      type: "salt-bridge-candidate",
      qualification: "distance-and-formal-charge-or-atom-type",
    })
  })

  it("detects a planar bonded ligand ring against a protein aromatic ring", () => {
    const hexagon = [
      [1, 0], [.5, .866], [-.5, .866], [-1, 0], [-.5, -.866], [.5, -.866],
    ] as const
    const proteinNames = ["CG", "CD1", "CD2", "CE1", "CE2", "CZ"]
    const lines = [
      ...hexagon.map(([x, y], index) => atomLine({
        serial: index + 1, name: proteinNames[index], residue: "PHE", chain: "A", sequence: 1,
        x, y, z: 0, element: "C",
      })),
      ...hexagon.map(([x, y], index) => atomLine({
        record: "HETATM", serial: index + 7, name: `C${index + 1}`, residue: "LIG", chain: "L", sequence: 1,
        x, y, z: 3.5, element: "C",
      })),
      conect(7, 8, 12), conect(8, 9), conect(9, 10), conect(10, 11), conect(11, 12),
    ]
    const structure = parseLegacyPdb(lines.join("\n"), { inferBonds: false })
    const candidates = detectBioCandidateInteractions(structure, {
      hydrogenBonds: false,
      saltBridges: false,
      piStacking: true,
      scope: "ligand-protein",
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].type).toBe("pi-stacking-candidate")
    expect(candidates[0].qualification).toBe("centroid-normal-and-offset")
    expect(candidates[0].distance).toBeCloseTo(3.5)
  })
})
