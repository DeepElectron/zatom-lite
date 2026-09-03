'use client'

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  bondsWithinAtomIds,
  crystalLayerRepresentationHasBonds,
  evaluateCrystalLayerStyle,
  resolveCrystalLayerComposition,
  resolveCrystalLayerStickRadius,
} from '../../../lib/crystal/semantic-layers'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import {
  resolveLayerShadingRenderOverride,
  type LayerRenderOverride,
} from './layer-render-override'
import { AtomMesh } from './atom-renderer'
import { BondMesh } from './bond-mesh'
import { InstancedAtoms } from './instanced-atoms'
import { InstancedBonds } from './bond-instances'
import { HyperStickPresentationLayer } from './hyper-stick-bonds'
import { CrystalLayerPolyhedra } from './coordination-polyhedra'
import { CrystalLayerSurface } from './crystal-layer-surface'
import type { ViewMode } from '../../../lib/crystal/types'
import { crystalBaseAtomRadii, crystalBaseBondRadius } from '../../../lib/crystal/base-presentation'

const INSTANCED_LAYER_THRESHOLD = 350

/**
 * Presentation passes for user-authored crystal layers. Geometry and picking
 * stay in the canonical atom/bond renderers; this component only selects data
 * and supplies LayerRenderOverride values.
 */
export function CrystalSemanticLayers({ showBonds }: { showBonds: boolean }) {
  const atoms = useCrystalStore((state) => state.atoms)
  const bonds = useCrystalStore((state) => state.bonds)
  const layers = useCrystalStore((state) => state.crystalLayers)
  const frame = useCrystalStore((state) => state.presentationFrame)
  const baseViewMode = useCrystalStore((state) => state.viewMode)
  const baseAtomScale = useCrystalStore((state) => state.atomScale)
  const baseBondScale = useCrystalStore((state) => state.bondScale)
  const sourceBondRadius = useCrystalStore((state) => state.bondRadius)
  const sourceRadiusScale = useCrystalStore((state) => state.radiusScale)
  const elementRadiusVariance = useCrystalStore((state) => state.elementRadiusVariance)
  const elementOverrides = useCrystalStore((state) => state.elementOverrides)
  const supercell = useCrystalStore((state) => state.supercellParams)
  const shadingContext = useCrystalStore(useShallow((state) => ({
    renderStyle: state.renderStyle,
    ambient: state.ambientIntensity,
    diffuse: state.diffuseIntensity,
    specular: state.specularIntensity,
    shininess: state.atomShininess,
    rim: state.rimIntensity,
    lightAmbient: state.lightAmbient,
    lightKey: state.lightKey,
  })))
  const composition = useMemo(
    () => resolveCrystalLayerComposition(atoms, layers, frame, supercell),
    [atoms, layers, frame, supercell],
  )
  const baseAtoms = useMemo(
    () => atoms.filter((atom) => composition.baseAtomIds.has(atom.id)),
    [atoms, composition],
  )
  const baseAtomIds = useMemo(() => new Set(baseAtoms.map((atom) => atom.id)), [baseAtoms])
  const baseBonds = useMemo(() => bondsWithinAtomIds(bonds, baseAtomIds), [bonds, baseAtomIds])
  const instancedBase = baseAtoms.length >= INSTANCED_LAYER_THRESHOLD
  const sourceBaseRenderOverride: LayerRenderOverride = {
    ...(baseViewMode === 'hyper-stick' || baseViewMode === 'wireframe' ? {} : { atomRadiusByAtomId: crystalBaseAtomRadii(baseAtoms, baseViewMode, {
      radiusScale: sourceRadiusScale,
      bondRadius: sourceBondRadius,
      elementRadiusVariance,
      elementOverrides,
    }) }),
    ...(baseViewMode === 'hyper-stick' || baseViewMode === 'wireframe' || baseViewMode === 'space-fill'
      ? {}
      : { bondRadius: crystalBaseBondRadius({ bondRadius: sourceBondRadius }) }),
  }

  return (
    <group>
      {baseViewMode === 'hyper-stick' ? (
        <HyperStickPresentationLayer
          atoms={baseAtoms}
          bonds={showBonds ? baseBonds : []}
          atomScale={baseAtomScale}
          renderOverride={{
            atomRadiusByAtomId: crystalBaseAtomRadii(baseAtoms, 'ball-stick', {
              radiusScale: sourceRadiusScale,
              bondRadius: sourceBondRadius,
              elementRadiusVariance,
              elementOverrides,
            }),
            atomScale: baseAtomScale,
            bondScale: baseBondScale,
            bondRadius: sourceBondRadius,
          }}
          atomKeyPrefix="crystal-base-hyper-stick"
        />
      ) : instancedBase ? (
        <InstancedAtoms atoms={baseAtoms} viewMode={baseViewMode} scale={baseAtomScale} renderOverride={sourceBaseRenderOverride} />
      ) : baseAtoms.map((atom) => (
        <AtomMesh key={`crystal-base-${atom.id}`} atom={atom} viewMode={baseViewMode} scale={baseAtomScale} renderOverride={sourceBaseRenderOverride} />
      ))}
      {showBonds && baseViewMode !== 'space-fill' && baseViewMode !== 'hyper-stick' && (instancedBase ? (
        <InstancedBonds atoms={baseAtoms} bonds={baseBonds} viewMode={baseViewMode} scale={baseBondScale} renderOverride={sourceBaseRenderOverride} />
      ) : baseBonds.map((bond) => (
        <BondMesh key={`crystal-base-${bond.id}`} atoms={baseAtoms} bond={bond} viewMode={baseViewMode} scale={baseBondScale} renderOverride={sourceBaseRenderOverride} />
      )))}
      {[...layers].reverse().map((layer) => {
        const style = evaluateCrystalLayerStyle(layer, frame, shadingContext)
        if (!style.visible) return null
        const atomIds = composition.layerAtomIds.get(layer.id) ?? new Set<string>()
        if (atomIds.size === 0) return null
        const layerAtoms = atoms.filter((atom) => atomIds.has(atom.id))
        const layerBonds = bondsWithinAtomIds(bonds, atomIds)
        const customColor = style.color.mode === 'custom' ? style.color.value : null
        const colorByAtomId = customColor
          ? new Map(layerAtoms.map((atom) => [atom.id, customColor] as const))
          : undefined
        const shading = style.shading
        const renderOverride: LayerRenderOverride = {
          colorByAtomId,
          atomScale: style.scale,
          bondScale: style.bondScale,
          opacity: style.opacity,
          ...resolveLayerShadingRenderOverride(shading),
        }
        if (style.representation === 'stick') {
          const radius = resolveCrystalLayerStickRadius(sourceBondRadius, style.bondScale)
          renderOverride.bondRadius = radius
          renderOverride.atomRadiusByAtomId = new Map(layerAtoms.map((atom) => [atom.id, radius]))
        }
        const atomMap = new Map(layerAtoms.map((atom) => [atom.id, atom] as const))
        const instanced = layerAtoms.length >= INSTANCED_LAYER_THRESHOLD

        if (style.representation === 'polyhedra') return (
          <CrystalLayerPolyhedra
            key={layer.id}
            atoms={atoms}
            selectedAtomIds={atomIds}
            color={customColor}
            opacity={style.opacity}
            renderOverride={renderOverride}
          />
        )
        if (style.representation === 'surface') return (
          <CrystalLayerSurface
            key={layer.id}
            atoms={atoms}
            selectedAtomIds={atomIds}
            opacity={style.opacity}
            renderOverride={renderOverride}
          />
        )
        // Licorice deliberately reuses the canonical mesh/material pipeline,
        // but supplies exact equal atom/bond radii instead of HyperStick SDF.
        const atomRepresentation: ViewMode = style.representation === 'stick'
          ? 'ball-stick'
          : style.representation

        return (
          <group key={layer.id}>
            {style.representation === 'hyper-stick' ? (
              <HyperStickPresentationLayer atoms={layerAtoms} bonds={layerBonds} atomScale={style.scale} renderOverride={renderOverride} atomKeyPrefix={layer.id} />
            ) : instanced ? (
              <InstancedAtoms
                atoms={layerAtoms}
                viewMode={atomRepresentation}
                scale={style.scale}
                renderOverride={renderOverride}
              />
            ) : layerAtoms.map((atom) => (
              <AtomMesh
                key={atom.id}
                atom={atom}
                viewMode={atomRepresentation}
                scale={style.scale}
                renderOverride={renderOverride}
              />
            ))}
            {crystalLayerRepresentationHasBonds(style.representation) && (instanced ? (
              <InstancedBonds
                atoms={layerAtoms}
                bonds={layerBonds}
                viewMode={atomRepresentation}
                scale={style.bondScale}
                renderOverride={renderOverride}
              />
            ) : layerBonds.map((bond) => (
              <BondMesh
                key={bond.id}
                atomMap={atomMap}
                atoms={layerAtoms}
                bond={bond}
                viewMode={atomRepresentation}
                scale={style.bondScale}
                renderOverride={renderOverride}
              />
            )))}
          </group>
        )
      })}
    </group>
  )
}
