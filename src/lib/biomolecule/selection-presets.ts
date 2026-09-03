import { evaluateBioSelection } from "./selection"
import type { BioRepresentation, BioStructure } from "./types"

export interface BioSelectionPreset {
  name: string
  expression: string
  description: string
  atomCount: number
  representation?: BioRepresentation
}

export interface BioSelectionPresetGroup {
  group: string
  items: BioSelectionPreset[]
}

interface PresetDefinition {
  name: string
  expression: string
  description: string
  representation?: BioRepresentation
}

function quoted(value: string): string {
  return JSON.stringify(value)
}

function quantile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)))
  return Math.round(sorted[index] * 10) / 10
}

function resolvedPreset(structure: BioStructure, definition: PresetDefinition): BioSelectionPreset | null {
  const result = evaluateBioSelection(structure, definition.expression)
  if (result.error || result.atomIndices.size === 0) return null
  return {
    ...definition,
    atomCount: result.atomIndices.size,
    description: `${definition.description} · ${result.atomIndices.size.toLocaleString()} atoms`,
  }
}

function resolvedGroup(
  structure: BioStructure,
  group: string,
  definitions: readonly PresetDefinition[],
): BioSelectionPresetGroup | null {
  const items = definitions.flatMap((definition) => {
    const preset = resolvedPreset(structure, definition)
    return preset ? [preset] : []
  })
  return items.length > 0 ? { group, items } : null
}

/**
 * Build content-driven shortcuts from the same selection language used by
 * layers and picking. Empty or invalid selections are deliberately omitted so
 * the panel never advertises a component that is absent from this structure.
 */
export function buildBioSelectionPresetGroups(structure: BioStructure): BioSelectionPresetGroup[] {
  const groups: BioSelectionPresetGroup[] = []
  const add = (group: BioSelectionPresetGroup | null) => {
    if (group) groups.push(group)
  }

  add(resolvedGroup(structure, "Composition", [
    { name: "Protein", expression: "protein", description: "Protein polymer", representation: "cartoon" },
    { name: "Nucleic acid", expression: "nucleic", description: "DNA/RNA polymer", representation: "cartoon" },
    { name: "Ligands", expression: "ligand", description: "Multi-atom non-polymer residues", representation: "ball-and-stick" },
    { name: "Ions", expression: "ion", description: "Single-atom non-polymer residues", representation: "space-filling" },
    { name: "Water", expression: "water", description: "Water molecules", representation: "ball-and-stick" },
    { name: "Backbone", expression: "backbone", description: "Polymer backbone atoms", representation: "sticks" },
    { name: "Side chains", expression: "sidechain", description: "Polymer atoms outside the backbone", representation: "sticks" },
  ]))

  if (structure.chains.length > 1) {
    add(resolvedGroup(structure, "Chains", structure.chains.map((chain) => ({
      name: `Chain ${chain.identifier || "∅"}`,
      expression: chain.identifier ? `chain ${quoted(chain.identifier)}` : "chain blank",
      description: `${chain.polymerType} chain`,
      representation: chain.polymerType === "other" ? "ball-and-stick" as const : "cartoon" as const,
    }))))
  }

  const ligandNames = [...new Set(structure.ligands
    .filter((ligand) => ligand.atomIndices.length > 1)
    .map((ligand) => ligand.name))]
  add(resolvedGroup(structure, "Ligands", [
    ...ligandNames.map((name) => ({
      name,
      expression: `resn ${quoted(name)}`,
      description: `Ligand ${name}`,
      representation: "ball-and-stick" as const,
    })),
    {
      name: "Binding pocket",
      expression: "byres (ligand around 5) and polymer",
      description: "Complete polymer residues within 5 Å of a ligand",
      representation: "sticks",
    },
  ]))

  add(resolvedGroup(structure, "Secondary structure", [
    { name: "Helices", expression: "helix", description: "Assigned alpha-helical regions", representation: "cartoon" },
    { name: "Sheets", expression: "sheet", description: "Assigned beta-sheet regions", representation: "cartoon" },
    { name: "Coils", expression: "coil and protein", description: "Protein coil/loop regions", representation: "cartoon" },
  ]))

  const functional: PresetDefinition[] = []
  if (structure.chains.length > 1) functional.push({
    name: "Chain interface",
    expression: "interface",
    description: "Polymer atoms within 5 Å of another chain",
    representation: "sticks",
  })
  functional.push(
    {
      name: "Ion coordination shell",
      expression: "byres (ion around 3) and not ion",
      description: "Complete residues within 3 Å of an ion",
      representation: "sticks",
    },
    {
      name: "Disulfide sulfurs",
      expression: "resn CYS and name SG",
      description: "Cysteine sulfur atoms (candidate/disulfide endpoints)",
      representation: "space-filling",
    },
  )
  add(resolvedGroup(structure, "Functional sites", functional))

  const polymerBFactors = structure.atoms
    .filter((atom) => structure.residues[atom.residueIndex]?.isStandard)
    .map((atom) => atom.bFactor)
  const threshold = structure.bFactorSemantics === "plddt"
    ? quantile(polymerBFactors, 0.2)
    : quantile(polymerBFactors, 0.8)
  add(resolvedGroup(structure, "Properties", [
    { name: "Hydrophobic core", expression: "hydrophobic and sidechain", description: "Hydrophobic side-chain atoms", representation: "sticks" },
    { name: "Charged residues", expression: "resn ARG+LYS+HIS+ASP+GLU and protein", description: "Ionizable protein residues", representation: "sticks" },
    { name: "Aromatic residues", expression: "resn PHE+TYR+TRP+HIS and protein", description: "Protein aromatic ring systems", representation: "sticks" },
    structure.bFactorSemantics === "plddt"
      ? { name: "Low confidence", expression: `bfactor < ${threshold} and polymer`, description: "Lowest pLDDT confidence region", representation: "cartoon" }
      : { name: "High B-factor", expression: `bfactor > ${threshold} and polymer`, description: "Highest temperature-factor region", representation: "cartoon" },
  ]))

  return groups
}
