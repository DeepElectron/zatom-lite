export interface StructureSearchItem {
  id: string;
  label: string;
  source: string;
  url: string;
  details?: string;
}

export type StructureSearchSource = 'all' | 'materials_project' | 'pubchem';

export interface StructureAtom {
  element: number;
  x: number;
  y: number;
  z: number;
}

export interface StructureFetchResponse {
  id: string;
  label: string;
  source: string;
  url: string;
  atoms: StructureAtom[];
  lattice?: {
    matrix: number[][];
    pbc?: boolean[];
  } | null;
}

export interface StructureSupercellResponse {
  atoms: StructureAtom[];
  lattice: {
    matrix: number[][];
    pbc?: boolean[];
  };
  repeats: number[];
}

export interface StructureSymmetryOperation {
  rotation: number[][];
  translation: number[];
}

export interface StructureSymmetryCell {
  atoms: StructureAtom[];
  lattice: {
    matrix: number[][];
    pbc?: boolean[];
  };
  atomCount: number;
}

export interface StructureSymmetryResponse {
  symprec: number;
  angleTolerance: number;
  spaceGroup: {
    number: number;
    internationalSymbol: string;
    hallSymbol: string;
    bravaisLattice: string;
    pointGroup: string;
    laueClass: string;
    crystalSystem: string;
  };
  operationCount: number;
  operations: StructureSymmetryOperation[];
  primitiveTransform: {
    latticeTransform: number[][];
    originShift: number[];
  };
  conventionalTransform: {
    latticeTransform: number[][];
    originShift: number[];
  };
  primitiveCell: StructureSymmetryCell;
  conventionalCell: StructureSymmetryCell;
  // Per-atom Wyckoff data from spglib.get_symmetry_dataset (lengths match input
  // atom count). Empty when backend is older or classification failed — UI then
  // falls back to local table + orbit grouping in lib/symmetry.
  wyckoffs?: string[];
  equivalentAtoms?: number[];
  siteSymmetrySymbols?: string[];
}
