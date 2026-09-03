import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  bioAtomSetToSelectionExpression,
  bioPickOperationFromModifiers,
  expandBioBoxSelection,
  shouldClearBioSelectionOnMiss,
} from "../lib/biomolecule/picking"
import { parseLegacyPdb } from "../lib/biomolecule/pdb"
import { evaluateBioSelection } from "../lib/biomolecule/selection"
import { buildBioSelectionPresetGroups } from "../lib/biomolecule/selection-presets"
import { bioResidueIndicesInChainRange } from "../lib/biomolecule/sequence"
import {
  bioResidueDragEndpoint,
  bioResidueDragRange,
  bioResidueSequenceColor,
  bioSequencePickOperation,
  currentBioSequenceGestureStore,
} from "../ui/components/biomolecule/sequence-strip"
import { applyBoxSelectionOperation } from "../orchestration/slices/box-selection-slice"
import {
  BOX_SELECT_DRAG_THRESHOLD_PX,
  exceedsBoxSelectDragThreshold,
  isBioSelectionReplaceMiss,
} from "../ui/components/crystal-viewer/selection-box"

function atomLine(serial: number, name: string, sequence: number, insertionCode: string, x: number): string {
  return `${"ATOM".padEnd(6)}${String(serial).padStart(5)} ${name.padStart(4)} ${"ALA".padStart(3)}  ${String(sequence).padStart(4)}${insertionCode || " "}   ${x.toFixed(3).padStart(8)}${"0.000".padStart(8)}${"0.000".padStart(8)}${"1.00".padStart(6)}${"10.00".padStart(6)}          ${"C".padStart(2)}`
}

function chainAtomLine(serial: number, chain: string, sequence: number, x: number): string {
  return `${"ATOM".padEnd(6)}${String(serial).padStart(5)} ${"CA".padStart(4)} ${"ALA".padStart(3)} ${chain}${String(sequence).padStart(4)}    ${x.toFixed(3).padStart(8)}${"0.000".padStart(8)}${"0.000".padStart(8)}${"1.00".padStart(6)}${"10.00".padStart(6)}          ${"C".padStart(2)}`
}

const structure = parseLegacyPdb(
  [
    atomLine(1, "CA", 10, "A", 0),
    atomLine(2, "CB", 10, "A", 1),
    atomLine(3, "CA", 10, "B", 4),
    atomLine(4, "CB", 10, "B", 5),
  ].join("\n"),
  { inferBonds: false },
)

describe("bio selection DSL", () => {
  it("normalizes forward and reverse sequence drags without losing the true range", () => {
    expect(bioResidueDragRange(10, 20)).toEqual([10, 20])
    expect(bioResidueDragRange(20, 10)).toEqual([10, 20])
    expect(bioResidueDragEndpoint(10, 20)).toBe(10)
    expect(bioResidueDragEndpoint(null, 20)).toBe(20)
  })

  it("keeps sequence drags within their originating chain", () => {
    const twoChains = parseLegacyPdb([
      chainAtomLine(1, "A", 1, 0),
      chainAtomLine(2, "A", 2, 1),
      chainAtomLine(3, "B", 1, 2),
      chainAtomLine(4, "B", 2, 3),
    ].join("\n"), { inferBonds: false })
    expect(bioResidueIndicesInChainRange(twoChains, 0, 0, 3)).toEqual([0, 1])
    expect(bioResidueIndicesInChainRange(twoChains, 0, 3, 0)).toEqual([0, 1])
    expect(bioResidueIndicesInChainRange(twoChains, 1, 0, 3)).toEqual([2, 3])
  })

  it("refuses to commit a sequence gesture after its viewport or PDB document changes", () => {
    const replacement = { ...structure, id: "replacement" }
    let currentStructure = structure
    const sourceStore = { getState: () => ({ bioStructure: currentStructure }) }
    const otherStore = { getState: () => ({ bioStructure: structure }) }

    expect(currentBioSequenceGestureStore(sourceStore, sourceStore, structure)).toBe(sourceStore)

    currentStructure = replacement
    expect(currentBioSequenceGestureStore(sourceStore, sourceStore, structure)).toBeNull()

    currentStructure = structure
    expect(currentBioSequenceGestureStore(sourceStore, otherStore, structure)).toBeNull()
  })

  it("locks modifier meaning and gives charged residues semantic colours", () => {
    expect(bioSequencePickOperation({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe("add")
    expect(bioSequencePickOperation({ shiftKey: true, ctrlKey: true, metaKey: false })).toBe("add")
    expect(bioResidueSequenceColor("ASP", "coil")).toBe("var(--status-red)")
    expect(bioResidueSequenceColor("LYS", "coil")).toBe("var(--control-selected-text)")
    expect(bioResidueSequenceColor("ALA", "sheet")).toBe("var(--status-amber)")
  })

  it("keeps the sequence strip in the root bottom stack above the viewport toolbar", () => {
    const modelerSource = readFileSync("src/ui/ModelerView.tsx", "utf8")
    const viewerSource = readFileSync("src/ui/components/crystal-viewer/index.tsx", "utf8")
    const sequenceSource = readFileSync("src/ui/components/biomolecule/sequence-strip.tsx", "utf8")

    expect(modelerSource).toContain('data-testid="viewport-bottom-stack"')
    expect(modelerSource).toMatch(/<BiomoleculeSequenceStrip\s+key=\{activeViewportId\}\s*\/>[\s\S]*<BottomToolbar\s*\/>/)
    expect(viewerSource).not.toContain('BiomoleculeSequenceStrip')
    expect(sequenceSource).toContain('pointer-events-auto relative w-full shrink-0')
    expect(sequenceSource).not.toContain('absolute inset-x-3 bottom-3')
  })
  it("rejects trailing garbage instead of silently accepting a prefix", () => {
    const result = evaluateBioSelection(structure, "all garbage")
    expect(result.error).toContain("Unexpected token")
    expect(result.atomIndices.size).toBe(0)
  })

  it("expresses blank chains and insertion codes", () => {
    expect([...evaluateBioSelection(structure, "chain blank and resi 10 and icode A").atomIndices]).toEqual([0, 1])
    expect([...evaluateBioSelection(structure, "chain \"\" and resi 10 and icode B").atomIndices]).toEqual([2, 3])
  })

  it("supports within N of syntax and boolean precedence", () => {
    expect([...evaluateBioSelection(structure, "within 1.1 of (index 0)").atomIndices]).toEqual([0, 1])
    expect([...evaluateBioSelection(structure, "index 0 or index 1 and index 3").atomIndices]).toEqual([0])
  })

  it("applies postfix distance expansion to the complete boolean expression", () => {
    const implicit = evaluateBioSelection(structure, "index 0 or index 2 around 1.1")
    const explicit = evaluateBioSelection(structure, "(index 0 or index 2) around 1.1")
    expect(implicit.error).toBeNull()
    expect([...implicit.atomIndices]).toEqual([...explicit.atomIndices])
  })

  it("round-trips full and partial residue picks without losing insertion identity", () => {
    const picks = [new Set([0, 1, 2, 3]), new Set([0, 1, 3])]
    for (const pick of picks) {
      const expression = bioAtomSetToSelectionExpression(structure, pick)
      expect(evaluateBioSelection(structure, expression).error).toBeNull()
      expect([...evaluateBioSelection(structure, expression).atomIndices]).toEqual([...pick])
    }
  })

  it("compresses consecutive complete residues into the source resi range syntax", () => {
    const consecutive = parseLegacyPdb([
      chainAtomLine(1, "A", 1, 0),
      chainAtomLine(2, "A", 2, 1),
      chainAtomLine(3, "A", 3, 2),
    ].join("\n"), { inferBonds: false })
    const picked = new Set([0, 1])
    const expression = bioAtomSetToSelectionExpression(consecutive, picked)
    expect(expression).toContain("resi 1-2")
    expect([...evaluateBioSelection(consecutive, expression).atomIndices]).toEqual([...picked])
  })

  it("raises biological marquee atom hits to complete residues", () => {
    expect(expandBioBoxSelection(structure, [structure.atoms[1].id])).toEqual([
      structure.atoms[0].id,
      structure.atoms[1].id,
    ])
    expect(expandBioBoxSelection(structure, [structure.atoms[1].id, structure.atoms[2].id])).toEqual(
      structure.atoms.map((atom) => atom.id),
    )
  })

  it("applies marquee replace, add and subtract against the drag-start snapshot", () => {
    const base = new Set(["a", "b"])
    expect(applyBoxSelectionOperation(base, ["c"], "replace")).toEqual(["c"])
    expect(applyBoxSelectionOperation(base, ["c"], "add")).toEqual(["a", "b", "c"])
    expect(applyBoxSelectionOperation(base, ["b"], "subtract")).toEqual(["a"])
  })

  it("defines one blank-click miss contract without treating handled double-clicks as misses", () => {
    const replace = { shiftKey: false, ctrlKey: false, metaKey: false }
    expect(bioPickOperationFromModifiers(replace)).toBe("replace")
    expect(bioPickOperationFromModifiers({ shiftKey: true, ctrlKey: true, metaKey: false })).toBe("add")
    expect(shouldClearBioSelectionOnMiss(replace)).toBe(true)
    expect(shouldClearBioSelectionOnMiss({ ...replace, shiftKey: true })).toBe(false)
    expect(shouldClearBioSelectionOnMiss({ ...replace, ctrlKey: true })).toBe(false)
    expect(isBioSelectionReplaceMiss({
      hasBiomolecule: true,
      toolMode: "select",
      measurementMode: "none",
      translateMode: false,
      boxSelectModeEnabled: false,
    }, { button: 0, detail: 1, ...replace })).toBe(true)
    expect(isBioSelectionReplaceMiss({
      hasBiomolecule: true,
      toolMode: "select",
      measurementMode: "distance",
      translateMode: false,
      boxSelectModeEnabled: false,
    }, { button: 0, detail: 1, ...replace })).toBe(false)
    expect(isBioSelectionReplaceMiss({
      hasBiomolecule: true,
      toolMode: "select",
      measurementMode: "none",
      translateMode: false,
      boxSelectModeEnabled: false,
    }, { button: 0, detail: 2, ...replace })).toBe(false)

    // Lock the regression boundary: an outer native dblclick listener runs
    // after R3F's handled mesh event and would erase the promoted chain/ligand.
    const overlaySource = readFileSync("src/ui/components/crystal-viewer/selection-box.tsx", "utf8")
    expect(overlaySource).not.toContain("addEventListener('dblclick'")
    const viewerSource = readFileSync("src/ui/components/crystal-viewer/index.tsx", "utf8")
    expect(viewerSource).toContain("onPointerMissed=")
  })

  it("separates a modifier click from a modifier drag by pointer travel", () => {
    const start = { x: 100, y: 100 }
    // A held-still or jittering pointer stays a click, so the atom pick owns the
    // selection and no rectangle is committed over it.
    expect(exceedsBoxSelectDragThreshold(start, start)).toBe(false)
    expect(exceedsBoxSelectDragThreshold(start, { x: 102, y: 102 })).toBe(false)
    expect(
      exceedsBoxSelectDragThreshold(start, { x: 100 + BOX_SELECT_DRAG_THRESHOLD_PX, y: 100 }),
    ).toBe(false)
    // Real travel in any direction promotes the gesture to a rubber band.
    expect(exceedsBoxSelectDragThreshold(start, { x: 120, y: 100 })).toBe(true)
    expect(exceedsBoxSelectDragThreshold(start, { x: 100, y: 70 })).toBe(true)
    expect(exceedsBoxSelectDragThreshold(start, { x: 90, y: 90 })).toBe(true)
  })

  it("derives only reachable one-click presets with counts and recommended representations", () => {
    const pdbLine = (options: {
      record?: "ATOM" | "HETATM"; serial: number; name: string; residue: string
      chain: string; sequence: number; x: number; element: string; bFactor?: number
    }) => `${(options.record ?? "ATOM").padEnd(6)}${String(options.serial).padStart(5)} ${options.name.padStart(4)} ${options.residue.padStart(3)} ${options.chain}${String(options.sequence).padStart(4)}    ${options.x.toFixed(3).padStart(8)}${"0.000".padStart(8)}${"0.000".padStart(8)}${"1.00".padStart(6)}${(options.bFactor ?? 10).toFixed(2).padStart(6)}          ${options.element.padStart(2)}`
    const rich = parseLegacyPdb([
      pdbLine({ serial: 1, name: "CA", residue: "ALA", chain: "A", sequence: 1, x: 0, element: "C", bFactor: 5 }),
      pdbLine({ serial: 2, name: "CB", residue: "ALA", chain: "A", sequence: 1, x: .7, element: "C", bFactor: 10 }),
      pdbLine({ serial: 3, name: "CA", residue: "LYS", chain: "B", sequence: 2, x: 3, element: "C", bFactor: 90 }),
      pdbLine({ serial: 4, name: "NZ", residue: "LYS", chain: "B", sequence: 2, x: 3.7, element: "N", bFactor: 95 }),
      pdbLine({ record: "HETATM", serial: 5, name: "C1", residue: "LIG", chain: "L", sequence: 3, x: 6, element: "C" }),
      pdbLine({ record: "HETATM", serial: 6, name: "O1", residue: "LIG", chain: "L", sequence: 3, x: 6.8, element: "O" }),
      pdbLine({ record: "HETATM", serial: 7, name: "ZN", residue: "ZN", chain: "Z", sequence: 4, x: 4.5, element: "Zn" }),
      pdbLine({ record: "HETATM", serial: 8, name: "O", residue: "HOH", chain: "W", sequence: 5, x: 12, element: "O" }),
    ].join("\n"), { inferBonds: false })

    const groups = buildBioSelectionPresetGroups(rich)
    const all = groups.flatMap((group) => group.items)
    expect(groups.map((group) => group.group)).toEqual(expect.arrayContaining([
      "Composition", "Chains", "Ligands", "Functional sites", "Properties",
    ]))
    expect(all.every((preset) => preset.atomCount > 0)).toBe(true)
    expect(all.find((preset) => preset.name === "Ligands")).toMatchObject({ atomCount: 2, representation: "ball-and-stick" })
    expect(all.find((preset) => preset.name === "Ions")).toMatchObject({ atomCount: 1, representation: "space-filling" })
    expect(all.find((preset) => preset.name === "Water")).toMatchObject({ atomCount: 1 })
    expect(all.find((preset) => preset.name === "Binding pocket")?.description).toContain("atoms")
    expect(all.some((preset) => preset.name === "Disulfide sulfurs")).toBe(false)
  })
})
