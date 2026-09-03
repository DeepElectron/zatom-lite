/**
 * Optimized Marching Cubes Algorithm
 * Directly uses pre-computed grid data to ensure complete isosurface generation
 */

import { edgeTable, triTable } from './MarchingCubesTables';

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface MarchingCubesResult {
  vertices: Float32Array;
  normals: Float32Array;
  faces: Uint32Array;
}

export interface MarchingCubesOptions {
  smoothIterations?: number;
  smoothFactor?: number;
  sharedVertices?: boolean;
}

export type GridFunction = (x: number, y: number, z: number) => number;

function emptyResult(): MarchingCubesResult {
  return {
    vertices: new Float32Array(0),
    normals: new Float32Array(0),
    faces: new Uint32Array(0),
  };
}

export class OptimizedMarchingCubes {
  private edgeConnections: number[][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];

  private cornerOffsets: number[][] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
  ];

  private config = {
    smoothIterations: 3,
    smoothFactor: 0.6,
    preserveFeatures: true,
    featureAngleThreshold: 0.7
  };

  generateFromGrid(
    gridDataOrFunc: GridFunction | Float32Array | number[],
    bounds: Bounds,
    resolution: number,
    isoValue: number,
    options: MarchingCubesOptions = {}
  ): MarchingCubesResult {
    const {
      smoothIterations = this.config.smoothIterations,
      smoothFactor = this.config.smoothFactor,
      sharedVertices = true
    } = options;

    const validBounds = Boolean(
      bounds
      && Array.isArray(bounds.min)
      && Array.isArray(bounds.max)
      && bounds.min.length === 3
      && bounds.max.length === 3
      && bounds.min.every(Number.isFinite)
      && bounds.max.every(Number.isFinite)
      && bounds.max.every((value, index) => value > bounds.min[index]),
    );
    if (!validBounds || !Number.isInteger(resolution) || resolution < 2 || !Number.isFinite(isoValue)) {
      return emptyResult();
    }
    if (typeof gridDataOrFunc !== 'function' && gridDataOrFunc.length !== resolution ** 3) {
      return emptyResult();
    }

    // Step 1: Generate basic mesh
    let result: { vertices: number[]; normals: number[]; faces: number[] };
    if (sharedVertices) {
      result = this.generateWithSharedVertices(gridDataOrFunc, resolution, bounds, isoValue);
    } else {
      result = this.generateBasicMesh(gridDataOrFunc, resolution, bounds, isoValue);
    }

    // Convert to typed arrays
    const vertices = new Float32Array(result.vertices);
    const normals = new Float32Array(result.normals);
    const faces = new Uint32Array(result.faces);

    // Step 2: Smoothing process
    if (smoothIterations > 0 && vertices.length > 0) {
      this.smoothMesh(vertices, faces, normals, smoothIterations, smoothFactor);
    }

    return { vertices, normals, faces };
  }

  private generateWithSharedVertices(
    gridData: GridFunction | Float32Array | number[],
    resolution: number,
    bounds: Bounds,
    isoValue: number
  ): { vertices: number[]; normals: number[]; faces: number[] } {
    const vertices: number[] = [];
    const normals: number[] = [];
    const faces: number[] = [];
    const edgeToVertex = new Map<string, number>();

    const { min, max } = bounds;
    const stepX = (max[0] - min[0]) / (resolution - 1);
    const stepY = (max[1] - min[1]) / (resolution - 1);
    const stepZ = (max[2] - min[2]) / (resolution - 1);

    const getGridValue = (i: number, j: number, k: number): number => {
      if (i < 0 || i >= resolution || j < 0 || j >= resolution || k < 0 || k >= resolution) {
        return 0;
      }

      if (typeof gridData === 'function') {
        const x = min[0] + i * stepX;
        const y = min[1] + j * stepY;
        const z = min[2] + k * stepZ;
        return gridData(x, y, z);
      } else if (gridData instanceof Float32Array || Array.isArray(gridData)) {
        const index = i + j * resolution + k * resolution * resolution;
        return gridData[index];
      }
      return 0;
    };

    let processedCubes = 0;
    let generatedTriangles = 0;

    // Process each cube
    for (let i = 0; i < resolution - 1; i++) {
      for (let j = 0; j < resolution - 1; j++) {
        for (let k = 0; k < resolution - 1; k++) {
          // Get values at 8 vertices of the cube
          const cubeValues = [
            getGridValue(i, j, k),
            getGridValue(i + 1, j, k),
            getGridValue(i + 1, j + 1, k),
            getGridValue(i, j + 1, k),
            getGridValue(i, j, k + 1),
            getGridValue(i + 1, j, k + 1),
            getGridValue(i + 1, j + 1, k + 1),
            getGridValue(i, j + 1, k + 1)
          ];

          // Calculate configuration index
          let cubeIndex = 0;
          for (let n = 0; n < 8; n++) {
            if (cubeValues[n] < isoValue) {
              cubeIndex |= (1 << n);
            }
          }

          // Skip cubes completely inside or outside the isosurface
          if (cubeIndex === 0 || cubeIndex === 255) continue;

          processedCubes++;

          // Get intersecting edges
          const edges = edgeTable[cubeIndex];
          const edgeVertices: number[] = new Array(12).fill(-1);

          // Process each intersecting edge
          for (let edge = 0; edge < 12; edge++) {
            if (edges & (1 << edge)) {
              const edgeKey = this.getEdgeKey(i, j, k, edge, resolution);

              if (!edgeToVertex.has(edgeKey)) {
                // Create new vertex
                const [v0, v1] = this.edgeConnections[edge];

                // Get world coordinates of edge endpoints
                const p0: [number, number, number] = [
                  min[0] + (i + this.cornerOffsets[v0][0]) * stepX,
                  min[1] + (j + this.cornerOffsets[v0][1]) * stepY,
                  min[2] + (k + this.cornerOffsets[v0][2]) * stepZ
                ];
                const p1: [number, number, number] = [
                  min[0] + (i + this.cornerOffsets[v1][0]) * stepX,
                  min[1] + (j + this.cornerOffsets[v1][1]) * stepY,
                  min[2] + (k + this.cornerOffsets[v1][2]) * stepZ
                ];

                // Linear interpolation to find point on isosurface
                const vertex = this.interpolateVertex(
                  p0, p1, cubeValues[v0], cubeValues[v1], isoValue
                );

                const vertexIndex = vertices.length / 3;
                vertices.push(...vertex);
                normals.push(0, 0, 0); // Temporary normal

                edgeToVertex.set(edgeKey, vertexIndex);
                edgeVertices[edge] = vertexIndex;
              } else {
                edgeVertices[edge] = edgeToVertex.get(edgeKey)!;
              }
            }
          }

          // Generate triangles based on lookup table
          const triConfig = triTable[cubeIndex];
          if (triConfig && Array.isArray(triConfig)) {
            for (let t = 0; t < triConfig.length; t++) {
              if (triConfig[t] === -1) break;

              if (t + 2 < triConfig.length &&
                  triConfig[t] !== -1 &&
                  triConfig[t + 1] !== -1 &&
                  triConfig[t + 2] !== -1) {

                const v0 = edgeVertices[triConfig[t]];
                const v1 = edgeVertices[triConfig[t + 1]];
                const v2 = edgeVertices[triConfig[t + 2]];

                if (v0 >= 0 && v1 >= 0 && v2 >= 0) {
                  faces.push(v0, v1, v2);
                  generatedTriangles++;
                }

                t += 2;
              }
            }
          }
        }
      }
    }

    void processedCubes;
    void generatedTriangles;

    // Calculate smooth vertex normals
    this.calculateSmoothNormals(vertices, faces, normals);

    return { vertices, normals, faces };
  }

  private generateBasicMesh(
    gridData: GridFunction | Float32Array | number[],
    resolution: number,
    bounds: Bounds,
    isoValue: number
  ): { vertices: number[]; normals: number[]; faces: number[] } {
    const vertices: number[] = [];
    const normals: number[] = [];
    const faces: number[] = [];

    const { min, max } = bounds;
    const stepX = (max[0] - min[0]) / (resolution - 1);
    const stepY = (max[1] - min[1]) / (resolution - 1);
    const stepZ = (max[2] - min[2]) / (resolution - 1);

    const getGridValue = (i: number, j: number, k: number): number => {
      if (i < 0 || i >= resolution || j < 0 || j >= resolution || k < 0 || k >= resolution) {
        return 0;
      }

      if (typeof gridData === 'function') {
        const x = min[0] + i * stepX;
        const y = min[1] + j * stepY;
        const z = min[2] + k * stepZ;
        return gridData(x, y, z);
      } else if (gridData instanceof Float32Array || Array.isArray(gridData)) {
        const index = i + j * resolution + k * resolution * resolution;
        return gridData[index];
      }
      return 0;
    };

    // Simplified version, each triangle generates vertices independently
    for (let i = 0; i < resolution - 1; i++) {
      for (let j = 0; j < resolution - 1; j++) {
        for (let k = 0; k < resolution - 1; k++) {
          const cubeValues = [
            getGridValue(i, j, k),
            getGridValue(i + 1, j, k),
            getGridValue(i + 1, j + 1, k),
            getGridValue(i, j + 1, k),
            getGridValue(i, j, k + 1),
            getGridValue(i + 1, j, k + 1),
            getGridValue(i + 1, j + 1, k + 1),
            getGridValue(i, j + 1, k + 1)
          ];

          let cubeIndex = 0;
          for (let n = 0; n < 8; n++) {
            if (cubeValues[n] < isoValue) {
              cubeIndex |= (1 << n);
            }
          }

          if (cubeIndex === 0 || cubeIndex === 255) continue;

          const edges = edgeTable[cubeIndex];
          const edgeVertices: ([number, number, number] | null)[] = new Array(12).fill(null);

          // Calculate vertices on edges
          for (let edge = 0; edge < 12; edge++) {
            if (edges & (1 << edge)) {
              const [v0, v1] = this.edgeConnections[edge];

              const p0: [number, number, number] = [
                min[0] + (i + this.cornerOffsets[v0][0]) * stepX,
                min[1] + (j + this.cornerOffsets[v0][1]) * stepY,
                min[2] + (k + this.cornerOffsets[v0][2]) * stepZ
              ];
              const p1: [number, number, number] = [
                min[0] + (i + this.cornerOffsets[v1][0]) * stepX,
                min[1] + (j + this.cornerOffsets[v1][1]) * stepY,
                min[2] + (k + this.cornerOffsets[v1][2]) * stepZ
              ];

              edgeVertices[edge] = this.interpolateVertex(
                p0, p1, cubeValues[v0], cubeValues[v1], isoValue
              );
            }
          }

          // Generate triangles
          const triConfig = triTable[cubeIndex];
          if (triConfig && Array.isArray(triConfig)) {
            for (let t = 0; t < triConfig.length - 2; t += 3) {
              if (triConfig[t] === -1) break;

              const v0 = edgeVertices[triConfig[t]];
              const v1 = edgeVertices[triConfig[t + 1]];
              const v2 = edgeVertices[triConfig[t + 2]];

              if (v0 && v1 && v2) {
                const startIdx = vertices.length / 3;

                vertices.push(...v0, ...v1, ...v2);

                // Calculate face normal
                const normal = this.calculateFaceNormal(v0, v1, v2);
                normals.push(...normal, ...normal, ...normal);

                faces.push(startIdx, startIdx + 1, startIdx + 2);
              }
            }
          }
        }
      }
    }

    return { vertices, normals, faces };
  }

  private getEdgeKey(i: number, j: number, k: number, edge: number, resolution: number): string {
    const [v0, v1] = this.edgeConnections[edge];
    const o0 = this.cornerOffsets[v0];
    const o1 = this.cornerOffsets[v1];

    const g0_i = i + o0[0];
    const g0_j = j + o0[1];
    const g0_k = k + o0[2];
    const g1_i = i + o1[0];
    const g1_j = j + o1[1];
    const g1_k = k + o1[2];

    const id0 = g0_k + g0_j * resolution + g0_i * resolution * resolution;
    const id1 = g1_k + g1_j * resolution + g1_i * resolution * resolution;

    return id0 < id1 ? `${id0}_${id1}` : `${id1}_${id0}`;
  }

  private interpolateVertex(
    p0: [number, number, number],
    p1: [number, number, number],
    v0: number,
    v1: number,
    isoValue: number
  ): [number, number, number] {
    if (Math.abs(isoValue - v0) < 1e-10) return p0;
    if (Math.abs(isoValue - v1) < 1e-10) return p1;
    if (Math.abs(v0 - v1) < 1e-10) return p0;

    const t = (isoValue - v0) / (v1 - v0);
    const t_clamped = Math.max(0, Math.min(1, t));

    return [
      p0[0] + t_clamped * (p1[0] - p0[0]),
      p0[1] + t_clamped * (p1[1] - p0[1]),
      p0[2] + t_clamped * (p1[2] - p0[2])
    ];
  }

  private calculateFaceNormal(
    v0: [number, number, number],
    v1: [number, number, number],
    v2: [number, number, number]
  ): [number, number, number] {
    const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
    const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

    const normal = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0]
    ];

    const length = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
    if (length > 1e-10) {
      return [normal[0] / length, normal[1] / length, normal[2] / length];
    }
    return [0, 0, 1];
  }

  private calculateSmoothNormals(vertices: number[], faces: number[], normals: number[]): void {
    // Reset all normals
    for (let i = 0; i < normals.length; i++) {
      normals[i] = 0;
    }

    // Accumulate face normals to their vertices
    for (let i = 0; i < faces.length; i += 3) {
      const i0 = faces[i] * 3;
      const i1 = faces[i + 1] * 3;
      const i2 = faces[i + 2] * 3;

      const v0: [number, number, number] = [vertices[i0], vertices[i0 + 1], vertices[i0 + 2]];
      const v1: [number, number, number] = [vertices[i1], vertices[i1 + 1], vertices[i1 + 2]];
      const v2: [number, number, number] = [vertices[i2], vertices[i2 + 1], vertices[i2 + 2]];

      const normal = this.calculateFaceNormal(v0, v1, v2);

      // Accumulate to each vertex
      for (let j = 0; j < 3; j++) {
        normals[i0 + j] += normal[j];
        normals[i1 + j] += normal[j];
        normals[i2 + j] += normal[j];
      }
    }

    // Normalize all vertex normals
    for (let i = 0; i < normals.length; i += 3) {
      const length = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2);
      if (length > 1e-10) {
        normals[i] /= length;
        normals[i + 1] /= length;
        normals[i + 2] /= length;
      } else {
        normals[i] = 0;
        normals[i + 1] = 0;
        normals[i + 2] = 1;
      }
    }
  }

  private smoothMesh(
    vertices: Float32Array,
    faces: Uint32Array,
    normals: Float32Array,
    iterations: number,
    factor: number
  ): void {
    const numVertices = vertices.length / 3;

    // Build vertex adjacency list
    const adjacency: Set<number>[] = new Array(numVertices).fill(null).map(() => new Set());

    for (let i = 0; i < faces.length; i += 3) {
      const v0 = faces[i];
      const v1 = faces[i + 1];
      const v2 = faces[i + 2];

      adjacency[v0].add(v1);
      adjacency[v0].add(v2);
      adjacency[v1].add(v0);
      adjacency[v1].add(v2);
      adjacency[v2].add(v0);
      adjacency[v2].add(v1);
    }

    // Laplacian smoothing
    for (let iter = 0; iter < iterations; iter++) {
      const newVertices = new Float32Array(vertices);

      for (let i = 0; i < numVertices; i++) {
        const neighbors = Array.from(adjacency[i]);
        if (neighbors.length === 0) continue;

        let avgX = 0, avgY = 0, avgZ = 0;
        for (const n of neighbors) {
          avgX += vertices[n * 3];
          avgY += vertices[n * 3 + 1];
          avgZ += vertices[n * 3 + 2];
        }

        avgX /= neighbors.length;
        avgY /= neighbors.length;
        avgZ /= neighbors.length;

        const idx = i * 3;
        newVertices[idx] = vertices[idx] + (avgX - vertices[idx]) * factor;
        newVertices[idx + 1] = vertices[idx + 1] + (avgY - vertices[idx + 1]) * factor;
        newVertices[idx + 2] = vertices[idx + 2] + (avgZ - vertices[idx + 2]) * factor;
      }

      // Update vertices
      for (let i = 0; i < vertices.length; i++) {
        vertices[i] = newVertices[i];
      }
    }

    // Recalculate normals
    const verticesArray = Array.from(vertices);
    const facesArray = Array.from(faces);
    const normalsArray = Array.from(normals);
    this.calculateSmoothNormals(verticesArray, facesArray, normalsArray);
    for (let i = 0; i < normals.length; i++) {
      normals[i] = normalsArray[i];
    }
  }
}

export default OptimizedMarchingCubes;
