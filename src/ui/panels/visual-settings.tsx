import { useMemo } from 'react'
import { Box, Circle, Hexagon, Minus, Orbit } from 'lucide-react'
import { resolveViewportTheme, useThemeStore } from '../../host'
import { hiddenHydrogenIds, parseKeptHydrogenOrdinals } from '../../lib/render/hydrogen-visibility'
import { useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'
import { resolveAtomLabelColor } from '../components/crystal-viewer/atom-labels'
import { CrystalVisualStyleControls } from './crystal-visual-style-controls'
import { IconSegmented, Segmented, SliderRow, Toggle } from './panel-ui'
import { BiomoleculeSettings } from './biomolecule-settings'
import { SurfaceSettings } from './surface-settings'

const VIEW_MODES = [
  { value: 'ball-stick', label: 'Ball & Stick', icon: Orbit },
  { value: 'stick', label: 'Stick', icon: Minus },
  { value: 'hyper-stick', label: 'HyperStick', icon: Hexagon },
  { value: 'space-fill', label: 'Space Fill', icon: Circle },
  { value: 'wireframe', label: 'Wireframe', icon: Box },
] as const

/**
 * Viewport appearance and material controls. This is intentionally separate
 * from ViewSettings: visual customization is a primary inspector destination,
 * while Tools owns interaction, analysis, and performance behavior.
 */
export function VisualSettings() {
  const bioStructure = useCrystalStore((state) => state.bioStructure)
  const compactStructure = useCrystalStore((state) => state.compactStructure)
  const appearance = useThemeStore((state) => state.appearance)
  const setAppearance = useThemeStore((state) => state.setAppearance)
  const cellColor = useCrystalStore((state) => state.cellColor)
  const setCrystalVisualSettings = useCrystalStore((state) => state.setCrystalVisualSettings)
  const showBonds = useCrystalStore((state) => state.showBonds)
  const wholeMolecules = useCrystalStore((state) => state.wholeMolecules)
  const setWholeMolecules = useCrystalStore((state) => state.setWholeMolecules)
  const bondCount = useCrystalStore((state) => state.bonds.length)
  const periodic = useCrystalStore((state) => state.periodic)
  const showPeriodicImages = useCrystalStore((state) => state.showPeriodicImages)
  const setShowPeriodicImages = useCrystalStore((state) => state.setShowPeriodicImages)
  const showAtomLabels = useCrystalStore((state) => state.showAtomLabels)
  const atomLabelSize = useCrystalStore((state) => state.atomLabelSize)
  const atomLabelColor = useCrystalStore((state) => state.atomLabelColor)
  const atomLabelBackground = useCrystalStore((state) => state.background)
  // The picker needs the concrete background hex even in automatic mode.
  const resolvedAtomLabelColor = resolveAtomLabelColor(
    resolveViewportTheme(atomLabelBackground) === 'dark',
    atomLabelColor,
  )
  const atomLabelScope = useCrystalStore((state) => state.atomLabelScope)
  const atomLabelContent = useCrystalStore((state) => state.atomLabelContent)
  const atomLabelOutline = useCrystalStore((state) => state.atomLabelOutline)
  const atomLabelPosition = useCrystalStore((state) => state.atomLabelPosition)
  const atomLabelGap = useCrystalStore((state) => state.atomLabelGap)
  const atomCount = useCrystalStore((state) => state.atoms.length)
  const atomScale = useCrystalStore((state) => state.atomScale)
  const bondScale = useCrystalStore((state) => state.bondScale)
  const elementRadiusVariance = useCrystalStore((state) => state.elementRadiusVariance)
  const viewMode = useCrystalStore((state) => state.viewMode)
  const cameraProjection = useCrystalStore((state) => state.cameraProjection)
  const focusedAtomOpacity = useCrystalStore((state) => state.focusedAtomOpacity)
  const focusFadesBonds = useCrystalStore((state) => state.focusFadesBonds)
  const setShowBonds = useCrystalStore((state) => state.setShowBonds)
  const setShowAtomLabels = useCrystalStore((state) => state.setShowAtomLabels)
  const setAtomLabelSize = useCrystalStore((state) => state.setAtomLabelSize)
  const setAtomLabelColor = useCrystalStore((state) => state.setAtomLabelColor)
  const setAtomLabelScope = useCrystalStore((state) => state.setAtomLabelScope)
  const setAtomLabelContent = useCrystalStore((state) => state.setAtomLabelContent)
  const setAtomLabelOutline = useCrystalStore((state) => state.setAtomLabelOutline)
  const setAtomLabelPosition = useCrystalStore((state) => state.setAtomLabelPosition)
  const setAtomLabelGap = useCrystalStore((state) => state.setAtomLabelGap)
  const setAtomScale = useCrystalStore((state) => state.setAtomScale)
  const setBondScale = useCrystalStore((state) => state.setBondScale)
  const setElementRadiusVariance = useCrystalStore((state) => state.setElementRadiusVariance)
  const setViewMode = useCrystalStore((state) => state.setViewMode)
  const setCameraProjection = useCrystalStore((state) => state.setCameraProjection)
  const setFocusedAtomOpacity = useCrystalStore((state) => state.setFocusedAtomOpacity)
  const setFocusFadesBonds = useCrystalStore((state) => state.setFocusFadesBonds)
  const atoms = useCrystalStore((state) => state.atoms)
  const hideHydrogens = useCrystalStore((state) => state.hideHydrogens)
  const keptHydrogens = useCrystalStore((state) => state.keptHydrogens)
  const setHideHydrogens = useCrystalStore((state) => state.setHideHydrogens)
  const setKeptHydrogens = useCrystalStore((state) => state.setKeptHydrogens)
  const showAtomRings = useCrystalStore((state) => state.showAtomRings)
  const setShowAtomRings = useCrystalStore((state) => state.setShowAtomRings)
  // Hide the hydrogen toggle when the structure contains no hydrogen.
  const hydrogenCount = useMemo(
    () => atoms.reduce((n, atom) => (atom.element === 'H' || atom.element === 'D' || atom.element === 'T' ? n + 1 : n), 0),
    [atoms],
  )
  const keptParse = useMemo(() => parseKeptHydrogenOrdinals(keptHydrogens), [keptHydrogens])
  const hiddenHydrogenCount = useMemo(
    () => hiddenHydrogenIds(atoms, { hideHydrogens, keptHydrogens }).size,
    [atoms, hideHydrogens, keptHydrogens],
  )

  return (
    <div className="space-y-4">
      {/* Put frequently changed periodicity first; hide it when modes are equivalent. */}
      {!bioStructure && periodic && <section className="space-y-1.5" aria-labelledby="visual-periodicity-heading">
        <div id="visual-periodicity-heading" style={{ fontSize: 13, color: 'var(--panel-text)' }}>Periodicity</div>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Whole molecules</span>
          <Toggle checked={wholeMolecules} onChange={(v) => { setWholeMolecules(v);  }} />
        </label>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--panel-text-secondary)' }}>
          Rejoins molecules that a cell edge cuts in half, following their bonds, so each one is drawn as a
          single piece sticking out past the cell. Display only — coordinates never change.
        </p>
        {/* Whole-molecule traversal requires bonds, so disclose that prerequisite. */}
        {wholeMolecules && bondCount === 0 && (
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--status-amber)' }}>
            No effect yet: this structure has no bonds, and molecules are traced along bonds. It matters for
            molecular crystals and MD frames, not for atomic solids like a plain metal cell.
          </p>
        )}
      </section>}

      {!bioStructure && <section className={periodic ? 'border-t border-[var(--glass-border-subtle)] pt-4' : undefined} aria-labelledby="visual-representation-heading">
        <div id="visual-representation-heading" style={{ fontSize: 13, color: 'var(--panel-text)', marginBottom: 10 }}>Representation</div>
        <IconSegmented
          columns={5}
          options={VIEW_MODES.filter((mode) => !compactStructure || mode.value !== 'stick').map((mode) => ({ label: mode.label, icon: mode.icon }))}
          value={VIEW_MODES.find((mode) => mode.value === viewMode)?.label ?? 'Ball & Stick'}
          onChange={(label) => {
            const mode = VIEW_MODES.find((candidate) => candidate.label === label)
            if (!mode) return
            setViewMode(mode.value as typeof viewMode)
          }}
        />
        {compactStructure && <p className="mt-2 text-[10px] leading-4" style={{ color: 'var(--status-amber)' }}>
          Stick is unavailable for compact point clouds because that format has no bond graph; materialize a bonded structure first.
        </p>}
      </section>}

      {bioStructure && (
        <div className="border-t border-[var(--glass-border-subtle)] pt-4">
          <BiomoleculeSettings />
        </div>
      )}

      {/* SurfaceSettings hides itself without cube or Molden data. */}
      <SurfaceSettings />

      {/* Keep geometry-size sliders in their own section. */}
      {!bioStructure && <section className="space-y-3 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="visual-geometry-heading">
        <div id="visual-geometry-heading" style={{ fontSize: 13, color: 'var(--panel-text)' }}>Geometry</div>
        {viewMode !== 'stick' && <>
          <SliderRow
            label="Atom Size" value={atomScale} min={0.3} max={2} step={0.1}
            onChange={(value) => { setAtomScale(value);  }}
          />
          <SliderRow
            label="Bond Size" value={bondScale} min={0.3} max={2} step={0.1}
            onChange={(value) => { setBondScale(value);  }}
          />
          <SliderRow
            label="Size Variance" value={elementRadiusVariance} min={0} max={1} step={0.05}
            onChange={(value) => { setElementRadiusVariance(value);  }}
          />
        </>}
        {viewMode === 'stick' && <p className="text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>
          Stick mode takes atom and bond thickness from the absolute Bond radius control in Crystal style.
        </p>}
      </section>}

      {!bioStructure && <section className="space-y-3 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="visual-display-heading">
        <div id="visual-display-heading" style={{ fontSize: 13, color: 'var(--panel-text)' }}>Display</div>
        <><label className="flex cursor-pointer items-center justify-between">
          <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Show Bonds</span>
          <Toggle checked={showBonds} onChange={(value) => { setShowBonds(value);  }} />
        </label>
        {(viewMode === 'ball-stick' || viewMode === 'space-fill') && <label className="flex cursor-pointer items-center justify-between" title="Draws three orthogonal rings around every atom sphere — the crossed-ring look used in reaction-mechanism figures. Decoration only; ball-and-stick and space-fill views.">
          <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Crossed rings</span>
          <Toggle checked={showAtomRings} onChange={(value) => { setShowAtomRings(value);  }} />
        </label>}
        {hydrogenCount > 0 && <label className="flex cursor-pointer items-center justify-between" title="Hides every hydrogen (and D/T) with its bonds and labels. Display only — coordinates never change.">
          <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Hide hydrogens</span>
          <Toggle checked={hideHydrogens} onChange={(value) => { setHideHydrogens(value);  }} />
        </label>}
        {hydrogenCount > 0 && hideHydrogens && <div className="space-y-1.5 rounded-xl p-2.5" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
          <label className="flex flex-col gap-1">
            <span className="text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>Keep these (atom numbers, e.g. 1,3,5-8)</span>
            <input
              type="text"
              inputMode="numeric"
              spellCheck={false}
              value={keptHydrogens}
              onChange={(event) => setKeptHydrogens(event.target.value)}
              placeholder="none kept"
              aria-label="Hydrogens to keep visible, by atom number"
              className="w-full rounded-md px-2 py-1 font-mono text-[12px] outline-none"
              style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', color: 'var(--panel-text)' }}
            />
          </label>
          {/* Numbers match the Atom labels → Number display. */}
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--panel-text-secondary)' }}>
            {hiddenHydrogenCount} of {hydrogenCount} hydrogens hidden. Numbers match the <em>Number</em> atom label — turn labels on to read them off the structure.
          </p>
          {keptParse.rejected.length > 0 && (
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--status-amber)' }}>
              Could not read: {keptParse.rejected.join(', ')}. Use whole numbers and ranges like 5-8.
            </p>
          )}
        </div>}
        <label className="flex cursor-pointer items-center justify-between" title="Draws periodic image atoms at cell boundaries (an FCC conventional cell shows 4 atoms as 14 spheres); clicking an image selects its source atom and coordinates are unchanged">
          <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Periodic images</span>
          <Toggle checked={showPeriodicImages} onChange={(value) => { setShowPeriodicImages(value);  }} />
        </label>
        <label className="flex cursor-pointer items-center justify-between">
          <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Atom labels</span>
          <Toggle checked={showAtomLabels} onChange={(value) => { setShowAtomLabels(value);  }} />
        </label>
        {showAtomLabels && <div className="space-y-3 rounded-xl p-2.5" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
          <div className="space-y-1.5">
            <span className="text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>Scope</span>
            <Segmented
              options={['All', 'Selected']}
              value={atomLabelScope === 'all' ? 'All' : 'Selected'}
              onChange={(value) => setAtomLabelScope(value === 'All' ? 'all' : 'selected')}
              ariaLabel="Atom label scope"
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>Content</span>
            <Segmented
              options={['Element', 'Number', 'Element + #']}
              value={atomLabelContent === 'element' ? 'Element' : atomLabelContent === 'number' ? 'Number' : 'Element + #'}
              onChange={(value) => setAtomLabelContent(value === 'Element' ? 'element' : value === 'Number' ? 'number' : 'element-number')}
              ariaLabel="Atom label content"
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>Position</span>
            <Segmented
              options={['Above', 'Center', 'Below']}
              value={atomLabelPosition === 'above' ? 'Above' : atomLabelPosition === 'center' ? 'Center' : 'Below'}
              onChange={(value) => setAtomLabelPosition(value === 'Above' ? 'above' : value === 'Center' ? 'center' : 'below')}
              ariaLabel="Atom label position"
            />
          </div>
          {atomLabelPosition !== 'center' && <SliderRow
            label="Label gap" value={atomLabelGap} min={0} max={2} step={.05}
            display={`${atomLabelGap.toFixed(2)} Å`}
            onChange={(value) => { setAtomLabelGap(value);  }}
          />}
          <SliderRow
            label="Label size" value={atomLabelSize} min={.5} max={3} step={.1}
            display={`${atomLabelSize.toFixed(1)}×`}
            onChange={(value) => { setAtomLabelSize(value);  }}
          />
          <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}>
            <span>Outline</span>
            <Toggle checked={atomLabelOutline} onChange={(value) => { setAtomLabelOutline(value);  }} />
          </label>
          <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}>
            <span>Label color</span>
            <div className="flex items-center gap-2">
              {/* Show the resolved viewport color when no override exists; expose Auto only after an override. */}
              {atomLabelColor !== null && <button
                type="button"
                onClick={() => setAtomLabelColor(null)}
                title="Follow the viewport background"
                className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide transition-colors"
                style={{ color: 'var(--panel-text-tertiary)', border: '1px solid var(--glass-border-subtle)' }}
              >
                Auto
              </button>}
              <input
                type="color"
                aria-label="Atom label color"
                value={resolvedAtomLabelColor}
                onChange={(event) => setAtomLabelColor(event.currentTarget.value)}
              />
            </div>
          </label>
          {(compactStructure || atomCount > 500) && <p className="text-[9px] leading-4" style={{ color: 'var(--status-amber)' }}>
            Large structures override All and show labels for selected atoms only.
          </p>}
        </div>}
        </>
      </section>}

      <section className="space-y-3 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="visual-focus-heading">
        <div id="visual-focus-heading" style={{ fontSize: 13, color: 'var(--panel-text)' }}>Focus appearance</div>
        <SliderRow
          label="Non-focused Opacity" value={focusedAtomOpacity} min={0.1} max={1} step={0.05}
          display={`${Math.round(focusedAtomOpacity * 100)}%`}
          onChange={(value) => { setFocusedAtomOpacity(value);  }}
        />
        <label className="flex cursor-pointer items-center justify-between">
          <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Fade Bonds on Focus</span>
          <Toggle checked={focusFadesBonds} onChange={(value) => { setFocusFadesBonds(value);  }} />
        </label>
      </section>

      {/* Camera projection is a view property, so keep it in a separate section. */}
      <section className="space-y-3 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="visual-camera-heading">
        <div id="visual-camera-heading" style={{ fontSize: 13, color: 'var(--panel-text)' }}>Camera</div>
        <Segmented
          options={['Perspective', 'Orthographic']}
          value={cameraProjection === 'perspective' ? 'Perspective' : 'Orthographic'}
          onChange={(value) => {
            setCameraProjection(value === 'Perspective' ? 'perspective' : 'orthographic')
          }}
        />
      </section>

      <CrystalVisualStyleControls />

      <section className="space-y-3 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="visual-appearance-heading">
        <div id="visual-appearance-heading" style={{ fontSize: 13, color: 'var(--panel-text)' }}>Appearance</div>
        <Segmented
          options={['Auto', 'System', 'Light', 'Dark']}
          value={
            appearance === 'viewport' ? 'Auto'
              : appearance === 'system' ? 'System'
                : appearance === 'dark' ? 'Dark'
                  : 'Light'
          }
          ariaLabel="Interface appearance"
          onChange={(value) => {
            const next = value === 'Auto' ? 'viewport'
              : value === 'System' ? 'system'
                : value === 'Dark' ? 'dark'
                  : 'light'
            if (next === appearance) return
            setAppearance(next)
            // A fixed Light or Dark override also updates the scientific viewport background.
            // Flip default cell-line colors when needed to preserve contrast.
            // Auto and System affect interface chrome without changing the scientific viewport.
            if (next === 'light' || next === 'dark') {
              const dark = next === 'dark'
              const cellColorPatch =
                dark && cellColor === '#000000' ? { cellColor: '#e6e6ea' }
                : !dark && cellColor === '#e6e6ea' ? { cellColor: '#000000' }
                : {}
              setCrystalVisualSettings({ background: dark ? '#101014' : '#ffffff', ...cellColorPatch })
            }
          }}
        />
        <p className="text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>
          Auto matches the active viewport. System follows your device in real time. Light and Dark are fixed overrides and also retint the viewport.
        </p>
      </section>
    </div>
  )
}
