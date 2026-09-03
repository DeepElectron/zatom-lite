'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Layers3, MousePointerSquareDashed, Plus, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  BIO_DEMO_STYLE_TRACKS,
  BIO_LAYER_MATERIAL_PRESETS,
  instantiateCrystalDemoTrack,
} from '../../lib/biomolecule/layer-materials'
import type { BioShadingMode } from '../../lib/biomolecule/types'
import {
  buildCrystalLayerSelectionPresetGroups,
  crystalAtomIdsToSelectionExpression,
} from '../../lib/crystal/layer-selection'
import {
  hasLayerStyleKeys,
  layerTrackIsConstant,
  recordLayerVisibility,
} from '../../lib/presentation/layer-track-authoring'
import {
  evaluateCrystalLayerSelection,
  evaluateCrystalLayerStyle,
  resolveCrystalLayerComposition,
  type CrystalLayer,
} from '../../lib/crystal/semantic-layers'
import { useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'
import { CollapsibleSection, SliderRow, Toggle } from './panel-ui'

const REPRESENTATIONS: readonly { value: CrystalLayer['representation']; label: string }[] = [
  { value: 'ball-stick', label: 'Ball & Stick' },
  { value: 'stick', label: 'Stick (Licorice)' },
  { value: 'hyper-stick', label: 'HyperStick' },
  { value: 'space-fill', label: 'Space Fill' },
  { value: 'wireframe', label: 'Wireframe' },
  { value: 'polyhedra', label: 'Coordination polyhedra' },
  { value: 'surface', label: 'Gaussian surface' },
]

type LayerShadingChoice = BioShadingMode | 'inherit'

const SHADING_CHOICES: readonly { value: LayerShadingChoice; label: string }[] = [
  { value: 'inherit', label: 'Inherit global shader' },
  { value: 'standard', label: 'VESTA Lambert' },
  { value: 'flat', label: 'Flat ink' },
  { value: 'cel', label: 'Cel shaded' },
  { value: 'gooch', label: 'Gooch' },
  { value: 'hatch', label: 'Pen hatch' },
  { value: 'iridescent', label: 'Iridescent' },
  { value: 'xray', label: 'X-ray' },
  { value: 'halftone', label: 'Halftone' },
  { value: 'thermal', label: 'Thermal' },
  { value: 'dither', label: '1-bit dither' },
  { value: 'pixel', label: '8-bit pixel' },
  { value: 'riso', label: 'Riso' },
  { value: 'velvet', label: 'Velvet' },
  { value: 'matcap', label: 'Matcap' },
]

// Reuse one empty set so LayerCard props stay referentially stable.
const EMPTY_ATOM_IDS: ReadonlySet<string> = new Set<string>()

const REPRESENTATIONS_WITHOUT_SCALE = new Set<CrystalLayer['representation']>(['stick', 'wireframe', 'polyhedra', 'surface'])
const REPRESENTATIONS_WITH_BONDS = new Set<CrystalLayer['representation']>(['ball-stick', 'stick', 'hyper-stick'])

function LayerCard({
  layer,
  index,
  count,
  effectiveCount,
  effectiveAtomIds,
  initiallyOpen = false,
}: {
  layer: CrystalLayer
  index: number
  count: number
  effectiveCount: number
/** Atoms effectively owned by this layer after exclusive/overlay resolution. */
  effectiveAtomIds: ReadonlySet<string>
  initiallyOpen?: boolean
}) {
  const selectAtoms = useCrystalStore((state) => state.selectAtoms)
  const setSelectMode = useCrystalStore((state) => state.setSelectMode)

  /** Select resolved effective IDs so edits match the layer count shown in the panel. */
  const selectLayerAtoms = () => {
    if (effectiveAtomIds.size === 0) return
    // Atom selection is visible and actionable only in atom mode.
    setSelectMode('atom')
    selectAtoms(Array.from(effectiveAtomIds))
  }

  const [open, setOpen] = useState(initiallyOpen)
  useEffect(() => {
    if (initiallyOpen) setOpen(true)
  }, [initiallyOpen])
  const atoms = useCrystalStore((state) => state.atoms)
  const supercell = useCrystalStore((state) => state.supercellParams)
  const update = useCrystalStore((state) => state.updateCrystalLayer)
  const editStyle = useCrystalStore((state) => state.editCrystalLayerStyle)
  const recordStyleAtPlayhead = useCrystalStore((state) => state.recordCrystalLayerStyle)
  const remove = useCrystalStore((state) => state.removeCrystalLayer)
  const duplicate = useCrystalStore((state) => state.duplicateCrystalLayer)
  const move = useCrystalStore((state) => state.moveCrystalLayer)
  const frame = useCrystalStore((state) => state.presentationFrame)
  const frames = useCrystalStore((state) => state.presentationFrames)
  const setFrame = useCrystalStore((state) => state.setPresentationFrame)
  const pause = useCrystalStore((state) => state.pausePresentation)
  const snapshotContext = useCrystalStore(useShallow((state) => ({
    renderStyle: state.renderStyle,
    ambient: state.ambientIntensity,
    diffuse: state.diffuseIntensity,
    specular: state.specularIntensity,
    shininess: state.atomShininess,
    rim: state.rimIntensity,
    lightAmbient: state.lightAmbient,
    lightKey: state.lightKey,
  })))
  const result = useMemo(
    () => evaluateCrystalLayerSelection(atoms, layer.selection, supercell),
    [atoms, layer.selection, supercell],
  )
  const selectedCount = result.atomIds.size
  const hasAnimatedStyle = hasLayerStyleKeys(layer.styleTrack)
  const constantTrack = layerTrackIsConstant(layer.styleTrack)
  const effectiveStyle = useMemo(
    () => evaluateCrystalLayerStyle(layer, frame, snapshotContext),
    [frame, layer, snapshotContext],
  )
  const displayedStyle = hasAnimatedStyle ? effectiveStyle : layer
  const displayedPresetId = hasAnimatedStyle
    ? layer.styleTrack?.find((keyframe) => keyframe.frame === Math.round(frame))?.presetId ?? ''
    : layer.materialPresetId ?? ''
  const inheritedAmbient = snapshotContext.lightAmbient ?? snapshotContext.ambient
  const inheritedDiffuse = snapshotContext.lightKey ?? snapshotContext.diffuse
  const makeKeyId = () => globalThis.crypto?.randomUUID?.() ?? `crystal-style-${Date.now()}-${Math.random()}`
  const updateStyle = (patch: Partial<Pick<CrystalLayer, 'representation' | 'color' | 'shading' | 'opacity' | 'scale' | 'bondScale' | 'materialPresetId'>>) => {
    pause()
    editStyle(layer.id, patch)
  }

  const applyMaterial = (presetId: string) => {
    const preset = BIO_LAYER_MATERIAL_PRESETS.find((candidate) => candidate.id === presetId)
    if (!preset) return
    updateStyle({
      materialPresetId: preset.id,
      opacity: preset.opacity,
      shading: { ...preset.shading },
    })
  }

  const recordStyle = () => {
    recordStyleAtPlayhead(layer.id)
  }

  const resetMaterialInheritance = () => {
    updateStyle({ materialPresetId: null, shading: null })
  }

  return (
    <article className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel-elevated)] p-2.5">
      <div className="flex items-center gap-2">
        <Toggle checked={effectiveStyle.visible} onChange={(visible) => update(layer.id, {
          ...(layer.styleTrack?.length
            ? { styleTrack: recordLayerVisibility(layer.styleTrack, frame, visible, makeKeyId) }
            : { visible }),
        })} />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span className="block truncate text-[12px] font-medium text-[var(--panel-text)]">{layer.name}</span>
          <span className="text-[9px] text-[var(--panel-text-tertiary)]">
            {result.error
              ? 'Invalid selection'
              : !effectiveStyle.visible
                ? `${selectedCount} matched · hidden at #${Math.round(frame)}`
              : effectiveCount === selectedCount
                ? `${selectedCount} atom${selectedCount === 1 ? '' : 's'} rendered`
                : `${effectiveCount} rendered · ${selectedCount - effectiveCount} claimed above`}
          </span>
        </button>
        <button
          type="button"
          className="zatom-pressable rounded-md p-1 text-[var(--panel-text-secondary)] disabled:opacity-40"
          onClick={selectLayerAtoms}
          disabled={effectiveCount === 0}
          aria-label={`Select the ${effectiveCount} atom${effectiveCount === 1 ? '' : 's'} in this layer`}
          title={effectiveCount === 0
            ? 'No atoms are owned by this layer at the current frame'
            : `Select this layer's ${effectiveCount} atom${effectiveCount === 1 ? '' : 's'}`}
        >
          <MousePointerSquareDashed className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="zatom-pressable rounded-md p-1 text-[var(--panel-text-secondary)]" onClick={() => move(index, index - 1)} disabled={index === 0} aria-label="Move layer up"><ChevronUp className="h-3.5 w-3.5" /></button>
        <button type="button" className="zatom-pressable rounded-md p-1 text-[var(--panel-text-secondary)]" onClick={() => move(index, index + 1)} disabled={index === count - 1} aria-label="Move layer down"><ChevronDown className="h-3.5 w-3.5" /></button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-[var(--panel-border)] pt-3">
          <label className="block text-[10px] text-[var(--panel-text-secondary)]">
            Name
            <input className="zatom-field mt-1 h-8 w-full rounded-lg px-2 text-[11px]" value={layer.name} onChange={(event) => update(layer.id, { name: event.currentTarget.value })} />
          </label>
          <label className="block text-[10px] text-[var(--panel-text-secondary)]">
            Selection expression
            <input className="zatom-field mt-1 h-8 w-full rounded-lg px-2 font-mono text-[10px]" value={layer.selection} onChange={(event) => update(layer.id, { selection: event.currentTarget.value })} spellCheck={false} />
          </label>
          <p className={`text-[9px] ${result.error ? 'text-[var(--status-red)]' : 'text-[var(--panel-text-tertiary)]'}`}>
            {result.error ?? 'DSL: elem Fe+O · site 0+2 · index 0-40 · fz > 0.5 · elem Fe expand 2.2'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-[var(--panel-text-secondary)]">
              Representation
              <select className="zatom-field mt-1 h-8 w-full rounded-lg px-2 text-[10px]" value={displayedStyle.representation} onChange={(event) => updateStyle({ representation: event.currentTarget.value as CrystalLayer['representation'] })}>
                {REPRESENTATIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-[var(--panel-text-secondary)]">
              Colour
              <select className="zatom-field mt-1 h-8 w-full rounded-lg px-2 text-[10px]" value={displayedStyle.color.mode} onChange={(event) => updateStyle({ color: event.currentTarget.value === 'custom' ? { mode: 'custom', value: '#4aa8ff' } : { mode: 'element' } })}>
                <option value="element">By element</option>
                <option value="custom">Custom</option>
              </select>
            </label>
          </div>
          {displayedStyle.color.mode === 'custom' && (
            <label className="flex items-center justify-between text-[10px] text-[var(--panel-text-secondary)]">
              Custom colour
              <input type="color" value={displayedStyle.color.value} onChange={(event) => updateStyle({ color: { mode: 'custom', value: event.currentTarget.value } })} className="h-7 w-10 rounded-md border-0 bg-transparent" />
            </label>
          )}
          <label className="block text-[10px] text-[var(--panel-text-secondary)]">
            Material
            <select className="zatom-field mt-1 h-8 w-full rounded-lg px-2 text-[10px]" value={displayedPresetId} onChange={(event) => applyMaterial(event.currentTarget.value)}>
              <option value="" disabled>Choose preset</option>
              {BIO_LAYER_MATERIAL_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
          </label>
          <label className="block text-[10px] text-[var(--panel-text-secondary)]">
            Shader override
            <select className="zatom-field mt-1 h-8 w-full rounded-lg px-2 text-[10px]" value={displayedStyle.shading?.mode ?? 'inherit'} onChange={(event) => {
              const mode = event.currentTarget.value as LayerShadingChoice
              updateStyle({
                materialPresetId: null,
                shading: mode === 'inherit'
                  ? (displayedStyle.shading && Object.keys(displayedStyle.shading).some((field) => field !== 'mode')
                    ? { ...displayedStyle.shading, mode: undefined }
                    : null)
                  : { ...displayedStyle.shading, mode },
              })
            }}>
              {SHADING_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
          </label>
          <details className="rounded-lg border border-[var(--panel-border)] px-2 py-1">
            <summary className="cursor-pointer text-[10px] text-[var(--panel-text-secondary)]">Independent lighting response</summary>
            <div className="mt-2 space-y-2">
              <p className="text-[9px] leading-4 text-[var(--panel-text-tertiary)]">Each untouched channel inherits the live global lighting controls.</p>
              <SliderRow label="Ambient" value={displayedStyle.shading?.ambient ?? inheritedAmbient} min={0} max={1.5} step={.01} onChange={(ambient) => updateStyle({ materialPresetId: null, shading: { ...displayedStyle.shading, ambient } })} display={displayedStyle.shading?.ambient === undefined ? 'global' : displayedStyle.shading.ambient.toFixed(2)} />
              <SliderRow label="Diffuse" value={displayedStyle.shading?.diffuse ?? inheritedDiffuse} min={0} max={1.5} step={.01} onChange={(diffuse) => updateStyle({ materialPresetId: null, shading: { ...displayedStyle.shading, diffuse } })} display={displayedStyle.shading?.diffuse === undefined ? 'global' : displayedStyle.shading.diffuse.toFixed(2)} />
              <SliderRow label="Specular" value={displayedStyle.shading?.specular ?? snapshotContext.specular} min={0} max={1.5} step={.01} onChange={(specular) => updateStyle({ materialPresetId: null, shading: { ...displayedStyle.shading, specular } })} display={displayedStyle.shading?.specular === undefined ? 'global' : displayedStyle.shading.specular.toFixed(2)} />
              <SliderRow label="Shininess" value={displayedStyle.shading?.shininess ?? snapshotContext.shininess} min={1} max={220} step={1} onChange={(shininess) => updateStyle({ materialPresetId: null, shading: { ...displayedStyle.shading, shininess } })} display={displayedStyle.shading?.shininess === undefined ? 'global' : String(Math.round(displayedStyle.shading.shininess))} />
              <SliderRow label="Fresnel rim" value={displayedStyle.shading?.rim ?? snapshotContext.rim} min={0} max={1.5} step={.01} onChange={(rim) => updateStyle({ materialPresetId: null, shading: { ...displayedStyle.shading, rim } })} display={displayedStyle.shading?.rim === undefined ? 'global' : displayedStyle.shading.rim.toFixed(2)} />
              <button type="button" className="zatom-pressable w-full rounded-lg border border-dashed border-[var(--panel-border)] px-2 py-1.5 text-[10px] text-[var(--panel-text-secondary)]" onClick={resetMaterialInheritance}>Reset all material channels to global</button>
            </div>
          </details>
          <SliderRow label="Opacity" value={displayedStyle.opacity} min={0} max={1} step={0.05} display={`${Math.round(displayedStyle.opacity * 100)}%`} onChange={(opacity) => updateStyle({ opacity, materialPresetId: null })} />
          {!REPRESENTATIONS_WITHOUT_SCALE.has(displayedStyle.representation) && <SliderRow label="Atom size" value={displayedStyle.scale} min={0.2} max={3} step={0.05} onChange={(scale) => updateStyle({ scale })} />}
          {REPRESENTATIONS_WITH_BONDS.has(displayedStyle.representation) && <SliderRow label="Bond size" value={displayedStyle.bondScale} min={0.2} max={3} step={0.05} onChange={(bondScale) => updateStyle({ bondScale })} />}
          <label className="flex items-center justify-between gap-3 text-[11px] text-[var(--panel-text-secondary)]">
            <span>Composition</span>
            <select
              className="zatom-field min-w-0 max-w-[185px] rounded-lg px-2 py-1.5 text-[10px]"
              value={layer.replaceBase ? 'exclusive' : 'overlay'}
              onChange={(event) => update(layer.id, { replaceBase: event.currentTarget.value === 'exclusive' })}
            >
              <option value="exclusive">Exclusive · replace below</option>
              <option value="overlay">Overlay · additive</option>
            </select>
          </label>
          <p className="text-[9px] leading-4 text-[var(--panel-text-tertiary)]">
            Layer order is top to bottom. Exclusive claims matching atoms from the base and lower layers; hiding it reveals the content below.
          </p>
          <label className="block text-[10px] text-[var(--panel-text-secondary)]">
            Demo style track
            <select className="zatom-field mt-1 h-8 w-full rounded-lg px-2 text-[10px] disabled:opacity-40" value="" disabled={effectiveCount === 0} title={effectiveCount === 0 ? 'Move this layer above the claiming layer or change its composition first' : undefined} onChange={(event) => {
              const demo = BIO_DEMO_STYLE_TRACKS.find((candidate) => candidate.id === event.currentTarget.value)
              if (!demo) return
              update(layer.id, {
                styleTrack: instantiateCrystalDemoTrack(demo, frames, () => globalThis.crypto?.randomUUID?.() ?? `crystal-demo-${Date.now()}-${Math.random()}`),
              })
            }}>
              <option value="">Choose animation…</option>
              {BIO_DEMO_STYLE_TRACKS.map((demo) => <option key={demo.id} value={demo.id}>{demo.label}</option>)}
            </select>
          </label>
          <button type="button" disabled={effectiveCount === 0} title={effectiveCount === 0 ? 'No atoms are owned by this layer at the current frame' : undefined} className="zatom-pressable w-full rounded-lg border border-[var(--panel-border)] px-2 py-1.5 text-[10px] text-[var(--panel-text)] disabled:opacity-40" onClick={recordStyle}>Record style @ {Math.round(frame)} · {layer.styleTrack?.length ?? 0} keys</button>
          {constantTrack && <p className="rounded-lg px-2 py-1.5 text-[9px] leading-4" style={{ color: 'var(--status-amber)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.24)' }}>This layer track is constant. Move to another frame, change this layer, then record again.</p>}
          <div className="grid grid-cols-2 gap-1"><button type="button" className="zatom-pressable rounded-lg border border-[var(--panel-border)] py-1 text-[9px]" onClick={() => update(layer.id, { styleTrack: recordLayerVisibility(layer.styleTrack, frame, true, makeKeyId) })}>Show from @{Math.round(frame)}</button><button type="button" className="zatom-pressable rounded-lg border border-[var(--panel-border)] py-1 text-[9px]" onClick={() => update(layer.id, { styleTrack: recordLayerVisibility(layer.styleTrack, frame, false, makeKeyId) })}>Hide from @{Math.round(frame)}</button></div>
          {(layer.styleTrack?.length ?? 0) > 0 && <div className="space-y-1 rounded-lg border border-[var(--panel-border)] p-1.5">
            {layer.styleTrack!.map((keyframe) => <div key={keyframe.id} className="flex items-center gap-2 text-[9px] text-[var(--panel-text-tertiary)]"><button type="button" className="zatom-pressable font-mono text-[var(--panel-text)]" onClick={() => { pause(); setFrame(keyframe.frame) }}>#{keyframe.frame}</button><span className="min-w-0 flex-1 truncate">{keyframe.presetId ? BIO_LAYER_MATERIAL_PRESETS.find((preset) => preset.id === keyframe.presetId)?.label ?? keyframe.presetId : keyframe.patch.visible === undefined ? 'style' : keyframe.patch.visible ? 'show' : 'hide'} · {keyframe.easing}</span><button type="button" aria-label={`Remove crystal layer key ${keyframe.frame}`} className="zatom-pressable px-1 text-[var(--status-red)]" onClick={() => update(layer.id, { styleTrack: layer.styleTrack?.filter((candidate) => candidate.id !== keyframe.id) })}>×</button></div>)}
            <button type="button" className="zatom-pressable w-full border-t border-[var(--panel-border)] pt-1 text-[9px] text-[var(--status-red)]" onClick={() => update(layer.id, { styleTrack: undefined })}>Clear layer track</button>
          </div>}
          <div className="flex justify-end gap-1">
            <button type="button" className="zatom-pressable rounded-lg p-2 text-[var(--panel-text-secondary)]" onClick={() => duplicate(layer.id)} aria-label="Duplicate layer"><Copy className="h-3.5 w-3.5" /></button>
            <button type="button" className="zatom-pressable rounded-lg p-2 text-[var(--status-red)]" onClick={() => remove(layer.id)} aria-label="Delete layer"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
    </article>
  )
}

export function CrystalLayersSettings() {
  const [createdLayerId, setCreatedLayerId] = useState<string | null>(null)
  const [creationError, setCreationError] = useState<string | null>(null)
  const layers = useCrystalStore((state) => state.crystalLayers)
  const atoms = useCrystalStore((state) => state.atoms)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  const frame = useCrystalStore((state) => state.presentationFrame)
  const supercell = useCrystalStore((state) => state.supercellParams)
  const add = useCrystalStore((state) => state.addCrystalLayer)
  const clearSelection = useCrystalStore((state) => state.clearSelection)
  const presetGroups = useMemo(() => buildCrystalLayerSelectionPresetGroups(atoms), [atoms])
  const composition = useMemo(
    () => resolveCrystalLayerComposition(atoms, layers, frame, supercell),
    [atoms, frame, layers, supercell],
  )
  const createdLayer = layers.find((layer) => layer.id === createdLayerId)
  const selectedAtomCount = useMemo(
    () => atoms.reduce((count, atom) => count + Number(selectedAtomIds.has(atom.id)), 0),
    [atoms, selectedAtomIds],
  )
  const createLayerFromSelection = () => {
    if (selectedAtomCount === 0) return
    try {
      const selection = crystalAtomIdsToSelectionExpression(atoms, selectedAtomIds)
      const evaluated = evaluateCrystalLayerSelection(atoms, selection)
      const exactMatch = !evaluated.error
        && evaluated.atomIds.size === selectedAtomIds.size
        && [...selectedAtomIds].every((id) => evaluated.atomIds.has(id))
      if (!exactMatch) throw new Error(evaluated.error ?? 'The layer selection did not round-trip exactly')
      const id = add({
        name: `Selection (${selectedAtomCount})`,
        selection,
        representation: 'ball-stick',
        // The selected atoms move from the base pass into this layer so material
        // animation never double-renders against the unchanged base geometry.
        replaceBase: true,
      })
      setCreatedLayerId(id)
      setCreationError(null)
      // The selection is now durable layer state. Remove the transient blue
      // selection treatment so it cannot mask the layer's authored material.
      clearSelection()
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : 'Could not create the layer')
    }
  }
  return (
    <CollapsibleSection title="Crystal layers" icon={Layers3} count={layers.length} defaultOpen={false}>
      <p className="text-[10px] leading-4 text-[var(--panel-text-secondary)]">Build semantic views with the source crystal selection language.</p>
      {selectedAtomCount > 0 && (
        <button
          type="button"
          className="zatom-choice zatom-pressable flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[10px] font-medium"
          onClick={createLayerFromSelection}
        >
          <Plus className="h-3.5 w-3.5" /> Create layer from 3D selection · {selectedAtomCount}
        </button>
      )}
      {creationError && <p role="alert" className="text-[9px] leading-4 text-[var(--status-red)]">{creationError}</p>}
      {createdLayer && !creationError && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-lg px-2 py-1.5 text-[9px] leading-4"
          style={{ color: 'var(--status-green)', border: '1px solid var(--status-green-border)', background: 'var(--status-green-bg)' }}
        >
          Created {createdLayer.name} · exact selection · base replaced
        </p>
      )}
      <div className="space-y-2">
        {layers.map((layer, index) => <LayerCard key={layer.id} layer={layer} index={index} count={layers.length} effectiveCount={composition.layerAtomIds.get(layer.id)?.size ?? 0} effectiveAtomIds={composition.layerAtomIds.get(layer.id) ?? EMPTY_ATOM_IDS} initiallyOpen={layer.id === createdLayerId} />)}
      </div>
      <button type="button" className="zatom-pressable flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--panel-border)] px-3 py-2 text-[11px] text-[var(--panel-text)]" onClick={() => { add({ selection: 'none' });  }}><Plus className="h-3.5 w-3.5" /> Add empty layer</button>
      {atoms.length > 0 && <div className="space-y-2 rounded-xl border border-[var(--panel-border)] p-2">
        <p className="text-[9px] text-[var(--panel-text-tertiary)]">Detected from this structure · click to create a layer</p>
        {presetGroups.map((group) => <div key={group.name} className="space-y-1">
          <p className="text-[9px] font-medium text-[var(--panel-text-secondary)]">{group.name}</p>
          <div className="flex flex-wrap gap-1">
            {group.items.map((preset) => <button
              key={`${group.name}-${preset.name}`}
              type="button"
              title={`${preset.description}\n${preset.expression}`}
              className="zatom-pressable rounded-md border border-[var(--panel-border)] px-1.5 py-1 text-[9px] text-[var(--panel-text-secondary)]"
              onClick={() => {
                add({
                  name: preset.name,
                  selection: preset.expression,
                  representation: preset.recommendedRepresentation ?? 'ball-stick',
                })
              }}
            >+ {preset.name}</button>)}
          </div>
        </div>)}
      </div>}
    </CollapsibleSection>
  )
}
