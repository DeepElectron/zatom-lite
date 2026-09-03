/**
 * CUB (Gaussian Cube) File Parser
 * Parses Gaussian cube format files containing volumetric data
 */

export interface CubAtom {
  atomicNumber: number;
  charge: number;
  x: number;
  y: number;
  z: number;
  symbol: string;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface CubData {
  title: string;
  comment: string;
  atoms: CubAtom[];
  origin: Vector3D;
  voxels: Vector3D;
  vectors: {
    x: Vector3D;
    y: Vector3D;
    z: Vector3D;
  };
  spacing: Vector3D;
  volumeData: Float32Array;
  bounds: {
    min: Vector3D;
    max: Vector3D;
  };
}

export type VolumeFunction = (x: number, y: number, z: number) => number;

/** Prevent a tiny forged header from allocating hundreds of MB before validation. */
export const CUB_MAX_VOXELS = 8_000_000;
const CUB_MAX_ATOMS = 1_000_000;

export class CubParser {
  private readonly BOHR_TO_ANGSTROM = 0.529177210903;

  parse(content: string): CubData {
    const lines = content.trim().split('\n');
    let lineIndex = 0;

    // Result object
    const result: CubData = {
      title: '',
      comment: '',
      atoms: [],
      origin: { x: 0, y: 0, z: 0 },
      voxels: { x: 0, y: 0, z: 0 },
      vectors: {
        x: { x: 0, y: 0, z: 0 },
        y: { x: 0, y: 0, z: 0 },
        z: { x: 0, y: 0, z: 0 }
      },
      spacing: { x: 0, y: 0, z: 0 },
      volumeData: new Float32Array(0),
      bounds: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 }
      }
    };

    // Parse header (first two lines are comments)
    result.title = lines[lineIndex++];
    result.comment = lines[lineIndex++];

    // Parse number of atoms and origin
    const atomLine = lines[lineIndex++].trim().split(/\s+/);
    const numAtoms = parseInt(atomLine[0]);
    if (!Number.isSafeInteger(numAtoms) || numAtoms === 0 || Math.abs(numAtoms) > CUB_MAX_ATOMS) {
      throw new Error(`Invalid CUBE atom count: ${atomLine[0] ?? '(missing)'}`);
    }
    const actualNumAtoms = Math.abs(numAtoms);
    const valuesPerVoxel = atomLine[4] === undefined ? 1 : parseInt(atomLine[4]);
    if (!Number.isSafeInteger(valuesPerVoxel) || valuesPerVoxel !== 1) {
      throw new Error(`CUBE contains ${atomLine[4] ?? '(invalid)'} values per voxel; only one scalar field is supported`);
    }

    result.origin.x = parseFloat(atomLine[1]);
    result.origin.y = parseFloat(atomLine[2]);
    result.origin.z = parseFloat(atomLine[3]);
    if (![result.origin.x, result.origin.y, result.origin.z].every(Number.isFinite)) {
      throw new Error('Invalid CUBE grid origin');
    }

    // Parse voxel information (3 lines)
    const rawGridCounts: number[] = [];
    const rawVectors: Vector3D[] = [];

    for (let i = 0; i < 3; i++) {
      const voxelLine = lines[lineIndex++].trim().split(/\s+/);
      const rawCount = parseInt(voxelLine[0]);
      if (!Number.isSafeInteger(rawCount) || rawCount === 0) {
        throw new Error(`Invalid CUBE grid dimension on axis ${i + 1}: ${voxelLine[0] ?? '(missing)'}`);
      }
      const vector: Vector3D = {
        x: parseFloat(voxelLine[1]),
        y: parseFloat(voxelLine[2]),
        z: parseFloat(voxelLine[3])
      };
      if (![vector.x, vector.y, vector.z].every(Number.isFinite)) {
        throw new Error(`Invalid CUBE grid vector on axis ${i + 1}`);
      }
      rawGridCounts.push(rawCount);
      rawVectors.push(vector);
    }

    const negativeGridAxes = rawGridCounts.filter((count) => count < 0).length;
    if (negativeGridAxes !== 0 && negativeGridAxes !== 3) {
      throw new Error('CUBE grid axes use mixed unit signs; all three counts must agree');
    }
    // De-facto CUBE convention: positive counts store Bohr, negative counts
    // store Å. NATOMS sign instead signals a following dataset-ID record.
    const isBohr = negativeGridAxes === 0;
    const convert = (value: number) => isBohr ? value * this.BOHR_TO_ANGSTROM : value;
    result.origin = {
      x: convert(result.origin.x),
      y: convert(result.origin.y),
      z: convert(result.origin.z),
    };
    const vectors = rawVectors.map((vector): Vector3D => ({
      x: convert(vector.x),
      y: convert(vector.y),
      z: convert(vector.z),
    }));
    result.voxels = {
      x: Math.abs(rawGridCounts[0]),
      y: Math.abs(rawGridCounts[1]),
      z: Math.abs(rawGridCounts[2]),
    };
    result.vectors = { x: vectors[0], y: vectors[1], z: vectors[2] };

    // Store grid spacing
    result.spacing = {
      x: vectors[0].x,
      y: vectors[1].y,
      z: vectors[2].z
    };

    // Parse atoms
    for (let i = 0; i < actualNumAtoms; i++) {
      const atomLineData = lines[lineIndex++].trim().split(/\s+/);
      const atom: CubAtom = {
        atomicNumber: parseInt(atomLineData[0]),
        charge: parseFloat(atomLineData[1]),
        x: parseFloat(atomLineData[2]),
        y: parseFloat(atomLineData[3]),
        z: parseFloat(atomLineData[4]),
        symbol: ''
      };

      // Convert to Angstrom if in Bohr
      if (isBohr) {
        atom.x *= this.BOHR_TO_ANGSTROM;
        atom.y *= this.BOHR_TO_ANGSTROM;
        atom.z *= this.BOHR_TO_ANGSTROM;
      }

      // Get element symbol
      atom.symbol = this.getElementSymbol(atom.atomicNumber);

      result.atoms.push(atom);
    }

    if (numAtoms < 0) {
      const datasetLine = lines[lineIndex++]?.trim().split(/\s+/).filter(Boolean) ?? [];
      const datasetCount = parseInt(datasetLine[0]);
      if (!Number.isSafeInteger(datasetCount) || datasetCount < 1) {
        throw new Error('Negative CUBE atom count requires a dataset-ID record');
      }
      if (datasetCount !== 1) {
        throw new Error(`CUBE contains ${datasetCount} interleaved datasets; only one scalar field is supported`);
      }
      if (datasetLine.length !== 2 || !Number.isSafeInteger(parseInt(datasetLine[1]))) {
        throw new Error('CUBE single-dataset ID record must contain exactly one integer identifier');
      }
    }

    // Calculate bounds for orthogonal grids
    result.bounds.min.x = result.origin.x;
    result.bounds.min.y = result.origin.y;
    result.bounds.min.z = result.origin.z;

    result.bounds.max.x = result.origin.x + (result.voxels.x - 1) * result.spacing.x;
    result.bounds.max.y = result.origin.y + (result.voxels.y - 1) * result.spacing.y;
    result.bounds.max.z = result.origin.z + (result.voxels.z - 1) * result.spacing.z;

    // Parse volumetric data
    const totalVoxels = result.voxels.x * result.voxels.y * result.voxels.z;
    if (!Number.isSafeInteger(totalVoxels) || totalVoxels <= 0 || totalVoxels > CUB_MAX_VOXELS) {
      throw new Error(`CUBE grid has ${totalVoxels} voxels; the supported limit is ${CUB_MAX_VOXELS}`);
    }
    result.volumeData = new Float32Array(totalVoxels);

    let dataIndex = 0;

    while (lineIndex < lines.length && dataIndex < totalVoxels) {
      const values = lines[lineIndex++].trim().split(/\s+/);
      for (let v = 0; v < values.length && dataIndex < totalVoxels; v++) {
        if (values[v] !== '') {
          const value = parseFloat(values[v]);
          if (!Number.isFinite(value)) throw new Error(`Invalid CUBE scalar value at voxel ${dataIndex + 1}`);
          result.volumeData[dataIndex++] = value;
        }
      }
    }

    if (dataIndex !== totalVoxels) {
      throw new Error(`CUBE grid is truncated: expected ${totalVoxels} values, read ${dataIndex}`);
    }
    return result;
  }

  getElementSymbol(atomicNumber: number): string {
    const elements = [
      '', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
      'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
      'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
      'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
      'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
      'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
      'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
      'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
      'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th',
      'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm',
      'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds',
      'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og'
    ];

    return (atomicNumber > 0 && atomicNumber < elements.length) ?
      elements[atomicNumber] : 'X';
  }

  // Create a function that evaluates the volume data at any point
  createVolumeFunction(cubData: CubData): VolumeFunction {
    const { origin, spacing, voxels, volumeData } = cubData;

    return (x: number, y: number, z: number): number => {
      // Transform world coordinates to grid coordinates
      const dx = x - origin.x;
      const dy = y - origin.y;
      const dz = z - origin.z;

      // Solve for grid indices using the spacing
      const i = dx / spacing.x;
      const j = dy / spacing.y;
      const k = dz / spacing.z;

      // Check bounds
      if (i < 0 || i >= voxels.x - 1 ||
          j < 0 || j >= voxels.y - 1 ||
          k < 0 || k >= voxels.z - 1) {
        return 0;
      }

      // Trilinear interpolation
      const i0 = Math.floor(i);
      const j0 = Math.floor(j);
      const k0 = Math.floor(k);
      const i1 = i0 + 1;
      const j1 = j0 + 1;
      const k1 = k0 + 1;

      const fx = i - i0;
      const fy = j - j0;
      const fz = k - k0;

      // Get values at cube corners
      const v000 = this.getVoxelValue(volumeData, voxels, i0, j0, k0);
      const v001 = this.getVoxelValue(volumeData, voxels, i0, j0, k1);
      const v010 = this.getVoxelValue(volumeData, voxels, i0, j1, k0);
      const v011 = this.getVoxelValue(volumeData, voxels, i0, j1, k1);
      const v100 = this.getVoxelValue(volumeData, voxels, i1, j0, k0);
      const v101 = this.getVoxelValue(volumeData, voxels, i1, j0, k1);
      const v110 = this.getVoxelValue(volumeData, voxels, i1, j1, k0);
      const v111 = this.getVoxelValue(volumeData, voxels, i1, j1, k1);

      // Interpolate
      const v00 = v000 * (1 - fx) + v100 * fx;
      const v01 = v001 * (1 - fx) + v101 * fx;
      const v10 = v010 * (1 - fx) + v110 * fx;
      const v11 = v011 * (1 - fx) + v111 * fx;

      const v0 = v00 * (1 - fy) + v10 * fy;
      const v1 = v01 * (1 - fy) + v11 * fy;

      return v0 * (1 - fz) + v1 * fz;
    };
  }

  private getVoxelValue(volumeData: Float32Array, voxels: Vector3D, i: number, j: number, k: number): number {
    if (i < 0 || i >= voxels.x || j < 0 || j >= voxels.y || k < 0 || k >= voxels.z) {
      return 0;
    }
    const index = i * voxels.y * voxels.z + j * voxels.z + k;
    return volumeData[index];
  }
}

export default CubParser;
