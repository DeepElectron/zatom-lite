'use client'

/**
 * Coordination polyhedra renderer.
 *
 * Detects local coordination geometry from atom positions and renders
 * meshes batched by central element. Face colors can follow atom colors, use an
 * independent center-element palette, or use one uniform color.
 *
 * Returns null when `showCoordinationPolyhedra` is false. Coplanar regions are
 * rendered as triangulated polygons; collinear regions are skipped.
 */

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import {
  analyzeCoordinationEnvironments,
  type CoordinationEnvironmentAnalysis,
  type CoordinationPolyhedron,
} from '../../../lib/crystal/polyhedra'
import { getDefaultCrystalElementVisual, resolvePolyhedronColor } from '../../../lib/render/crystal-visuals'
import type { Atom, LatticeVectors } from '../../../lib/crystal/types'
import type { LayerRenderOverride } from './layer-render-override'
import {
  POLY_MODE_GEM,
  POLY_MODE_HOLOGRAM,
  SHADING_MODE_MAP,
} from '../../../lib/render/stylized-material'
import { StylizedMaterial } from './stylized-material'

export function buildCoordinationPolyhedraGeometry(polyhedra: readonly CoordinationPolyhedron[]): THREE.BufferGeometry | null {
  const positions: number[] = []
  const normals: number[] = []
  for (const p of polyhedra) {
    for (const face of p.faces) {
      const [ia, ib, ic] = face
      const a = p.vertices[ia]
      const b = p.vertices[ib]
      const c = p.vertices[ic]
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
      // Face normal (assumes hull builder already winds outward).
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      nx /= len; ny /= len; nz /= len
      normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
    }
  }
  if (positions.length === 0) return null
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return geom
}

export function useCoordinationAnalysis(): CoordinationEnvironmentAnalysis | null {
  const showCoordinationPolyhedra = useCrystalStore((s) => s.showCoordinationPolyhedra)
  const polyhedraCentralElements = useCrystalStore((s) => s.polyhedraCentralElements)
  const atoms = useCrystalStore((s) => s.atoms)
  const periodic = useCrystalStore((s) => s.periodic)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const supercellParams = useCrystalStore((s) => s.supercellParams)
  const pairCutoffs = useCrystalStore((s) => s.bondSettings.elementPairRadii)
  const restrictToConfiguredPairs = useCrystalStore((s) => s.bondSettings.restrictToConfiguredPairs)

  const visiblePeriodicCell = useMemo<LatticeVectors | undefined>(() => {
    if (!periodic) return undefined
    const { a, b, c } = latticeVectors
    const { nx, ny, nz } = supercellParams
    return {
      a: [a[0] * nx, a[1] * nx, a[2] * nx],
      b: [b[0] * ny, b[1] * ny, b[2] * ny],
      c: [c[0] * nz, c[1] * nz, c[2] * nz],
    }
  }, [latticeVectors, periodic, supercellParams])

  return useMemo(() => {
    if (!showCoordinationPolyhedra) return null
    return analyzeCoordinationEnvironments(atoms, {
      centralElements: polyhedraCentralElements.size > 0 ? polyhedraCentralElements : undefined,
      periodicLatticeVectors: visiblePeriodicCell,
      pairCutoffs,
      restrictToConfiguredPairs,
    })
  }, [showCoordinationPolyhedra, atoms, polyhedraCentralElements, visiblePeriodicCell, pairCutoffs, restrictToConfiguredPairs])
}

export function CoordinationPolyhedra({ analysis }: { analysis: CoordinationEnvironmentAnalysis | null }) {
  const showCoordinationPolyhedra = useCrystalStore((s) => s.showCoordinationPolyhedra)
  const polyhedraOpacity = useCrystalStore((s) => s.polyhedraOpacity)
  const setCoordinationAnalysisSummary = useCrystalStore((s) => s.setCoordinationAnalysisSummary)
  const renderStyle = useCrystalStore((s) => s.renderStyle)
  const polyStyle = useCrystalStore((s) => s.polyStyle)
  const polyColorSource = useCrystalStore((s) => s.polyColorSource)
  const polyElementColors = useCrystalStore((s) => s.polyElementColors)
  const polyColor = useCrystalStore((s) => s.polyColor)
  const showPolyEdges = useCrystalStore((s) => s.showPolyEdges)
  const polyEdgeColor = useCrystalStore((s) => s.polyEdgeColor)
  const polyEdgeOpacity = useCrystalStore((s) => s.polyEdgeOpacity)
  const polySpecular = useCrystalStore((s) => s.polySpecular)
  const polyShininess = useCrystalStore((s) => s.polyShininess)
  const polyFresnel = useCrystalStore((s) => s.polyFresnel)
  const ambientIntensity = useCrystalStore((s) => s.ambientIntensity)
  const diffuseIntensity = useCrystalStore((s) => s.diffuseIntensity)
  const elementOverrides = useCrystalStore((s) => s.elementOverrides)

  const polyhedra = analysis?.environments ?? []

  useEffect(() => {
    setCoordinationAnalysisSummary(analysis?.summary ?? null)
  }, [analysis, setCoordinationAnalysisSummary])

  const geometries = useMemo(() => {
    const groups = new Map<string, CoordinationPolyhedron[]>()
    for (const polyhedron of polyhedra) {
      const group = groups.get(polyhedron.centralElement)
      if (group) group.push(polyhedron)
      else groups.set(polyhedron.centralElement, [polyhedron])
    }
    return Array.from(groups.entries())
      .map(([element, group]) => {
        const geom = buildCoordinationPolyhedraGeometry(group)
        return {
          element,
          geom,
          edgeGeom: geom && (showPolyEdges || polyStyle === 'wireframe' || polyStyle === 'neon')
            ? new THREE.EdgesGeometry(geom, 1)
            : null,
        }
      })
      .filter((x): x is { element: string; geom: THREE.BufferGeometry; edgeGeom: THREE.EdgesGeometry | null } => x.geom !== null)
  }, [polyhedra, polyStyle, showPolyEdges])

  useEffect(() => () => {
    for (const { geom, edgeGeom } of geometries) {
      geom.dispose()
      edgeGeom?.dispose()
    }
  }, [geometries])

  if (!showCoordinationPolyhedra || geometries.length === 0) return null

  return (
    <group>
      {geometries.map(({ element, geom, edgeGeom }) => {
        const color = resolvePolyhedronColor(
          element,
          polyColorSource,
          elementOverrides,
          polyElementColors,
          polyColor,
        )
        const translucent = polyhedraOpacity < 0.999
          || polyStyle === 'translucent'
          || polyStyle === 'glass'
          || polyStyle === 'hologram'
          || polyStyle === 'neon'
        const mode = polyStyle === 'paper'
          ? SHADING_MODE_MAP.cel
          : polyStyle === 'gem'
            ? POLY_MODE_GEM
            : polyStyle === 'hologram'
              ? POLY_MODE_HOLOGRAM
              : polyStyle === 'neon'
                ? SHADING_MODE_MAP.xray
                : renderStyle === 'xray'
                  ? SHADING_MODE_MAP.vesta
                  : SHADING_MODE_MAP[renderStyle]
        // Opacity is a composable material control, including for the nominally
        // solid facet styles. Presets that require opaque paper/gem faces store 1.
        const opacity = polyhedraOpacity
        const edgeColor = polyStyle === 'neon' ? color : polyEdgeColor
        return (
          <group key={element}>
            {polyStyle !== 'wireframe' && (
              <mesh geometry={geom} renderOrder={2}>
                <StylizedMaterial
                  color={color}
                  mode={mode}
                  opacity={opacity}
                  transparent={translucent}
                  depthWrite={!translucent}
                  side={THREE.DoubleSide}
                  ambient={ambientIntensity + 0.1}
                  diffuse={diffuseIntensity}
                  specularStrength={polySpecular}
                  shininess={polyShininess}
                  fresnel={polyFresnel}
                />
              </mesh>
            )}
            {edgeGeom && (
              <lineSegments geometry={edgeGeom} renderOrder={3} raycast={() => {}}>
                <lineBasicMaterial
                  color={edgeColor}
                  transparent={polyEdgeOpacity < 1}
                  opacity={polyEdgeOpacity}
                  depthWrite={false}
                />
              </lineSegments>
            )}
            {polyStyle === 'neon' && edgeGeom && (
              <lineSegments geometry={edgeGeom} renderOrder={2} raycast={() => {}} scale={1.012}>
                <lineBasicMaterial color={color} transparent opacity={polyEdgeOpacity * (0.35 / 0.95)} depthWrite={false} />
              </lineSegments>
            )}
          </group>
        )
      })}
    </group>
  )
}

/**
 * A semantic-layer polyhedron pass is independent from the global polyhedron
 * switch. Only selected atoms may act as centres; coordinating neighbours are
 * still taken from the complete structure so shells naturally cross the
 * selection boundary.
 */
export function CrystalLayerPolyhedra({
  atoms,
  selectedAtomIds,
  color,
  opacity,
  renderOverride,
}: {
  atoms: Atom[]
  selectedAtomIds: ReadonlySet<string>
  color: string | null
  opacity: number
  renderOverride: LayerRenderOverride
}) {
  const periodic = useCrystalStore((state) => state.periodic)
  const latticeVectors = useCrystalStore((state) => state.latticeVectors)
  const supercellParams = useCrystalStore((state) => state.supercellParams)
  const pairCutoffs = useCrystalStore((state) => state.bondSettings.elementPairRadii)
  const restrictToConfiguredPairs = useCrystalStore((state) => state.bondSettings.restrictToConfiguredPairs)
  const elementOverrides = useCrystalStore((state) => state.elementOverrides)
  const showPolyEdges = useCrystalStore((state) => state.showPolyEdges)
  const polyEdgeColor = useCrystalStore((state) => state.polyEdgeColor)
  const polyEdgeOpacity = useCrystalStore((state) => state.polyEdgeOpacity)

  const visiblePeriodicCell = useMemo<LatticeVectors | undefined>(() => {
    if (!periodic) return undefined
    const { a, b, c } = latticeVectors
    const { nx, ny, nz } = supercellParams
    return {
      a: [a[0] * nx, a[1] * nx, a[2] * nx],
      b: [b[0] * ny, b[1] * ny, b[2] * ny],
      c: [c[0] * nz, c[1] * nz, c[2] * nz],
    }
  }, [latticeVectors, periodic, supercellParams])
  const centralElements = useMemo(() => new Set(
    atoms.filter((atom) => selectedAtomIds.has(atom.id)).map((atom) => atom.element),
  ), [atoms, selectedAtomIds])
  const environments = useMemo(() => centralElements.size === 0 ? [] : analyzeCoordinationEnvironments(atoms, {
    centralElements,
    periodicLatticeVectors: visiblePeriodicCell,
    pairCutoffs,
    restrictToConfiguredPairs,
  }).environments.filter((environment) => selectedAtomIds.has(environment.centralAtomId)), [
    atoms,
    centralElements,
    pairCutoffs,
    restrictToConfiguredPairs,
    selectedAtomIds,
    visiblePeriodicCell,
  ])
  const groups = useMemo(() => {
    const byColor = new Map<string, CoordinationPolyhedron[]>()
    for (const environment of environments) {
      if (environment.faces.length === 0) continue
      const faceColor = color ?? elementOverrides[environment.centralElement]?.color
        ?? getDefaultCrystalElementVisual(environment.centralElement).color
      const group = byColor.get(faceColor)
      if (group) group.push(environment)
      else byColor.set(faceColor, [environment])
    }
    return [...byColor.entries()].flatMap(([faceColor, polyhedra]) => {
      const geometry = buildCoordinationPolyhedraGeometry(polyhedra)
      if (!geometry) return []
      return [{ faceColor, geometry, edgeGeometry: showPolyEdges ? new THREE.EdgesGeometry(geometry, 1) : null }]
    })
  }, [color, elementOverrides, environments, showPolyEdges])

  useEffect(() => () => {
    for (const group of groups) {
      group.geometry.dispose()
      group.edgeGeometry?.dispose()
    }
  }, [groups])

  if (groups.length === 0) return null
  // Match the source layer contract: faces retain enough translucency for the
  // central atom/coordination shell to remain legible even at layer opacity 1.
  const faceOpacity = Math.min(opacity, .84)
  const translucent = faceOpacity < .999
  return <group>
    {groups.map(({ faceColor, geometry, edgeGeometry }) => <group key={faceColor}>
      <mesh geometry={geometry} renderOrder={5} raycast={() => {}}>
        <StylizedMaterial
          color={faceColor}
          opacity={faceOpacity}
          transparent={translucent}
          depthWrite={!translucent}
          side={THREE.DoubleSide}
          mode={renderOverride.mode}
          ambient={renderOverride.ambient}
          diffuse={renderOverride.diffuse}
          specularStrength={renderOverride.specularStrength}
          shininess={renderOverride.shininess}
          fresnel={renderOverride.fresnel}
        />
      </mesh>
      {edgeGeometry && <lineSegments geometry={edgeGeometry} renderOrder={6} raycast={() => {}}>
        <lineBasicMaterial color={polyEdgeColor} transparent={polyEdgeOpacity < 1} opacity={polyEdgeOpacity} depthWrite={false} />
      </lineSegments>}
    </group>)}
  </group>
}
