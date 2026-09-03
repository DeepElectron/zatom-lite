import { describe, expect, it } from "vitest"
import { parseLegacyPdb } from "../lib/biomolecule/pdb"

function atomLine(options: {
  record?: "ATOM" | "HETATM"
  serial: number
  name: string
  rawName?: string
  alternateLocation?: string
  residue: string
  chain?: string
  sequence: number
  insertionCode?: string
  x: number
  y: number
  z: number
  occupancy?: number
  bFactor?: number
  element?: string
}): string {
  const record = (options.record ?? "ATOM").padEnd(6)
  const serial = String(options.serial).padStart(5)
  const name = options.rawName ?? options.name.padStart(4)
  const alternateLocation = options.alternateLocation ?? " "
  const residue = options.residue.padStart(3)
  const chain = options.chain ?? " "
  const sequence = String(options.sequence).padStart(4)
  const insertionCode = options.insertionCode ?? " "
  const coordinate = (value: number) => value.toFixed(3).padStart(8)
  const occupancy = (options.occupancy ?? 1).toFixed(2).padStart(6)
  const bFactor = (options.bFactor ?? 0).toFixed(2).padStart(6)
  return `${record}${serial} ${name}${alternateLocation}${residue} ${chain}${sequence}${insertionCode}   ${coordinate(options.x)}${coordinate(options.y)}${coordinate(options.z)}${occupancy}${bFactor}          ${(options.element ?? "").padStart(2)}`
}

function conect(...serials: number[]): string {
  return `CONECT${serials.map((serial) => String(serial).padStart(5)).join("")}`
}

function helixLine(chain: string, start: number, end: number): string {
  const columns = new Array<string>(80).fill(" ")
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) columns[offset + index] = value[index]
  }
  write(0, "HELIX ")
  columns[19] = chain
  write(21, String(start).padStart(4))
  write(33, String(end).padStart(4))
  return columns.join("")
}

/** Six idealized C-alpha positions that satisfy the parser's helix fallback. */
function geometricHelixFixture(secondaryRecords: readonly string[] = []): string {
  const positions = Array.from({ length: 6 }, (_, index) => {
    const angle = index * 100 * Math.PI / 180
    return [2.3 * Math.cos(angle), 2.3 * Math.sin(angle), 1.5 * index] as const
  })
  return [
    ...secondaryRecords,
    ...positions.map(([x, y, z], index) => atomLine({
      serial: index + 1,
      name: "CA",
      residue: "ALA",
      chain: "A",
      sequence: index + 1,
      x,
      y,
      z,
      element: "C",
    })),
  ].join("\n")
}

describe("parseLegacyPdb", () => {
  it("preserves blank chain, insertion codes, occupancy zero, CONECT and SSBOND provenance", () => {
    const lines = [
      "TITLE     INSERTION AND BOND FIXTURE",
      "SSBOND   1 CYS A    1    CYS A    2",
      atomLine({ serial: 1, name: "SG", residue: "CYS", chain: "A", sequence: 1, x: 0, y: 0, z: 0, element: "S" }),
      atomLine({ serial: 2, name: "SG", residue: "CYS", chain: "A", sequence: 2, x: 2.03, y: 0, z: 0, element: "S" }),
      atomLine({ serial: 3, name: "CA", residue: "GLY", chain: " ", sequence: 10, insertionCode: "A", x: 8, y: 0, z: 0, occupancy: 0, element: "C" }),
      atomLine({ serial: 4, name: "CA", residue: "ALA", chain: " ", sequence: 10, insertionCode: "B", x: 9, y: 0, z: 0, element: "C" }),
      conect(3, 4),
      "END",
    ]
    const structure = parseLegacyPdb(lines.join("\n"), { id: "FIX", inferBonds: false })

    expect(structure.residues).toHaveLength(4)
    expect(structure.residues[2].identity).toEqual({ chainId: "", sequenceNumber: 10, insertionCode: "A" })
    expect(structure.residues[3].identity).toEqual({ chainId: "", sequenceNumber: 10, insertionCode: "B" })
    expect(structure.atoms[2].occupancy).toBe(0)
    expect(structure.chains.map((chain) => chain.identifier)).toEqual(["A", ""])
    expect(structure.bonds.map((bond) => [bond.source, bond.kind])).toEqual([
      ["conect", "covalent"],
      ["ssbond", "disulfide"],
    ])
  })

  it("keeps only MODEL frames with identical atom identity and order", () => {
    const first = [
      atomLine({ serial: 1, name: "N", residue: "ALA", chain: "A", sequence: 1, x: 0, y: 0, z: 0, element: "N" }),
      atomLine({ serial: 2, name: "CA", residue: "ALA", chain: "A", sequence: 1, x: 1, y: 0, z: 0, element: "C" }),
    ]
    const valid = [
      atomLine({ serial: 1, name: "N", residue: "ALA", chain: "A", sequence: 1, x: 0, y: 1, z: 0, element: "N" }),
      atomLine({ serial: 2, name: "CA", residue: "ALA", chain: "A", sequence: 1, x: 1, y: 1, z: 0, element: "C" }),
    ]
    const reordered = [valid[1], valid[0]]
    const content = [
      "MODEL        1",
      ...first,
      "ENDMDL",
      "MODEL        2",
      ...valid,
      "ENDMDL",
      "MODEL        3",
      ...reordered,
      "ENDMDL",
    ].join("\n")
    const structure = parseLegacyPdb(content, { inferBonds: false })

    expect(structure.frames.map((frame) => frame.modelNumber)).toEqual([1, 2])
    expect(structure.warnings).toContain("MODEL 3 was omitted because atom identity or order differs from the topology model")
    expect(structure.frames[1].positions[1] - structure.frames[0].positions[1]).toBeCloseTo(1)
  })

  it("infers a standard-residue alpha carbon as C and a calcium HETATM as Ca", () => {
    const structure = parseLegacyPdb([
      atomLine({ serial: 1, name: "CA", rawName: " CA ", residue: "ALA", chain: "A", sequence: 1, x: 0, y: 0, z: 0 }),
      atomLine({ record: "HETATM", serial: 2, name: "CA", rawName: "CA  ", residue: "CA", chain: "A", sequence: 2, x: 4, y: 0, z: 0 }),
    ].join("\n"), { inferBonds: false })

    expect(structure.atoms.map((atom) => atom.element)).toEqual(["C", "Ca"])
  })

  it("selects blank altLoc first, otherwise highest occupancy with a stable letter tie", () => {
    const structure = parseLegacyPdb([
      atomLine({ serial: 1, name: "CA", residue: "ALA", chain: "A", sequence: 1, alternateLocation: "A", occupancy: 0.9, x: 1, y: 0, z: 0, element: "C" }),
      atomLine({ serial: 2, name: "CA", residue: "ALA", chain: "A", sequence: 1, occupancy: 0.1, x: 2, y: 0, z: 0, element: "C" }),
      atomLine({ serial: 3, name: "CB", residue: "ALA", chain: "A", sequence: 1, alternateLocation: "C", occupancy: 0.6, x: 3, y: 0, z: 0, element: "C" }),
      atomLine({ serial: 4, name: "CB", residue: "ALA", chain: "A", sequence: 1, alternateLocation: "B", occupancy: 0.6, x: 4, y: 0, z: 0, element: "C" }),
      atomLine({ serial: 5, name: "N", residue: "ALA", chain: "A", sequence: 1, alternateLocation: "A", occupancy: 0.4, x: 5, y: 0, z: 0, element: "N" }),
      atomLine({ serial: 6, name: "N", residue: "ALA", chain: "A", sequence: 1, alternateLocation: "B", occupancy: 0.7, x: 6, y: 0, z: 0, element: "N" }),
    ].join("\n"), { inferBonds: false })

    expect(structure.atoms.map((atom) => [atom.name, atom.serial, atom.alternateLocation])).toEqual([
      ["CA", 2, ""],
      ["CB", 4, "B"],
      ["N", 6, "B"],
    ])
  })

  it("keeps topology altLoc identity across MODEL frames", () => {
    const model = (number: number, aOccupancy: number, bOccupancy: number) => [
      `MODEL     ${String(number).padStart(4)}`,
      atomLine({ serial: 1, name: "CA", residue: "ALA", chain: "A", sequence: 1, alternateLocation: "A", occupancy: aOccupancy, x: number, y: 0, z: 0, element: "C" }),
      atomLine({ serial: 2, name: "CA", residue: "ALA", chain: "A", sequence: 1, alternateLocation: "B", occupancy: bOccupancy, x: number + 10, y: 0, z: 0, element: "C" }),
      "ENDMDL",
    ]
    const structure = parseLegacyPdb([
      ...model(1, 0.8, 0.2),
      ...model(2, 0.1, 0.9),
    ].join("\n"), { inferBonds: false })

    expect(structure.atoms[0].alternateLocation).toBe("A")
    expect(structure.frames).toHaveLength(2)
    expect(structure.frames[1].positions[0] - structure.frames[0].positions[0]).toBeCloseTo(1)
  })

  it("preserves CONECT multiplicity as bond order without double-counting reciprocals", () => {
    const structure = parseLegacyPdb([
      atomLine({ serial: 1, name: "C1", residue: "LIG", chain: "A", sequence: 1, x: 0, y: 0, z: 0, element: "C" }),
      atomLine({ serial: 2, name: "N1", residue: "LIG", chain: "A", sequence: 1, x: 1, y: 0, z: 0, element: "N" }),
      conect(1, 2, 2, 2),
      conect(2, 1),
    ].join("\n"), { inferBonds: false })

    expect(structure.bonds).toHaveLength(1)
    expect(structure.bonds[0].order).toBe(3)
  })

  it("does not infer a peptide bond across a residue-number gap", () => {
    const structure = parseLegacyPdb([
      atomLine({ serial: 1, name: "C", residue: "ALA", chain: "A", sequence: 1, x: 0, y: 0, z: 0, element: "C" }),
      atomLine({ serial: 2, name: "N", residue: "GLY", chain: "A", sequence: 10, x: 1.33, y: 0, z: 0, element: "N" }),
    ].join("\n"))

    expect(structure.bonds).toEqual([])
  })

  it("skips atoms at a conflicting residue identity instead of merging residue names", () => {
    const structure = parseLegacyPdb([
      "SSBOND   1 CYS A    1    CYS A    2",
      atomLine({ serial: 1, name: "SG", residue: "CYS", chain: "A", sequence: 1, x: 0, y: 0, z: 0, element: "S" }),
      atomLine({ serial: 2, name: "CA", residue: "ALA", chain: "A", sequence: 1, x: 5, y: 0, z: 0, element: "C" }),
      atomLine({ serial: 3, name: "SG", residue: "CYS", chain: "A", sequence: 2, x: 2.03, y: 0, z: 0, element: "S" }),
    ].join("\n"), { inferBonds: false })

    expect(structure.residues.map((residue) => residue.name)).toEqual(["CYS"])
    expect(structure.residues[0].identity.sequenceNumber).toBe(2)
    expect(structure.bonds).toEqual([])
    expect(structure.warnings.some((warning) => warning.includes("ambiguous site was skipped"))).toBe(true)
  })

  it("does not call the geometry fallback DSSP", () => {
    const structure = parseLegacyPdb(
      atomLine({ serial: 1, name: "CA", residue: "ALA", chain: "A", sequence: 1, x: 0, y: 0, z: 0, element: "C" }),
      { inferBonds: false },
    )
    expect(structure.residues[0].secondaryStructureSource).toBe("none")
  })

  it("uses the geometric secondary-structure fallback when no PDB assignment exists", () => {
    const structure = parseLegacyPdb(geometricHelixFixture(), { inferBonds: false })

    expect(structure.residues.map((residue) => residue.secondaryStructure)).toEqual(
      new Array(6).fill("helix"),
    )
    expect(structure.residues.map((residue) => residue.secondaryStructureSource)).toEqual(
      new Array(6).fill("geometry-estimate"),
    )
  })

  it("does not mix geometric estimates into residues left uncovered by a valid PDB assignment", () => {
    const structure = parseLegacyPdb(
      geometricHelixFixture([helixLine("A", 1, 2)]),
      { inferBonds: false },
    )

    expect(structure.residues.map((residue) => residue.secondaryStructure)).toEqual([
      "helix", "helix", "coil", "coil", "coil", "coil",
    ])
    expect(structure.residues.map((residue) => residue.secondaryStructureSource)).toEqual([
      "pdb-record", "pdb-record", "none", "none", "none", "none",
    ])
  })

  it("falls back to geometry when HELIX/SHEET records do not assign any valid protein residue", () => {
    const structure = parseLegacyPdb(
      geometricHelixFixture([helixLine("B", 1, 6)]),
      { inferBonds: false },
    )

    expect(structure.residues.map((residue) => residue.secondaryStructure)).toEqual(
      new Array(6).fill("helix"),
    )
    expect(structure.residues.map((residue) => residue.secondaryStructureSource)).toEqual(
      new Array(6).fill("geometry-estimate"),
    )
  })
})
