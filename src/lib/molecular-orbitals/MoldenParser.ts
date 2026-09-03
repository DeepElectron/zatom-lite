/**
 * Molden File Parser
 * Parses Molden format files for molecular structure and orbital data
 */

import { GaussianBasisFunction } from './GaussianBasisFunction';
import type { AngularMomentum } from './GaussianBasisFunction';

export interface MoldenAtom {
  symbol: string;
  index: number;
  atomicNumber: number;
  x: number;
  y: number;
  z: number;
}

export interface BasisShell {
  atomIndex: number;
  shellType: string;
  exponents: number[];
  coefficients: number[];
}

export interface OrbitalCoefficient {
  index: number;
  value: number;
}

export interface MoldenOrbital {
  symmetry: string;
  energy: number;
  spin: string;
  occupation: number;
  coefficients: OrbitalCoefficient[];
}

export interface MoldenData {
  atoms: MoldenAtom[];
  orbitals: MoldenOrbital[];
  basis: BasisShell[];
  gtos: GaussianBasisFunction[];
}

export class MoldenParser {
  private content: string;
  private atoms: MoldenAtom[] = [];
  private orbitals: MoldenOrbital[] = [];
  private basis: BasisShell[] = [];
  private gtos: GaussianBasisFunction[] = [];
  private units: string = 'AU';
  private readonly BOHR_TO_ANGSTROM = 0.529177210903;

  constructor(content: string) {
    this.content = content;
  }

  parse(): MoldenData {
    const lines = this.content.split('\n').map(line => line.trim());
    let currentSection = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('[')) {
        const closeBracketIndex = line.indexOf(']');
        if (closeBracketIndex > 0) {
          currentSection = line.substring(0, closeBracketIndex + 1).toLowerCase();
          const remainder = line.substring(closeBracketIndex + 1).trim();
          if (remainder) {
            // Both forms occur in real Molden writers: `[Atoms] AU` and
            // `[Atoms] (AU)` (likewise Angs). Keep one canonical section key
            // so the parser does not silently skip every atom in xTB/PySCF
            // files that use the parenthesized spelling.
            const qualifier = remainder.replace(/^\(\s*(.*?)\s*\)$/, '$1').toLowerCase();
            currentSection += ' ' + qualifier;
          }
          i++;
          continue;
        }
      }

      switch (currentSection) {
        case '[atoms]':
        case '[atoms] au':
        case '[atoms] bohr':
        case '[atoms] angs':
        case '[atoms] angstrom':
          i = this.parseAtoms(lines, i);
          break;
        case '[gto]':
          i = this.parseGTO(lines, i);
          break;
        case '[mo]':
          i = this.parseOrbitals(lines, i);
          break;
        default:
          i++;
      }
    }

    if (this.atoms.length === 0) {
      throw new Error('No atomic data found. Please check if the file contains [Atoms] section.');
    }

    this.createBasisFunctions();

    return {
      atoms: this.atoms,
      orbitals: this.orbitals,
      basis: this.basis,
      gtos: this.gtos
    };
  }

  private parseAtoms(lines: string[], startIndex: number): number {
    let i = startIndex;

    this.units = 'AU';

    if (startIndex > 0 && lines[startIndex - 1]) {
      const atomsLine = lines[startIndex - 1].toUpperCase();
      if (atomsLine.includes('ANGS') || atomsLine.includes('ANGSTROM')) {
        this.units = 'ANGS';
      } else if (atomsLine.includes('AU') || atomsLine.includes('BOHR')) {
        this.units = 'AU';
      }
    }

    if (startIndex > 1 && lines[startIndex - 2]) {
      const prevLine = lines[startIndex - 2].toUpperCase();
      if (prevLine.includes('ANGS') || prevLine.includes('ANGSTROM')) {
        this.units = 'ANGS';
      }
    }

    while (i < lines.length && !lines[i].startsWith('[')) {
      const line = lines[i].trim();
      if (line && !line.startsWith('#') && line.length > 0) {
        const parts = line.split(/\s+/).filter(part => part.length > 0);
        if (parts.length >= 6) {
          const x_str = parts[3];
          const y_str = parts[4];
          const z_str = parts[5];

          if (!isNaN(parseFloat(x_str)) && !isNaN(parseFloat(y_str)) && !isNaN(parseFloat(z_str))) {
            let x = parseFloat(x_str);
            let y = parseFloat(y_str);
            let z = parseFloat(z_str);

            if (this.units === 'AU') {
              x *= this.BOHR_TO_ANGSTROM;
              y *= this.BOHR_TO_ANGSTROM;
              z *= this.BOHR_TO_ANGSTROM;
            }

            const atom: MoldenAtom = {
              symbol: parts[0],
              index: parseInt(parts[1]),
              atomicNumber: parseInt(parts[2]),
              x,
              y,
              z
            };

            this.atoms.push(atom);
          }
        }
      }
      i++;
    }
    return i;
  }

  private parseGTO(lines: string[], startIndex: number): number {
    let i = startIndex;
    let currentAtom = -1;

    while (i < lines.length && !lines[i].startsWith('[')) {
      const line = lines[i].trim();

      if (line && !line.startsWith('#')) {
        const parts = line.split(/\s+/);

        if (parts.length === 2 && !isNaN(parseInt(parts[0]))) {
          currentAtom = parseInt(parts[0]) - 1;
        } else if (parts.length >= 2 && parts[0].match(/[spdf]/i)) {
          const shellType = parts[0].toLowerCase();
          const numPrimitives = parseInt(parts[1]);

          const exponents: number[] = [];
          const coefficients: number[] = [];

          for (let j = 1; j <= numPrimitives; j++) {
            i++;
            if (i < lines.length) {
              const primParts = lines[i].trim().split(/\s+/);
              if (primParts.length >= 2) {
                exponents.push(parseFloat(primParts[0]));
                coefficients.push(parseFloat(primParts[1]));
              }
            }
          }

          this.basis.push({
            atomIndex: currentAtom,
            shellType,
            exponents,
            coefficients
          });
        }
      }
      i++;
    }
    return i;
  }

  private parseOrbitals(lines: string[], startIndex: number): number {
    let i = startIndex;
    let currentOrbital: MoldenOrbital | null = null;

    while (i < lines.length && !lines[i].startsWith('[')) {
      const line = lines[i].trim();

      if (line.startsWith('Sym=')) {
        if (currentOrbital) {
          this.orbitals.push(currentOrbital);
        }
        currentOrbital = {
          symmetry: line.split('=')[1].trim(),
          energy: 0,
          spin: 'Alpha',
          occupation: 0,
          coefficients: []
        };
      } else if (currentOrbital) {
        if (line.startsWith('Ene=')) {
          currentOrbital.energy = parseFloat(line.split('=')[1]);
        } else if (line.startsWith('Spin=')) {
          currentOrbital.spin = line.split('=')[1].trim();
        } else if (line.startsWith('Occup=')) {
          currentOrbital.occupation = parseFloat(line.split('=')[1]);
        } else if (line.match(/^\s*\d+\s+[\d.-]+/)) {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) {
            currentOrbital.coefficients.push({
              index: parseInt(parts[0]) - 1,
              value: parseFloat(parts[1])
            });
          }
        }
      }
      i++;
    }

    if (currentOrbital) {
      this.orbitals.push(currentOrbital);
    }

    return i;
  }

  private createBasisFunctions(): void {
    this.gtos = [];

    for (const shell of this.basis) {
      if (shell.atomIndex >= 0 && shell.atomIndex < this.atoms.length) {
        const atom = this.atoms[shell.atomIndex];

        let centerX = atom.x;
        let centerY = atom.y;
        let centerZ = atom.z;

        if (this.units === 'AU') {
          centerX = centerX / this.BOHR_TO_ANGSTROM;
          centerY = centerY / this.BOHR_TO_ANGSTROM;
          centerZ = centerZ / this.BOHR_TO_ANGSTROM;
        }

        const center: [number, number, number] = [centerX, centerY, centerZ];

        const angularMomentumSets = this.getAngularMomentumSets(shell.shellType);

        for (const angMom of angularMomentumSets) {
          const gto = new GaussianBasisFunction(
            center,
            shell.exponents,
            shell.coefficients,
            angMom
          );
          this.gtos.push(gto);
        }
      }
    }

  }

  private getAngularMomentumSets(shellType: string): AngularMomentum[] {
    switch (shellType.toLowerCase()) {
      case 's':
        return [{ l: 0, m: 0, n: 0 }];
      case 'p':
        return [
          { l: 1, m: 0, n: 0 }, // px
          { l: 0, m: 1, n: 0 }, // py
          { l: 0, m: 0, n: 1 }  // pz
        ];
      case 'd':
        return [
          { l: 2, m: 0, n: 0 }, // dxx
          { l: 0, m: 2, n: 0 }, // dyy
          { l: 0, m: 0, n: 2 }, // dzz
          { l: 1, m: 1, n: 0 }, // dxy
          { l: 1, m: 0, n: 1 }, // dxz
          { l: 0, m: 1, n: 1 }  // dyz
        ];
      case 'f':
        return [
          { l: 3, m: 0, n: 0 },
          { l: 0, m: 3, n: 0 },
          { l: 0, m: 0, n: 3 },
          { l: 2, m: 1, n: 0 },
          { l: 2, m: 0, n: 1 },
          { l: 1, m: 2, n: 0 },
          { l: 0, m: 2, n: 1 },
          { l: 1, m: 0, n: 2 },
          { l: 0, m: 1, n: 2 },
          { l: 1, m: 1, n: 1 }
        ];
      default:
        return [{ l: 0, m: 0, n: 0 }];
    }
  }
}

export default MoldenParser;
