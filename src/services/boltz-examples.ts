/**
 * One loadable, nontrivial example for each of the seven pipelines.
 *
 * This table is the single source of truth for both fetch-boltz-examples.mts and the UI gallery,
 * ensuring stored results match the inputs loaded into the form.
 *
 * Selection principles:
 * 1. Source all sequences and SMILES from RCSB or PubChem and record provenance.
 * 2. Use one-based positions in the submitted sequence, derived from mmCIF `label_seq_id`, not PDB
 *    author numbering. These often differ, as with the His-tagged KRAS chain in 6OIM.
 * 3. Give every case a falsifiable expectation, not merely an expectation that output exists.
 *
 * Interface residues use a fixed criterion of heavy-atom distance <=4.0 angstroms with at least two
 * contacts. Ligand pockets use <=4.5 angstroms with one contact because ligands are smaller.
 */

import type { BoltzPipelineId } from './boltz-pipelines'

// ---------------------------------------------------------------------------
// Target and candidate sequences, all sourced from RCSB FASTA as noted in provenance.
// ---------------------------------------------------------------------------

/**
 * KRAS G12C from 6OIM chain A with the first 14 His-tag residues removed. The resulting sequence
 * starts at native Met1 and position 12 is the mutated cysteine, matching conventional numbering.
 */
const KRAS_G12C =
  'MTEYKLVVVGACGVGKSALTIQLIQNHFVDEYDPTIEDSYRKQVVIDGETSLLDILDTAGQEEYSAMRDQYMRTGEGFLLVFAINNTKSFEDIHHYREQIKRVKDSEDVPMVLVGNKSDLPSRTVDTKQAQDLARSYGIPFIETSAKTRQGVDDAFYTLVREIRKHKEK'

/** ABL1 kinase domain from chain A of the 2HYY imatinib co-crystal. */
const ABL1_KINASE =
  'VSPNYDKWEMERTDITMKHKLGGGQYGEVYEGVWKKYSLTVAVKTLKEDTMEVEEFLKEAAVMKEIKHPNLVQLLGVCTREPPFYIITEFMTYGNLLDYLRECNRQEVNAVVLLYMATQISSAMEYLEKKNFIHRDLAARNCLVGENHLVKVADFGLSRLMTGDTYTAHAGAKFPIKWTAPESLAYNKFSIKSDVWAFGVLLWEIATYGMSPYPGIDLSQVYELLEKDYRMERPEGCPEKVYELMRACWQWNPSDRPSFAEIHQAFETMFQES'

/**
 * Human PD-L1 IgV domain, the first 120 residues of 3BIK chain A. The computed PD-1 interface ends
 * at position 108, so this retains margin without submitting the non-interacting IgC domain.
 */
const PD_L1_IGV =
  'AFTVTVPKDLYVVEYGSNMTIECKFPVEKQLDLAALIVYWEMEDKNIIQFVHGEEDLKVQHSSYRQRARLLKDQLSLGNAALQITDVKLQDAGVYRCMISYGGADYKRITVKVNAPYNK'

/** Human PD-1 extracellular domain from 3RRQ chain A, the native PD-L1 partner. */
const PD_1_HUMAN =
  'WNPPTFSPALLVVTEGDNATFTCSFSNTSESFVLNWYRMSPSNQTDKLAAFPEDRSQPGQDCRFRVTQLPNGRDFHMSVVRARRNDSGTYLCGAISLAPKLQIKESLRAELRVTERRAEVPTAHPSPSP'

/** Mouse PD-1 from 3BIK chain B, observed in complex with human PD-L1. */
const PD_1_MOUSE =
  'ALEVPNGPWRSLTFYPAWLTVSEGANATFTCSLSNWSEDLMLNWNRLSPSNQTEKQAAFSNGLSQPVQDARFQIIQLPNRHDFHMNILDTRRNDSGIYLCGAISLHPKAKIEESPGAELVVTERILETSTRYPS'

/** Small domains with no known PD-L1 interaction, used as negative controls. */
const CONTROL_UBIQUITIN = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG'
const CONTROL_PROTEIN_G = 'MTYKLILNGKTLKGETTTEAVDAATAEKVFKQYANDNGVDGEWTYDDATKTFTVTE'
const CONTROL_LYSOZYME =
  'MNIFEMLRIDEGLRLKIYKATEGYYTIGIGHLLTKSPSLNAAKSELDKAIGRNTNGVITKDEAEKLFNQDVDAAVRGILRNAKLKPVYDSLDAVRRAALINMVFQMGETGVAGFTNSLRMLQQKRWDEAAVNLAKSRWYNQTPNRAKRVITTFRTGTWDAYKNL'
const CONTROL_CRAMBIN = 'TTCCPSIVARSNFNVCRLPGTPEAICATYTGCIIIPGATCPGDYAN'
const CONTROL_SH3 = 'MDETGKELVLALYDYQEKSPREVTMKKGDILTLLNSTNKDWWKVEVNDRQGFVPAAYVKKLD'
const CONTROL_VILLIN = 'MLSDEDFKAVFGMTRSAFANLPLWKQQNLKKEKGLF'

// ---------------------------------------------------------------------------
// Ligands with SMILES sourced from RCSB chemical components or PubChem.
// ---------------------------------------------------------------------------

/**
 * Bound-state stereochemical SMILES for sotorasib (AMG 510), RCSB component MOV. Use this adduct
 * rather than the free acrylamide drug because Boltz models a noncovalent complex; it can be
 * compared directly with the molecule observed in 6OIM.
 */
const SOTORASIB_BOUND =
  'CCC(=O)N1CCN([C@H](C1)C)C2=NC(=O)N(c3c2cc(c(n3)c4c(cccc4F)O)F)c5c(ccnc5C(C)C)C'

/** Six marketed ABL1 TKIs expected to rank above the controls. */
const ABL1_INHIBITORS = [
  'CC1=C(C=C(C=C1)NC(=O)C2=CC=C(C=C2)CN3CCN(CC3)C)NC4=NC=CC(=N4)C5=CN=CC=C5', // imatinib
  'CC1=C(C=C(C=C1)C(=O)NC2=CC(=CC(=C2)C(F)(F)F)N3C=C(N=C3)C)NC4=NC=CC(=N4)C5=CN=CC=C5', // nilotinib
  'CC1=C(C(=CC=C1)Cl)NC(=O)C2=CN=C(S2)NC3=CC(=NC(=N3)C)N4CCN(CC4)CCO', // dasatinib
  'CN1CCN(CC1)CCCOC2=C(C=C3C(=C2)N=CC(=C3NC4=CC(=C(C=C4Cl)Cl)OC)C#N)OC', // bosutinib
  'CC1=C(C=C(C=C1)C(=O)NC2=CC(=C(C=C2)CN3CCN(CC3)C)C(F)(F)F)C#CC4=CN=C5N4N=CC=C5', // ponatinib
  'C1CN(CC1O)C2=C(C=C(C=N2)C(=O)NC3=CC=C(C=C3)OC(F)(F)Cl)C4=CC=NN4', // asciminib
]

/** Drugs not known to bind ABL1, used to test screening discrimination. */
const NON_BINDERS = [
  'CC(=O)OC1=CC=CC=C1C(=O)O', // aspirin
  'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', // caffeine
  'CC(C)CC1=CC=C(C=C1)C(C)C(=O)O', // ibuprofen
  'CN(C)C(=N)N=C(N)N', // metformin
]

/** Marketed drugs spanning broad physicochemical ranges for the ADME panel. */
const ADME_DRUGS = [
  ...ABL1_INHIBITORS.slice(0, 3),
  ...NON_BINDERS,
  'CC(C)C1=C(C(=C(N1CCC(CC(CC(=O)O)O)O)C2=CC=C(C=C2)F)C3=CC=CC=C3)C(=O)NC4=CC=CC=C4', // atorvastatin
  'CC(=O)CC(C1=CC=CC=C1)C2=C(C3=CC=CC=C3OC2=O)O', // warfarin
  SOTORASIB_BOUND,
]

// ---------------------------------------------------------------------------
// Sites computed from real structures with fixed criteria rather than manual selection.
// ---------------------------------------------------------------------------

/**
 * KRAS switch-II pocket residues within 4.5 angstroms of sotorasib in 6OIM, converted to the
 * tag-stripped sequence by subtracting 14 from label_seq_id. Includes Cys12 and residues 58-63.
 */
const KRAS_SWITCH_II_POCKET = [9, 10, 11, 12, 13, 16, 34, 58, 59, 60, 61, 62, 63, 68, 69, 72, 95, 96, 99, 100, 103]

/**
 * PD-1 epitope on PD-L1: residues in 3BIK within 4.0 angstroms and at least two atom contacts.
 * Positions use label_seq_id and cover the known interface hotspots.
 */
const PD_L1_EPITOPE = [2, 9, 39, 49, 96, 98, 104, 105, 106, 107, 108]

/**
 * BPTI interface residues against trypsin in 2PTC, label chain B versus A, within 4.0 angstroms
 * and at least two contacts. The nine residues include specificity-determining P1 Lys15.
 */
const BPTI_INTERFACE = [13, 14, 15, 16, 17, 18, 19, 38, 39]

// ---------------------------------------------------------------------------

/** Form values loaded into boltz-panel; field names mirror panel state. */
export interface BoltzExampleForm {
  sequence?: string
  ligand?: string
  epitope?: string
  library?: string
  units?: number
  predictionSamples?: number
  binderSource?: 'de_novo' | 'from_structure' | 'library'
  ligandSource?: 'design' | 'library'
  binderLength?: string
  redesignMode?: 'generic' | 'binder'
  redesignChain?: string
  redesignResidues?: string
  /** Repository mmCIF asset for examples requiring structure input. */
  structureAsset?: string
  /** Pocket residues for small-molecule design. */
  pocket?: string
}

export interface BoltzExample {
  /** Stable id and repository artifact directory name. */
  id: string
  pipelineId: BoltzPipelineId
  title: string
  /** Scientific question addressed by the case. */
  question: string
  /** Falsifiable expected result. */
  expectation: string
  /** Data provenance for verification. */
  provenance: string
  form: BoltzExampleForm
}

export const BOLTZ_EXAMPLES: readonly BoltzExample[] = [
  {
    id: 'kras-sotorasib',
    pipelineId: 'structure-and-binding',
    title: 'KRAS G12C + sotorasib',
    question:
      'Co-fold a marketed KRAS G12C inhibitor with its target to test whether the co-crystal pose is reproduced and scored.',
    expectation:
      'The drug should occupy the switch-II pocket (near Cys12 and residues 58–63), not elsewhere. High-scoring poses across the 8 samples should agree with one another and align with the 6OIM crystal structure. Scattered poses, or the drug drifting to the surface, count as failure.',
    provenance:
      'RCSB 6OIM chain A (His-tag stripped); ligand SMILES from RCSB chem-comp MOV stereo form',
    form: {
      sequence: KRAS_G12C,
      ligand: SOTORASIB_BOUND,
      predictionSamples: 8,
    },
  },
  {
    id: 'abl1-tki-screen',
    pipelineId: 'small-molecule-library-screen',
    title: 'ABL1 inhibitor screen (with negative controls)',
    question:
      'Rank 10 compounds against the ABL1 kinase: 6 marketed TKIs mixed with 4 unrelated drugs. Can the screen tell them apart?',
    expectation:
      'Imatinib, nilotinib, dasatinib, bosutinib, ponatinib and asciminib should all rank clearly above aspirin, caffeine, ibuprofen and metformin. A control breaking into the top ranks means the scoring has no discriminating power — this assertion is directly falsifiable.',
    provenance: 'ABL1 sequence from RCSB 2HYY chain A; all 10 SMILES from PubChem canonical forms',
    form: {
      sequence: ABL1_KINASE,
      library: [...ABL1_INHIBITORS, ...NON_BINDERS].join('\n'),
      ligandSource: 'library',
    },
  },
  {
    id: 'pdl1-binder-design',
    pipelineId: 'protein-design',
    title: 'De novo binder design against the PD-L1 epitope',
    question:
      'Design small protein binders against the genuine PD-1 binding face of PD-L1, starting from nothing but the target.',
    expectation:
      'Designs should bind the specified epitope — the face formed by Y56/D122/Y123/K124/R125, which PD-1 natively occupies — and binding confidence should fall monotonically down the candidate ranking. Binding the opposite face, or low epitope coverage, counts as failure.',
    provenance:
      'PD-L1 IgV domain from RCSB 3BIK chain A; epitope computed from ≤4.0 Å contacts in 3BIK',
    form: {
      sequence: PD_L1_IGV,
      epitope: PD_L1_EPITOPE.join(', '),
      units: 10,
      binderSource: 'de_novo',
      binderLength: '55..75',
    },
  },
  {
    id: 'pdl1-candidate-screen',
    pipelineId: 'protein-library-screen',
    title: 'PD-L1 candidate protein screen (with negative controls)',
    question:
      'Rank 8 candidate proteins against PD-L1: 2 genuine PD-1 orthologs (human and mouse) mixed with 6 unrelated small domains.',
    expectation:
      'Human and mouse PD-1 should take the top two places — 3BIK is itself a human PD-L1 + mouse PD-1 complex — while ubiquitin, protein G B1, T4 lysozyme, crambin, SH3 and villin rank clearly below. A control reaching the top two counts as failure.',
    provenance:
      'PD-1 from 3RRQ chain A and 3BIK chain B; controls from 1UBQ / 1PGA / 253L / 1CRN / 1SHG / 1VII',
    form: {
      sequence: PD_L1_IGV,
      library: [
        PD_1_HUMAN,
        PD_1_MOUSE,
        CONTROL_UBIQUITIN,
        CONTROL_PROTEIN_G,
        CONTROL_LYSOZYME,
        CONTROL_CRAMBIN,
        CONTROL_SH3,
        CONTROL_VILLIN,
      ].join('\n'),
      binderSource: 'library',
    },
  },
  {
    id: 'kras-ligand-design',
    pipelineId: 'small-molecule-design',
    title: 'Ligand design for the KRAS switch-II pocket',
    question:
      'Supply no known drug and specify only the switch-II pocket, then let the model generate small molecules from scratch.',
    expectation:
      'Generated molecules should occupy the sotorasib pocket (near Cys12 and residues 58–63) rather than scattering over the surface, and candidates should show genuine scaffold diversity rather than minor variations on one molecule. Landing away from the pocket counts as failure.',
    provenance:
      'KRAS G12C from 6OIM chain A; pocket residues computed from ≤4.5 Å contacts to MOV in 6OIM',
    form: {
      sequence: KRAS_G12C,
      pocket: KRAS_SWITCH_II_POCKET.join(', '),
      units: 10,
      ligandSource: 'design',
    },
  },
  {
    id: 'bpti-interface-redesign',
    pipelineId: 'protein-sequence-redesign',
    title: 'Sequence redesign of the BPTI inhibitor interface',
    question:
      'On the trypsin–BPTI complex, redesign only the 9 BPTI interface residues and leave every other position untouched.',
    expectation:
      'The returned sequence should differ only at the 9 specified positions — including the P1 residue Lys15, which inserts into the S1 pocket and sets specificity — with every other position matching native BPTI exactly. Any change outside the specified positions means the residue-indexing convention is wrong, so this case also pins down the 0-based / 1-based ambiguity.',
    // Calcium and water chains C/D/E are removed because the service requires entities to cover
    // every CIF chain exactly once. The stored fixture is submitted without further transformation.
    provenance:
      'RCSB 2PTC, polymer chains A/B only; interface residues computed from label chain B against A at ≤4.0 Å',
    form: {
      structureAsset: 'boltz-examples/inputs/2ptc-polymer.cif',
      redesignMode: 'binder',
      redesignChain: 'B',
      redesignResidues: BPTI_INTERFACE.join(', '),
      units: 10,
    },
  },
  {
    id: 'drug-adme-panel',
    pipelineId: 'adme',
    title: 'ADME profile for 10 marketed drugs',
    question:
      'Run a set of drugs spanning a wide physicochemical range in a single pass to see whether the prediction reproduces known absorption and distribution differences.',
    expectation:
      'Metformin (highly polar, poor oral absorption) and atorvastatin (highly lipophilic, high protein binding) should sit at opposite ends of the property ranges, and caffeine should show high permeability. All 10 drugs clustering together means the prediction has no discriminating power.',
    provenance: '10 SMILES from PubChem canonical forms; sotorasib uses RCSB chem-comp MOV',
    form: {
      library: ADME_DRUGS.join('\n'),
    },
  },
]

const BY_ID = new Map(BOLTZ_EXAMPLES.map((example) => [example.id, example]))

export function getBoltzExample(id: string): BoltzExample | undefined {
  return BY_ID.get(id)
}

/** Return the example associated with one pipeline. */
export function exampleForPipeline(pipelineId: BoltzPipelineId): BoltzExample | undefined {
  return BOLTZ_EXAMPLES.find((example) => example.pipelineId === pipelineId)
}
