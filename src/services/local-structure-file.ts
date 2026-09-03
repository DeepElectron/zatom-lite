/**
 * Recognises and mounts structure files coming from a bound local directory.
 *
 * One canonical classifier serves both the directory tree filter and the mount
 * action, so a file can never be listed as mountable and then rejected on click.
 *
 * Two routes exist because the codebase has two parsers, not by choice:
 *  - `unified` — `importUnifiedStructureFile` already dispatches CIF/mmCIF
 *    (same-suffix disambiguation), XYZ/extXYZ, MOL, PDB, CUB/Molden and
 *    trajectories, and loads the result into the viewport store itself.
 *  - `poscar`  — `resolveImportKind` has no POSCAR branch at all, so VASP
 *    coordinate files reach the store through the agent's POSCAR parser in
 *    `structure-text-io`, which needs the format stated explicitly.
 */

import { importStructureText, ZATOM_STRUCTURE_TEXT_MAX_BYTES } from '../agent/structure-text-io'
import { importUnifiedStructureFile, inspectUnifiedStructureFile } from './unified-file-import'

import type { ZatomStructure } from '../agent/contracts'

export type LocalStructureRoute = 'unified' | 'poscar'

/**
 * Extensions dispatched by `importUnifiedStructureFile`.
 *
 * `UNIFIED_IMPORT_ACCEPT` is deliberately not reused here: it exists to make a
 * file picker permissive and contains `*&#47;*`, bare MIME types and the catch-all
 * `.txt` / `.log` / `.out` / `.json` sniffing extensions. Applying it to a whole
 * directory would list every log and note file next to the structures, so this
 * set keeps only suffixes that identify a structure or trajectory on their own.
 */
const UNIFIED_EXTENSIONS = [
  '.cif',
  '.mcif',
  '.mmcif',
  '.xyz',
  '.extxyz',
  '.mol',
  '.pdb',
  '.ent',
  '.cub',
  '.cube',
  '.molden',
  '.mld',
  '.traj',
  '.spectraj',
  '.dump',
  '.lammpstrj',
] as const

/** VASP writes coordinates to fixed basenames rather than a suffix. */
const POSCAR_BASENAMES = ['poscar', 'contcar'] as const

export function classifyLocalStructureFile(fileName: string): LocalStructureRoute | null {
  const lower = fileName.toLowerCase()

  // XDATCAR is a VASP trajectory, and the unified importer already keys on the
  // basename, so it must be tested before the POSCAR rules below.
  if (lower.includes('xdatcar')) return 'unified'
  if (UNIFIED_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'unified'

  if (lower.endsWith('.vasp')) return 'poscar'
  // Matches `POSCAR`, `CONTCAR`, and the common `POSCAR_relaxed` / `POSCAR.2`
  // variants, without swallowing unrelated names that merely contain the word.
  if (POSCAR_BASENAMES.some((base) => lower === base || lower.startsWith(`${base}.`) || lower.startsWith(`${base}_`))) {
    return 'poscar'
  }

  return null
}

export interface LocalStructureMountResult {
  ok: boolean
  message: string
  atomCount?: number
}

export interface LocalStructureMountOptions {
  /** Defaults to true for the existing user-click import path. */
  applyToWorkspace?: boolean
}

/**
 * Parses a local structure, optionally writing it into the active workspace.
 *
 * Callers inject the browser workspace writer so parsing remains independent of
 * viewport state. The unified apply path loads its target store itself;
 * candidate mode gives it a disposable store instead.
 */
export type LocalStructureWriter = (structure: ZatomStructure) => Promise<unknown>

export async function mountLocalStructureFile(
  file: File,
  writeStructure: LocalStructureWriter,
  options: LocalStructureMountOptions = {},
): Promise<LocalStructureMountResult> {
  const route = classifyLocalStructureFile(file.name)
  if (!route) {
    return { ok: false, message: `${file.name} is not a recognised structure file` }
  }
  const apply = options.applyToWorkspace !== false

  if (route === 'unified') {
    const inspected = apply
      ? { result: await importUnifiedStructureFile(file), atomCount: undefined }
      : await inspectUnifiedStructureFile(file)
    const result = inspected.result
    return result.success
      ? {
          ok: true,
          message: apply
            ? result.message ?? `Loaded ${file.name}`
            : `Parsed ${file.name} as a candidate (${inspected.atomCount} atoms); the active viewport was not changed.`,
          ...(inspected.atomCount === undefined ? {} : { atomCount: inspected.atomCount }),
        }
      : { ok: false, message: result.error }
  }

  if (file.size > ZATOM_STRUCTURE_TEXT_MAX_BYTES) {
    return {
      ok: false,
      message: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${ZATOM_STRUCTURE_TEXT_MAX_BYTES / 1024 / 1024} MB POSCAR limit`,
    }
  }

  try {
    const imported = importStructureText({ format: 'poscar', text: await file.text(), label: file.name })
    if (apply) await writeStructure(imported.structure)
    const atomCount = imported.structure.atoms.length
    return {
      ok: true,
      message: apply
        ? `Loaded ${file.name} (POSCAR, ${atomCount} atoms)`
        : `Parsed ${file.name} as a candidate (POSCAR, ${atomCount} atoms); the active viewport was not changed.`,
      atomCount,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
