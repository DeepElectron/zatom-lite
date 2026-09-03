/**
 * Built-in crystal template CIF. Most are conventional standard cells from the Materials Project;
 * A small number of bundled entries come from structure definitions delivered with the project and have provenance documented separately.
 *
 * It uses the path of parseCIF + loadFromCIF, which is completely the same as the user dragging in any .cif file.
 *
 * **Refresh process** (MP updates ID/data occasionally; wants to sync the latest version):
 * curl -s "https://legacy.materialsproject.org/rest/v2/materials/<mp-id>/cif" \
 * | python3 -c "import json,sys; print(json.load(sys.stdin)['response']['cif'])"
 * Just replace the entire output section with the corresponding constant (note that the trailing newline is retained).
 *
 * Add new template: add a line at the end of STRUCTURE_TEMPLATE_CIFS; CIF text can be directly Inline or
 * You can extract the constants individually.
 */

export interface CrystalTemplateCifEntry {
  /**
  * The name displayed on the UI
  */
  name: string
  /** Provenance for the bundled structure definition. */
  source: { kind: 'materials-project'; id: string } | { kind: 'bundled'; note: string }
  /**
  * Complete CIF text - feed parseCIF directly
  */
  cif: string
  /** Conventional-cell symmetry intentionally omitted by the P1 coordinate export. */
  spaceGroupNumber: number
  centeringType: 'P' | 'F' | 'I'
  defaultSupercell?: [number, number, number]
  bondPairRadii?: Record<string, number>
  polyhedraCentralElements?: string[]
  showCoordinationPolyhedra?: boolean
}

// Source: https://legacy.materialsproject.org/materials/mp-153/  (refresh via /rest/v2/materials/mp-153/cif)
const HCP_CIF = `# generated using pymatgen
data_Mg
_symmetry_space_group_name_H-M   'P 1'
_cell_length_a   3.20302773
_cell_length_b   3.20302773
_cell_length_c   5.12669100
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   120.00000000
_symmetry_Int_Tables_number   1
_chemical_formula_structural   Mg
_chemical_formula_sum   Mg2
_cell_volume   45.55008289
_cell_formula_units_Z   2
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Mg  Mg0  1  0.66666667  0.33333333  0.75000000  1
  Mg  Mg1  1  0.33333333  0.66666667  0.25000000  1
`

// Source: https://legacy.materialsproject.org/materials/mp-13/  (refresh via /rest/v2/materials/mp-13/cif)
const BCC_CIF = `# generated using pymatgen
data_Fe
_symmetry_space_group_name_H-M   'P 1'
_cell_length_a   2.84005168
_cell_length_b   2.84005168
_cell_length_c   2.84005168
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   90.00000000
_symmetry_Int_Tables_number   1
_chemical_formula_structural   Fe
_chemical_formula_sum   Fe2
_cell_volume   22.90755445
_cell_formula_units_Z   2
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Fe  Fe0  1  0.00000000  0.00000000  0.00000000  1
  Fe  Fe1  1  0.50000000  0.50000000  0.50000000  1
`

// Source: https://legacy.materialsproject.org/materials/mp-30/  (refresh via /rest/v2/materials/mp-30/cif)
const FCC_CIF = `# generated using pymatgen
data_Cu
_symmetry_space_group_name_H-M   'P 1'
_cell_length_a   3.62126200
_cell_length_b   3.62126200
_cell_length_c   3.62126200
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   90.00000000
_symmetry_Int_Tables_number   1
_chemical_formula_structural   Cu
_chemical_formula_sum   Cu4
_cell_volume   47.48755856
_cell_formula_units_Z   4
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Cu  Cu0  1  0.00000000  0.00000000  0.00000000  1
  Cu  Cu1  1  0.00000000  0.50000000  0.50000000  1
  Cu  Cu2  1  0.50000000  0.00000000  0.50000000  1
  Cu  Cu3  1  0.50000000  0.50000000  0.00000000  1
`

// Source: https://legacy.materialsproject.org/materials/mp-66/  (refresh via /rest/v2/materials/mp-66/cif)
const DIAMOND_CIF = `# generated using pymatgen
data_C
_symmetry_space_group_name_H-M   'P 1'
_cell_length_a   3.57371000
_cell_length_b   3.57371000
_cell_length_c   3.57371000
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   90.00000000
_symmetry_Int_Tables_number   1
_chemical_formula_structural   C
_chemical_formula_sum   C8
_cell_volume   45.64129120
_cell_formula_units_Z   8
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  C  C0  1  0.25000000  0.75000000  0.25000000  1
  C  C1  1  0.00000000  0.00000000  0.50000000  1
  C  C2  1  0.25000000  0.25000000  0.75000000  1
  C  C3  1  0.00000000  0.50000000  0.00000000  1
  C  C4  1  0.75000000  0.75000000  0.75000000  1
  C  C5  1  0.50000000  0.00000000  0.00000000  1
  C  C6  1  0.75000000  0.25000000  0.25000000  1
  C  C7  1  0.50000000  0.50000000  0.50000000  1
`

// Source: https://legacy.materialsproject.org/materials/mp-22862/  (refresh via /rest/v2/materials/mp-22862/cif)
const NACL_CIF = `# generated using pymatgen
data_NaCl
_symmetry_space_group_name_H-M   'P 1'
_cell_length_a   5.69169400
_cell_length_b   5.69169400
_cell_length_c   5.69169400
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   90.00000000
_symmetry_Int_Tables_number   1
_chemical_formula_structural   NaCl
_chemical_formula_sum   'Na4 Cl4'
_cell_volume   184.38459333
_cell_formula_units_Z   4
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Na  Na0  1  0.00000000  0.00000000  0.00000000  1
  Na  Na1  1  0.00000000  0.50000000  0.50000000  1
  Na  Na2  1  0.50000000  0.00000000  0.50000000  1
  Na  Na3  1  0.50000000  0.50000000  0.00000000  1
  Cl  Cl4  1  0.50000000  0.00000000  0.00000000  1
  Cl  Cl5  1  0.50000000  0.50000000  0.50000000  1
  Cl  Cl6  1  0.00000000  0.00000000  0.50000000  1
  Cl  Cl7  1  0.00000000  0.50000000  0.00000000  1
`

// Source: https://legacy.materialsproject.org/materials/mp-5229/  (refresh via /rest/v2/materials/mp-5229/cif)
const PEROVSKITE_CIF = `# generated using pymatgen
data_SrTiO3
_symmetry_space_group_name_H-M   'P 1'
_cell_length_a   3.94513000
_cell_length_b   3.94513000
_cell_length_c   3.94513000
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   90.00000000
_symmetry_Int_Tables_number   1
_chemical_formula_structural   SrTiO3
_chemical_formula_sum   'Sr1 Ti1 O3'
_cell_volume   61.40220340
_cell_formula_units_Z   1
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Sr  Sr0  1  0.00000000  0.00000000  0.00000000  1
  Ti  Ti1  1  0.50000000  0.50000000  0.50000000  1
  O  O2  1  0.50000000  0.00000000  0.50000000  1
  O  O3  1  0.50000000  0.50000000  0.00000000  1
  O  O4  1  0.00000000  0.50000000  0.50000000  1
`

// Source: https://legacy.materialsproject.org/materials/mp-48/  (refresh via /rest/v2/materials/mp-48/cif)
const GRAPHITE_CIF = `# generated using pymatgen
data_C
_symmetry_space_group_name_H-M   'P 1'
_cell_length_a   2.46772414
_cell_length_b   2.46772414
_cell_length_c   8.68503800
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   120.00000000
_symmetry_Int_Tables_number   1
_chemical_formula_structural   C
_chemical_formula_sum   C4
_cell_volume   45.80317400
_cell_formula_units_Z   4
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  C  C0  1  0.00000000  0.00000000  0.25000000  1
  C  C1  1  0.00000000  0.00000000  0.75000000  1
  C  C2  1  0.66666667  0.33333333  0.25000000  1
  C  C3  1  0.33333333  0.66666667  0.75000000  1
`

// Source: https://legacy.materialsproject.org/materials/mp-10695/  (refresh via /rest/v2/materials/mp-10695/cif)
const ZINCBLENDE_CIF = `# generated using pymatgen
data_ZnS
_symmetry_space_group_name_H-M   'P 1'
_cell_length_a   5.45027000
_cell_length_b   5.45027000
_cell_length_c   5.45027000
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   90.00000000
_symmetry_Int_Tables_number   1
_chemical_formula_structural   ZnS
_chemical_formula_sum   'Zn4 S4'
_cell_volume   161.90268522
_cell_formula_units_Z   4
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Zn  Zn0  1  0.00000000  0.00000000  0.00000000  1
  Zn  Zn1  1  0.00000000  0.50000000  0.50000000  1
  Zn  Zn2  1  0.50000000  0.00000000  0.50000000  1
  Zn  Zn3  1  0.50000000  0.50000000  0.00000000  1
  S  S4  1  0.25000000  0.25000000  0.75000000  1
  S  S5  1  0.25000000  0.75000000  0.25000000  1
  S  S6  1  0.75000000  0.25000000  0.25000000  1
  S  S7  1  0.75000000  0.75000000  0.75000000  1
`

// Bundled idealized molecular crystal supplied with the visual-style project.
const SBS6_CIF = `# bundled idealized SbS6 octahedra
data_SbS6
_symmetry_space_group_name_H-M   'P 1'
_symmetry_Int_Tables_number   1
_cell_length_a   13.50000000
_cell_length_b   4.90000000
_cell_length_c   4.90000000
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   90.00000000
_chemical_formula_structural   SbS6
_chemical_formula_sum   'Sb2 S12'
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Sb  Sb0  1  0.27000000  0.50000000  0.50000000  1
  S   S1   1  0.45076444  0.57490612  0.54960000  1
  S   S2   1  0.08923556  0.42509388  0.45040000  1
  S   S3   1  0.27000000  0.95870272  0.71389659  1
  S   S4   1  0.27000000  0.04129728  0.28610341  1
  S   S5   1  0.27000000  0.28610341  0.95870272  1
  S   S6   1  0.27000000  0.71389659  0.04129728  1
  Sb  Sb7  1  0.73000000  0.50000000  0.50000000  1
  S   S8   1  0.91076444  0.57490612  0.54960000  1
  S   S9   1  0.54923556  0.42509388  0.45040000  1
  S   S10  1  0.73000000  0.95870272  0.71389659  1
  S   S11  1  0.73000000  0.04129728  0.28610341  1
  S   S12  1  0.73000000  0.28610341  0.95870272  1
  S   S13  1  0.73000000  0.71389659  0.04129728  1
`

// Bundled conventional rutile cell from the supplied visual-style project.
const RUTILE_CIF = `# bundled rutile TiO2 conventional cell
data_TiO2_rutile
_symmetry_space_group_name_H-M   'P 1'
_symmetry_Int_Tables_number   1
_cell_length_a   4.59400000
_cell_length_b   4.59400000
_cell_length_c   2.95900000
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   90.00000000
_chemical_formula_structural   TiO2
_chemical_formula_sum   'Ti2 O4'
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Ti  Ti0  1  0.00000000  0.00000000  0.00000000  1
  Ti  Ti1  1  0.50000000  0.50000000  0.50000000  1
  O   O2   1  0.30500000  0.30500000  0.00000000  1
  O   O3   1  0.69500000  0.69500000  0.00000000  1
  O   O4   1  0.80500000  0.19500000  0.50000000  1
  O   O5   1  0.19500000  0.80500000  0.50000000  1
`

export const STRUCTURE_TEMPLATE_CIFS: Record<string, CrystalTemplateCifEntry> = {
  hcp:         { name: 'HCP (Mg)',                    source: { kind: 'materials-project', id: 'mp-153' },   cif: HCP_CIF,        spaceGroupNumber: 194, centeringType: 'P' },
  bcc:         { name: 'Body-Centered Cubic (α-Fe)',  source: { kind: 'materials-project', id: 'mp-13' },    cif: BCC_CIF,        spaceGroupNumber: 229, centeringType: 'I' },
  fcc:         { name: 'Face-Centered Cubic (Cu)',    source: { kind: 'materials-project', id: 'mp-30' },    cif: FCC_CIF,        spaceGroupNumber: 225, centeringType: 'F' },
  diamond:     { name: 'Diamond (C)',                 source: { kind: 'materials-project', id: 'mp-66' },    cif: DIAMOND_CIF,    spaceGroupNumber: 227, centeringType: 'F', defaultSupercell: [2, 2, 2], bondPairRadii: { 'C-C': 1.65 } },
  nacl:        { name: 'Rock Salt (NaCl)',            source: { kind: 'materials-project', id: 'mp-22862' }, cif: NACL_CIF,       spaceGroupNumber: 225, centeringType: 'F', defaultSupercell: [1, 1, 1], bondPairRadii: { 'Cl-Na': 2.95 }, polyhedraCentralElements: ['Na'] },
  perovskite:  { name: 'Perovskite (SrTiO₃)',        source: { kind: 'materials-project', id: 'mp-5229' },  cif: PEROVSKITE_CIF, spaceGroupNumber: 221, centeringType: 'P', defaultSupercell: [2, 2, 2], bondPairRadii: { 'O-Ti': 2.1 }, polyhedraCentralElements: ['Ti'], showCoordinationPolyhedra: true },
  graphite:    { name: 'Graphite (C)',                source: { kind: 'materials-project', id: 'mp-48' },    cif: GRAPHITE_CIF,   spaceGroupNumber: 194, centeringType: 'P' },
  zincblende:  { name: 'Zinc Blende (ZnS)',          source: { kind: 'materials-project', id: 'mp-10695' }, cif: ZINCBLENDE_CIF, spaceGroupNumber: 216, centeringType: 'F' },
  sbs6:        { name: 'SbS₆ Octahedral Molecule',   source: { kind: 'bundled', note: 'Idealized structure supplied with the visual-style project' }, cif: SBS6_CIF, spaceGroupNumber: 1, centeringType: 'P', defaultSupercell: [1, 1, 1], bondPairRadii: { 'S-Sb': 2.7 }, polyhedraCentralElements: ['Sb'] },
  rutile:      { name: 'Rutile (TiO₂)',               source: { kind: 'bundled', note: 'Conventional rutile cell supplied with the visual-style project' }, cif: RUTILE_CIF, spaceGroupNumber: 136, centeringType: 'P', defaultSupercell: [2, 2, 2], bondPairRadii: { 'O-Ti': 2.1 }, polyhedraCentralElements: ['Ti'], showCoordinationPolyhedra: true },
}

export function getCrystalTemplateNames(): string[] {
  return Object.keys(STRUCTURE_TEMPLATE_CIFS)
}
