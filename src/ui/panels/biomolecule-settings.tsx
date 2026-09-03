import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Crosshair, Diamond, Eye, EyeOff, Loader2, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'
import { evaluateBioSelection } from '../../lib/biomolecule/selection'
import { bioAtomSetToSelectionExpression } from '../../lib/biomolecule/picking'
import { BIO_CARTOON_LIMITS, BIO_CARTOON_MODELS } from '../../lib/biomolecule/cartoon-geometry'
import { BIO_DEMO_STYLE_TRACKS, BIO_LAYER_MATERIAL_PRESETS, instantiateBioDemoTrack } from '../../lib/biomolecule/layer-materials'
import { buildBioSelectionPresetGroups } from '../../lib/biomolecule/selection-presets'
import { resolveBioLayerComposition } from '../../lib/biomolecule/layer-composition'
import { evaluateBioStyleTrack, evaluateBioVisibility } from '../../lib/biomolecule/style-track'
import {
  hasLayerStyleKeys,
  layerTrackIsConstant,
  recordLayerVisibility,
} from '../../lib/presentation/layer-track-authoring'
import { parseLegacyPdb } from '../../lib/biomolecule/pdb'
import { superposeBioStructures } from '../../lib/biomolecule/superposition'
import { alignRcsbPdbStructure } from '../../services/biomolecule-alignment'
import type { BioBuiltinAtomicRepresentation, BioBuiltinAtomicRepresentationOrInherit } from '../../lib/biomolecule/presentation-contract'
import type { BioColorScheme, BioLayer, BioLayerColor, BioRepresentation, BioShadingMode } from '../../lib/biomolecule/types'
import { Segmented, SliderRow, Toggle } from './panel-ui'

const REPRESENTATIONS: readonly { value: BioRepresentation; label: string }[] = [
  { value: 'cartoon', label: 'Cartoon' },
  { value: 'ball-and-stick', label: 'Ball + stick' },
  { value: 'space-filling', label: 'Space fill' },
  { value: 'sticks', label: 'Sticks' },
  { value: 'lines', label: 'Lines' },
  { value: 'surface', label: 'Surface' },
  { value: 'coordination-polyhedra', label: 'Metal polyhedra' },
]

const ATOMIC_REPRESENTATIONS: readonly { value: BioBuiltinAtomicRepresentation; label: string }[] = [
  { value: 'ball-and-stick', label: 'Ball + stick' },
  { value: 'space-filling', label: 'Space fill' },
  { value: 'sticks', label: 'Sticks' },
  { value: 'lines', label: 'Lines' },
]

const POLYMER_REPRESENTATIONS: readonly { value: BioBuiltinAtomicRepresentationOrInherit; label: string }[] = [
  { value: 'inherit', label: 'Inherit global atom style' },
  ...ATOMIC_REPRESENTATIONS,
]

const COLOR_SCHEMES: readonly { value: BioColorScheme; label: string }[] = [
  { value: 'chain', label: 'Chain' }, { value: 'chain-publication', label: 'Chain · Publication' },
  { value: 'sequence-spectrum', label: 'N → C · Spectrum' },
  { value: 'viridis', label: 'N → C · Viridis' }, { value: 'sequence-sunset', label: 'N → C · Sunset' },
  { value: 'sequence-ocean', label: 'N → C · Ocean' }, { value: 'sequence-muted', label: 'N → C · Muted' },
  { value: 'sequence-mono', label: 'N → C · Mono' }, { value: 'secondary-structure', label: 'Secondary structure' },
  { value: 'element', label: 'Element' }, { value: 'b-factor', label: 'B-factor' },
  { value: 'plddt', label: 'pLDDT' }, { value: 'hydrophobicity', label: 'Hydrophobicity' },
  { value: 'qualitative-residue-charge', label: 'Qualitative residue charge' },
  { value: 'qualitative-coulomb-potential', label: 'Qualitative Coulomb coloring' },
]

type LayerColorChoice = BioColorScheme | 'inherit' | 'custom'

const LAYER_COLOR_CHOICES: readonly { value: LayerColorChoice; label: string }[] = [
  { value: 'inherit', label: 'Inherit global' },
  ...COLOR_SCHEMES,
  { value: 'custom', label: 'Custom color' },
]

type LayerShadingChoice = BioShadingMode | 'inherit'

const LAYER_SHADING_CHOICES: readonly { value: LayerShadingChoice; label: string }[] = [
  { value: 'inherit', label: 'Inherit global' },
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

const DEFAULT_LAYER_SHADING = {
  mode: 'standard' as const,
  ambient: .55,
  diffuse: .47,
  specular: .6,
  shininess: 100,
  rim: 0,
}

function SelectRow<T extends string>({ label, value, values, onChange }: {
  label: string; value: T; values: readonly { value: T; label: string }[]; onChange: (value: T) => void
}) {
  return <label className="flex items-center justify-between gap-3 text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}>
    {label}
    <select className="zatom-field min-w-0 max-w-[175px] rounded-lg px-2 py-1.5 text-[11px]" value={value} onChange={(event) => onChange(event.currentTarget.value as T)}>
      {values.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
}

function BuiltinSubsystemControls({
  representation,
  color,
  colorChoices,
  scale,
  onRepresentation,
  onColor,
  onScale,
}: {
  representation: BioBuiltinAtomicRepresentation
  color: BioLayerColor
  colorChoices: typeof LAYER_COLOR_CHOICES
  scale: number
  onRepresentation: (value: BioBuiltinAtomicRepresentation) => void
  onColor: (value: BioLayerColor) => void
  onScale: (value: number) => void
}) {
  const colorChoice: LayerColorChoice = color.mode === 'scheme' ? color.scheme : color.mode
  return <div className="space-y-2 rounded-lg px-2 py-2" style={{ border: '1px solid var(--panel-border)' }}>
    <SelectRow label="Representation" value={representation} values={ATOMIC_REPRESENTATIONS} onChange={onRepresentation} />
    <SelectRow<LayerColorChoice> label="Color" value={colorChoice} values={colorChoices} onChange={(choice) => onColor(
      choice === 'inherit'
        ? { mode: 'inherit' }
        : choice === 'custom'
          ? { mode: 'custom', value: color.mode === 'custom' ? color.value : '#5b9dff' }
          : { mode: 'scheme', scheme: choice },
    )} />
    {color.mode === 'custom' && <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Custom color</span><input type="color" value={color.value} onChange={(event) => onColor({ mode: 'custom', value: event.currentTarget.value })} /></label>}
    <SliderRow label="Size" value={scale} min={.1} max={4} step={.05} onChange={onScale} display={`${scale.toFixed(2)}×`} />
  </div>
}

function PolymerControls({
  representation,
  color,
  colorChoices,
  scale,
  onRepresentation,
  onColor,
  onScale,
}: {
  representation: BioBuiltinAtomicRepresentationOrInherit
  color: BioLayerColor
  colorChoices: typeof LAYER_COLOR_CHOICES
  scale: number
  onRepresentation: (value: BioBuiltinAtomicRepresentationOrInherit) => void
  onColor: (value: BioLayerColor) => void
  onScale: (value: number) => void
}) {
  const colorChoice: LayerColorChoice = color.mode === 'scheme' ? color.scheme : color.mode
  return <div className="space-y-2 rounded-lg px-2 py-2" style={{ border: '1px solid var(--panel-border)' }}>
    <SelectRow label="Representation" value={representation} values={POLYMER_REPRESENTATIONS} onChange={onRepresentation} />
    <SelectRow<LayerColorChoice> label="Color" value={colorChoice} values={colorChoices} onChange={(choice) => onColor(
      choice === 'inherit'
        ? { mode: 'inherit' }
        : choice === 'custom'
          ? { mode: 'custom', value: color.mode === 'custom' ? color.value : '#5b9dff' }
          : { mode: 'scheme', scheme: choice },
    )} />
    {color.mode === 'custom' && <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Custom color</span><input type="color" value={color.value} onChange={(event) => onColor({ mode: 'custom', value: event.currentTarget.value })} /></label>}
    <SliderRow label="Size" value={scale} min={.1} max={4} step={.05} onChange={onScale} display={`${scale.toFixed(2)}×`} />
  </div>
}

function BioLayerEditor({ layer, index, effectiveAtomCount }: { layer: BioLayer; index: number; effectiveAtomCount: number }) {
  const structure = useCrystalStore((state) => state.bioStructure)!
  const colorChoices = structure.bFactorSemantics === 'plddt'
    ? LAYER_COLOR_CHOICES
    : LAYER_COLOR_CHOICES.filter((choice) => choice.value !== 'plddt')
  const layers = useCrystalStore((state) => state.bioLayers)
  const update = useCrystalStore((state) => state.updateBioLayer)
  const editStyle = useCrystalStore((state) => state.editBioLayerStyle)
  const recordStyleAtPlayhead = useCrystalStore((state) => state.recordBioLayerStyle)
  const remove = useCrystalStore((state) => state.removeBioLayer)
  const duplicate = useCrystalStore((state) => state.duplicateBioLayer)
  const move = useCrystalStore((state) => state.moveBioLayer)
  const focusOnAtoms = useCrystalStore((state) => state.focusOnAtoms)
  const frame = useCrystalStore((state) => state.presentationFrame)
  const frames = useCrystalStore((state) => state.presentationFrames)
  const setFrame = useCrystalStore((state) => state.setPresentationFrame)
  const pause = useCrystalStore((state) => state.pausePresentation)
  const snapshotContext = useCrystalStore(useShallow((state) => ({
    bioColorScheme: state.bioColorScheme,
    renderStyle: state.renderStyle,
    ambient: state.ambientIntensity,
    diffuse: state.diffuseIntensity,
    specular: state.specularIntensity,
    shininess: state.atomShininess,
    rim: state.rimIntensity,
    lightAmbient: state.lightAmbient,
    lightKey: state.lightKey,
  })))
  const evaluation = useMemo(() => evaluateBioSelection(structure, layer.selection), [layer.selection, structure])
  const evaluatedStyle = evaluateBioStyleTrack(layer.styleTrack, frame, {
    representation: layer.representation,
    color: layer.color,
    opacity: layer.opacity,
    scale: layer.scale,
    bondScale: layer.bondScale,
    shading: layer.shading,
  }, {
    ambient: snapshotContext.lightAmbient ?? snapshotContext.ambient,
    diffuse: snapshotContext.lightKey ?? snapshotContext.diffuse,
    specular: snapshotContext.specular,
    shininess: snapshotContext.shininess,
    rim: snapshotContext.rim,
  })
  const effectiveStyle = evaluatedStyle ? {
    representation: evaluatedStyle.representation ?? layer.representation,
    color: evaluatedStyle.color ?? layer.color,
    opacity: evaluatedStyle.opacity,
    scale: evaluatedStyle.scale,
    bondScale: evaluatedStyle.bondScale,
    shading: {
      mode: evaluatedStyle.mode,
      ambient: evaluatedStyle.ambient,
      diffuse: evaluatedStyle.diffuse,
      specular: evaluatedStyle.specular,
      shininess: evaluatedStyle.shininess,
      rim: evaluatedStyle.rim,
    },
  } : {
    representation: layer.representation,
    color: layer.color,
    opacity: layer.opacity,
    scale: layer.scale,
    bondScale: layer.bondScale,
    shading: layer.shading,
  }
  const makeKeyId = () => `layer-key-${crypto.randomUUID()}`
  const updateStyle = (patch: Partial<Pick<BioLayer, 'representation' | 'color' | 'shading' | 'opacity' | 'scale' | 'bondScale' | 'materialPresetId'>>) => {
    editStyle(layer.id, patch)
  }
  const setVisibilityKey = (visible: boolean) => update(layer.id, {
    styleTrack: recordLayerVisibility(layer.styleTrack, frame, visible, makeKeyId),
  })
  const effectiveVisible = evaluateBioVisibility(layer.styleTrack, frame, layer.visible)
  const constantTrack = layerTrackIsConstant(layer.styleTrack)
  const displayedPresetId = hasLayerStyleKeys(layer.styleTrack)
    ? layer.styleTrack?.find((keyframe) => keyframe.frame === Math.round(frame))?.presetId ?? ''
    : layer.materialPresetId ?? ''
  return <article className="rounded-xl p-3" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
    <div className="flex items-center gap-1.5">
      <button type="button" aria-label={effectiveVisible ? 'Hide layer' : 'Show layer'} className="zatom-pressable h-7 w-7 rounded-lg" onClick={() => layer.styleTrack?.length ? setVisibilityKey(!effectiveVisible) : update(layer.id, { visible: !effectiveVisible })}>{effectiveVisible ? <Eye className="mx-auto h-3.5 w-3.5" /> : <EyeOff className="mx-auto h-3.5 w-3.5" />}</button>
      <input className="zatom-field min-w-0 flex-1 rounded-lg px-2 py-1 text-[11px]" value={layer.name} onChange={(event) => update(layer.id, { name: event.currentTarget.value })} />
      {/* Focus the resolved layer by mapping its atom indices to stable IDs. */}
      <button
        type="button"
        className="zatom-pressable h-7 w-7 rounded-lg"
        aria-label={`Focus camera on ${layer.name}`}
        title="Focus camera on this layer"
        disabled={evaluation.atomIndices.size === 0}
        onClick={() => focusOnAtoms([...evaluation.atomIndices].flatMap((index) => {
          const id = structure.atoms[index]?.id
          return id ? [id] : []
        }))}
      ><Crosshair className="mx-auto h-3.5 w-3.5" /></button>
      <button type="button" className="zatom-pressable h-7 w-7 rounded-lg" aria-label="Move layer up" disabled={index === 0} onClick={() => move(index, index - 1)}><ChevronUp className="mx-auto h-3 w-3" /></button>
      <button type="button" className="zatom-pressable h-7 w-7 rounded-lg" aria-label="Move layer down" disabled={index === layers.length - 1} onClick={() => move(index, index + 1)}><ChevronDown className="mx-auto h-3 w-3" /></button>
    </div>
    <textarea className="zatom-field mt-2 min-h-14 w-full resize-y rounded-lg px-2 py-1.5 font-mono text-[10px]" value={layer.selection} onChange={(event) => update(layer.id, { selection: event.currentTarget.value })} aria-label={`${layer.name} selection expression`} />
    <p className="mb-2 text-[9px]" style={{ color: evaluation.error ? 'var(--status-red)' : 'var(--panel-text-tertiary)' }}>{evaluation.error ?? (!effectiveVisible
      ? `${evaluation.atomIndices.size.toLocaleString()} matched · hidden at #${Math.round(frame)}`
      : effectiveAtomCount === evaluation.atomIndices.size
        ? `${effectiveAtomCount.toLocaleString()} atoms rendered`
        : `${effectiveAtomCount.toLocaleString()} rendered · ${(evaluation.atomIndices.size - effectiveAtomCount).toLocaleString()} claimed above`)}</p>
    <div className="space-y-2">
      <SelectRow label="Representation" value={effectiveStyle.representation} values={REPRESENTATIONS} onChange={(representation) => updateStyle({ representation })} />
      <SelectRow<LayerColorChoice> label="Color" value={effectiveStyle.color.mode === 'scheme' ? effectiveStyle.color.scheme : effectiveStyle.color.mode} values={colorChoices} onChange={(choice) => updateStyle({ color: choice === 'inherit' ? { mode: 'inherit' } : choice === 'custom' ? { mode: 'custom', value: effectiveStyle.color.mode === 'custom' ? effectiveStyle.color.value : '#5b9dff' } : { mode: 'scheme', scheme: choice } })} />
      {effectiveStyle.color.mode === 'custom' && <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Custom color</span><input type="color" value={effectiveStyle.color.value} onChange={(event) => updateStyle({ color: { mode: 'custom', value: event.currentTarget.value } })} /></label>}
      <SliderRow label="Opacity" value={effectiveStyle.opacity} min={0} max={1} step={.01} onChange={(opacity) => updateStyle({ opacity, materialPresetId: null })} display={`${Math.round(effectiveStyle.opacity * 100)}%`} />
      <SliderRow label="Size" value={effectiveStyle.scale} min={.1} max={4} step={.05} onChange={(scale) => updateStyle({ scale })} display={`${effectiveStyle.scale.toFixed(2)}×`} />
      <SliderRow label="Bond size" value={effectiveStyle.bondScale} min={.1} max={4} step={.05} onChange={(bondScale) => updateStyle({ bondScale })} display={`${effectiveStyle.bondScale.toFixed(2)}×`} />
      <label className="flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}>
        Layer material
        <select className="zatom-field rounded-lg px-2 py-1.5 text-[10px]" value={displayedPresetId} onChange={(event) => {
          const preset = BIO_LAYER_MATERIAL_PRESETS.find((candidate) => candidate.id === event.currentTarget.value)
          if (preset) updateStyle({ materialPresetId: preset.id, shading: { ...preset.shading }, opacity: preset.opacity })
          else updateStyle({ materialPresetId: null, shading: null })
        }}><option value="">Inherit / choose…</option>{BIO_LAYER_MATERIAL_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select>
      </label>
      <SelectRow<LayerShadingChoice>
        label="Shader override"
        value={effectiveStyle.shading?.mode ?? 'inherit'}
        values={LAYER_SHADING_CHOICES}
        onChange={(mode) => updateStyle({
          materialPresetId: null,
          shading: mode === 'inherit'
            ? null
            : { ...DEFAULT_LAYER_SHADING, ...effectiveStyle.shading, mode },
        })}
      />
      {effectiveStyle.shading && <details className="rounded-lg px-2 py-1" style={{ border: '1px solid var(--panel-border)' }}>
        <summary className="cursor-pointer text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>Shader lighting</summary>
        <div className="mt-2 space-y-2">
          <SliderRow label="Ambient" value={effectiveStyle.shading.ambient ?? DEFAULT_LAYER_SHADING.ambient} min={0} max={1.5} step={.01} onChange={(ambient) => updateStyle({ materialPresetId: null, shading: { ...effectiveStyle.shading!, ambient } })} display={(effectiveStyle.shading.ambient ?? DEFAULT_LAYER_SHADING.ambient).toFixed(2)} />
          <SliderRow label="Diffuse" value={effectiveStyle.shading.diffuse ?? DEFAULT_LAYER_SHADING.diffuse} min={0} max={1.5} step={.01} onChange={(diffuse) => updateStyle({ materialPresetId: null, shading: { ...effectiveStyle.shading!, diffuse } })} display={(effectiveStyle.shading.diffuse ?? DEFAULT_LAYER_SHADING.diffuse).toFixed(2)} />
          {effectiveStyle.shading.mode === 'standard' && <>
            <SliderRow label="Specular" value={effectiveStyle.shading.specular ?? DEFAULT_LAYER_SHADING.specular} min={0} max={1.5} step={.01} onChange={(specular) => updateStyle({ materialPresetId: null, shading: { ...effectiveStyle.shading!, specular } })} display={(effectiveStyle.shading.specular ?? DEFAULT_LAYER_SHADING.specular).toFixed(2)} />
            <SliderRow label="Shininess" value={effectiveStyle.shading.shininess ?? DEFAULT_LAYER_SHADING.shininess} min={1} max={220} step={1} onChange={(shininess) => updateStyle({ materialPresetId: null, shading: { ...effectiveStyle.shading!, shininess } })} display={String(Math.round(effectiveStyle.shading.shininess ?? DEFAULT_LAYER_SHADING.shininess))} />
          </>}
          {effectiveStyle.shading.mode !== 'xray' && <SliderRow label="Fresnel rim" value={effectiveStyle.shading.rim ?? DEFAULT_LAYER_SHADING.rim} min={0} max={1.5} step={.01} onChange={(rim) => updateStyle({ materialPresetId: null, shading: { ...effectiveStyle.shading!, rim } })} display={(effectiveStyle.shading.rim ?? DEFAULT_LAYER_SHADING.rim).toFixed(2)} />}
        </div>
      </details>}
      <label className="flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}>
        Demo track
        <select className="zatom-field rounded-lg px-2 py-1.5 text-[10px] disabled:opacity-40" value="" disabled={effectiveAtomCount === 0} onChange={(event) => {
          const demo = BIO_DEMO_STYLE_TRACKS.find((candidate) => candidate.id === event.currentTarget.value)
          if (demo) update(layer.id, { styleTrack: instantiateBioDemoTrack(demo, frames, () => `layer-key-${crypto.randomUUID()}`) })
        }}><option value="">Choose animation…</option>{BIO_DEMO_STYLE_TRACKS.map((demo) => <option key={demo.id} value={demo.id}>{demo.label}</option>)}</select>
      </label>
      <button type="button" disabled={effectiveAtomCount === 0} className="zatom-choice zatom-pressable flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] disabled:opacity-40" onClick={() => {
        recordStyleAtPlayhead(layer.id)
      }}><Diamond className="h-3 w-3" /> Record layer style @ {frame}</button>
      {constantTrack && <p className="rounded-lg px-2 py-1.5 text-[9px] leading-4" style={{ color: 'var(--status-amber)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.24)' }}>This layer track is constant. Move to another frame, change this layer, then record again.</p>}
      <div className="grid grid-cols-2 gap-1"><button type="button" className="zatom-pressable rounded-lg border border-[var(--panel-border)] py-1 text-[9px]" onClick={() => setVisibilityKey(true)}>Show from @{frame}</button><button type="button" className="zatom-pressable rounded-lg border border-[var(--panel-border)] py-1 text-[9px]" onClick={() => setVisibilityKey(false)}>Hide from @{frame}</button></div>
      {(layer.styleTrack?.length ?? 0) > 0 && <div className="space-y-1 rounded-lg border border-[var(--panel-border)] p-1.5">
        {layer.styleTrack!.map((keyframe) => <div key={keyframe.id} className="flex items-center gap-2 text-[9px] text-[var(--panel-text-tertiary)]"><button type="button" className="zatom-pressable font-mono text-[var(--panel-text)]" onClick={() => { pause(); setFrame(keyframe.frame) }}>#{keyframe.frame}</button><span className="min-w-0 flex-1 truncate">{keyframe.presetId ? BIO_LAYER_MATERIAL_PRESETS.find((preset) => preset.id === keyframe.presetId)?.label ?? keyframe.presetId : keyframe.patch.visible === undefined ? 'style' : keyframe.patch.visible ? 'show' : 'hide'} · {keyframe.easing}</span><button type="button" aria-label={`Remove layer key ${keyframe.frame}`} className="zatom-pressable px-1 text-[var(--status-red)]" onClick={() => update(layer.id, { styleTrack: layer.styleTrack?.filter((candidate) => candidate.id !== keyframe.id) })}>×</button></div>)}
        <button type="button" className="zatom-pressable w-full border-t border-[var(--panel-border)] pt-1 text-[9px] text-[var(--status-red)]" onClick={() => update(layer.id, { styleTrack: undefined })}>Clear layer track</button>
      </div>}
    </div>
    <div className="mt-2 flex justify-end gap-1"><button type="button" className="zatom-pressable h-7 w-7 rounded-lg" aria-label="Duplicate layer" onClick={() => duplicate(layer.id)}><Copy className="mx-auto h-3.5 w-3.5" /></button><button type="button" className="zatom-pressable h-7 w-7 rounded-lg" aria-label="Delete layer" onClick={() => remove(layer.id)} style={{ color: 'var(--status-red)' }}><Trash2 className="mx-auto h-3.5 w-3.5" /></button></div>
  </article>
}

export function BiomoleculeLayersSettings() {
  const structure = useCrystalStore((state) => state.bioStructure)
  const layers = useCrystalStore((state) => state.bioLayers)
  const add = useCrystalStore((state) => state.addBioLayer)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  const frame = useCrystalStore((state) => state.presentationFrame)
  const clearSelection = useCrystalStore((state) => state.clearSelection)
  const presets = useMemo(() => structure ? buildBioSelectionPresetGroups(structure) : [], [structure])
  const composition = useMemo(
    () => structure ? resolveBioLayerComposition(structure, layers, frame) : null,
    [frame, layers, structure],
  )

  if (!structure) return null

  return (
    <section className="space-y-2 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="bio-layers-heading">
      <div className="flex items-center justify-between"><div id="bio-layers-heading" className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Semantic layers</div><button type="button" className="zatom-choice zatom-pressable flex h-7 items-center gap-1 rounded-lg px-2 text-[10px]" onClick={() => add({ selection: 'none' })}><Plus className="h-3 w-3" /> Empty layer</button></div>
      <p className="text-[9px] leading-4" style={{ color: 'var(--panel-text-tertiary)' }}>Expressions: protein · chain A · resi 10-30 · byres (ligand around 5) · within 4 of ion. Layers are assigned top to bottom; the first matching layer owns an atom. Hiding releases it to the layer or base below; use opacity 0 for a true fade-out.</p>
      {selectedAtomIds.size > 0 && <button type="button" className="zatom-choice zatom-pressable flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10px]" onClick={() => {
        const indices = new Set<number>()
        const byId = new Map(structure.atoms.map((atom) => [atom.id, atom.index]))
        for (const id of selectedAtomIds) { const index = byId.get(id); if (index != null) indices.add(index) }
        if (indices.size === selectedAtomIds.size && indices.size > 0) {
          add({ name: `Selection (${indices.size})`, selection: bioAtomSetToSelectionExpression(structure, indices), representation: 'ball-and-stick' })
          clearSelection()
        }
      }}><Plus className="h-3 w-3" /> Create layer from 3D selection</button>}
      <div className="space-y-1.5">{presets.map((group) => <details key={group.group} className="rounded-lg px-2 py-1.5" style={{ border: '1px solid var(--panel-border)' }}><summary className="cursor-pointer text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>{group.group} · {group.items.length}</summary><div className="mt-1.5 grid grid-cols-2 gap-1">{group.items.map((preset) => <button type="button" key={`${group.group}-${preset.name}`} className="zatom-choice zatom-pressable min-w-0 rounded-lg px-2 py-1.5 text-left" title={`${preset.description}\n${preset.expression}`} onClick={() => add({ name: preset.name, selection: preset.expression, representation: preset.representation ?? 'ball-and-stick' })}><span className="block truncate text-[9px]">{preset.name}</span><span className="block truncate text-[8px] tabular-nums" style={{ color: 'var(--panel-text-tertiary)' }}>{preset.atomCount.toLocaleString()} atoms · {preset.representation ?? 'ball-and-stick'}</span></button>)}</div></details>)}</div>
      <div className="space-y-2">{layers.map((layer, index) => <BioLayerEditor key={layer.id} layer={layer} index={index} effectiveAtomCount={composition?.layerAtomIndices.get(layer.id)?.size ?? 0} />)}</div>
    </section>
  )
}

export function BiomoleculeSettings() {
  const structure = useCrystalStore((state) => state.bioStructure)
  const settings = useCrystalStore(useShallow((state) => ({
    bioShowCartoon: state.bioShowCartoon,
    bioShowSticks: state.bioShowSticks,
    bioShowSpacefill: state.bioShowSpacefill,
    bioShowSurface: state.bioShowSurface,
    bioColorScheme: state.bioColorScheme,
    bioCartoonModel: state.bioCartoonModel,
    bioCartoonQuality: state.bioCartoonQuality,
    bioCartoonSmooth: state.bioCartoonSmooth,
    bioRibbonWidth: state.bioRibbonWidth,
    bioRibbonThickness: state.bioRibbonThickness,
    bioSurfaceSpacing: state.bioSurfaceSpacing,
    bioSurfaceOpacity: state.bioSurfaceOpacity,
    bioPolymerRepresentation: state.bioPolymerRepresentation,
    bioPolymerColor: state.bioPolymerColor,
    bioPolymerScale: state.bioPolymerScale,
    bioShowLigand: state.bioShowLigand,
    bioLigandRepresentation: state.bioLigandRepresentation,
    bioLigandColor: state.bioLigandColor,
    bioLigandScale: state.bioLigandScale,
    bioShowIons: state.bioShowIons,
    bioIonRepresentation: state.bioIonRepresentation,
    bioIonColor: state.bioIonColor,
    bioIonScale: state.bioIonScale,
    bioShowPocket: state.bioShowPocket,
    bioPocketRadius: state.bioPocketRadius,
    bioPocketRepresentation: state.bioPocketRepresentation,
    bioPocketColor: state.bioPocketColor,
    bioPocketScale: state.bioPocketScale,
    bioHideWater: state.bioHideWater,
    bioShowSSBonds: state.bioShowSSBonds,
    bioShowInteractions: state.bioShowInteractions,
    bioInteractionHBond: state.bioInteractionHBond,
    bioInteractionSaltBridge: state.bioInteractionSaltBridge,
    bioInteractionPiStacking: state.bioInteractionPiStacking,
    bioInteractionHydrophobic: state.bioInteractionHydrophobic,
    bioInteractionScope: state.bioInteractionScope,
    bioInteractionLabels: state.bioInteractionLabels,
    bioShowChainLabels: state.bioShowChainLabels,
    bioShowTerminiLabels: state.bioShowTerminiLabels,
    bioShowLigandLabels: state.bioShowLigandLabels,
    bioShowSelectedAtomDetails: state.bioShowSelectedAtomDetails,
    bioResidueLabelInterval: state.bioResidueLabelInterval,
    bioLabelSize: state.bioLabelSize,
    bioLabelColor: state.bioLabelColor,
  })))
  const update = useCrystalStore((state) => state.updateBioSettings)
  const setLightAmbientOcclusion = useCrystalStore((state) => state.setLightAmbientOcclusion)
  const alignmentGhost = useCrystalStore((state) => state.bioAlignmentGhost)
  const setAlignmentGhost = useCrystalStore((state) => state.setBioAlignmentGhost)
  const alignmentInputRef = useRef<HTMLInputElement>(null)
  const alignmentRequestRef = useRef(0)
  const alignmentReferenceRef = useRef(structure)
  alignmentReferenceRef.current = structure
  const [alignmentPdbId, setAlignmentPdbId] = useState('')
  const [alignmentLoading, setAlignmentLoading] = useState(false)
  const [alignmentError, setAlignmentError] = useState<string | null>(null)
  useEffect(() => {
    ++alignmentRequestRef.current
    setAlignmentLoading(false)
    setAlignmentError(null)
    return () => { ++alignmentRequestRef.current }
  }, [structure])
  if (!structure) return null
  const availableColors = COLOR_SCHEMES.filter((scheme) => scheme.value !== 'plddt' || structure.bFactorSemantics === 'plddt')
  const availableLayerColors = LAYER_COLOR_CHOICES.filter((choice) => choice.value !== 'plddt' || structure.bFactorSemantics === 'plddt')

  return <div className="space-y-4">
    <section className="space-y-2" aria-labelledby="bio-structure-heading">
      <div id="bio-structure-heading" className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Biomolecule</div>
      <p className="text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>{structure.title} · {structure.atoms.length.toLocaleString()} atoms · {structure.residues.length.toLocaleString()} residues · {structure.chains.length} chains</p>
      {structure.warnings.length > 0 && <details className="text-[9px]" style={{ color: 'var(--status-amber)' }}><summary>{structure.warnings.length} parse warning(s)</summary><ul className="mt-1 list-disc pl-4">{structure.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    </section>

    <section className="space-y-2 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="bio-alignment-heading">
      <div id="bio-alignment-heading" className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Structure alignment</div>
      <p className="text-[9px] leading-4" style={{ color: 'var(--panel-text-tertiary)' }}>
        Align a second PDB by exact chain, residue number and insertion code. This is rigid superposition, not sequence alignment.
      </p>
      <form className="flex gap-1.5" onSubmit={async (event) => {
        event.preventDefault()
        const request = ++alignmentRequestRef.current
        setAlignmentLoading(true)
        setAlignmentError(null)
        const result = await alignRcsbPdbStructure(structure, alignmentPdbId)
        if (request !== alignmentRequestRef.current || alignmentReferenceRef.current !== structure) return
        setAlignmentLoading(false)
        if (!result.success) {
          setAlignmentError(result.error)
          return
        }
        setAlignmentPdbId(result.sourceLabel.slice(0, 4))
        setAlignmentGhost({
          structure: result.structure,
          pairCount: result.pairCount,
          rmsd: result.rmsd,
          method: result.method,
          sourceLabel: result.sourceLabel,
          opacity: .45,
          color: '#e879a0',
        })
      }}>
        <label className="sr-only" htmlFor="alignment-rcsb-pdb-id">Second-structure RCSB PDB ID</label>
        <input
          id="alignment-rcsb-pdb-id"
          aria-invalid={Boolean(alignmentError)}
          autoCapitalize="characters"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg px-2 py-1.5 font-mono text-[10px] uppercase"
          disabled={alignmentLoading}
          maxLength={4}
          onChange={(event) => setAlignmentPdbId(event.currentTarget.value.toUpperCase())}
          placeholder="PDB ID · 1D3Z"
          spellCheck={false}
          value={alignmentPdbId}
        />
        <button type="submit" disabled={alignmentLoading} className="zatom-choice zatom-pressable flex min-w-16 items-center justify-center rounded-lg px-2 text-[10px] font-medium disabled:opacity-50">
          {alignmentLoading ? <Loader2 aria-label="Loading alignment PDB" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : 'Align ID'}
        </button>
      </form>
      <input ref={alignmentInputRef} className="hidden" type="file" accept=".pdb,.ent,chemical/x-pdb,text/plain" onChange={async (event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (!file) return
        const request = ++alignmentRequestRef.current
        setAlignmentLoading(true)
        setAlignmentError(null)
        try {
          if (file.size > 50 * 1024 * 1024) throw new Error('Alignment PDB exceeds the 50 MB limit.')
          const moving = parseLegacyPdb(await file.text(), { id: file.name, title: file.name })
          const result = superposeBioStructures(structure, moving)
          if (request !== alignmentRequestRef.current || alignmentReferenceRef.current !== structure) return
          setAlignmentLoading(false)
          setAlignmentGhost({ structure: result.transformedStructure, pairCount: result.pairCount, rmsd: result.rmsd, method: 'exact-residue-identity', sourceLabel: file.name, opacity: .45, color: '#e879a0' })
        } catch (error) {
          if (request !== alignmentRequestRef.current || alignmentReferenceRef.current !== structure) return
          setAlignmentLoading(false)
          setAlignmentError(error instanceof Error ? error.message : 'Alignment failed.')
        }
      }} />
      <button type="button" disabled={alignmentLoading} className="zatom-choice zatom-pressable flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[10px] font-medium disabled:opacity-50" onClick={() => alignmentInputRef.current?.click()}>{alignmentLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Upload className="h-3.5 w-3.5" />} {alignmentLoading ? 'Aligning…' : 'Align local PDB…'}</button>
      {alignmentError && <p role="alert" className="rounded-lg px-2 py-1.5 text-[10px]" style={{ color: 'var(--status-red)', background: 'var(--status-red-bg)', border: '1px solid var(--status-red-border)' }}>{alignmentError}</p>}
      {alignmentGhost && <div className="space-y-2 rounded-xl p-2.5" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}><div className="flex items-center justify-between gap-2 text-[10px]"><span className="min-w-0 truncate" title={alignmentGhost.sourceLabel}>{alignmentGhost.sourceLabel}</span><button type="button" className="zatom-pressable shrink-0" style={{ color: 'var(--status-red)' }} onClick={() => { ++alignmentRequestRef.current; setAlignmentLoading(false); setAlignmentGhost(null) }}>Remove</button></div><p aria-live="polite" className="text-[9px] tabular-nums" style={{ color: 'var(--panel-text-tertiary)' }}>{alignmentGhost.pairCount} exact residue representatives · RMSD {alignmentGhost.rmsd.toFixed(3)} Å</p><SliderRow label="Ghost opacity" value={alignmentGhost.opacity} min={.05} max={.9} step={.01} display={`${Math.round(alignmentGhost.opacity * 100)}%`} onChange={(opacity) => setAlignmentGhost({ ...alignmentGhost, opacity })} /><label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Ghost color</span><input type="color" aria-label="Ghost color" value={alignmentGhost.color} onChange={(event) => setAlignmentGhost({ ...alignmentGhost, color: event.currentTarget.value })} /></label></div>}
    </section>

    <section className="space-y-2 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="bio-base-heading">
      <div id="bio-base-heading" className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Representations · stackable</div>
      {/* Apply the coordinated publication-surface preset in one action. */}
      <button
        type="button"
        className="zatom-choice zatom-pressable flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[10px] font-medium"
        onClick={() => {
          update({
            bioShowSurface: true,
            // Disable cartoon so ribbons do not intersect the surface.
            bioShowCartoon: false,
            bioShowSticks: false,
            bioShowSpacefill: false,
            bioColorScheme: 'chain-publication',
            // Avoid full opacity because it hides internal ligands.
            // Slight transparency preserves a solid surface while revealing ligand outlines.
            // This matches common publication-style molecular surfaces.
            bioSurfaceOpacity: .92,
            // A 0.6 Å grid preserves grooves for ambient-occlusion contact shadows.
            bioSurfaceSpacing: .6,
          })
          setLightAmbientOcclusion(1)
        }}
      >
        <Sparkles className="h-3.5 w-3.5" /> Publication figure
      </button>
      <SelectRow label="Color" value={settings.bioColorScheme} values={availableColors} onChange={(bioColorScheme) => update({ bioColorScheme })} />
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Cartoon</span><Toggle checked={settings.bioShowCartoon} onChange={(bioShowCartoon) => update({ bioShowCartoon })} /></label>
      {settings.bioShowCartoon && <><SelectRow label="Cartoon model" value={settings.bioCartoonModel} values={BIO_CARTOON_MODELS} onChange={(bioCartoonModel) => update({ bioCartoonModel })} /><SliderRow label="Quality" value={settings.bioCartoonQuality} min={BIO_CARTOON_LIMITS.quality.min} max={BIO_CARTOON_LIMITS.quality.max} step={1} onChange={(bioCartoonQuality) => update({ bioCartoonQuality })} display={String(settings.bioCartoonQuality)} /><SliderRow label="Smoothing" value={settings.bioCartoonSmooth} min={BIO_CARTOON_LIMITS.smooth.min} max={BIO_CARTOON_LIMITS.smooth.max} step={.05} onChange={(bioCartoonSmooth) => update({ bioCartoonSmooth })} display={`${Math.round(settings.bioCartoonSmooth * 100)}%`} /><SliderRow label="Ribbon width" value={settings.bioRibbonWidth} min={BIO_CARTOON_LIMITS.width.min} max={BIO_CARTOON_LIMITS.width.max} step={.05} onChange={(bioRibbonWidth) => update({ bioRibbonWidth })} display={`${settings.bioRibbonWidth.toFixed(2)}×`} /><SliderRow label="Ribbon thickness" value={settings.bioRibbonThickness} min={BIO_CARTOON_LIMITS.thickness.min} max={BIO_CARTOON_LIMITS.thickness.max} step={.05} onChange={(bioRibbonThickness) => update({ bioRibbonThickness })} display={`${settings.bioRibbonThickness.toFixed(2)}×`} /></>}
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Polymer atoms / bonds</span><Toggle checked={settings.bioShowSticks} onChange={(bioShowSticks) => update({ bioShowSticks })} /></label>
      {settings.bioShowSticks && <PolymerControls representation={settings.bioPolymerRepresentation} color={settings.bioPolymerColor} colorChoices={availableLayerColors} scale={settings.bioPolymerScale} onRepresentation={(bioPolymerRepresentation) => update({ bioPolymerRepresentation })} onColor={(bioPolymerColor) => update({ bioPolymerColor })} onScale={(bioPolymerScale) => update({ bioPolymerScale })} />}
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Space fill · vdW</span><Toggle checked={settings.bioShowSpacefill} onChange={(bioShowSpacefill) => update({ bioShowSpacefill })} /></label>
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Molecular surface</span><Toggle checked={settings.bioShowSurface} onChange={(bioShowSurface) => update({ bioShowSurface })} /></label>
      {settings.bioShowSurface && <><SliderRow label="Grid spacing" value={settings.bioSurfaceSpacing} min={.45} max={2.5} step={.05} onChange={(bioSurfaceSpacing) => update({ bioSurfaceSpacing })} display={`${settings.bioSurfaceSpacing.toFixed(2)} Å`} /><SliderRow label="Surface opacity" value={settings.bioSurfaceOpacity} min={.1} max={1} step={.01} onChange={(bioSurfaceOpacity) => update({ bioSurfaceOpacity })} display={`${Math.round(settings.bioSurfaceOpacity * 100)}%`} /></>}
    </section>

    <section className="space-y-2 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="bio-subsystems-heading">
      <div id="bio-subsystems-heading" className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Built-in subsystems</div>
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Ligands</span><Toggle checked={settings.bioShowLigand} onChange={(bioShowLigand) => update({ bioShowLigand })} /></label>
      {settings.bioShowLigand && <BuiltinSubsystemControls representation={settings.bioLigandRepresentation} color={settings.bioLigandColor} colorChoices={availableLayerColors} scale={settings.bioLigandScale} onRepresentation={(bioLigandRepresentation) => update({ bioLigandRepresentation })} onColor={(bioLigandColor) => update({ bioLigandColor })} onScale={(bioLigandScale) => update({ bioLigandScale })} />}
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Ions / metal centers</span><Toggle checked={settings.bioShowIons} onChange={(bioShowIons) => update({ bioShowIons })} /></label>
      {settings.bioShowIons && <BuiltinSubsystemControls representation={settings.bioIonRepresentation} color={settings.bioIonColor} colorChoices={availableLayerColors} scale={settings.bioIonScale} onRepresentation={(bioIonRepresentation) => update({ bioIonRepresentation })} onColor={(bioIonColor) => update({ bioIonColor })} onScale={(bioIonScale) => update({ bioIonScale })} />}
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Binding pocket</span><Toggle checked={settings.bioShowPocket} onChange={(bioShowPocket) => update({ bioShowPocket })} /></label>
      {settings.bioShowPocket && <><BuiltinSubsystemControls representation={settings.bioPocketRepresentation} color={settings.bioPocketColor} colorChoices={availableLayerColors} scale={settings.bioPocketScale} onRepresentation={(bioPocketRepresentation) => update({ bioPocketRepresentation })} onColor={(bioPocketColor) => update({ bioPocketColor })} onScale={(bioPocketScale) => update({ bioPocketScale })} /><SliderRow label="Pocket radius" value={settings.bioPocketRadius} min={3} max={10} step={.5} onChange={(bioPocketRadius) => update({ bioPocketRadius })} display={`${settings.bioPocketRadius.toFixed(1)} Å`} /></>}
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Hide water</span><Toggle checked={settings.bioHideWater} onChange={(bioHideWater) => update({ bioHideWater })} /></label>
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Disulfide bonds</span><Toggle checked={settings.bioShowSSBonds} onChange={(bioShowSSBonds) => update({ bioShowSSBonds })} /></label>
    </section>

    <section className="space-y-2 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="bio-interactions-heading">
      <div id="bio-interactions-heading" className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Candidate contacts</div>
      <p className="text-[9px] leading-4" style={{ color: 'var(--panel-text-tertiary)' }}>Geometry candidates, not authoritative biochemical interactions. H-bonds use heavy-atom distance/type because legacy PDB files often omit hydrogen.</p>
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Show candidates</span><Toggle checked={settings.bioShowInteractions} onChange={(bioShowInteractions) => update({ bioShowInteractions })} /></label>
      {settings.bioShowInteractions && <><Segmented options={['Ligand', 'Interchain', 'Both']} value={settings.bioInteractionScope === 'ligand-protein' ? 'Ligand' : settings.bioInteractionScope === 'interchain' ? 'Interchain' : 'Both'} onChange={(value) => update({ bioInteractionScope: value === 'Ligand' ? 'ligand-protein' : value === 'Interchain' ? 'interchain' : 'both' })} />{[['H-bond', 'bioInteractionHBond'], ['Salt bridge', 'bioInteractionSaltBridge'], ['π stacking', 'bioInteractionPiStacking'], ['Hydrophobic', 'bioInteractionHydrophobic'], ['Distance labels', 'bioInteractionLabels']].map(([label, key]) => <label key={key} className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>{label}</span><Toggle checked={Boolean(settings[key as keyof typeof settings])} onChange={(value) => update({ [key]: value })} /></label>)}</>}
    </section>

    <section className="space-y-2 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="bio-labels-heading">
      <div id="bio-labels-heading" className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Labels</div>
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Selected atom details</span><Toggle checked={settings.bioShowSelectedAtomDetails} onChange={(bioShowSelectedAtomDetails) => update({ bioShowSelectedAtomDetails })} /></label>
      {[['Chain names', 'bioShowChainLabels'], ['N/C termini', 'bioShowTerminiLabels'], ['Ligands', 'bioShowLigandLabels']].map(([label, key]) => <label key={key} className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>{label}</span><Toggle checked={Boolean(settings[key as keyof typeof settings])} onChange={(value) => update({ [key]: value })} /></label>)}
      <SliderRow label="Residue interval" value={settings.bioResidueLabelInterval} min={0} max={100} step={1} display={settings.bioResidueLabelInterval === 0 ? 'Off' : String(settings.bioResidueLabelInterval)} onChange={(bioResidueLabelInterval) => update({ bioResidueLabelInterval })} />
      <SliderRow label="Label size" value={settings.bioLabelSize} min={.5} max={3} step={.1} display={`${settings.bioLabelSize.toFixed(1)}×`} onChange={(bioLabelSize) => update({ bioLabelSize })} />
      <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}><span>Label color</span><input type="color" value={settings.bioLabelColor} onChange={(event) => update({ bioLabelColor: event.currentTarget.value })} /></label>
    </section>
  </div>
}
