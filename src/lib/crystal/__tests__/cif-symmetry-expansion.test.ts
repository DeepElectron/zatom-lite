import { describe, expect, it } from 'vitest'

import { parseCIF } from '../cif-parser'
import { listBuiltInSpaceGroups } from '../spacegroup-data'

// One Na at the origin in a rock-salt cell. With Fm-3m expansion this is the
// 4 Na of the conventional cell; with identity alone it is 1 atom — a cell
// that renders and is wrong.
function cif(header: string, symops?: string[]): string {
  return [
    'data_test',
    '_cell_length_a 5.64',
    '_cell_length_b 5.64',
    '_cell_length_c 5.64',
    '_cell_angle_alpha 90',
    '_cell_angle_beta 90',
    '_cell_angle_gamma 90',
    header,
    ...(symops
      ? ['loop_', '_symmetry_equiv_pos_as_xyz', ...symops.map((s) => `'${s}'`)]
      : []),
    'loop_',
    '_atom_site_label',
    '_atom_site_type_symbol',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    'Na1 Na 0 0 0',
    '',
  ].join('\n')
}

describe('CIF asymmetric-unit expansion is never silent', () => {
  it('expands from the built-in table when the file names a listed group without symops', () => {
    const result = parseCIF(cif("_symmetry_space_group_name_H-M 'F m -3 m'"))
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.atoms).toHaveLength(4)
  })

  it('refuses a listed-number but unlisted-table group instead of importing the asymmetric unit', () => {
    // No. 136 (P4_2/mnm, rutile) is not in the offline table.
    expect(listBuiltInSpaceGroups()).not.toContain(136)
    const result = parseCIF(cif('_symmetry_Int_Tables_number 136'))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.type).toBe('unsupported_symmetry')
      expect(result.error.message).toContain('136')
      expect(result.error.message).toContain('_symmetry_equiv_pos_as_xyz')
    }
  })

  it('refuses an unrecognised symbol without symops', () => {
    const result = parseCIF(cif("_symmetry_space_group_name_H-M 'P 42/m n m'"))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.type).toBe('unsupported_symmetry')
  })

  it('accepts any group when the file ships its own operations', () => {
    const result = parseCIF(cif('_symmetry_Int_Tables_number 136', ['x,y,z', '-x,-y,z']))
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.atoms).toHaveLength(1) // origin is fixed under both ops
  })

  it('accepts P1 with no operations', () => {
    const result = parseCIF(cif("_symmetry_space_group_name_H-M 'P 1'"))
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.atoms).toHaveLength(1)
  })

  it('accepts a file with no space group information at all', () => {
    const result = parseCIF(cif(''))
    expect(result.success).toBe(true)
  })
})
