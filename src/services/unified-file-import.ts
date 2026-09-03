"use client"

import { isXYZContent, type XYZFrame } from '../lib/crystal/xyz-parser'
import { parseMolfile, molfileToCrystalStructure } from '../lib/molecule/molfile'
import { CubParser } from '../lib/molecular-orbitals/CubParser'
import { MoldenParser } from '../lib/molecular-orbitals/MoldenParser'
import {
  createAtomsFromCubData,
  createAtomsFromMoldenData,
  createAutoDetectedMoleculeBonds,
} from '../lib/molecular-orbitals/structure'
import { mmcifToPdbText } from '../lib/biomolecule/mmcif'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import type { BioStructure } from '../lib/biomolecule/types'
import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'
import { createCrystalStore } from '../orchestration/crystalStore'
import {
  detectBinaryFormat,
  detectFormat,
  parseAseTraj,
  parseTrajectory,
  type TrajectoryFormat,
} from '../lib/analysis/trajectory'

export type UnifiedImportStore = ReturnType<typeof createCrystalStore>

/** Default target for ordinary UI imports. Tests and candidate inspection may inject an isolated store. */
function activeImportStore(): UnifiedImportStore {
  return getActiveViewportStoreApi()
}

type UnifiedImportMode = "crystal" | "molecule" | "bio"
type UnifiedImportKind =
  | "cif"
  /** Macromolecular mmCIF from Boltz, AlphaFold, or RCSB; use biomolecular parsing. */
  | "mmcif"
  | "xyz"
  | "mol"
  | "cub"
  | "molden"
  | "pdb"
  | "trajectory" // XDATCAR / LAMMPS dump / Gaussian / pymatgen JSON traj

export const UNIFIED_IMPORT_ACCEPT = [
  "*/*",
  ".cif",
  ".mcif",
  ".mmcif",
  ".xyz",
  ".extxyz",
  ".mol",
  ".cub",
  ".cube",
  ".molden",
  ".mld",
  ".pdb",
  ".ent",
  ".txt",
  // Trajectory formats — all routed through the unified trajectory dispatcher.
  ".dump",
  ".lammpstrj",
  ".log",
  ".out",
  ".traj",
  ".spectraj",
  "text/plain",
  "chemical/x-cif",
  "chemical/x-xyz",
  "chemical/x-mdl-molfile",
  "chemical/x-mol",
  "chemical/x-pdb",
  "chemical/x-pdb-file",
].join(",")

/** Format label shown in UI badges / tooltips after a trajectory load. */
const TRAJECTORY_FORMAT_LABELS: Record<TrajectoryFormat, string> = {
  extxyz: 'Extended XYZ',
  vasp_xdatcar: 'VASP XDATCAR',
  lammps_dump: 'LAMMPS dump',
  pmg_json: 'pymatgen JSON',
  gaussian: 'Gaussian output',
  ase_traj: 'ASE .traj',
  zatom_agent: 'zatom Agent trajectory',
  unknown: 'unknown',
}

/** Serialise N frames to multi-frame extended-XYZ so loadFromXYZ can ingest them. */
function framesToExtxyz(frames: XYZFrame[]): string {
  const lines: string[] = []
  for (const frame of frames) {
    lines.push(String(frame.atoms.length))
    if (frame.latticeVectors) {
      const { a, b, c } = frame.latticeVectors
      const lat = [...a, ...b, ...c].map((v) => v.toFixed(6)).join(' ')
      lines.push(`Lattice="${lat}" ${frame.comment ?? ''}`.trim())
    } else {
      lines.push(frame.comment ?? '')
    }
    for (const atom of frame.atoms) {
      const [x, y, z] = atom.cartesian ?? atom.position
      lines.push(`${atom.element} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`)
    }
  }
  return lines.join('\n')
}

export interface UnifiedImportSuccess {
  success: true
  mode: UnifiedImportMode
  message: string
}

export interface UnifiedImportFailure {
  success: false
  error: string
}

export type UnifiedImportResult = UnifiedImportSuccess | UnifiedImportFailure

export interface RcsbPdbStructureSuccess {
  success: true
  /** Normalized four-character entry identifier. */
  pdbId: string
  fileName: string
  /** Parsed structure only; fetching this result never changes the active viewport. */
  structure: BioStructure
}

export type RcsbPdbStructureResult = RcsbPdbStructureSuccess | UnifiedImportFailure

export const RCSB_PDB_MAX_BYTES = 50 * 1024 * 1024
const RCSB_PDB_CONTENT_TYPES = new Set(['text/plain', 'chemical/x-pdb', 'chemical/x-pdb-file'])

async function readResponseTextWithinLimit(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`RCSB response exceeds the ${Math.round(maximumBytes / 1024 / 1024)} MB PDB limit.`)
  }
  if (!response.body) {
    const fallback = await response.arrayBuffer()
    if (fallback.byteLength > maximumBytes) throw new Error('RCSB response is too large.')
    return new TextDecoder().decode(fallback)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maximumBytes) throw new Error('RCSB response is too large.')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Fetch and parse one canonical four-character RCSB entry without installing it.
 *
 * Alignment and other read-only consumers use this boundary so they cannot
 * accidentally replace the active document. The ordinary importer below also
 * reuses it, keeping ID, media-type and byte-limit validation on one path.
 */
export async function fetchRcsbPdbStructure(pdbId: string): Promise<RcsbPdbStructureResult> {
  const normalized = pdbId.trim().toUpperCase()
  if (!/^[A-Z0-9]{4}$/.test(normalized)) {
    return { success: false, error: 'Enter a four-character PDB ID.' }
  }
  try {
    const response = await fetch(`https://files.rcsb.org/download/${normalized}.pdb`, {
      headers: { Accept: 'text/plain' },
    })
    if (!response.ok) {
      return {
        success: false,
        error: response.status === 404
          ? `PDB entry ${normalized} was not found.`
          : `RCSB returned HTTP ${response.status}.`,
      }
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? ''
    if (!RCSB_PDB_CONTENT_TYPES.has(contentType)) {
      return { success: false, error: `RCSB returned unsupported Content-Type ${contentType || '<missing>'}.` }
    }
    const content = await readResponseTextWithinLimit(response, RCSB_PDB_MAX_BYTES)
    const fileName = `${normalized}.pdb`
    return {
      success: true,
      pdbId: normalized,
      fileName,
      structure: parseLegacyPdb(content, { id: slugifyFileName(fileName), title: fileName }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'RCSB download failed.' }
  }
}

/** Fetch one canonical four-character RCSB entry and install it as the active document. */
export async function importRcsbPdb(pdbId: string): Promise<UnifiedImportResult> {
  const downloaded = await fetchRcsbPdbStructure(pdbId)
  if (!downloaded.success) return downloaded
  try {
    return installBiomoleculeStructure(downloaded.fileName, downloaded.structure, activeImportStore())
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to import structure file.' }
  }
}

function slugifyFileName(fileName: string) {
  return fileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported"
}

/**
 * Distinguish crystallographic CIF from macromolecular mmCIF despite their shared .cif suffix.
 *
 * A crystal requires `_cell_length_*` fields to define periodicity. Coordinate-only Boltz,
 * AlphaFold, and RCSB files lack a cell and use dotted `_atom_site.` tags, which separates them
 * from underscore-style crystallographic tags.
 */
function isMacromolecularMmcif(content: string): boolean {
  // Any CIF with a cell can follow the periodic crystal path.
  if (/^\s*_cell[._]length_a/mi.test(content)) return false
  return /^\s*_atom_site\.(group_PDB|label_atom_id|label_comp_id)/mi.test(content)
}

function resolveImportKind(fileName: string, content: string): UnifiedImportKind | null {
  const lowerName = fileName.toLowerCase()

  if (lowerName.endsWith(".mcif") || lowerName.endsWith(".mmcif") || lowerName.endsWith(".cif")) {
    // The suffix identifies CIF syntax, not structure kind; inspect the content as well.
    return isMacromolecularMmcif(content) ? "mmcif" : "cif"
  }
  if (lowerName.endsWith(".extxyz") || lowerName.endsWith(".xyz")) return "xyz"
  if (lowerName.endsWith(".mol")) return "mol"
  if (lowerName.endsWith(".cub") || lowerName.endsWith(".cube")) return "cub"
  if (lowerName.endsWith(".molden") || lowerName.endsWith(".mld")) return "molden"
  if (lowerName.endsWith(".pdb") || lowerName.endsWith(".ent")) return "pdb"

  // Trajectory-only extensions and basename conventions.
  if (
    lowerName.endsWith(".dump") ||
    lowerName.endsWith(".lammpstrj") ||
    lowerName.endsWith(".out") ||
    lowerName.endsWith(".log") ||
    lowerName.includes("xdatcar")
  ) return "trajectory"

  // Trajectory JSON (pymatgen Trajectory.as_dict). We look at structure-specific
  // hints before falling back to other JSON consumers.
  if ((lowerName.endsWith(".json")) && /"species"\s*:|"@class"\s*:\s*"Trajectory"/.test(content)) {
    return "trajectory"
  }

  if (/\[molden format\]/i.test(content)) return "molden"
  if (isXYZContent(content)) return "xyz"
  if (/^data_/m.test(content) && /_atom_site_/m.test(content)) return "cif"
  if (/^(ATOM|HETATM)/m.test(content)) return "pdb"

  // Content-based trajectory hints (no clear filename signal).
  const trajFormat = detectFormat(content, fileName)
  if (trajFormat !== "unknown" && trajFormat !== "extxyz") return "trajectory"

  return null
}

function resetInteractionState(store: UnifiedImportStore) {
  store.setState({
    selectedAtomIds: new Set<string>(),
    selectedBondIds: new Set<string>(),
    selectedEdgeIds: new Set<string>(),
    selectedFaceIds: new Set<string>(),
    focusedAtomIds: new Set<string>(),
    draggingAtomId: null,
    measurementMode: 'none',
    measurements: [],
    pendingMeasurementAtoms: [],
    activeMeasurementEdit: null,
    pendingBondAtomId: null,
    boxSelectModeEnabled: false,
    isBoxSelecting: false,
    boxStart: null,
    boxEnd: null,
    selectionRegionPreview: null,
    constructedPlane: null,
    show2DPlaneView: false,
    clippingEnabled: false,
    clippingNormal: null,
    translateMode: false,
    translationPreview: null,
    rotationPreview: null,
    selectionTransformMode: 'translate',
    selectionTransformOrigin: null,
  })
}

/** Install one already-parsed CUBE into a chosen viewport store. */
export function installCubDataIntoStore(
  cubData: ReturnType<CubParser['parse']>,
  fileName: string,
  store: UnifiedImportStore,
): number {
  const crystalStore = store.getState()
  const atoms = createAtomsFromCubData(cubData, slugifyFileName(fileName))
  const bonds = createAutoDetectedMoleculeBonds(atoms)
  crystalStore.setBuilderMode('structure')
  crystalStore.setPeriodic(false)
  crystalStore.clearTrajectory()
  crystalStore.replaceAtomsDirectly(atoms)
  crystalStore.setBondsDirectly(bonds)
  crystalStore.loadCubData(cubData, fileName)
  resetInteractionState(store)
  return atoms.length
}

/** Install one already-parsed Molden wavefunction into a chosen viewport store. */
export function installMoldenDataIntoStore(
  moldenData: ReturnType<MoldenParser['parse']>,
  fileName: string,
  store: UnifiedImportStore,
): number {
  const crystalStore = store.getState()
  const atoms = createAtomsFromMoldenData(moldenData, slugifyFileName(fileName))
  const bonds = createAutoDetectedMoleculeBonds(atoms)
  crystalStore.setBuilderMode('structure')
  crystalStore.setPeriodic(false)
  crystalStore.clearTrajectory()
  crystalStore.replaceAtomsDirectly(atoms)
  crystalStore.setBondsDirectly(bonds)
  crystalStore.loadMoldenData(moldenData, fileName)
  resetInteractionState(store)
  return atoms.length
}

function installBiomoleculeStructure(
  fileName: string,
  structure: BioStructure,
  store: UnifiedImportStore,
): UnifiedImportSuccess {
  const crystalStore = store.getState()
  crystalStore.loadBiomolecule(structure)
  resetInteractionState(store)
  const modelMessage = structure.frames.length > 1
    ? ` · ${structure.frames.length} compatible MODEL frames`
    : ''
  const warningMessage = structure.warnings.length > 0
    ? ` · ${structure.warnings.length} warning${structure.warnings.length === 1 ? '' : 's'}`
    : ''
  return {
    success: true,
    mode: 'bio',
    message: `${fileName} loaded — ${structure.atoms.length} atoms${modelMessage}${warningMessage}.`,
  }
}

/** Load the bundled synthetic MODEL demo through the same parser/installer as imported PDB files. */
export async function importBundledBiomoleculePdb(
  sourcePath: string,
  id: string,
): Promise<UnifiedImportResult> {
  if (!/^\/trajectories\/[a-z0-9._-]+\.pdb$/i.test(sourcePath)) {
    return { success: false, error: 'Unsupported bundled PDB path.' }
  }
  try {
    const response = await fetch(sourcePath, { headers: { Accept: 'text/plain' } })
    if (!response.ok) return { success: false, error: `Bundled trajectory returned HTTP ${response.status}.` }
    const content = await readResponseTextWithinLimit(response, RCSB_PDB_MAX_BYTES)
    const structure = parseLegacyPdb(content, { id, title: id })
    return installBiomoleculeStructure(`${id}.pdb`, structure, activeImportStore())
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Bundled trajectory failed to load.' }
  }
}

export const STREAM_TRAJECTORY_MIN_BYTES = 30 * 1024 * 1024
export const ZATOM_VOLUMETRIC_FILE_MAX_BYTES = 32 * 1024 * 1024

export async function importUnifiedStructureFile(
  file: File,
  store: UnifiedImportStore = activeImportStore(),
): Promise<UnifiedImportResult> {
  // Binary formats branch before the text decode (ASE .traj etc).
  const lowerName = file.name.toLowerCase()
  if (/\.(?:cub|cube|molden|mld)$/.test(lowerName) && file.size > ZATOM_VOLUMETRIC_FILE_MAX_BYTES) {
    return {
      success: false,
      error: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; CUBE/Molden imports are limited to ${ZATOM_VOLUMETRIC_FILE_MAX_BYTES / 1024 / 1024} MB to keep the browser responsive.`,
    }
  }
  // .spectraj — streaming per-frame species trajectory (positions static, appearance
  // animates Si↔Ge). Sliced/decoded on demand so RAM stays bounded regardless of frames.
  if (lowerName.endsWith(".spectraj")) {
    try {
      const { frameCount, atomCount } = await store.getState().loadCompactSpeciesFile(file)
      return { success: true, mode: "crystal", message: `Species animation: ${frameCount.toLocaleString()} frames × ${atomCount.toLocaleString()} atoms (streamed)` }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  // Large multi-frame xyz: whole-file text parsing would blow the JS string limit —
  // route to the streaming trajectory loader (worker-indexed, sliding-window decode).
  if ((lowerName.endsWith(".xyz") || lowerName.endsWith(".extxyz")) && file.size >= STREAM_TRAJECTORY_MIN_BYTES) {
    try {
      const { frameCount, atomCount } = await store.getState().loadCompactTrajectoryFile(file)
      return { success: true, mode: "crystal", message: `Trajectory: ${frameCount.toLocaleString()} frames × ${atomCount.toLocaleString()} atoms (streamed)` }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  if (lowerName.endsWith(".traj")) {
    const buf = await file.arrayBuffer()
    const binFormat = detectBinaryFormat(buf, file.name)
    if (binFormat === "ase_traj") {
      const result = parseAseTraj(buf, file.name)
      // Currently this always returns success: false with a helpful hint. Once
      // the in-browser ULM reader lands we'll wire it through the same path
      // as the text trajectories.
      if (!result.success) return { success: false, error: result.error }
    }
    // Unknown binary; fall through to text path (may still error cleanly).
  }
  const content = await file.text()
  return importUnifiedStructureText(file.name, content, store)
}

/**
 * Run the real unified importer against a disposable store.
 *
 * Agent candidate mode needs format validation and an atom count without
 * changing the structure, trajectory, or surface the user is looking at. A
 * detached store keeps that path on the canonical parsers while making the
 * no-write guarantee structural rather than relying on a restore afterward.
 */
export async function inspectUnifiedStructureFile(
  file: File,
): Promise<{ result: UnifiedImportResult; atomCount: number; store: UnifiedImportStore }> {
  const store = createCrystalStore()
  const result = await importUnifiedStructureFile(file, store)
  return { result, atomCount: store.getState().atoms.length, store }
}

export async function importUnifiedStructureText(
  fileName: string,
  content: string,
  store: UnifiedImportStore = activeImportStore(),
): Promise<UnifiedImportResult> {
  const crystalStore = store.getState()
  const importKind = resolveImportKind(fileName, content)
  const idPrefix = slugifyFileName(fileName)

  if (!importKind) {
    return {
      success: false,
      error: "Unsupported file format. Use CIF for Crystal, XYZ/CUB/Molden for Molecule, or PDB for Bio.",
    }
  }

  try {
    switch (importKind) {
      case "cif": {
        const result = await crystalStore.loadFromCIF(content)
        if (result.success === false) {
          return { success: false, error: result.error }
        }
        resetInteractionState(store)
        crystalStore.setBuilderMode("structure")
        crystalStore.setPeriodic(true)
        return { success: true, mode: "crystal", message: `${fileName} loaded as periodic structure.` }
      }
      case "xyz": {
        // Extended XYZ with a Lattice field is periodic; plain XYZ is molecular.
        const hasLattice = /Lattice\s*=/i.test(content)
        const result = await crystalStore.loadFromXYZ(content)
        if (result.success === false) {
          return { success: false, error: result.error }
        }
        resetInteractionState(store)
        crystalStore.setBuilderMode("structure")
        crystalStore.setPeriodic(hasLattice)
        return {
          success: true,
          mode: hasLattice ? "crystal" : "molecule",
          message: `${fileName} loaded as ${hasLattice ? 'periodic' : 'molecular'} structure.`,
        }
      }
      case "mol": {
        const parsed = parseMolfile(content)
        const structure = molfileToCrystalStructure(parsed, idPrefix)
        crystalStore.setBuilderMode("structure"); crystalStore.setPeriodic(false)
        crystalStore.clearTrajectory()
        crystalStore.replaceAtomsDirectly(structure.atoms)
        crystalStore.setBondsDirectly(structure.bonds)
        resetInteractionState(store)
        return {
          success: true,
          mode: "molecule",
          message: `${fileName} loaded with ${structure.atoms.length} atoms in Molecule Builder.`,
        }
      }
      case "cub": {
        const cubData = new CubParser().parse(content)
        installCubDataIntoStore(cubData, fileName, store)
        return {
          success: true,
          mode: "molecule",
          message: `${fileName} loaded with orbital data in Molecule Builder.`,
        }
      }
      case "molden": {
        const moldenData = new MoldenParser(content).parse()
        installMoldenDataIntoStore(moldenData, fileName, store)
        return {
          success: true,
          mode: "molecule",
          message: `${fileName} loaded with ${moldenData.orbitals.length} orbitals in Molecule Builder.`,
        }
      }
      case "pdb": {
        const structure = parseLegacyPdb(content, { id: idPrefix, title: fileName })
        return installBiomoleculeStructure(fileName, structure, store)
      }
      case "mmcif": {
        // Convert to PDB text and reuse established chain, residue, and bond parsing.
        //
        // Do not force bFactorSemantics: external mmCIF may contain experimental B-factors or
        // Boltz/AlphaFold pLDDT. Let parseLegacyPdb detect it; in-app Boltz results use a path that
        // can declare pLDDT explicitly.
        const structure = parseLegacyPdb(mmcifToPdbText(content, { title: fileName }), {
          id: idPrefix,
          title: fileName,
        })
        return installBiomoleculeStructure(fileName, structure, store)
      }
      case "trajectory": {
        const parsed = parseTrajectory(content, fileName)
        if (!parsed.success) {
          return { success: false, error: parsed.error }
        }
        const traj = parsed.data
        // Serialise to multi-frame extxyz so loadFromXYZ wires bonds / atoms /
        // trajectoryFrames as it does for native multi-frame XYZ.
        const xyzText = framesToExtxyz(traj.frames)
        const result = await crystalStore.loadFromXYZ(xyzText)
        if (result.success === false) {
          return { success: false, error: result.error }
        }
        resetInteractionState(store)
        const hasLattice = !!traj.frames[0]?.latticeVectors
        crystalStore.setBuilderMode("structure")
        crystalStore.setPeriodic(hasLattice)
        // Surface format + per-frame metadata so the play bar can show a badge
        // and downstream tools can read energies/forces per frame.
        store.setState({
          trajectoryFormatLabel: TRAJECTORY_FORMAT_LABELS[traj.format],
          trajectoryFormatKind: traj.format,
          trajectoryMetadata: traj.metadata,
        })
        const label = TRAJECTORY_FORMAT_LABELS[traj.format]
        return {
          success: true,
          mode: hasLattice ? "crystal" : "molecule",
          message: `${fileName} loaded — ${label}, ${traj.frames.length} frames.`,
        }
      }
      default:
        return { success: false, error: "Unsupported file format." }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to import structure file.",
    }
  }
}
