export interface MoleculeTemplate {
  name: string
  formula: string
  format: 'xyz'
  xyz: string
  bonds?: Array<{ from: number; to: number; type: 'single' | 'double' | 'triple' }>
}

export const MOLECULE_TEMPLATES: Record<string, MoleculeTemplate> = {
  water: {
    name: "Water",
    formula: "H₂O",
    format: 'xyz',
    xyz: "3\nWater · H₂O\nO 0 0 0\nH 0.757 0.586 0\nH -0.757 0.586 0\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":0,"to":2,"type":"single"}],
  },
  methane: {
    name: "Methane",
    formula: "CH₄",
    format: 'xyz',
    xyz: "5\nMethane · CH₄\nC 0 0 0\nH 0.629 0.629 0.629\nH -0.629 -0.629 0.629\nH -0.629 0.629 -0.629\nH 0.629 -0.629 -0.629\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":0,"to":2,"type":"single"},{"from":0,"to":3,"type":"single"},{"from":0,"to":4,"type":"single"}],
  },
  ammonia: {
    name: "Ammonia",
    formula: "NH₃",
    format: 'xyz',
    xyz: "4\nAmmonia · NH₃\nN 0 0 0.116\nH 0.939 0 -0.271\nH -0.47 0.813 -0.271\nH -0.47 -0.813 -0.271\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":0,"to":2,"type":"single"},{"from":0,"to":3,"type":"single"}],
  },
  co2: {
    name: "Carbon Dioxide",
    formula: "CO₂",
    format: 'xyz',
    xyz: "3\nCarbon Dioxide · CO₂\nC 0 0 0\nO -1.16 0 0\nO 1.16 0 0\n",
    bonds: [{"from":0,"to":1,"type":"double"},{"from":0,"to":2,"type":"double"}],
  },
  ethane: {
    name: "Ethane",
    formula: "C₂H₆",
    format: 'xyz',
    xyz: "8\nEthane · C₂H₆\nC -0.762 0 0\nC 0.762 0 0\nH -1.157 0.513 0.89\nH -1.157 0.513 -0.89\nH -1.157 -1.027 0\nH 1.157 -0.513 0.89\nH 1.157 -0.513 -0.89\nH 1.157 1.027 0\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":0,"to":2,"type":"single"},{"from":0,"to":3,"type":"single"},{"from":0,"to":4,"type":"single"},{"from":1,"to":5,"type":"single"},{"from":1,"to":6,"type":"single"},{"from":1,"to":7,"type":"single"}],
  },
  ethylene: {
    name: "Ethylene",
    formula: "C₂H₄",
    format: 'xyz',
    xyz: "6\nEthylene · C₂H₄\nC -0.665 0 0\nC 0.665 0 0\nH -1.232 0.928 0\nH -1.232 -0.928 0\nH 1.232 0.928 0\nH 1.232 -0.928 0\n",
    bonds: [{"from":0,"to":1,"type":"double"},{"from":0,"to":2,"type":"single"},{"from":0,"to":3,"type":"single"},{"from":1,"to":4,"type":"single"},{"from":1,"to":5,"type":"single"}],
  },
  acetylene: {
    name: "Acetylene",
    formula: "C₂H₂",
    format: 'xyz',
    xyz: "4\nAcetylene · C₂H₂\nC -0.602 0 0\nC 0.602 0 0\nH -1.662 0 0\nH 1.662 0 0\n",
    bonds: [{"from":0,"to":1,"type":"triple"},{"from":0,"to":2,"type":"single"},{"from":1,"to":3,"type":"single"}],
  },
  benzene: {
    name: "Benzene",
    formula: "C₆H₆",
    format: 'xyz',
    xyz: "12\nBenzene · C₆H₆\nC 1.396 0 0\nC 0.698 1.209 0\nC -0.698 1.209 0\nC -1.396 0 0\nC -0.698 -1.209 0\nC 0.698 -1.209 0\nH 2.479 0 0\nH 1.24 2.147 0\nH -1.24 2.147 0\nH -2.479 0 0\nH -1.24 -2.147 0\nH 1.24 -2.147 0\n",
    bonds: [{"from":0,"to":1,"type":"double"},{"from":1,"to":2,"type":"single"},{"from":2,"to":3,"type":"double"},{"from":3,"to":4,"type":"single"},{"from":4,"to":5,"type":"double"},{"from":5,"to":0,"type":"single"},{"from":0,"to":6,"type":"single"},{"from":1,"to":7,"type":"single"},{"from":2,"to":8,"type":"single"},{"from":3,"to":9,"type":"single"},{"from":4,"to":10,"type":"single"},{"from":5,"to":11,"type":"single"}],
  },
  formaldehyde: {
    name: "Formaldehyde",
    formula: "CH₂O",
    format: 'xyz',
    xyz: "4\nFormaldehyde · CH₂O\nC 0 0 0\nO 0 1.21 0\nH 0.943 -0.544 0\nH -0.943 -0.544 0\n",
    bonds: [{"from":0,"to":1,"type":"double"},{"from":0,"to":2,"type":"single"},{"from":0,"to":3,"type":"single"}],
  },
  h2o2: {
    name: "Hydrogen Peroxide",
    formula: "H₂O₂",
    format: 'xyz',
    xyz: "4\nHydrogen Peroxide · H₂O₂\nO -0.727 0 0\nO 0.727 0 0\nH -1.044 0.926 0\nH 1.044 -0.926 0\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":0,"to":2,"type":"single"},{"from":1,"to":3,"type":"single"}],
  },
  methanol: {
    name: "Methanol",
    formula: "CH₃OH",
    format: 'xyz',
    xyz: "6\nMethanol · CH₃OH\nC -0.046 0.664 0\nO -0.046 -0.753 0\nH 1.012 0.93 0\nH -0.565 1.028 0.89\nH -0.565 1.028 -0.89\nH 0.852 -1.083 0\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":0,"to":2,"type":"single"},{"from":0,"to":3,"type":"single"},{"from":0,"to":4,"type":"single"},{"from":1,"to":5,"type":"single"}],
  },
  aceticAcid: {
    name: "Acetic Acid",
    formula: "CH₃COOH",
    format: 'xyz',
    xyz: "8\nAcetic Acid · CH₃COOH\nC -0.024 1.504 0\nC -0.024 0 0\nO 1.047 -0.625 0\nO -1.13 -0.683 0\nH 1.032 1.792 0\nH -0.557 1.878 0.879\nH -0.557 1.878 -0.879\nH -1.014 -1.634 0\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":1,"to":2,"type":"double"},{"from":1,"to":3,"type":"single"},{"from":0,"to":4,"type":"single"},{"from":0,"to":5,"type":"single"},{"from":0,"to":6,"type":"single"},{"from":3,"to":7,"type":"single"}],
  },
  hcn: {
    name: "Hydrogen Cyanide",
    formula: "HCN",
    format: 'xyz',
    xyz: "3\nHydrogen Cyanide · HCN\nH -1.595 0 0\nC -0.528 0 0\nN 0.628 0 0\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":1,"to":2,"type":"triple"}],
  },
  n2: {
    name: "Nitrogen",
    formula: "N₂",
    format: 'xyz',
    xyz: "2\nNitrogen · N₂\nN -0.548 0 0\nN 0.548 0 0\n",
    bonds: [{"from":0,"to":1,"type":"triple"}],
  },
  o2: {
    name: "Oxygen",
    formula: "O₂",
    format: 'xyz',
    xyz: "2\nOxygen · O₂\nO -0.604 0 0\nO 0.604 0 0\n",
    bonds: [{"from":0,"to":1,"type":"double"}],
  },
  h2: {
    name: "Hydrogen",
    formula: "H₂",
    format: 'xyz',
    xyz: "2\nHydrogen · H₂\nH -0.371 0 0\nH 0.371 0 0\n",
    bonds: [{"from":0,"to":1,"type":"single"}],
  },
  propane: {
    name: "Propane",
    formula: "C₃H₈",
    format: 'xyz',
    xyz: "11\nPropane · C₃H₈\nC -1.27 -0.26 0\nC 0 0.587 0\nC 1.27 -0.26 0\nH -2.151 0.38 0\nH -1.31 -0.905 0.881\nH -1.31 -0.905 -0.881\nH 0 1.232 0.881\nH 0 1.232 -0.881\nH 2.151 0.38 0\nH 1.31 -0.905 0.881\nH 1.31 -0.905 -0.881\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":1,"to":2,"type":"single"},{"from":0,"to":3,"type":"single"},{"from":0,"to":4,"type":"single"},{"from":0,"to":5,"type":"single"},{"from":1,"to":6,"type":"single"},{"from":1,"to":7,"type":"single"},{"from":2,"to":8,"type":"single"},{"from":2,"to":9,"type":"single"},{"from":2,"to":10,"type":"single"}],
  },
  /**
  * n-butane, **gauche conformation** (C-C-C-C dihedral angle ≈ 60°).
  *
  * Deliberately uses gauche rather than anti (180°), providing a meaningful
  * starting geometry for conformational editing and comparison.
  *
  * Coordinates are generated by Z-matrix from standard bond lengths and angles and verified item by item (C-C 1.53 Å, C-H 1.09 Å,
  * C-C-C 112.7°, non-bonded minimum distance 2.108 Å), not handwritten - handwritten three-dimensional coordinates of 14 atoms
  * When an error occurs, it still looks like a molecule when rendered, but the bond lengths are wrong and cannot be seen with the naked eye.
  */
  butane: {
    name: "n-Butane (gauche)",
    formula: "C₄H₁₀",
    format: 'xyz',
    xyz: "14\nn-Butane (gauche) · C₄H₁₀\nC -1.269 -0.938 -0.348\nC 0.261 -0.938 -0.348\nC 0.852 0.473 -0.348\nC 0.428 1.29 0.874\nH -1.651 -0.428 -1.232\nH -1.651 -1.959 -0.348\nH -1.651 -0.428 0.536\nH 0.757 0.802 1.792\nH 0.868 2.287 0.838\nH -0.656 1.393 0.908\nH 0.618 -1.475 -1.227\nH 0.618 -1.475 0.531\nH 0.535 0.993 -1.252\nH 1.939 0.405 -0.373\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":1,"to":2,"type":"single"},{"from":2,"to":3,"type":"single"},{"from":0,"to":4,"type":"single"},{"from":0,"to":5,"type":"single"},{"from":0,"to":6,"type":"single"},{"from":3,"to":7,"type":"single"},{"from":3,"to":8,"type":"single"},{"from":3,"to":9,"type":"single"},{"from":1,"to":10,"type":"single"},{"from":1,"to":11,"type":"single"},{"from":2,"to":12,"type":"single"},{"from":2,"to":13,"type":"single"}],
  },
  cyclohexane: {
    name: "Cyclohexane",
    formula: "C₆H₁₂",
    format: 'xyz',
    xyz: "18\nCyclohexane · C₆H₁₂\nC 1.262 0.728 0.252\nC 1.262 -0.728 -0.252\nC 0 -1.457 0.252\nC -1.262 -0.728 -0.252\nC -1.262 0.728 0.252\nC 0 1.457 -0.252\nH 1.303 0.728 1.344\nH 2.167 1.202 -0.131\nH 1.303 -0.728 -1.344\nH 2.167 -1.202 0.131\nH 0 -1.457 1.344\nH 0 -2.403 -0.131\nH -1.303 -0.728 -1.344\nH -2.167 -1.202 0.131\nH -1.303 0.728 1.344\nH -2.167 1.202 -0.131\nH 0 1.457 -1.344\nH 0 2.403 0.131\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":1,"to":2,"type":"single"},{"from":2,"to":3,"type":"single"},{"from":3,"to":4,"type":"single"},{"from":4,"to":5,"type":"single"},{"from":5,"to":0,"type":"single"},{"from":0,"to":6,"type":"single"},{"from":0,"to":7,"type":"single"},{"from":1,"to":8,"type":"single"},{"from":1,"to":9,"type":"single"},{"from":2,"to":10,"type":"single"},{"from":2,"to":11,"type":"single"},{"from":3,"to":12,"type":"single"},{"from":3,"to":13,"type":"single"},{"from":4,"to":14,"type":"single"},{"from":4,"to":15,"type":"single"},{"from":5,"to":16,"type":"single"},{"from":5,"to":17,"type":"single"}],
  },
  h2so4: {
    name: "Sulfuric Acid",
    formula: "H₂SO₄",
    format: 'xyz',
    xyz: "7\nSulfuric Acid · H₂SO₄\nS 0 0 0\nO 1.422 0 0\nO -1.422 0 0\nO 0 1.422 0\nO 0 -1.422 0\nH 1.8 0.88 0\nH -1.8 -0.88 0\n",
    bonds: [{"from":0,"to":1,"type":"single"},{"from":0,"to":2,"type":"single"},{"from":0,"to":3,"type":"double"},{"from":0,"to":4,"type":"double"},{"from":1,"to":5,"type":"single"},{"from":2,"to":6,"type":"single"}],
  },
}
