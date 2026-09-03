/**
 * HPKOT band-path data.
 *
 * Y. Hinuma, G. Pizzi, Y. Kumagai, F. Oba, I. Tanaka, "Band structure diagram
 * paths based on crystallography", Comput. Mater. Sci. 128 (2017) 140-184.
 *
 * The table below is the seekpath reference data
 * (seekpath/hpkot/band_path_data/<type>/{points,path,k_vector_parameters}.txt)
 * reproduced verbatim: same labels, same expressions, same segment order. Do
 * not edit entries by hand; regenerate from seekpath if the reference changes.
 * Expressions are evaluated by `evaluateKExpression`, a real parser, so any
 * arithmetic the reference writes is supported.
 */

import jsep from 'jsep'

export type ExtendedBravaisType = 
  | 'aP2' | 'aP3'  // Triclinic (all-obtuse, all-acute)
  | 'cF1' | 'cF2'  // Cubic face-centered
  | 'cI1'          // Cubic body-centered
  | 'cP1' | 'cP2'  // Cubic primitive
  | 'hP1' | 'hP2'  // Hexagonal primitive
  | 'hR1' | 'hR2'  // Rhombohedral (hexagonal setting)
  | 'mC1' | 'mC2' | 'mC3'  // Monoclinic C-centered
  | 'mP1'          // Monoclinic primitive
  | 'oA1' | 'oA2'  // Orthorhombic A-centered
  | 'oC1' | 'oC2'  // Orthorhombic C-centered
  | 'oF1' | 'oF2' | 'oF3'  // Orthorhombic face-centered
  | 'oI1' | 'oI2' | 'oI3'  // Orthorhombic body-centered
  | 'oP1'          // Orthorhombic primitive
  | 'tI1' | 'tI2'  // Tetragonal body-centered
  | 'tP1'          // Tetragonal primitive

/**
 * K-vector parameter definitions
 * Format: [paramName, expression]
 * The expression uses a, b, c, cosalpha, cosbeta, cosgamma
 */
export interface KParamDef {
  name: string
  expr: string
}

/**
 * K-point definition using symbolic coordinates
 */
export interface KPointDef {
  [label: string]: [string, string, string]  // Symbolic coordinates
}

/**
 * Complete band path data for an extended Bravais type
 */
export interface BandPathData {
  kparams: KParamDef[]
  points: KPointDef
  path: [string, string][]
}

/**
 * All band path data organized by extended Bravais type
 */
export const HPKOT_DATA: Record<ExtendedBravaisType, BandPathData> = {
  cP1: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      R: ['1/2', '1/2', '1/2'],
      M: ['1/2', '1/2', '0'],
      X: ['0', '1/2', '0'],
      X_1: ['1/2', '0', '0'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'M'],
      ['M', 'GAMMA'],
      ['GAMMA', 'R'],
      ['R', 'X'],
      ['R', 'M'],
      ['M', 'X_1'],
    ],
  },
  cP2: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      R: ['1/2', '1/2', '1/2'],
      M: ['1/2', '1/2', '0'],
      X: ['0', '1/2', '0'],
      X_1: ['1/2', '0', '0'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'M'],
      ['M', 'GAMMA'],
      ['GAMMA', 'R'],
      ['R', 'X'],
      ['R', 'M'],
    ],
  },
  cF1: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      X: ['1/2', '0', '1/2'],
      L: ['1/2', '1/2', '1/2'],
      W: ['1/2', '1/4', '3/4'],
      W_2: ['3/4', '1/4', '1/2'],
      K: ['3/8', '3/8', '3/4'],
      U: ['5/8', '1/4', '5/8'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'U'],
      ['K', 'GAMMA'],
      ['GAMMA', 'L'],
      ['L', 'W'],
      ['W', 'X'],
      ['X', 'W_2'],
    ],
  },
  cF2: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      X: ['1/2', '0', '1/2'],
      L: ['1/2', '1/2', '1/2'],
      W: ['1/2', '1/4', '3/4'],
      W_2: ['3/4', '1/4', '1/2'],
      K: ['3/8', '3/8', '3/4'],
      U: ['5/8', '1/4', '5/8'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'U'],
      ['K', 'GAMMA'],
      ['GAMMA', 'L'],
      ['L', 'W'],
      ['W', 'X'],
    ],
  },
  cI1: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      H: ['1/2', '-1/2', '1/2'],
      P: ['1/4', '1/4', '1/4'],
      N: ['0', '0', '1/2'],
    },
    path: [
      ['GAMMA', 'H'],
      ['H', 'N'],
      ['N', 'GAMMA'],
      ['GAMMA', 'P'],
      ['P', 'H'],
      ['P', 'N'],
    ],
  },
  tP1: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Z: ['0', '0', '1/2'],
      M: ['1/2', '1/2', '0'],
      A: ['1/2', '1/2', '1/2'],
      R: ['0', '1/2', '1/2'],
      X: ['0', '1/2', '0'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'M'],
      ['M', 'GAMMA'],
      ['GAMMA', 'Z'],
      ['Z', 'R'],
      ['R', 'A'],
      ['A', 'Z'],
      ['X', 'R'],
      ['M', 'A'],
    ],
  },
  tI1: {
    kparams: [
      { name: 'H', expr: '(1+c*c/a/a)/4' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      M: ['-1/2', '1/2', '1/2'],
      X: ['0', '0', '1/2'],
      P: ['1/4', '1/4', '1/4'],
      Z: ['H', 'H', '-H'],
      Z_0: ['-H', '1-H', 'H'],
      N: ['0', '1/2', '0'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'M'],
      ['M', 'GAMMA'],
      ['GAMMA', 'Z'],
      ['Z_0', 'M'],
      ['X', 'P'],
      ['P', 'N'],
      ['N', 'GAMMA'],
    ],
  },
  tI2: {
    kparams: [
      { name: 'H', expr: '(1+a*a/c/c)/4' },
      { name: 'Z', expr: 'a*a/2/c/c' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      M: ['1/2', '1/2', '-1/2'],
      X: ['0', '0', '1/2'],
      P: ['1/4', '1/4', '1/4'],
      N: ['0', '1/2', '0'],
      S_0: ['-H', 'H', 'H'],
      S: ['H', '1-H', '-H'],
      R: ['-Z', 'Z', '1/2'],
      G: ['1/2', '1/2', '-Z'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'P'],
      ['P', 'N'],
      ['N', 'GAMMA'],
      ['GAMMA', 'M'],
      ['M', 'S'],
      ['S_0', 'GAMMA'],
      ['X', 'R'],
      ['G', 'M'],
    ],
  },
  oP1: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      X: ['1/2', '0', '0'],
      Z: ['0', '0', '1/2'],
      U: ['1/2', '0', '1/2'],
      Y: ['0', '1/2', '0'],
      S: ['1/2', '1/2', '0'],
      T: ['0', '1/2', '1/2'],
      R: ['1/2', '1/2', '1/2'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'S'],
      ['S', 'Y'],
      ['Y', 'GAMMA'],
      ['GAMMA', 'Z'],
      ['Z', 'U'],
      ['U', 'R'],
      ['R', 'T'],
      ['T', 'Z'],
      ['X', 'U'],
      ['Y', 'T'],
      ['S', 'R'],
    ],
  },
  oF1: {
    kparams: [
      { name: 'J', expr: '(1+a*a/b/b-a*a/c/c)/4' },
      { name: 'H', expr: '(1+a*a/b/b+a*a/c/c)/4' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      T: ['1', '1/2', '1/2'],
      Z: ['1/2', '1/2', '0'],
      Y: ['1/2', '0', '1/2'],
      SIGMA_0: ['0', 'H', 'H'],
      U_0: ['1', '1-H', '1-H'],
      A_0: ['1/2', '1/2+J', 'J'],
      C_0: ['1/2', '1/2-J', '1-J'],
      L: ['1/2', '1/2', '1/2'],
    },
    path: [
      ['GAMMA', 'Y'],
      ['Y', 'T'],
      ['T', 'Z'],
      ['Z', 'GAMMA'],
      ['GAMMA', 'SIGMA_0'],
      ['U_0', 'T'],
      ['Y', 'C_0'],
      ['A_0', 'Z'],
      ['GAMMA', 'L'],
    ],
  },
  oF2: {
    kparams: [
      { name: 'J', expr: '(1+c*c/a/a-c*c/b/b)/4' },
      { name: 'K', expr: '(1+c*c/a/a+c*c/b/b)/4' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      T: ['0', '1/2', '1/2'],
      Z: ['1/2', '1/2', '1'],
      Y: ['1/2', '0', '1/2'],
      LAMBDA_0: ['K', 'K', '0'],
      Q_0: ['1-K', '1-K', '1'],
      G_0: ['1/2-J', '1-J', '1/2'],
      H_0: ['1/2+J', 'J', '1/2'],
      L: ['1/2', '1/2', '1/2'],
    },
    path: [
      ['GAMMA', 'T'],
      ['T', 'Z'],
      ['Z', 'Y'],
      ['Y', 'GAMMA'],
      ['GAMMA', 'LAMBDA_0'],
      ['Q_0', 'Z'],
      ['T', 'G_0'],
      ['H_0', 'Y'],
      ['GAMMA', 'L'],
    ],
  },
  oF3: {
    kparams: [
      { name: 'H', expr: '(1+a*a/b/b-a*a/c/c)/4' },
      { name: 'K', expr: '(1+b*b/a/a-b*b/c/c)/4' },
      { name: 'P', expr: '(1+c*c/b/b-c*c/a/a)/4' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      T: ['0', '1/2', '1/2'],
      Z: ['1/2', '1/2', '0'],
      Y: ['1/2', '0', '1/2'],
      A_0: ['1/2', '1/2+H', 'H'],
      C_0: ['1/2', '1/2-H', '1-H'],
      B_0: ['1/2+K', '1/2', 'K'],
      D_0: ['1/2-K', '1/2', '1-K'],
      G_0: ['P', '1/2+P', '1/2'],
      H_0: ['1-P', '1/2-P', '1/2'],
      L: ['1/2', '1/2', '1/2'],
    },
    path: [
      ['GAMMA', 'Y'],
      ['Y', 'C_0'],
      ['A_0', 'Z'],
      ['Z', 'B_0'],
      ['D_0', 'T'],
      ['T', 'G_0'],
      ['H_0', 'Y'],
      ['T', 'GAMMA'],
      ['GAMMA', 'Z'],
      ['GAMMA', 'L'],
    ],
  },
  oI1: {
    kparams: [
      { name: 'Z', expr: '(1+a*a/c/c)/4' },
      { name: 'H', expr: '(1+b*b/c/c)/4' },
      { name: 'D', expr: '(b*b-a*a)/4/c/c' },
      { name: 'N', expr: '(a*a+b*b)/4/c/c' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      X: ['1/2', '1/2', '-1/2'],
      S: ['1/2', '0', '0'],
      R: ['0', '1/2', '0'],
      T: ['0', '0', '1/2'],
      W: ['1/4', '1/4', '1/4'],
      SIGMA_0: ['-Z', 'Z', 'Z'],
      F_2: ['Z', '1-Z', '-Z'],
      Y_0: ['H', '-H', 'H'],
      U_0: ['1-H', 'H', '-H'],
      L_0: ['-N', 'N', '1/2-D'],
      M_0: ['N', '-N', '1/2+D'],
      J_0: ['1/2-D', '1/2+D', '-N'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'F_2'],
      ['SIGMA_0', 'GAMMA'],
      ['GAMMA', 'Y_0'],
      ['U_0', 'X'],
      ['GAMMA', 'R'],
      ['R', 'W'],
      ['W', 'S'],
      ['S', 'GAMMA'],
      ['GAMMA', 'T'],
      ['T', 'W'],
    ],
  },
  oI2: {
    kparams: [
      { name: 'Z', expr: '(1+b*b/a/a)/4' },
      { name: 'H', expr: '(1+c*c/a/a)/4' },
      { name: 'D', expr: '(c*c-b*b)/4/a/a' },
      { name: 'N', expr: '(b*b+c*c)/4/a/a' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      X: ['-1/2', '1/2', '1/2'],
      S: ['1/2', '0', '0'],
      R: ['0', '1/2', '0'],
      T: ['0', '0', '1/2'],
      W: ['1/4', '1/4', '1/4'],
      Y_0: ['Z', '-Z', 'Z'],
      U_2: ['-Z', 'Z', '1-Z'],
      LAMBDA_0: ['H', 'H', '-H'],
      G_2: ['-H', '1-H', 'H'],
      K: ['1/2-D', '-N', 'N'],
      K_2: ['1/2+D', 'N', '-N'],
      K_4: ['-N', '1/2-D', '1/2+D'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'U_2'],
      ['Y_0', 'GAMMA'],
      ['GAMMA', 'LAMBDA_0'],
      ['G_2', 'X'],
      ['GAMMA', 'R'],
      ['R', 'W'],
      ['W', 'S'],
      ['S', 'GAMMA'],
      ['GAMMA', 'T'],
      ['T', 'W'],
    ],
  },
  oI3: {
    kparams: [
      { name: 'Z', expr: '(1+c*c/b/b)/4' },
      { name: 'Y', expr: '(1+a*a/b/b)/4' },
      { name: 'D', expr: '(a*a-c*c)/4/b/b' },
      { name: 'M', expr: '(c*c+a*a)/4/b/b' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      X: ['1/2', '-1/2', '1/2'],
      S: ['1/2', '0', '0'],
      R: ['0', '1/2', '0'],
      T: ['0', '0', '1/2'],
      W: ['1/4', '1/4', '1/4'],
      SIGMA_0: ['-Y', 'Y', 'Y'],
      F_0: ['Y', '-Y', '1-Y'],
      LAMBDA_0: ['Z', 'Z', '-Z'],
      G_0: ['1-Z', '-Z', 'Z'],
      V_0: ['M', '1/2-D', '-M'],
      H_0: ['-M', '1/2+D', 'M'],
      H_2: ['1/2+D', '-M', '1/2-D'],
    },
    path: [
      ['GAMMA', 'X'],
      ['X', 'F_0'],
      ['SIGMA_0', 'GAMMA'],
      ['GAMMA', 'LAMBDA_0'],
      ['G_0', 'X'],
      ['GAMMA', 'R'],
      ['R', 'W'],
      ['W', 'S'],
      ['S', 'GAMMA'],
      ['GAMMA', 'T'],
      ['T', 'W'],
    ],
  },
  oC1: {
    kparams: [
      { name: 'X', expr: '(1+a*a/b/b)/4' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Y: ['-1/2', '1/2', '0'],
      T: ['-1/2', '1/2', '1/2'],
      Z: ['0', '0', '1/2'],
      S: ['0', '1/2', '0'],
      R: ['0', '1/2', '1/2'],
      SIGMA_0: ['X', 'X', '0'],
      C_0: ['-X', '1-X', '0'],
      A_0: ['X', 'X', '1/2'],
      E_0: ['-X', '1-X', '1/2'],
    },
    path: [
      ['GAMMA', 'Y'],
      ['Y', 'C_0'],
      ['SIGMA_0', 'GAMMA'],
      ['GAMMA', 'Z'],
      ['Z', 'A_0'],
      ['E_0', 'T'],
      ['T', 'Y'],
      ['GAMMA', 'S'],
      ['S', 'R'],
      ['R', 'Z'],
      ['Z', 'T'],
    ],
  },
  oC2: {
    kparams: [
      { name: 'X', expr: '(1+b*b/a/a)/4' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Y: ['1/2', '1/2', '0'],
      T: ['1/2', '1/2', '1/2'],
      T_2: ['1/2', '1/2', '-1/2'],
      Z: ['0', '0', '1/2'],
      Z_2: ['0', '0', '-1/2'],
      S: ['0', '1/2', '0'],
      R: ['0', '1/2', '1/2'],
      R_2: ['0', '1/2', '-1/2'],
      DELTA_0: ['-X', 'X', '0'],
      F_0: ['X', '1-X', '0'],
      B_0: ['-X', 'X', '1/2'],
      B_2: ['-X', 'X', '-1/2'],
      G_0: ['X', '1-X', '1/2'],
      G_2: ['X', '1-X', '-1/2'],
    },
    path: [
      ['GAMMA', 'Y'],
      ['Y', 'F_0'],
      ['DELTA_0', 'GAMMA'],
      ['GAMMA', 'Z'],
      ['Z', 'B_0'],
      ['G_0', 'T'],
      ['T', 'Y'],
      ['GAMMA', 'S'],
      ['S', 'R'],
      ['R', 'Z'],
      ['Z', 'T'],
    ],
  },
  oA1: {
    kparams: [
      { name: 'X', expr: '(1+b*b/c/c)/4' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Y: ['-1/2', '1/2', '0'],
      T: ['-1/2', '1/2', '1/2'],
      Z: ['0', '0', '1/2'],
      S: ['0', '1/2', '0'],
      R: ['0', '1/2', '1/2'],
      SIGMA_0: ['X', 'X', '0'],
      C_0: ['-X', '1-X', '0'],
      A_0: ['X', 'X', '1/2'],
      E_0: ['-X', '1-X', '1/2'],
    },
    path: [
      ['GAMMA', 'Y'],
      ['Y', 'C_0'],
      ['SIGMA_0', 'GAMMA'],
      ['GAMMA', 'Z'],
      ['Z', 'A_0'],
      ['E_0', 'T'],
      ['T', 'Y'],
      ['GAMMA', 'S'],
      ['S', 'R'],
      ['R', 'Z'],
      ['Z', 'T'],
    ],
  },
  oA2: {
    kparams: [
      { name: 'X', expr: '(1+c*c/b/b)/4' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Y: ['1/2', '1/2', '0'],
      T: ['1/2', '1/2', '1/2'],
      T_2: ['1/2', '1/2', '-1/2'],
      Z: ['0', '0', '1/2'],
      Z_2: ['0', '0', '-1/2'],
      S: ['0', '1/2', '0'],
      R: ['0', '1/2', '1/2'],
      R_2: ['0', '1/2', '-1/2'],
      DELTA_0: ['-X', 'X', '0'],
      F_0: ['X', '1-X', '0'],
      B_0: ['-X', 'X', '1/2'],
      B_2: ['-X', 'X', '-1/2'],
      G_0: ['X', '1-X', '1/2'],
      G_2: ['X', '1-X', '-1/2'],
    },
    path: [
      ['GAMMA', 'Y'],
      ['Y', 'F_0'],
      ['DELTA_0', 'GAMMA'],
      ['GAMMA', 'Z'],
      ['Z', 'B_0'],
      ['G_0', 'T'],
      ['T', 'Y'],
      ['GAMMA', 'S'],
      ['S', 'R'],
      ['R', 'Z'],
      ['Z', 'T'],
    ],
  },
  hP1: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      A: ['0', '0', '1/2'],
      K: ['1/3', '1/3', '0'],
      H: ['1/3', '1/3', '1/2'],
      H_2: ['1/3', '1/3', '-1/2'],
      M: ['1/2', '0', '0'],
      L: ['1/2', '0', '1/2'],
    },
    path: [
      ['GAMMA', 'M'],
      ['M', 'K'],
      ['K', 'GAMMA'],
      ['GAMMA', 'A'],
      ['A', 'L'],
      ['L', 'H'],
      ['H', 'A'],
      ['L', 'M'],
      ['H', 'K'],
      ['K', 'H_2'],
    ],
  },
  hP2: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      A: ['0', '0', '1/2'],
      K: ['1/3', '1/3', '0'],
      H: ['1/3', '1/3', '1/2'],
      H_2: ['1/3', '1/3', '-1/2'],
      M: ['1/2', '0', '0'],
      L: ['1/2', '0', '1/2'],
    },
    path: [
      ['GAMMA', 'M'],
      ['M', 'K'],
      ['K', 'GAMMA'],
      ['GAMMA', 'A'],
      ['A', 'L'],
      ['L', 'H'],
      ['H', 'A'],
      ['L', 'M'],
      ['H', 'K'],
    ],
  },
  hR1: {
    kparams: [
      { name: 'D', expr: 'a*a/4/c/c' },
      { name: 'Y', expr: '5/6-2*D' },
      { name: 'N', expr: '1/3+D' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      T: ['1/2', '1/2', '1/2'],
      L: ['1/2', '0', '0'],
      L_2: ['0', '-1/2', '0'],
      L_4: ['0', '0', '-1/2'],
      F: ['1/2', '0', '1/2'],
      F_2: ['1/2', '1/2', '0'],
      S_0: ['N', '-N', '0'],
      S_2: ['1-N', '0', 'N'],
      S_4: ['N', '0', '-N'],
      S_6: ['1-N', 'N', '0'],
      H_0: ['1/2', '-1+Y', '1-Y'],
      H_2: ['Y', '1-Y', '1/2'],
      H_4: ['Y', '1/2', '1-Y'],
      H_6: ['1/2', '1-Y', '-1+Y'],
      M_0: ['N', '-1+Y', 'N'],
      M_2: ['1-N', '1-Y', '1-N'],
      M_4: ['Y', 'N', 'N'],
      M_6: ['1-N', '1-N', '1-Y'],
      M_8: ['N', 'N', '-1+Y'],
    },
    path: [
      ['GAMMA', 'T'],
      ['T', 'H_2'],
      ['H_0', 'L'],
      ['L', 'GAMMA'],
      ['GAMMA', 'S_0'],
      ['S_2', 'F'],
      ['F', 'GAMMA'],
    ],
  },
  hR2: {
    kparams: [
      { name: 'Z', expr: '1/6-c*c/9/a/a' },
      { name: 'H', expr: '1/2-2*Z' },
      { name: 'N', expr: '1/2+Z' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      T: ['1/2', '-1/2', '1/2'],
      P_0: ['H', '-1+H', 'H'],
      P_2: ['H', 'H', 'H'],
      R_0: ['1-H', '-H', '-H'],
      M: ['1-N', '-N', '1-N'],
      M_2: ['N', '-1+N', '-1+N'],
      L: ['1/2', '0', '0'],
      F: ['1/2', '-1/2', '0'],
    },
    path: [
      ['GAMMA', 'L'],
      ['L', 'T'],
      ['T', 'P_0'],
      ['P_2', 'GAMMA'],
      ['GAMMA', 'F'],
    ],
  },
  mP1: {
    kparams: [
      { name: 'Y', expr: '(1+a/c*cosbeta)/2/sinbeta/sinbeta' },
      { name: 'N', expr: '1/2+Y*c*cosbeta/a' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Z: ['0', '1/2', '0'],
      B: ['0', '0', '1/2'],
      B_2: ['0', '0', '-1/2'],
      Y: ['1/2', '0', '0'],
      Y_2: ['-1/2', '0', '0'],
      C: ['1/2', '1/2', '0'],
      C_2: ['-1/2', '1/2', '0'],
      D: ['0', '1/2', '1/2'],
      D_2: ['0', '1/2', '-1/2'],
      A: ['-1/2', '0', '1/2'],
      E: ['-1/2', '1/2', '1/2'],
      H: ['-Y', '0', '1-N'],
      H_2: ['-1+Y', '0', 'N'],
      H_4: ['-Y', '0', '-N'],
      M: ['-Y', '1/2', '1-N'],
      M_2: ['-1+Y', '1/2', 'N'],
      M_4: ['-Y', '1/2', '-N'],
    },
    path: [
      ['GAMMA', 'Z'],
      ['Z', 'D'],
      ['D', 'B'],
      ['B', 'GAMMA'],
      ['GAMMA', 'A'],
      ['A', 'E'],
      ['E', 'Z'],
      ['Z', 'C_2'],
      ['C_2', 'Y_2'],
      ['Y_2', 'GAMMA'],
    ],
  },
  mC1: {
    kparams: [
      { name: 'Z', expr: '(2+a/c*cosbeta)/4/sinbeta/sinbeta' },
      { name: 'H', expr: '1/2-2*Z*c*cosbeta/a' },
      { name: 'S', expr: '3/4-b*b/4/a/a/sinbeta/sinbeta' },
      { name: 'P', expr: 'S-(3/4-S)*a*cosbeta/c' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Y_2: ['-1/2', '1/2', '0'],
      Y_4: ['1/2', '-1/2', '0'],
      A: ['0', '0', '1/2'],
      M_2: ['-1/2', '1/2', '1/2'],
      V: ['1/2', '0', '0'],
      V_2: ['0', '1/2', '0'],
      L_2: ['0', '1/2', '1/2'],
      C: ['1-S', '1-S', '0'],
      C_2: ['-1+S', 'S', '0'],
      C_4: ['S', '-1+S', '0'],
      D: ['-1+P', 'P', '1/2'],
      D_2: ['1-P', '1-P', '1/2'],
      E: ['-1+Z', '1-Z', '1-H'],
      E_2: ['-Z', 'Z', 'H'],
      E_4: ['Z', '-Z', '1-H'],
    },
    path: [
      ['GAMMA', 'C'],
      ['C_2', 'Y_2'],
      ['Y_2', 'GAMMA'],
      ['GAMMA', 'M_2'],
      ['M_2', 'D'],
      ['D_2', 'A'],
      ['A', 'GAMMA'],
      ['L_2', 'GAMMA'],
      ['GAMMA', 'V_2'],
    ],
  },
  mC2: {
    kparams: [
      { name: 'Z', expr: '(a*a/b/b+(1+a/c*cosbeta)/sinbeta/sinbeta)/4' },
      { name: 'M', expr: '(1+a*a/b/b)/4' },
      { name: 'D', expr: '-a*c*cosbeta/2/b/b' },
      { name: 'X', expr: '1/2-2*Z*c*cosbeta/a' },
      { name: 'P', expr: '1+Z-2*M' },
      { name: 'S', expr: 'X-2*D' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Y: ['1/2', '1/2', '0'],
      A: ['0', '0', '1/2'],
      M: ['1/2', '1/2', '1/2'],
      V_2: ['0', '1/2', '0'],
      L_2: ['0', '1/2', '1/2'],
      F: ['-1+P', '1-P', '1-S'],
      F_2: ['1-P', 'P', 'S'],
      F_4: ['P', '1-P', '1-S'],
      H: ['-Z', 'Z', 'X'],
      H_2: ['Z', '1-Z', '1-X'],
      H_4: ['Z', '-Z', '1-X'],
      G: ['-M', 'M', 'D'],
      G_2: ['M', '1-M', '-D'],
      G_4: ['M', '-M', '-D'],
      G_6: ['1-M', 'M', 'D'],
    },
    path: [
      ['GAMMA', 'Y'],
      ['Y', 'M'],
      ['M', 'A'],
      ['A', 'GAMMA'],
      ['L_2', 'GAMMA'],
      ['GAMMA', 'V_2'],
    ],
  },
  mC3: {
    kparams: [
      { name: 'Z', expr: '(a*a/b/b+(1+a/c*cosbeta)/sinbeta/sinbeta)/4' },
      { name: 'R', expr: '1-Z*b*b/a/a' },
      { name: 'E', expr: '1/2-2*Z*c*cosbeta/a' },
      { name: 'F', expr: 'E/2+a*a/4/b/b+a*c*cosbeta/2/b/b' },
      { name: 'U', expr: '2*F-Z' },
      { name: 'W', expr: 'c/2/a/cosbeta*(1-4*U+a*a*sinbeta*sinbeta/b/b)' },
      { name: 'D', expr: '-1/4+W/2-Z*c*cosbeta/a' },
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Y: ['1/2', '1/2', '0'],
      A: ['0', '0', '1/2'],
      M_2: ['-1/2', '1/2', '1/2'],
      V: ['1/2', '0', '0'],
      V_2: ['0', '1/2', '0'],
      L_2: ['0', '1/2', '1/2'],
      I: ['-1+R', 'R', '1/2'],
      I_2: ['1-R', '1-R', '1/2'],
      K: ['-U', 'U', 'W'],
      K_2: ['-1+U', '1-U', '1-W'],
      K_4: ['1-U', 'U', 'W'],
      H: ['-Z', 'Z', 'E'],
      H_2: ['Z', '1-Z', '1-E'],
      H_4: ['Z', '-Z', '1-E'],
      N: ['-F', 'F', 'D'],
      N_2: ['F', '1-F', '-D'],
      N_4: ['F', '-F', '-D'],
      N_6: ['1-F', 'F', 'D'],
    },
    path: [
      ['GAMMA', 'A'],
      ['A', 'I_2'],
      ['I', 'M_2'],
      ['M_2', 'GAMMA'],
      ['GAMMA', 'Y'],
      ['L_2', 'GAMMA'],
      ['GAMMA', 'V_2'],
    ],
  },
  aP2: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Z: ['0', '0', '1/2'],
      Y: ['0', '1/2', '0'],
      X: ['1/2', '0', '0'],
      V: ['1/2', '1/2', '0'],
      U: ['1/2', '0', '1/2'],
      T: ['0', '1/2', '1/2'],
      R: ['1/2', '1/2', '1/2'],
    },
    path: [
      ['GAMMA', 'X'],
      ['Y', 'GAMMA'],
      ['GAMMA', 'Z'],
      ['R', 'GAMMA'],
      ['GAMMA', 'T'],
      ['U', 'GAMMA'],
      ['GAMMA', 'V'],
    ],
  },
  aP3: {
    kparams: [
    ],
    points: {
      GAMMA: ['0', '0', '0'],
      Z: ['0', '0', '1/2'],
      Y: ['0', '1/2', '0'],
      Y_2: ['0', '-1/2', '0'],
      X: ['1/2', '0', '0'],
      V_2: ['1/2', '-1/2', '0'],
      U_2: ['-1/2', '0', '1/2'],
      T_2: ['0', '-1/2', '1/2'],
      R_2: ['-1/2', '-1/2', '1/2'],
    },
    path: [
      ['GAMMA', 'X'],
      ['Y', 'GAMMA'],
      ['GAMMA', 'Z'],
      ['R_2', 'GAMMA'],
      ['GAMMA', 'T_2'],
      ['U_2', 'GAMMA'],
      ['GAMMA', 'V_2'],
    ],
  },
}

/** Lattice quantities an HPKOT expression may reference. */
export interface KExpressionScope {
  a: number
  b: number
  c: number
  cosalpha: number
  cosbeta: number
  cosgamma: number
  sinalpha: number
  sinbeta: number
  singamma: number
  /** k-parameters evaluated so far (the table lists them in dependency order). */
  [kparam: string]: number
}

/**
 * Evaluate one HPKOT expression ("(1+a*a/c/c)/4", "1/2-J", "-1+N", ...)
 * against the scope. Throws on an unknown identifier or an unsupported
 * construct: a k-point silently placed at 0 is the failure mode this replaces.
 */
export function evaluateKExpression(expr: string, scope: KExpressionScope): number {
  const evaluate = (node: jsep.Expression): number => {
    switch (node.type) {
      case 'Literal': {
        const value = (node as jsep.Literal).value
        if (typeof value !== 'number') throw new Error(`[HPKOT] Non-numeric literal in "${expr}"`)
        return value
      }
      case 'Identifier': {
        const name = (node as jsep.Identifier).name
        if (!(name in scope)) throw new Error(`[HPKOT] Unknown symbol "${name}" in "${expr}"`)
        return scope[name]
      }
      case 'UnaryExpression': {
        const unary = node as jsep.UnaryExpression
        if (unary.operator !== '-' && unary.operator !== '+') throw new Error(`[HPKOT] Unsupported unary "${unary.operator}" in "${expr}"`)
        const value = evaluate(unary.argument)
        return unary.operator === '-' ? -value : value
      }
      case 'BinaryExpression': {
        const binary = node as jsep.BinaryExpression
        const left = evaluate(binary.left)
        const right = evaluate(binary.right)
        switch (binary.operator) {
          case '+': return left + right
          case '-': return left - right
          case '*': return left * right
          case '/': return left / right
          default: throw new Error(`[HPKOT] Unsupported operator "${binary.operator}" in "${expr}"`)
        }
      }
      default:
        throw new Error(`[HPKOT] Unsupported construct ${node.type} in "${expr}"`)
    }
  }
  const value = evaluate(jsep(expr))
  if (!Number.isFinite(value)) throw new Error(`[HPKOT] "${expr}" is not finite for this cell`)
  return value
}

/**
 * Extended Bravais type from the space group number plus cell metrics.
 */
export function getExtendedBravaisForSpaceGroup(
  spaceGroupNumber: number,
  a: number,
  b: number,
  c: number,
  _cosalpha: number,
  cosbeta: number,
  _cosgamma: number
): ExtendedBravaisType {
  const sinbeta = Math.sqrt(1 - cosbeta * cosbeta)
  
  // Cubic (SG 195-230)
  if (spaceGroupNumber >= 195 && spaceGroupNumber <= 230) {
    // F-centered cubic
    const fCentered = [196, 202, 203, 209, 210, 216, 219, 225, 226, 227, 228]
    // I-centered cubic
    const iCentered = [197, 199, 204, 206, 211, 214, 217, 220, 229, 230]

    if (fCentered.includes(spaceGroupNumber)) {
      // cF1 vs cF2: HPKOT distinction based on space group
      // cF1: SG 196, 202, 209, 216, 225 (symmorphic)
      // cF2: SG 203, 210, 219, 226, 227, 228 (non-symmorphic)
      const cF1Groups = [196, 202, 209, 216, 225]
      return cF1Groups.includes(spaceGroupNumber) ? 'cF1' : 'cF2'
    }
    if (iCentered.includes(spaceGroupNumber)) {
      return 'cI1'
    }
    // P-centered cubic: cP1 vs cP2
    // cP1: SG 195, 198, 200, 201, 205, 207, 208, 212, 213, 215, 218, 221, 222, 223, 224
    // cP2: SG 198 (P2_13) and other non-symmorphic groups
    const cP1Groups = [195, 200, 207, 208, 215, 221]
    return cP1Groups.includes(spaceGroupNumber) ? 'cP1' : 'cP2'
  }
  
  // Tetragonal
  if (spaceGroupNumber >= 75 && spaceGroupNumber <= 142) {
    // Body-centered tetragonal
    const tICentered = [79, 80, 82, 87, 88, 97, 98, 107, 108, 109, 110, 
                        119, 120, 121, 122, 139, 140, 141, 142]
    if (tICentered.includes(spaceGroupNumber)) {
      return c < a ? 'tI1' : 'tI2'
    }
    return 'tP1'
  }
  
  // Orthorhombic
  if (spaceGroupNumber >= 16 && spaceGroupNumber <= 74) {
    // Face-centered
    const oFCentered = [22, 42, 43, 69, 70]
    if (oFCentered.includes(spaceGroupNumber)) {
      if (1/(a*a) > 1/(b*b) + 1/(c*c)) return 'oF1'
      if (1/(c*c) > 1/(a*a) + 1/(b*b)) return 'oF2'
      return 'oF3'
    }
    // Body-centered
    const oICentered = [23, 24, 44, 45, 46, 71, 72, 73, 74]
    if (oICentered.includes(spaceGroupNumber)) {
      if (c >= a && c >= b) return 'oI1'
      if (a >= b && a >= c) return 'oI2'
      return 'oI3'
    }
    // C-centered
    const oCCentered = [20, 21, 35, 36, 37, 63, 64, 65, 66, 67, 68]
    if (oCCentered.includes(spaceGroupNumber)) {
      return a <= b ? 'oC1' : 'oC2'
    }
    // A-centered
    const oACentered = [38, 39, 40, 41]
    if (oACentered.includes(spaceGroupNumber)) {
      return b <= c ? 'oA1' : 'oA2'
    }
    return 'oP1'
  }
  
  // Hexagonal
  if (spaceGroupNumber >= 168 && spaceGroupNumber <= 194) {
    // Actually all hexagonal are hP2 unless trigonal
    return 'hP2'
  }
  
  // Trigonal (rhombohedral and trigonal hexagonal)
  if (spaceGroupNumber >= 143 && spaceGroupNumber <= 167) {
    // R-centered groups: 146, 148, 155, 160, 161, 166, 167
    const rCentered = [146, 148, 155, 160, 161, 166, 167]
    if (rCentered.includes(spaceGroupNumber)) {
      // Check hR1 vs hR2 condition: sqrt(3)*a <= sqrt(2)*c
      if (Math.sqrt(3) * a <= Math.sqrt(2) * c) {
        return 'hR1'
      }
      return 'hR2'
    }
    // Hexagonal trigonal
    const hP1Groups = [143, 144, 145, 147, 149, 151, 153, 157, 159, 162, 163]
    if (hP1Groups.includes(spaceGroupNumber)) {
      return 'hP1'
    }
    return 'hP2'
  }
  
  // Monoclinic
  if (spaceGroupNumber >= 3 && spaceGroupNumber <= 15) {
    // C-centered monoclinic
    const mCCentered = [5, 8, 9, 12, 15]
    if (mCCentered.includes(spaceGroupNumber)) {
      if (b < a * sinbeta) {
        return 'mC1'
      }
      const condition = -a * cosbeta / c + a * a * sinbeta * sinbeta / b / b
      if (condition <= 1) {
        return 'mC2'
      }
      return 'mC3'
    }
    return 'mP1'
  }
  
  // Triclinic
  if (spaceGroupNumber >= 1 && spaceGroupNumber <= 2) {
    // Need to check reciprocal cell angles
    // For simplicity, default to aP2
    return 'aP2'
  }
  
  // Default fallback
  return 'aP2'
}
