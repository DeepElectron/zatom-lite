// Element periodic table data with colors and radii
import type { ElementData } from './types'

export const ELEMENTS: Record<string, ElementData> = {
  H:  { symbol: 'H',  name: 'Hydrogen',    atomicNumber: 1,  color: '#FFFFFF', radius: 0.31, mass: 1.008 },
  He: { symbol: 'He', name: 'Helium',      atomicNumber: 2,  color: '#D9FFFF', radius: 0.28, mass: 4.003 },
  Li: { symbol: 'Li', name: 'Lithium',     atomicNumber: 3,  color: '#CC80FF', radius: 1.28, mass: 6.941 },
  Be: { symbol: 'Be', name: 'Beryllium',   atomicNumber: 4,  color: '#C2FF00', radius: 0.96, mass: 9.012 },
  B:  { symbol: 'B',  name: 'Boron',       atomicNumber: 5,  color: '#FFB5B5', radius: 0.84, mass: 10.81 },
  C:  { symbol: 'C',  name: 'Carbon',      atomicNumber: 6,  color: '#909090', radius: 0.76, mass: 12.01 },
  N:  { symbol: 'N',  name: 'Nitrogen',    atomicNumber: 7,  color: '#3050F8', radius: 0.71, mass: 14.01 },
  O:  { symbol: 'O',  name: 'Oxygen',      atomicNumber: 8,  color: '#FF0D0D', radius: 0.66, mass: 16.00 },
  F:  { symbol: 'F',  name: 'Fluorine',    atomicNumber: 9,  color: '#90E050', radius: 0.57, mass: 19.00 },
  Ne: { symbol: 'Ne', name: 'Neon',        atomicNumber: 10, color: '#B3E3F5', radius: 0.58, mass: 20.18 },
  Na: { symbol: 'Na', name: 'Sodium',      atomicNumber: 11, color: '#AB5CF2', radius: 1.66, mass: 22.99 },
  Mg: { symbol: 'Mg', name: 'Magnesium',   atomicNumber: 12, color: '#8AFF00', radius: 1.41, mass: 24.31 },
  Al: { symbol: 'Al', name: 'Aluminum',    atomicNumber: 13, color: '#BFA6A6', radius: 1.21, mass: 26.98 },
  Si: { symbol: 'Si', name: 'Silicon',     atomicNumber: 14, color: '#F0C8A0', radius: 1.11, mass: 28.09 },
  P:  { symbol: 'P',  name: 'Phosphorus',  atomicNumber: 15, color: '#FF8000', radius: 1.07, mass: 30.97 },
  S:  { symbol: 'S',  name: 'Sulfur',      atomicNumber: 16, color: '#FFFF30', radius: 1.05, mass: 32.07 },
  Cl: { symbol: 'Cl', name: 'Chlorine',    atomicNumber: 17, color: '#1FF01F', radius: 1.02, mass: 35.45 },
  Ar: { symbol: 'Ar', name: 'Argon',       atomicNumber: 18, color: '#80D1E3', radius: 1.06, mass: 39.95 },
  K:  { symbol: 'K',  name: 'Potassium',   atomicNumber: 19, color: '#8F40D4', radius: 2.03, mass: 39.10 },
  Ca: { symbol: 'Ca', name: 'Calcium',     atomicNumber: 20, color: '#3DFF00', radius: 1.76, mass: 40.08 },
  Sc: { symbol: 'Sc', name: 'Scandium',    atomicNumber: 21, color: '#E6E6E6', radius: 1.70, mass: 44.96 },
  Ti: { symbol: 'Ti', name: 'Titanium',    atomicNumber: 22, color: '#BFC2C7', radius: 1.60, mass: 47.87 },
  V:  { symbol: 'V',  name: 'Vanadium',    atomicNumber: 23, color: '#A6A6AB', radius: 1.53, mass: 50.94 },
  Cr: { symbol: 'Cr', name: 'Chromium',    atomicNumber: 24, color: '#8A99C7', radius: 1.39, mass: 52.00 },
  Mn: { symbol: 'Mn', name: 'Manganese',   atomicNumber: 25, color: '#9C7AC7', radius: 1.39, mass: 54.94 },
  Fe: { symbol: 'Fe', name: 'Iron',        atomicNumber: 26, color: '#E06633', radius: 1.32, mass: 55.85 },
  Co: { symbol: 'Co', name: 'Cobalt',      atomicNumber: 27, color: '#F090A0', radius: 1.26, mass: 58.93 },
  Ni: { symbol: 'Ni', name: 'Nickel',      atomicNumber: 28, color: '#50D050', radius: 1.24, mass: 58.69 },
  Cu: { symbol: 'Cu', name: 'Copper',      atomicNumber: 29, color: '#C88033', radius: 1.32, mass: 63.55 },
  Zn: { symbol: 'Zn', name: 'Zinc',        atomicNumber: 30, color: '#7D80B0', radius: 1.22, mass: 65.38 },
  Ga: { symbol: 'Ga', name: 'Gallium',     atomicNumber: 31, color: '#C28F8F', radius: 1.22, mass: 69.72 },
  Ge: { symbol: 'Ge', name: 'Germanium',   atomicNumber: 32, color: '#668F8F', radius: 1.20, mass: 72.63 },
  As: { symbol: 'As', name: 'Arsenic',     atomicNumber: 33, color: '#BD80E3', radius: 1.19, mass: 74.92 },
  Se: { symbol: 'Se', name: 'Selenium',    atomicNumber: 34, color: '#FFA100', radius: 1.20, mass: 78.97 },
  Br: { symbol: 'Br', name: 'Bromine',     atomicNumber: 35, color: '#A62929', radius: 1.20, mass: 79.90 },
  Kr: { symbol: 'Kr', name: 'Krypton',     atomicNumber: 36, color: '#5CB8D1', radius: 1.16, mass: 83.80 },
  Rb: { symbol: 'Rb', name: 'Rubidium',    atomicNumber: 37, color: '#702EB0', radius: 2.20, mass: 85.47 },
  Sr: { symbol: 'Sr', name: 'Strontium',   atomicNumber: 38, color: '#00FF00', radius: 1.95, mass: 87.62 },
  Y:  { symbol: 'Y',  name: 'Yttrium',     atomicNumber: 39, color: '#94FFFF', radius: 1.90, mass: 88.91 },
  Zr: { symbol: 'Zr', name: 'Zirconium',   atomicNumber: 40, color: '#94E0E0', radius: 1.75, mass: 91.22 },
  Nb: { symbol: 'Nb', name: 'Niobium',     atomicNumber: 41, color: '#73C2C9', radius: 1.64, mass: 92.91 },
  Mo: { symbol: 'Mo', name: 'Molybdenum',  atomicNumber: 42, color: '#54B5B5', radius: 1.54, mass: 95.95 },
  Ru: { symbol: 'Ru', name: 'Ruthenium',   atomicNumber: 44, color: '#248F8F', radius: 1.46, mass: 101.1 },
  Rh: { symbol: 'Rh', name: 'Rhodium',     atomicNumber: 45, color: '#0A7D8C', radius: 1.42, mass: 102.9 },
  Pd: { symbol: 'Pd', name: 'Palladium',   atomicNumber: 46, color: '#006985', radius: 1.39, mass: 106.4 },
  Ag: { symbol: 'Ag', name: 'Silver',      atomicNumber: 47, color: '#C0C0C0', radius: 1.45, mass: 107.9 },
  Cd: { symbol: 'Cd', name: 'Cadmium',     atomicNumber: 48, color: '#FFD98F', radius: 1.44, mass: 112.4 },
  In: { symbol: 'In', name: 'Indium',      atomicNumber: 49, color: '#A67573', radius: 1.42, mass: 114.8 },
  Sn: { symbol: 'Sn', name: 'Tin',         atomicNumber: 50, color: '#668080', radius: 1.39, mass: 118.7 },
  Sb: { symbol: 'Sb', name: 'Antimony',    atomicNumber: 51, color: '#9E63B5', radius: 1.39, mass: 121.8 },
  Te: { symbol: 'Te', name: 'Tellurium',   atomicNumber: 52, color: '#D47A00', radius: 1.38, mass: 127.6 },
  I:  { symbol: 'I',  name: 'Iodine',      atomicNumber: 53, color: '#940094', radius: 1.39, mass: 126.9 },
  Xe: { symbol: 'Xe', name: 'Xenon',       atomicNumber: 54, color: '#429EB0', radius: 1.40, mass: 131.3 },
  Cs: { symbol: 'Cs', name: 'Cesium',      atomicNumber: 55, color: '#57178F', radius: 2.44, mass: 132.9 },
  Ba: { symbol: 'Ba', name: 'Barium',      atomicNumber: 56, color: '#00C900', radius: 2.15, mass: 137.3 },
  La: { symbol: 'La', name: 'Lanthanum',   atomicNumber: 57, color: '#70D4FF', radius: 2.07, mass: 138.9 },
  Ce: { symbol: 'Ce', name: 'Cerium',      atomicNumber: 58, color: '#FFFFC7', radius: 2.04, mass: 140.1 },
  Hf: { symbol: 'Hf', name: 'Hafnium',     atomicNumber: 72, color: '#4DC2FF', radius: 1.59, mass: 178.49 },
  W:  { symbol: 'W',  name: 'Tungsten',    atomicNumber: 74, color: '#2194D6', radius: 1.62, mass: 183.84 },
  Au: { symbol: 'Au', name: 'Gold',        atomicNumber: 79, color: '#FFD123', radius: 1.36, mass: 197.0 },
  Pt: { symbol: 'Pt', name: 'Platinum',    atomicNumber: 78, color: '#D0D0E0', radius: 1.36, mass: 195.1 },
  Pb: { symbol: 'Pb', name: 'Lead',        atomicNumber: 82, color: '#575961', radius: 1.46, mass: 207.2 },
  Bi: { symbol: 'Bi', name: 'Bismuth',     atomicNumber: 83, color: '#9E4FB5', radius: 1.48, mass: 209.0 },
  U:  { symbol: 'U',  name: 'Uranium',     atomicNumber: 92, color: '#008FFF', radius: 1.96, mass: 238.0 },
}

// Get element data with fallback
export function getElement(symbol: string): ElementData {
  return ELEMENTS[symbol] || {
    symbol,
    name: 'Unknown',
    atomicNumber: 0,
    color: '#FF00FF',
    radius: 1.0,
    mass: 1.0,
  }
}

// Get all element symbols as array
export function getAllElementSymbols(): string[] {
  return Object.keys(ELEMENTS)
}

// Periodic table Z↔symbol canonical implementation of chemistry/periodic-table in the package (covering Z 1-103,
// More complete than deriving from ELEMENTS - ELEMENTS has only 63 common Z's, lacks actinide, etc.).
export { atomicNumberToSymbol } from '../../chemistry/periodic-table'

// Common elements for quick access
export const COMMON_ELEMENTS = ['H', 'C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'Fe', 'Cu', 'Zn', 'Na', 'K', 'Ca', 'Mg', 'Si', 'Al', 'Ti', 'Hf']

// The minimum element radius of the entire table (He = 0.28), used as the "floor" to suppress differences - when variance=0, all atoms are of this size
export const MIN_ELEMENT_RADIUS = 0.28

/**
 * Apply element radius difference suppression:
 * - variance = 1 → elementRadius as is (maximum difference)
 * - variance = 0 → all = MIN_ELEMENT_RADIUS (the small one remains unchanged, the large one is pulled to the small size)
 * - median lerp
 */
export function applyRadiusVariance(elementRadius: number, variance: number): number {
  return MIN_ELEMENT_RADIUS + (elementRadius - MIN_ELEMENT_RADIUS) * variance
}
