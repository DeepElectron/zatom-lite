/**
 * Calculate the final Cartesian atomic coordinates and lattice vectors from the assembly's sceneObjects + buildingBlocks.
 * Commonly used by CIF export and 3D boundary preview to avoid logical duplication.
 */

export interface AssemblyGeometryResult {
  atoms: { element: string; cartesian: [number, number, number] }[]
  latticeVectors: number[][] | null
  hasMolecule: boolean
  /**
  * Offset by which the atom is translated (used for 3D preview bounding box positioning)
  */
  originShift: [number, number, number]
}

export function computeAssemblyGeometry(
  sceneObjects: any[],
  buildingBlocks: any[],
  periodicDirs: { a: boolean; b: boolean; c: boolean },
  freeDirPadding: { a: [number, number]; b: [number, number]; c: [number, number] },
): AssemblyGeometryResult | null {
  if (sceneObjects.length === 0) return null

  let totalOriginShift: [number, number, number] = [0, 0, 0]

  // Collect the Cartesian coordinates of all atoms
  const allCartesianAtoms: { element: string; cartesian: [number, number, number] }[] = []
  let latticeVectors: number[][] | null = null
  let hasMolecule = false

  // First pass: collect lattice information and determine whether molecules exist
  sceneObjects.forEach(obj => {
    const block = buildingBlocks.find((b: any) => b.id === obj.blockId)
    if (!block) return

    if (block.type === 'molecule') {
      hasMolecule = true
    }

    const supercell = obj.supercell || { a: 1, b: 1, c: 1 }

    // Use the lattice information of the first crystal
    if (block.latticeVectors && block.type === 'crystal' && !latticeVectors) {
      let va: number[], vb: number[], vc: number[]
      if (Array.isArray(block.latticeVectors)) {
        [va, vb, vc] = block.latticeVectors
      } else {
        va = block.latticeVectors.a
        vb = block.latticeVectors.b
        vc = block.latticeVectors.c
      }
      latticeVectors = [
        [va[0] * supercell.a, va[1] * supercell.a, va[2] * supercell.a],
        [vb[0] * supercell.b, vb[1] * supercell.b, vb[2] * supercell.b],
        [vc[0] * supercell.c, vc[1] * supercell.c, vc[2] * supercell.c],
      ]
    }
  })

  // Second pass: collect the Cartesian coordinates of all atoms
  sceneObjects.forEach(obj => {
    const block = buildingBlocks.find((b: any) => b.id === obj.blockId)
    if (!block) return

    const supercell = obj.supercell || { a: 1, b: 1, c: 1 }
    const objPos = obj.position || [0, 0, 0]
    const objRot = obj.rotation || [0, 0, 0]

    // rotation matrix
    const cosX = Math.cos(objRot[0]), sinX = Math.sin(objRot[0])
    const cosY = Math.cos(objRot[1]), sinY = Math.sin(objRot[1])
    const cosZ = Math.cos(objRot[2]), sinZ = Math.sin(objRot[2])

    const rotatePoint = (x: number, y: number, z: number): [number, number, number] => {
      const y1 = y * cosX - z * sinX, z1 = y * sinX + z * cosX
      const x2 = x * cosY + z1 * sinY, z2 = -x * sinY + z1 * cosY
      const x3 = x2 * cosZ - y1 * sinZ, y3 = x2 * sinZ + y1 * cosZ
      return [x3, y3, z2]
    }

    if (!block.atoms || block.atoms.length === 0) return

    // Calculate center — exactly the same as SceneObjectRenderer of assembly-viewer
    let centerX = 0, centerY = 0, centerZ = 0
    if (block.type === 'crystal' && block.latticeVectors) {
      let va: number[], vb: number[], vc: number[]
      if (Array.isArray(block.latticeVectors)) {
        [va, vb, vc] = block.latticeVectors
      } else {
        va = block.latticeVectors.a; vb = block.latticeVectors.b; vc = block.latticeVectors.c
      }
      const sc = supercell
      centerX = 0.5 * (va[0]*sc.a + vb[0]*sc.b + vc[0]*sc.c)
      centerY = 0.5 * (va[1]*sc.a + vb[1]*sc.b + vc[1]*sc.c)
      centerZ = 0.5 * (va[2]*sc.a + vb[2]*sc.b + vc[2]*sc.c)
    } else {
      let count = 0
      block.atoms.forEach((a: any) => {
        const pos = a.cartesian || [a.x || 0, a.y || 0, a.z || 0]
        centerX += pos[0]; centerY += pos[1]; centerZ += pos[2]
        count++
      })
      if (count > 0) { centerX /= count; centerY /= count; centerZ /= count }
    }

    block.atoms.forEach((atom: any) => {
      if (block.type === 'crystal' && block.latticeVectors) {
        let va: number[], vb: number[], vc: number[]
        if (Array.isArray(block.latticeVectors)) {
          [va, vb, vc] = block.latticeVectors
        } else {
          va = block.latticeVectors.a; vb = block.latticeVectors.b; vc = block.latticeVectors.c
        }
        const baseCart = atom.cartesian
          ? [atom.cartesian[0], atom.cartesian[1], atom.cartesian[2]]
          : (() => {
              const fx = atom.position?.[0] ?? 0
              const fy = atom.position?.[1] ?? 0
              const fz = atom.position?.[2] ?? 0
              return [fx*va[0]+fy*vb[0]+fz*vc[0], fx*va[1]+fy*vb[1]+fz*vc[1], fx*va[2]+fy*vb[2]+fz*vc[2]]
            })()

        for (let ia = 0; ia < supercell.a; ia++) {
          for (let ib = 0; ib < supercell.b; ib++) {
            for (let ic = 0; ic < supercell.c; ic++) {
              const ox = ia*va[0] + ib*vb[0] + ic*vc[0]
              const oy = ia*va[1] + ib*vb[1] + ic*vc[1]
              const oz = ia*va[2] + ib*vb[2] + ic*vc[2]
              // Same as 3D view: cart - center + offset, then rotate + objPos
              const px = baseCart[0] - centerX + ox
              const py = baseCart[1] - centerY + oy
              const pz = baseCart[2] - centerZ + oz
              const rotated = rotatePoint(px, py, pz)
              allCartesianAtoms.push({
                element: atom.element,
                cartesian: [rotated[0] + objPos[0], rotated[1] + objPos[1], rotated[2] + objPos[2]]
              })
            }
          }
        }
      } else {
        const cart = atom.cartesian || [atom.x || 0, atom.y || 0, atom.z || 0]
        // Consistent with 3D view: cart - center, then rotate + objPos
        const px = cart[0] - centerX
        const py = cart[1] - centerY
        const pz = cart[2] - centerZ
        const rotated = rotatePoint(px, py, pz)
        allCartesianAtoms.push({
          element: atom.element,
          cartesian: [rotated[0] + objPos[0], rotated[1] + objPos[1], rotated[2] + objPos[2]]
        })
      }
    })
  })

  if (allCartesianAtoms.length === 0) return null

  // If there is no lattice, create a box surrounding all atoms
  if (!latticeVectors) {
    const minX = Math.min(...allCartesianAtoms.map(a => a.cartesian[0])) - 5
    const maxX = Math.max(...allCartesianAtoms.map(a => a.cartesian[0])) + 5
    const minY = Math.min(...allCartesianAtoms.map(a => a.cartesian[1])) - 5
    const maxY = Math.max(...allCartesianAtoms.map(a => a.cartesian[1])) + 5
    const minZ = Math.min(...allCartesianAtoms.map(a => a.cartesian[2])) - 5
    const maxZ = Math.max(...allCartesianAtoms.map(a => a.cartesian[2])) + 5
    latticeVectors = [
      [maxX - minX, 0, 0],
      [0, maxY - minY, 0],
      [0, 0, maxZ - minZ],
    ]
    // Move atoms into the box
    totalOriginShift = [minX, minY, minZ]
    allCartesianAtoms.forEach(a => {
      a.cartesian[0] -= minX
      a.cartesian[1] -= minY
      a.cartesian[2] -= minZ
    })
  }

  // When crystal + molecules coexist, expand the lattice to just include all atoms (without adding a vacuum layer)
  if (hasMolecule && latticeVectors) {
    const [tva, tvb, tvc] = latticeVectors
    const tm00 = tva[0], tm01 = tvb[0], tm02 = tvc[0]
    const tm10 = tva[1], tm11 = tvb[1], tm12 = tvc[1]
    const tm20 = tva[2], tm21 = tvb[2], tm22 = tvc[2]
    const tdet = tm00*(tm11*tm22 - tm12*tm21) - tm01*(tm10*tm22 - tm12*tm20) + tm02*(tm10*tm21 - tm11*tm20)
    const tinv00 = (tm11*tm22 - tm12*tm21) / tdet
    const tinv01 = (tm02*tm21 - tm01*tm22) / tdet
    const tinv02 = (tm01*tm12 - tm02*tm11) / tdet
    const tinv10 = (tm12*tm20 - tm10*tm22) / tdet
    const tinv11 = (tm00*tm22 - tm02*tm20) / tdet
    const tinv12 = (tm02*tm10 - tm00*tm12) / tdet
    const tinv20 = (tm10*tm21 - tm11*tm20) / tdet
    const tinv21 = (tm01*tm20 - tm00*tm21) / tdet
    const tinv22 = (tm00*tm11 - tm01*tm10) / tdet

    // Calculate the fractional coordinate range of all atoms
    let minFx = Infinity, maxFx = -Infinity
    let minFy = Infinity, maxFy = -Infinity
    let minFz = Infinity, maxFz = -Infinity

    allCartesianAtoms.forEach(atom => {
      const [x, y, z] = atom.cartesian
      const fx = tinv00*x + tinv01*y + tinv02*z
      const fy = tinv10*x + tinv11*y + tinv12*z
      const fz = tinv20*x + tinv21*y + tinv22*z
      minFx = Math.min(minFx, fx); maxFx = Math.max(maxFx, fx)
      minFy = Math.min(minFy, fy); maxFy = Math.max(maxFy, fy)
      minFz = Math.min(minFz, fz); maxFz = Math.max(maxFz, fz)
    })

    // Only expand in the direction of atoms beyond the scope of the lattice, just including all atoms
    const needExtendA = minFx < -0.01 || maxFx > 1.01
    const needExtendB = minFy < -0.01 || maxFy > 1.01
    const needExtendC = minFz < -0.01 || maxFz > 1.01

    const newMinFx = needExtendA ? minFx : 0
    const newMaxFx = needExtendA ? maxFx : 1
    const newMinFy = needExtendB ? minFy : 0
    const newMaxFy = needExtendB ? maxFy : 1
    const newMinFz = needExtendC ? minFz : 0
    const newMaxFz = needExtendC ? maxFz : 1

    const scaleA = newMaxFx - newMinFx
    const scaleB = newMaxFy - newMinFy
    const scaleC = newMaxFz - newMinFz

    // Translate the atom to the new origin
    const originX = newMinFx * tva[0] + newMinFy * tvb[0] + newMinFz * tvc[0]
    const originY = newMinFx * tva[1] + newMinFy * tvb[1] + newMinFz * tvc[1]
    const originZ = newMinFx * tva[2] + newMinFy * tvb[2] + newMinFz * tvc[2]

    totalOriginShift = [
      totalOriginShift[0] + originX,
      totalOriginShift[1] + originY,
      totalOriginShift[2] + originZ,
    ]

    allCartesianAtoms.forEach(a => {
      a.cartesian[0] -= originX
      a.cartesian[1] -= originY
      a.cartesian[2] -= originZ
    })

    // Scale lattice vector
    latticeVectors = [
      [tva[0] * scaleA, tva[1] * scaleA, tva[2] * scaleA],
      [tvb[0] * scaleB, tvb[1] * scaleB, tvb[2] * scaleB],
      [tvc[0] * scaleC, tvc[1] * scaleC, tvc[2] * scaleC],
    ]
  }

  // For the direction marked free, calculate the projection range along the lattice direction instead of periodicity
  const hasFreeDirs = !periodicDirs.a || !periodicDirs.b || !periodicDirs.c
  if (latticeVectors && hasFreeDirs) {
    const [tva, tvb, tvc] = latticeVectors
    // Calculate the inverse matrix for projection
    const tm00 = tva[0], tm01 = tvb[0], tm02 = tvc[0]
    const tm10 = tva[1], tm11 = tvb[1], tm12 = tvc[1]
    const tm20 = tva[2], tm21 = tvb[2], tm22 = tvc[2]
    const tdet = tm00*(tm11*tm22 - tm12*tm21) - tm01*(tm10*tm22 - tm12*tm20) + tm02*(tm10*tm21 - tm11*tm20)
    if (Math.abs(tdet) > 1e-10) {
      const ti00 = (tm11*tm22 - tm12*tm21) / tdet
      const ti01 = (tm02*tm21 - tm01*tm22) / tdet
      const ti02 = (tm01*tm12 - tm02*tm11) / tdet
      const ti10 = (tm12*tm20 - tm10*tm22) / tdet
      const ti11 = (tm00*tm22 - tm02*tm20) / tdet
      const ti12 = (tm02*tm10 - tm00*tm12) / tdet
      const ti20 = (tm10*tm21 - tm11*tm20) / tdet
      const ti21 = (tm01*tm20 - tm00*tm21) / tdet
      const ti22 = (tm00*tm11 - tm01*tm10) / tdet

      // Calculate the fractional coordinate range of all atoms along each lattice direction
      let minFa = Infinity, maxFa = -Infinity
      let minFb = Infinity, maxFb = -Infinity
      let minFc = Infinity, maxFc = -Infinity
      allCartesianAtoms.forEach(a => {
        const [x, y, z] = a.cartesian
        const fa = ti00*x + ti01*y + ti02*z
        const fb = ti10*x + ti11*y + ti12*z
        const fc = ti20*x + ti21*y + ti22*z
        minFa = Math.min(minFa, fa); maxFa = Math.max(maxFa, fa)
        minFb = Math.min(minFb, fb); maxFb = Math.max(maxFb, fb)
        minFc = Math.min(minFc, fc); maxFc = Math.max(maxFc, fc)
      })

      const dirs = [
        { key: 'a' as const, vec: tva, min: minFa, max: maxFa },
        { key: 'b' as const, vec: tvb, min: minFb, max: maxFb },
        { key: 'c' as const, vec: tvc, min: minFc, max: maxFc },
      ]

      // For free direction: extend the fraction range to include all atoms + user-set padding
      const newMinF = [periodicDirs.a ? 0 : minFa, periodicDirs.b ? 0 : minFb, periodicDirs.c ? 0 : minFc]
      const newMaxF = [periodicDirs.a ? 1 : maxFa, periodicDirs.b ? 1 : maxFb, periodicDirs.c ? 1 : maxFc]

      dirs.forEach((d, i) => {
        if (!periodicDirs[d.key]) {
          const mag = Math.sqrt(d.vec[0]**2 + d.vec[1]**2 + d.vec[2]**2)
          const [padMinus, padPlus] = freeDirPadding[d.key]
          newMinF[i] = d.min - padMinus / mag
          newMaxF[i] = d.max + padPlus / mag
        }
      })

      const scaleA = newMaxF[0] - newMinF[0]
      const scaleB = newMaxF[1] - newMinF[1]
      const scaleC = newMaxF[2] - newMinF[2]

      // new origin
      const ox = newMinF[0]*tva[0] + newMinF[1]*tvb[0] + newMinF[2]*tvc[0]
      const oy = newMinF[0]*tva[1] + newMinF[1]*tvb[1] + newMinF[2]*tvc[1]
      const oz = newMinF[0]*tva[2] + newMinF[1]*tvb[2] + newMinF[2]*tvc[2]

      totalOriginShift = [
        totalOriginShift[0] + ox,
        totalOriginShift[1] + oy,
        totalOriginShift[2] + oz,
      ]

      allCartesianAtoms.forEach(a => {
        a.cartesian[0] -= ox
        a.cartesian[1] -= oy
        a.cartesian[2] -= oz
      })

      latticeVectors = [
        [tva[0]*scaleA, tva[1]*scaleA, tva[2]*scaleA],
        [tvb[0]*scaleB, tvb[1]*scaleB, tvb[2]*scaleB],
        [tvc[0]*scaleC, tvc[1]*scaleC, tvc[2]*scaleC],
      ]
    }
  }

  return { atoms: allCartesianAtoms, latticeVectors, hasMolecule, originShift: totalOriginShift }
}
