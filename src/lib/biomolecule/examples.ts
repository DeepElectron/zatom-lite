export interface RcsbBiomoleculeExample {
  id: string
  label: string
  description: string
}

export interface BiomoleculeTrajectoryExample extends RcsbBiomoleculeExample {
  frames: number
  /** A bundled path is used only for the explicitly synthetic demo. */
  src?: string
}

/** Examples carried by the authoritative viewer source. */
export const RCSB_BIOMOLECULE_EXAMPLES = [
  { id: '1CRN', label: 'Crambin', description: 'Small mixed α/β protein' },
  { id: '4HHB', label: 'Hemoglobin', description: 'Four chains with heme ligands' },
  { id: '1BNA', label: 'B-DNA', description: 'DNA double helix' },
  { id: '6LU7', label: 'SARS-CoV-2 Mpro', description: 'Protease with inhibitor N3' },
  { id: '1UBQ', label: 'Ubiquitin', description: 'Canonical 76-residue fold' },
  { id: '2PTC', label: 'Trypsin complex', description: 'Enzyme–inhibitor complex' },
  { id: '1CA2', label: 'Carbonic anhydrase II', description: 'Tetrahedral zinc site' },
  { id: '2SOD', label: 'Cu/Zn SOD', description: 'Coupled copper and zinc sites' },
  { id: '1MBO', label: 'Myoglobin', description: 'Heme iron coordination' },
  { id: '1ZNF', label: 'Zinc finger', description: 'Cys₂His₂ zinc domain' },
  { id: '1AZU', label: 'Azurin', description: 'Type-I blue copper site' },
] as const satisfies readonly RcsbBiomoleculeExample[]

/** Multi-MODEL examples carried by the authoritative viewer source. */
export const BIOMOLECULE_TRAJECTORY_EXAMPLES = [
  { id: 'DEMO-MD', label: 'Helix breathing · synthetic', description: '20-frame bundled poly-Ala breathing/unfolding demonstration', frames: 20, src: '/trajectories/demo-helix-md.pdb' },
  { id: '1D3Z', label: 'Ubiquitin NMR ensemble', description: '10 conformers paired with the 1UBQ crystal structure', frames: 10 },
  { id: '1G03', label: 'NMR ensemble', description: '20 conformers', frames: 20 },
  { id: '1ZNF', label: 'Zinc-finger NMR ensemble', description: '37 conformers with a zinc site', frames: 37 },
  { id: '2K39', label: 'Ubiquitin RDC ensemble', description: '116 conformers', frames: 116 },
  { id: '2LJ5', label: 'Large NMR ensemble', description: '301-conformer stress example', frames: 301 },
] as const satisfies readonly BiomoleculeTrajectoryExample[]
