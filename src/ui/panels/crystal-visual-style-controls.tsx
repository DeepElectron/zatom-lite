import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { PATH_TRACING_BLOCKER_MESSAGE, PATH_TRACING_TARGET_SAMPLES } from '../../lib/render/path-tracing'
import { useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'
import {
  STYLE_PRESETS,
  type IsoSurfaceStyle,
  type PolyhedronColorSource,
  type PolyhedronStyle,
  type RenderStyle,
  type SliceClipMode,
  type SliceStyle,
  type VolumeFieldType,
} from '../../lib/render/crystal-visuals'
import {
  COLORMAP_OPTIONS,
  colormapCSSGradient,
  type ColormapName,
} from '../../lib/render/crystal-colormaps'
import { getDefaultCrystalElementVisual } from '../../lib/render/crystal-visuals'
import { MAX_PROCEDURAL_VOLUME_ATOMS } from '../../lib/render/procedural-volume'
import { CollapsibleSection, SelectRow, SliderRow, Toggle } from './panel-ui'

const SHADING_OPTIONS: Array<{ value: RenderStyle; label: string }> = [
  { value: 'vesta', label: 'VESTA Lambert' },
  { value: 'flat', label: 'Flat illustration' },
  { value: 'cel', label: 'Cel shading' },
  { value: 'gooch', label: 'Gooch cool/warm' },
  { value: 'hatch', label: 'Cross-hatching' },
  { value: 'iridescent', label: 'Iridescent' },
  { value: 'xray', label: 'X-ray' },
  { value: 'halftone', label: 'Halftone' },
  { value: 'thermal', label: 'Thermal' },
  { value: 'dither', label: '1-bit dither' },
  { value: 'pixel8', label: '8-bit pixel' },
  { value: 'riso', label: 'Risograph' },
  { value: 'velvet', label: 'Velvet' },
  { value: 'matcap', label: 'Studio Matcap' },
]

const POLY_OPTIONS: Array<{ value: PolyhedronStyle; label: string }> = [
  { value: 'solid-atoms', label: 'Solid + vertex atoms' },
  { value: 'translucent', label: 'Translucent' },
  { value: 'solid', label: 'Solid' },
  { value: 'glass', label: 'Glass Fresnel' },
  { value: 'paper', label: 'Paper facets' },
  { value: 'gem', label: 'Gem facets' },
  { value: 'hologram', label: 'Hologram' },
  { value: 'neon', label: 'Neon edges' },
  { value: 'wireframe', label: 'Wireframe' },
]

const POLY_COLOR_SOURCE_OPTIONS: Array<{ value: PolyhedronColorSource; label: string }> = [
  { value: 'atom', label: 'Follow atom colors' },
  { value: 'element', label: 'Per center element' },
  { value: 'uniform', label: 'Single color' },
]

const ISO_OPTIONS: Array<{ value: IsoSurfaceStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'translucent', label: 'Translucent' },
  { value: 'glass', label: 'Glass' },
  { value: 'solidwire', label: 'Solid + wire' },
  { value: 'wireframe', label: 'Wireframe' },
  { value: 'normals', label: 'Normal colors' },
  { value: 'points', label: 'Point cloud' },
  { value: 'cel', label: 'Cel shading' },
  { value: 'gooch', label: 'Gooch' },
  { value: 'hatch', label: 'Hatching' },
  { value: 'halftone', label: 'Halftone' },
  { value: 'xray', label: 'X-ray' },
  { value: 'iridescent', label: 'Iridescent' },
  { value: 'velvet', label: 'Velvet' },
  { value: 'matcap', label: 'Matcap' },
  { value: 'gem', label: 'Gem' },
  { value: 'hologram', label: 'Hologram' },
  { value: 'bands', label: 'Layer bands' },
  { value: 'dither', label: '1-bit dither' },
  { value: 'pixel8', label: '8-bit pixel' },
  { value: 'riso', label: 'Risograph' },
]

const SLICE_OPTIONS: Array<{ value: SliceStyle; label: string }> = [
  { value: 'smooth', label: 'Smooth heatmap' },
  { value: 'banded', label: 'Filled contours' },
  { value: 'lines', label: 'Contour lines' },
  { value: 'diverging', label: 'Positive / negative lines' },
  { value: 'pixel', label: 'Pixel mosaic' },
  { value: 'dots', label: 'Halftone dots' },
  { value: 'topo', label: 'Topographic' },
  { value: 'relief', label: 'Relief' },
  { value: 'crosshatch', label: 'Cross-hatching' },
  { value: 'crt', label: 'CRT phosphor' },
  { value: 'blueprint', label: 'Blueprint' },
  { value: 'interference', label: 'Interference' },
  { value: 'marbled', label: 'Marbled ink' },
  { value: 'stipple', label: 'Stipple' },
  { value: 'neoncontour', label: 'Neon contours' },
  { value: 'woodcut', label: 'Woodcut' },
  { value: 'negative', label: 'Film negative' },
  { value: 'etching', label: 'Etching' },
]


function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[12px]" style={{ color: 'var(--panel-text-secondary)' }}>{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase" style={{ color: 'var(--panel-text-tertiary)' }}>{value}</span>
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-9 cursor-pointer rounded-md border border-[var(--panel-border)] bg-transparent p-0.5"
          aria-label={label}
        />
      </span>
    </label>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-[12px]" style={{ color: 'var(--panel-text-secondary)' }}>{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </label>
  )
}

export function CrystalVisualStyleControls() {
  const state = useCrystalStore(useShallow((s) => ({
    atoms: s.atoms,
    periodic: s.periodic,
    supercellParams: s.supercellParams,
    compactStructure: s.compactStructure,
    viewMode: s.viewMode,
    pathTracing: s.pathTracing,
    setPathTracing: s.setPathTracing,
    pathTracingSamples: s.pathTracingSamples,
    pathTracingBlocker: s.pathTracingBlocker,
    stylePresetId: s.stylePresetId,
    radiusScale: s.radiusScale,
    bondRadius: s.bondRadius,
    renderStyle: s.renderStyle,
    background: s.background,
    outline: s.outline,
    outlineWidth: s.outlineWidth,
    outlineColor: s.outlineColor,
    sphereDetail: s.sphereDetail,
    elementOverrides: s.elementOverrides,
    atomShininess: s.atomShininess,
    bondBicolor: s.bondBicolor,
    bondColor: s.bondColor,
    showCoordinationPolyhedra: s.showCoordinationPolyhedra,
    polyhedraOpacity: s.polyhedraOpacity,
    polyhedraCentralElements: s.polyhedraCentralElements,
    polyStyle: s.polyStyle,
    polyColorSource: s.polyColorSource,
    polyElementColors: s.polyElementColors,
    polyColor: s.polyColor,
    showPolyEdges: s.showPolyEdges,
    polyEdgeColor: s.polyEdgeColor,
    polyEdgeOpacity: s.polyEdgeOpacity,
    polySpecular: s.polySpecular,
    polyShininess: s.polyShininess,
    polyFresnel: s.polyFresnel,
    cellColor: s.cellColor,
    cellLineWidth: s.cellLineWidth,
    showCellGrid: s.showCellGrid,
    showLattice: s.showLattice,
    showCrystalAxes: s.showCrystalAxes,
    autoRotate: s.autoRotate,
    ambientIntensity: s.ambientIntensity,
    diffuseIntensity: s.diffuseIntensity,
    specularIntensity: s.specularIntensity,
    rimIntensity: s.rimIntensity,
    volumeField: s.volumeField,
    volumeResolution: s.volumeResolution,
    isoLevel: s.isoLevel,
    isoStyle: s.isoStyle,
    isoOpacity: s.isoOpacity,
    isoColorPos: s.isoColorPos,
    isoColorNeg: s.isoColorNeg,
    sliceEnabled: s.sliceEnabled,
    sliceH: s.sliceH,
    sliceK: s.sliceK,
    sliceL: s.sliceL,
    sliceOffset: s.sliceOffset,
    sliceColormap: s.sliceColormap,
    sliceStyle: s.sliceStyle,
    sliceContours: s.sliceContours,
    sliceOpacity: s.sliceOpacity,
    sliceClip: s.sliceClip,
    sliceIsolate: s.sliceIsolate,
    sliceLineColor: s.sliceLineColor,
    sliceBgColor: s.sliceBgColor,
    applyCrystalStylePreset: s.applyCrystalStylePreset,
    setRenderStyle: s.setRenderStyle,
    setCrystalVisualSettings: s.setCrystalVisualSettings,
    setShowCellGrid: s.setShowCellGrid,
    setShowLattice: s.setShowLattice,
    setElementVisualOverride: s.setElementVisualOverride,
    clearElementVisualOverrides: s.clearElementVisualOverrides,
    setPolyhedronElementColor: s.setPolyhedronElementColor,
    clearPolyhedronElementColors: s.clearPolyhedronElementColors,
    setShowCoordinationPolyhedra: s.setShowCoordinationPolyhedra,
    setPolyhedraCentralElements: s.setPolyhedraCentralElements,
    setPolyhedraOpacity: s.setPolyhedraOpacity,
    resetCrystalVisualSettings: s.resetCrystalVisualSettings,
  })))

  const elements = useMemo(
    () => Array.from(new Set(state.atoms.map((atom) => atom.element))).sort(),
    [state.atoms],
  )
  const activePreset = STYLE_PRESETS.find((preset) => preset.id === state.stylePresetId)
  const setVisual = state.setCrystalVisualSettings
  const slicePlaneValid = state.sliceH !== 0 || state.sliceK !== 0 || state.sliceL !== 0
  const polyUsesVestaLighting = (
    state.polyStyle === 'solid-atoms'
    || state.polyStyle === 'translucent'
    || state.polyStyle === 'solid'
    || state.polyStyle === 'glass'
  ) && (state.renderStyle === 'vesta' || state.renderStyle === 'xray')

  return (
    <div className="space-y-4 border-t border-[var(--glass-border-subtle)] pt-4">
      <CollapsibleSection title="Visual style" defaultOpen>
        {state.compactStructure && (
          <p className="rounded-lg px-2.5 py-2 text-[10px] leading-4" style={{ color: 'var(--status-amber)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)' }}>
            Compact scenes keep the high-throughput renderer. Materialize a smaller structure to use per-atom shaders, outlines, overrides, and illustrative scalar fields.
          </p>
        )}
        {state.viewMode === 'hyper-stick' && (
          <p className="rounded-lg px-2.5 py-2 text-[10px] leading-4" style={{ color: 'var(--status-amber)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)' }}>
            HyperStick keeps its high-throughput SDF surface; VESTA colors, radii, bicolor bonds, and shader-lighting controls still apply. Switch to Ball &amp; Stick for the 14 surface shaders and silhouette outlines.
          </p>
        )}
        <SelectRow
          label="Preset"
          value={state.stylePresetId}
          options={[
            ...(state.stylePresetId === 'custom' ? [{ value: 'custom', label: 'Custom settings' }] : []),
            ...STYLE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
          ]}
          onChange={(id) => {
            if (id === 'custom') return
            state.applyCrystalStylePreset(id)
          }}
        />
        {activePreset && (
          <p className="rounded-lg px-2.5 py-2 text-[10px] leading-4" style={{ color: 'var(--panel-text-tertiary)', background: 'var(--panel-elevated)' }}>
            {activePreset.desc}
          </p>
        )}
        {!activePreset && <p className="text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>Custom settings</p>}
        <SelectRow label="Shader" value={state.renderStyle} options={SHADING_OPTIONS} onChange={state.setRenderStyle} />
        <ColorRow label="Viewport background" value={state.background} onChange={(background) => setVisual({ background })} />
        <ToggleRow label="Silhouette outline" checked={state.outline} onChange={(outline) => setVisual({ outline })} />
        {state.outline && (
          <>
            <SliderRow label="Outline width" value={state.outlineWidth} min={0.5} max={5} step={0.1} onChange={(outlineWidth) => setVisual({ outlineWidth })} />
            <ColorRow label="Outline color" value={state.outlineColor} onChange={(outlineColor) => setVisual({ outlineColor })} />
          </>
        )}
        <ToggleRow label="Auto rotate" checked={state.autoRotate} onChange={(autoRotate) => setVisual({ autoRotate })} />
          {/* Path tracing is meaningful only for the physically lit studio style. */}
        {state.renderStyle === 'studio' && (
          <>
            <ToggleRow label="Path tracing" checked={state.pathTracing} onChange={state.setPathTracing} />
            {state.pathTracing && (
              <p className="text-[10px] leading-relaxed" style={{ color: state.pathTracingBlocker ? 'var(--status-amber)' : 'var(--panel-text-tertiary)' }}>
                {state.pathTracingBlocker
                  ? PATH_TRACING_BLOCKER_MESSAGE[state.pathTracingBlocker]
                  : state.pathTracingSamples >= PATH_TRACING_TARGET_SAMPLES
                    ? `已收敛（${PATH_TRACING_TARGET_SAMPLES} 采样）`
                    : `渐进细化中 ${state.pathTracingSamples}/${PATH_TRACING_TARGET_SAMPLES} 采样`}
              </p>
            )}
          </>
        )}
        <button
          type="button"
          className="zatom-choice zatom-pressable rounded-lg px-3 py-2 text-[11px]"
          onClick={() => { state.resetCrystalVisualSettings();  }}
        >
          Reset visual controls
        </button>
      </CollapsibleSection>

      <CollapsibleSection title="Atoms and bonds" defaultOpen={false}>
        <SliderRow label="Atom radius scale" value={state.radiusScale} min={0.1} max={1.2} step={0.01} display={`${state.radiusScale.toFixed(2)}×`} onChange={(radiusScale) => setVisual({ radiusScale })} />
        <SliderRow label="Bond radius" value={state.bondRadius} min={0.02} max={0.4} step={0.01} display={`${state.bondRadius.toFixed(2)} Å`} onChange={(bondRadius) => setVisual({ bondRadius })} />
        <SliderRow label="Sphere detail" value={state.sphereDetail} min={8} max={64} step={4} display={String(state.sphereDetail)} onChange={(sphereDetail) => setVisual({ sphereDetail })} />
        <ToggleRow label="Bicolor bonds" checked={state.bondBicolor} onChange={(bondBicolor) => setVisual({ bondBicolor })} />
        {!state.bondBicolor && <ColorRow label="Bond color" value={state.bondColor} onChange={(bondColor) => setVisual({ bondColor })} />}
        {elements.length > 0 && (
          <div className="space-y-2 border-t border-[var(--panel-border)] pt-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--panel-text-tertiary)' }}>Element overrides</span>
              {Object.keys(state.elementOverrides).length > 0 && (
                <button type="button" className="zatom-pressable text-[10px]" style={{ color: 'var(--panel-accent)' }} onClick={state.clearElementVisualOverrides}>Reset</button>
              )}
            </div>
            <div className="grid grid-cols-[34px_1fr_70px] gap-2 text-[9px] uppercase tracking-wide" style={{ color: 'var(--panel-text-tertiary)' }}>
              <span>Element</span>
              <span>Color</span>
              <span className="text-right">Radius Å</span>
            </div>
            {elements.map((element) => {
              const base = getDefaultCrystalElementVisual(element)
              const visual = state.elementOverrides[element] ?? base
              return (
                <div key={element} className="grid grid-cols-[34px_1fr_70px] items-center gap-2">
                  <span className="rounded-md px-1 py-1 text-center font-mono text-[10px] font-semibold" style={{ color: '#111', background: visual.color }}>{element}</span>
                  <input type="color" value={visual.color} aria-label={`${element} color`} onChange={(event) => state.setElementVisualOverride(element, { color: event.target.value })} className="h-7 w-full cursor-pointer rounded-md border border-[var(--panel-border)] bg-transparent p-0.5" />
                  <input type="number" min={0.1} max={3} step={0.05} value={visual.radius} aria-label={`${element} radius`} onChange={(event) => state.setElementVisualOverride(element, { radius: Number(event.target.value) })} className="zatom-field rounded-md px-2 py-1 text-right font-mono text-[10px]" />
                </div>
              )
            })}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Cell and polyhedra" defaultOpen={false}>
        {state.periodic && <div className="space-y-3">
          <ToggleRow label="Show supercell boundary" checked={state.showLattice} onChange={state.setShowLattice} />
          <ColorRow label="Boundary color" value={state.cellColor} onChange={(cellColor) => setVisual({ cellColor })} />
          <SliderRow label="Boundary line width" value={state.cellLineWidth} min={0.5} max={4} step={0.1} onChange={(cellLineWidth) => setVisual({ cellLineWidth })} />
          <ToggleRow label="Unit-cell grid" checked={state.showCellGrid} onChange={state.setShowCellGrid} />
          <ToggleRow label="Crystal axes" checked={state.showCrystalAxes} onChange={(showCrystalAxes) => setVisual({ showCrystalAxes })} />
          <p className="text-[9px] leading-4" style={{ color: 'var(--panel-text-tertiary)' }}>
            Boundary follows the current {state.supercellParams.nx} × {state.supercellParams.ny} × {state.supercellParams.nz} supercell; the grid reveals its unit cells.
          </p>
        </div>}
        <div className="border-t border-[var(--panel-border)] pt-3">
          <ToggleRow
            label="Coordination polyhedra"
            checked={state.showCoordinationPolyhedra}
            onChange={(show) => state.setShowCoordinationPolyhedra(show)}
          />
        </div>
        {state.showCoordinationPolyhedra && (
          <div className="space-y-3 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-elevated)] p-3">
            {elements.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--panel-text-tertiary)' }}>Center elements</span>
                  <button
                    type="button"
                    className="zatom-pressable text-[10px]"
                    style={{ color: state.polyhedraCentralElements.size === 0 ? 'var(--panel-accent)' : 'var(--panel-text-secondary)' }}
                    onClick={() => state.setPolyhedraCentralElements(new Set())}
                  >Auto</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {elements.map((element) => {
                    const selected = state.polyhedraCentralElements.has(element)
                    return <button
                      key={`poly-center-${element}`}
                      type="button"
                      aria-pressed={selected}
                      className="zatom-pressable rounded-md border px-2 py-1 font-mono text-[10px]"
                      style={{
                        color: selected ? 'var(--panel-accent)' : 'var(--panel-text-secondary)',
                        borderColor: selected ? 'var(--panel-accent)' : 'var(--panel-border)',
                      }}
                      onClick={() => {
                        const next = new Set(state.polyhedraCentralElements)
                        if (selected) next.delete(element)
                        else next.add(element)
                        state.setPolyhedraCentralElements(next)
                      }}
                    >{element}</button>
                  })}
                </div>
                <p className="text-[9px] leading-4" style={{ color: 'var(--panel-text-tertiary)' }}>
                  Auto prioritizes metal centers; choose elements to restrict coordination analysis.
                </p>
              </div>
            )}
            <SelectRow label="Surface style" value={state.polyStyle} options={POLY_OPTIONS} onChange={(polyStyle) => setVisual({ polyStyle })} />
            {state.polyStyle !== 'wireframe' && (
              <>
                <SliderRow label="Face opacity" value={state.polyhedraOpacity} min={0.02} max={1} step={0.01} onChange={state.setPolyhedraOpacity} />
                <SelectRow label="Face colors" value={state.polyColorSource} options={POLY_COLOR_SOURCE_OPTIONS} onChange={(polyColorSource) => setVisual({ polyColorSource })} />
                {state.polyColorSource === 'uniform' && (
                  <ColorRow label="Face color" value={state.polyColor} onChange={(polyColor) => setVisual({ polyColor })} />
                )}
                {state.polyColorSource === 'atom' && (
                  <p className="text-[10px] leading-4" style={{ color: 'var(--panel-text-tertiary)' }}>
                    Faces follow the center atom palette above, so atom color edits stay coordinated with the geometry.
                  </p>
                )}
                {state.polyColorSource === 'element' && elements.length > 0 && (
                  <div className="space-y-2 border-t border-[var(--panel-border)] pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--panel-text-tertiary)' }}>
                        Center element colors
                      </span>
                      {Object.keys(state.polyElementColors).length > 0 && (
                        <button type="button" className="zatom-pressable text-[10px]" style={{ color: 'var(--panel-accent)' }} onClick={state.clearPolyhedronElementColors}>
                          Reset
                        </button>
                      )}
                    </div>
                    {elements.map((element) => {
                      const color = state.polyElementColors[element] ?? getDefaultCrystalElementVisual(element).color
                      return (
                        <label key={element} className="grid grid-cols-[38px_1fr_72px] items-center gap-2">
                          <span className="rounded-md px-1 py-1 text-center font-mono text-[10px] font-semibold" style={{ color: '#111', background: color }}>{element}</span>
                          <input
                            type="color"
                            value={color}
                            aria-label={`${element} polyhedron color`}
                            onChange={(event) => state.setPolyhedronElementColor(element, event.target.value)}
                            className="h-7 w-full cursor-pointer rounded-md border border-[var(--panel-border)] bg-transparent p-0.5"
                          />
                          <span className="text-right font-mono text-[9px] uppercase" style={{ color: 'var(--panel-text-tertiary)' }}>{color}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
                {polyUsesVestaLighting && (
                  <>
                    <SliderRow label="Specular" value={state.polySpecular} min={0} max={1} step={0.01} onChange={(polySpecular) => setVisual({ polySpecular })} />
                    <SliderRow label="Shininess" value={state.polyShininess} min={1} max={100} step={1} display={String(state.polyShininess)} onChange={(polyShininess) => setVisual({ polyShininess })} />
                  </>
                )}
                {state.polyStyle !== 'neon' && (
                  <SliderRow label="Fresnel rim" value={state.polyFresnel} min={0} max={1} step={0.01} onChange={(polyFresnel) => setVisual({ polyFresnel })} />
                )}
              </>
            )}
            {state.polyStyle !== 'wireframe' && state.polyStyle !== 'neon' && (
              <ToggleRow label="Edges" checked={state.showPolyEdges} onChange={(showPolyEdges) => setVisual({ showPolyEdges })} />
            )}
            {(state.showPolyEdges || state.polyStyle === 'wireframe' || state.polyStyle === 'neon') && (
              <>
                {state.polyStyle === 'neon'
                  ? <p className="text-[10px] leading-4" style={{ color: 'var(--panel-text-tertiary)' }}>Neon edges follow each face color.</p>
                  : <ColorRow label="Edge color" value={state.polyEdgeColor} onChange={(polyEdgeColor) => setVisual({ polyEdgeColor })} />}
                <SliderRow label="Edge opacity" value={state.polyEdgeOpacity} min={0} max={1} step={0.01} onChange={(polyEdgeOpacity) => setVisual({ polyEdgeOpacity })} />
              </>
            )}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Shader lighting" defaultOpen={false}>
        <SliderRow label="Shininess" value={state.atomShininess} min={1} max={100} step={1} display={String(state.atomShininess)} onChange={(atomShininess) => setVisual({ atomShininess })} />
        <SliderRow label="Ambient" value={state.ambientIntensity} min={0} max={1} step={0.01} onChange={(ambientIntensity) => setVisual({ ambientIntensity })} />
        <SliderRow label="Diffuse" value={state.diffuseIntensity} min={0} max={1.5} step={0.01} onChange={(diffuseIntensity) => setVisual({ diffuseIntensity })} />
        <SliderRow label="Specular" value={state.specularIntensity} min={0} max={1} step={0.01} onChange={(specularIntensity) => setVisual({ specularIntensity })} />
        <SliderRow label="Rim light" value={state.rimIntensity} min={0} max={1} step={0.01} onChange={(rimIntensity) => setVisual({ rimIntensity })} />
      </CollapsibleSection>

      <CollapsibleSection title="Illustrative scalar field" defaultOpen={false}>
        <p className="rounded-lg px-2.5 py-2 text-[10px] leading-4" style={{ color: 'var(--status-amber)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)' }}>
          These fields are procedural visual approximations derived from atom positions and bonds. They are not DFT charge density or ELF data.
        </p>
        {!state.periodic && <p className="text-[10px]" style={{ color: 'var(--status-amber)' }}>A periodic cell is required.</p>}
        {state.compactStructure && <p className="text-[10px]" style={{ color: 'var(--status-amber)' }}>Illustrative fields require a materialized structure.</p>}
        {state.atoms.length > MAX_PROCEDURAL_VOLUME_ATOMS && (
          <p className="text-[10px]" style={{ color: 'var(--status-amber)' }}>
            Procedural fields are limited to {MAX_PROCEDURAL_VOLUME_ATOMS.toLocaleString()} atoms; reduce the supercell first.
          </p>
        )}
        <SelectRow
          label="Field"
          value={state.volumeField}
          options={[
            { value: 'none', label: 'Off' },
            { value: 'density', label: 'Approx. total density' },
            { value: 'bonding', label: 'Approx. bonding difference' },
            { value: 'elf', label: 'ELF-like localization' },
          ] as Array<{ value: VolumeFieldType; label: string }>}
          onChange={(volumeField) => {
            if (volumeField !== 'none' && (!state.periodic || state.compactStructure || state.atoms.length > MAX_PROCEDURAL_VOLUME_ATOMS)) return
            setVisual({ volumeField })
          }}
        />
        {state.volumeField !== 'none' && (
          <>
            <SliderRow label="Grid resolution" value={state.volumeResolution} min={24} max={96} step={8} display={String(state.volumeResolution)} onChange={(volumeResolution) => setVisual({ volumeResolution })} />
            <SliderRow label="Isovalue" value={state.isoLevel} min={0.05} max={0.9} step={0.01} onChange={(isoLevel) => setVisual({ isoLevel })} />
            <SelectRow label="Surface style" value={state.isoStyle} options={ISO_OPTIONS} onChange={(isoStyle) => setVisual({ isoStyle })} />
            <SliderRow label="Surface opacity" value={state.isoOpacity} min={0.05} max={1} step={0.01} onChange={(isoOpacity) => setVisual({ isoOpacity })} />
            <ColorRow label={state.volumeField === 'bonding' ? 'Accumulation (+)' : 'Surface color'} value={state.isoColorPos} onChange={(isoColorPos) => setVisual({ isoColorPos })} />
            {state.volumeField === 'bonding' && <ColorRow label="Depletion (−)" value={state.isoColorNeg} onChange={(isoColorNeg) => setVisual({ isoColorNeg })} />}
            <ToggleRow label="Show hkl slice" checked={state.sliceEnabled} onChange={(sliceEnabled) => setVisual({ sliceEnabled })} />
            {state.sliceEnabled && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {(['sliceH', 'sliceK', 'sliceL'] as const).map((key, index) => (
                    <label key={key} className="text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>
                      {['h', 'k', 'l'][index]}
                      <input type="number" min={-3} max={3} step={1} value={state[key]} onChange={(event) => setVisual({ [key]: Number(event.target.value) })} className="zatom-field mt-1 w-full rounded-md px-2 py-1.5 text-center font-mono text-[11px]" />
                    </label>
                  ))}
                </div>
                {!slicePlaneValid && <p className="text-[10px]" style={{ color: 'var(--status-red)' }}>(000) does not define a plane.</p>}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ['(100)', 1, 0, 0], ['(010)', 0, 1, 0], ['(001)', 0, 0, 1], ['(110)', 1, 1, 0], ['(111)', 1, 1, 1],
                  ].map(([label, h, k, l]) => (
                    <button key={String(label)} type="button" className="zatom-choice zatom-pressable rounded-md px-2 py-1 font-mono text-[10px]" onClick={() => setVisual({ sliceH: Number(h), sliceK: Number(k), sliceL: Number(l) })}>{label}</button>
                  ))}
                </div>
                <SliderRow label="Slice offset" value={state.sliceOffset} min={0.02} max={0.98} step={0.01} onChange={(sliceOffset) => setVisual({ sliceOffset })} />
                <SelectRow label="Slice style" value={state.sliceStyle} options={SLICE_OPTIONS} onChange={(sliceStyle) => setVisual({ sliceStyle })} />
                <SelectRow label="Colormap" value={state.sliceColormap} options={COLORMAP_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={(sliceColormap: ColormapName) => setVisual({ sliceColormap })} />
                <div className="h-3 rounded-sm border border-[var(--panel-border)]" role="img" aria-label="Colormap preview" style={{ background: colormapCSSGradient(state.sliceColormap) }} />
                <SliderRow label="Contour count" value={state.sliceContours} min={0} max={30} step={1} display={String(state.sliceContours)} onChange={(sliceContours) => setVisual({ sliceContours })} />
                <SliderRow label="Slice opacity" value={state.sliceOpacity} min={0.1} max={1} step={0.01} onChange={(sliceOpacity) => setVisual({ sliceOpacity })} />
                <SelectRow
                  label="Clip isosurface"
                  value={state.sliceClip}
                  options={[
                    { value: 'none', label: 'No clipping' },
                    { value: 'front', label: 'Remove front' },
                    { value: 'back', label: 'Remove back' },
                  ] as Array<{ value: SliceClipMode; label: string }>}
                  onChange={(sliceClip) => setVisual({ sliceClip })}
                />
                <ToggleRow label="Isolate slice" checked={state.sliceIsolate} onChange={(sliceIsolate) => setVisual({ sliceIsolate })} />
                {(state.sliceStyle === 'lines' || state.sliceStyle === 'diverging' || state.sliceContours > 0) && <ColorRow label="Line color" value={state.sliceLineColor} onChange={(sliceLineColor) => setVisual({ sliceLineColor })} />}
                {(state.sliceStyle === 'lines' || state.sliceStyle === 'diverging') && <ColorRow label="Plane background" value={state.sliceBgColor} onChange={(sliceBgColor) => setVisual({ sliceBgColor })} />}
              </>
            )}
          </>
        )}
      </CollapsibleSection>
    </div>
  )
}
