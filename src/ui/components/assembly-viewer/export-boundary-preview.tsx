/** Draw the exact periodic/free-axis boundary that the assembly exporter uses. */
import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useCrystalStore } from '../../../orchestration/crystalStore'
import { computeAssemblyGeometry } from '../../../lib/assembly/computeAssemblyGeometry'

export function ExportBoundaryPreview() {
  const sceneObjects = useCrystalStore(s => s.sceneObjects)
  const buildingBlocks = useCrystalStore(s => s.buildingBlocks)
  const periodicDirs = useCrystalStore(s => s.periodicDirs)
  const freeDirPadding = useCrystalStore(s => s.freeDirPadding)

  const boundary = useMemo(() => {
    const geometry = computeAssemblyGeometry(sceneObjects, buildingBlocks, periodicDirs, freeDirPadding)
    if (!geometry || !geometry.latticeVectors) return null

    const [va, vb, vc] = geometry.latticeVectors

    const visualPositions: [number, number, number][] = []
    sceneObjects.forEach(obj => {
      const block = buildingBlocks.find((b: any) => b.id === obj.blockId)
      if (!block) return
      const sc = obj.supercell || { a: 1, b: 1, c: 1 }
      const objPos = obj.position || [0, 0, 0]

      let cx = 0, cy = 0, cz = 0
      if (block.type === 'crystal' && block.latticeVectors) {
        let bva: number[], bvb: number[], bvc: number[]
        if (Array.isArray(block.latticeVectors)) { [bva, bvb, bvc] = block.latticeVectors }
        else { bva = block.latticeVectors.a; bvb = block.latticeVectors.b; bvc = block.latticeVectors.c }
        cx = 0.5*(bva[0]*sc.a+bvb[0]*sc.b+bvc[0]*sc.c)
        cy = 0.5*(bva[1]*sc.a+bvb[1]*sc.b+bvc[1]*sc.c)
        cz = 0.5*(bva[2]*sc.a+bvb[2]*sc.b+bvc[2]*sc.c)
      } else {
        let cnt = 0
        block.atoms?.forEach((a: any) => {
          const p = a.cartesian || [a.x||0, a.y||0, a.z||0]
          cx += p[0]; cy += p[1]; cz += p[2]; cnt++
        })
        if (cnt) { cx /= cnt; cy /= cnt; cz /= cnt }
      }

      block.atoms?.forEach((a: any) => {
        const p = a.cartesian || [a.x||0, a.y||0, a.z||0]
        visualPositions.push([p[0]-cx+objPos[0], p[1]-cy+objPos[1], p[2]-cz+objPos[2]])
      })
    })

    if (visualPositions.length === 0) return null

    const m00=va[0],m01=vb[0],m02=vc[0],m10=va[1],m11=vb[1],m12=vc[1],m20=va[2],m21=vb[2],m22=vc[2]
    const det=m00*(m11*m22-m12*m21)-m01*(m10*m22-m12*m20)+m02*(m10*m21-m11*m20)
    if (Math.abs(det) < 1e-10) return null
    const i00=(m11*m22-m12*m21)/det,i01=(m02*m21-m01*m22)/det,i02=(m01*m12-m02*m11)/det
    const i10=(m12*m20-m10*m22)/det,i11=(m00*m22-m02*m20)/det,i12=(m02*m10-m00*m12)/det
    const i20=(m10*m21-m11*m20)/det,i21=(m01*m20-m00*m21)/det,i22=(m00*m11-m01*m10)/det

    let minFa=Infinity,maxFa=-Infinity,minFb=Infinity,maxFb=-Infinity,minFc=Infinity,maxFc=-Infinity
    visualPositions.forEach(([x,y,z]) => {
      const fa=i00*x+i01*y+i02*z, fb=i10*x+i11*y+i12*z, fc=i20*x+i21*y+i22*z
      minFa=Math.min(minFa,fa);maxFa=Math.max(maxFa,fa)
      minFb=Math.min(minFb,fb);maxFb=Math.max(maxFb,fb)
      minFc=Math.min(minFc,fc);maxFc=Math.max(maxFc,fc)
    })

    const aMag = Math.sqrt(va[0]**2+va[1]**2+va[2]**2)
    const bMag = Math.sqrt(vb[0]**2+vb[1]**2+vb[2]**2)
    const cMag = Math.sqrt(vc[0]**2+vc[1]**2+vc[2]**2)
    const padAMinus = !periodicDirs.a ? freeDirPadding.a[0] / aMag : 0
    const padAPlus  = !periodicDirs.a ? freeDirPadding.a[1] / aMag : 0
    const padBMinus = !periodicDirs.b ? freeDirPadding.b[0] / bMag : 0
    const padBPlus  = !periodicDirs.b ? freeDirPadding.b[1] / bMag : 0
    const padCMinus = !periodicDirs.c ? freeDirPadding.c[0] / cMag : 0
    const padCPlus  = !periodicDirs.c ? freeDirPadding.c[1] / cMag : 0

    let blueOrigin: THREE.Vector3 | null = null
    for (const obj of sceneObjects) {
      const block = buildingBlocks.find((b: any) => b.id === obj.blockId)
      if (block?.type === 'crystal' && block.latticeVectors) {
        const sc = obj.supercell || { a: 1, b: 1, c: 1 }
        const objPos = obj.position || [0, 0, 0]
        let bva: number[], bvb: number[], bvc: number[]
        if (Array.isArray(block.latticeVectors)) { [bva, bvb, bvc] = block.latticeVectors }
        else { bva = block.latticeVectors.a; bvb = block.latticeVectors.b; bvc = block.latticeVectors.c }
        const cx = 0.5*(bva[0]*sc.a+bvb[0]*sc.b+bvc[0]*sc.c)
        const cy = 0.5*(bva[1]*sc.a+bvb[1]*sc.b+bvc[1]*sc.c)
        const cz = 0.5*(bva[2]*sc.a+bvb[2]*sc.b+bvc[2]*sc.c)
        blueOrigin = new THREE.Vector3(objPos[0]-cx, objPos[1]-cy, objPos[2]-cz)
        break
      }
    }

    const bo = blueOrigin || new THREE.Vector3(0, 0, 0)

    const corner = (fa: number, fb: number, fc: number) => new THREE.Vector3(
      fa*va[0]+fb*vb[0]+fc*vc[0],
      fa*va[1]+fb*vb[1]+fc*vc[1],
      fa*va[2]+fb*vb[2]+fc*vc[2],
    )

    const boFa = i00*bo.x+i01*bo.y+i02*bo.z
    const boFb = i10*bo.x+i11*bo.y+i12*bo.z
    const boFc = i20*bo.x+i21*bo.y+i22*bo.z

    const fMinA = periodicDirs.a ? boFa : minFa - padAMinus
    const fMaxA = periodicDirs.a ? boFa + 1 : maxFa + padAPlus
    const fMinB = periodicDirs.b ? boFb : minFb - padBMinus
    const fMaxB = periodicDirs.b ? boFb + 1 : maxFb + padBPlus
    const fMinC = periodicDirs.c ? boFc : minFc - padCMinus
    const fMaxC = periodicDirs.c ? boFc + 1 : maxFc + padCPlus
    const c000 = corner(fMinA,fMinB,fMinC)
    const c100 = corner(fMaxA,fMinB,fMinC)
    const c010 = corner(fMinA,fMaxB,fMinC)
    const c110 = corner(fMaxA,fMaxB,fMinC)
    const c001 = corner(fMinA,fMinB,fMaxC)
    const c101 = corner(fMaxA,fMinB,fMaxC)
    const c011 = corner(fMinA,fMaxB,fMaxC)
    const c111 = corner(fMaxA,fMaxB,fMaxC)

    return [
      [c000,c100],[c010,c110],[c001,c101],[c011,c111],
      [c000,c010],[c100,c110],[c001,c011],[c101,c111],
      [c000,c001],[c100,c101],[c010,c011],[c110,c111],
    ] as [THREE.Vector3, THREE.Vector3][]
  }, [sceneObjects, buildingBlocks, periodicDirs, freeDirPadding])

  if (!boundary) return null

  return (
    <group>
      {boundary.map((edge, i) => (
        <Line
          key={i}
          points={[edge[0].toArray(), edge[1].toArray()]}
          color="#FF9F0A"
          lineWidth={1.5}
          dashed
          dashSize={0.3}
          gapSize={0.2}
        />
      ))}
    </group>
  )
}
