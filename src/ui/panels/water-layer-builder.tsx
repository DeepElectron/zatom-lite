"use client"

import { useMemo, useState } from "react"
import { Droplet } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import {
  buildWaterLayer,
  type WaterFillOptions,
  type WaterModel,
  type WaterSoluteAtom,
  type Vec3,
} from "../../lib/analysis/builders/water-layer"
import { StatusLine } from "./builder-controls"

type Mat3 = [Vec3, Vec3, Vec3]
type FillMode = 'box' | 'surface'
type Side = 'top' | 'bottom' | 'both'

const MODELS: WaterModel[] = ['SPC/E', 'TIP3P', 'TIP4P']

/**
 * Inspector section for the water-fill builder (PR-H).
 *
 * Two modes:
 *   - Box     → fill the existing periodic cell with water at the chosen density
 *   - Surface → grow a water layer above (and/or below) the existing slab
 *
 * Both paths call `buildWaterLayer` (pure-TS MC packing) and feed the resulting
 * extended-XYZ back through `crystalStore.loadFromXYZ`.
 */
export function WaterLayerBuilderSection() {
  const atoms = useCrystalStore((s) => s.atoms)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [mode, setMode] = useState<FillMode>('box')
  const [model, setModel] = useState<WaterModel>('SPC/E')
  const [density, setDensity] = useState('1.0')
  const [targetCount, setTargetCount] = useState('')
  const [layerThickness, setLayerThickness] = useState('8')
  const [surfaceOffset, setSurfaceOffset] = useState('2.5')
  const [side, setSide] = useState<Side>('top')
  const [minSoluteD, setMinSoluteD] = useState('2.3')
  const [minOOD, setMinOOD] = useState('2.5')
  const [seed, setSeed] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [building, setBuilding] = useState(false)

  const densityN = clamp(parseFloat(density) || 1.0, 0.1, 3.0)
  const targetCountN = targetCount.trim() === '' ? undefined : Math.max(0, parseInt(targetCount) || 0)
  const layerN = clamp(parseFloat(layerThickness) || 8, 1, 60)
  const offsetN = clamp(parseFloat(surfaceOffset) || 2.5, 1, 10)
  const minSoluteN = Math.max(0.5, parseFloat(minSoluteD) || 2.3)
  const minOOldN = Math.max(0.5, parseFloat(minOOD) || 2.5)
  const seedN = seed.trim() === '' ? undefined : (parseInt(seed) | 0)

  // Mode-specific availability gating.
  const noLattice = !latticeVectors
  const noAtoms = (atoms?.length ?? 0) === 0
  const disabledReason = useMemo<string | null>(() => {
    if (mode === 'box' && noLattice) return 'Box mode needs a periodic lattice. Load a crystal first.'
    if (mode === 'surface' && noAtoms) return 'Surface mode needs slab atoms. Build / load a slab first.'
    if (mode === 'surface' && noLattice) return 'Surface mode needs a lattice (the slab’s in-plane cell).'
    return null
  }, [mode, noLattice, noAtoms])

  const handleBuild = async () => {
    setStatus(null)
    if (disabledReason) {
      setStatus({ ok: false, message: disabledReason })
      return
    }
    if (!latticeVectors) {
      setStatus({ ok: false, message: 'Missing lattice vectors' })
      return
    }
    setBuilding(true)
    try {
      const lat: Mat3 = [
        [...latticeVectors.a] as Vec3,
        [...latticeVectors.b] as Vec3,
        [...latticeVectors.c] as Vec3,
      ]
      // Resolve current atoms to cartesian coords; fall back to fractional ×
      // lattice if no cartesian is stored.
      const solute: WaterSoluteAtom[] = (atoms ?? []).map((a) => {
        const cart: Vec3 = a.cartesian
          ? [a.cartesian[0], a.cartesian[1], a.cartesian[2]]
          : [
              a.position[0] * lat[0][0] + a.position[1] * lat[1][0] + a.position[2] * lat[2][0],
              a.position[0] * lat[0][1] + a.position[1] * lat[1][1] + a.position[2] * lat[2][1],
              a.position[0] * lat[0][2] + a.position[1] * lat[1][2] + a.position[2] * lat[2][2],
            ]
        return { element: a.element, cartesian: cart }
      })

      const opts: WaterFillOptions = {
        mode,
        lattice: lat,
        solute_atoms: solute,
        density: densityN,
        target_count: targetCountN,
        water_model: model,
        min_solute_distance: minSoluteN,
        min_water_water_distance: minOOldN,
        seed: seedN,
      }
      if (mode === 'surface') {
        opts.layer_thickness = layerN
        opts.surface_offset = offsetN
        opts.side = side
      }

      const result = buildWaterLayer(opts)
      const loadRes = await loadFromXYZ(result.xyz)
      if (loadRes.success) {
        setPeriodic(true)
        setStatus({ ok: true, message: result.description })
      } else {
        setStatus({ ok: false, message: `Load failed: ${loadRes.error}` })
      }
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--panel-text)', marginBottom: 4 }}>
          Water layer / box fill
        </div>
        <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', lineHeight: 1.5 }}>
          Pack rigid-water molecules into the periodic box or above an existing slab via
          Monte Carlo packing — Packmol-style, all in-browser.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1.5">
        {(['box', 'surface'] as FillMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m);  }}
            className="zatom-choice zatom-pressable flex-1 rounded py-1.5 text-[11px] font-medium capitalize"
            data-selected={mode === m}
          >
            {m === 'box' ? 'Box fill' : 'Surface layer'}
          </button>
        ))}
      </div>

      {/* Common params */}
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
        <Row label="Water model">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as WaterModel)}
            className="zatom-field rounded px-1.5 py-0.5 text-[11px]"
          >
            {MODELS.map((m) => (
              <option key={m} value={m} style={{ backgroundColor: 'var(--panel-bg)', color: 'var(--panel-text)' }}>
                {m}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Density (g/cm³)">
          <input
            type="number"
            step="0.05"
            min={0.1}
            max={3}
            value={density}
            onChange={(e) => setDensity(e.target.value)}
            className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
          />
        </Row>
        <Row label="Target count">
          <input
            type="text"
            placeholder="auto"
            value={targetCount}
            onChange={(e) => setTargetCount(e.target.value)}
            className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
          />
        </Row>
      </div>

      {/* Surface-only params */}
      {mode === 'surface' && (
        <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
          <Row label="Layer thickness (Å)">
            <input
              type="number"
              step="0.5"
              min={1}
              max={60}
              value={layerThickness}
              onChange={(e) => setLayerThickness(e.target.value)}
              className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
            />
          </Row>
          <Row label="Surface offset (Å)">
            <input
              type="number"
              step="0.1"
              min={1}
              max={10}
              value={surfaceOffset}
              onChange={(e) => setSurfaceOffset(e.target.value)}
              className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
            />
          </Row>
          <Row label="Side">
            <div className="flex items-center gap-1">
              {(['top', 'bottom', 'both'] as Side[]).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSide(s);  }}
                  className="zatom-choice zatom-pressable rounded px-1.5 py-0.5 text-[10px] capitalize"
                  data-selected={side === s}
                >
                  {s}
                </button>
              ))}
            </div>
          </Row>
        </div>
      )}

      {/* Advanced disclosure */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-[10px] text-left underline"
        style={{ color: 'var(--panel-text-tertiary)' }}
      >
        {showAdvanced ? '− Hide advanced' : '+ More options'}
      </button>
      {showAdvanced && (
        <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
          <Row label="Min O–solute (Å)">
            <input
              type="number"
              step="0.1"
              min={0.5}
              value={minSoluteD}
              onChange={(e) => setMinSoluteD(e.target.value)}
              className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
            />
          </Row>
          <Row label="Min O–O (Å)">
            <input
              type="number"
              step="0.1"
              min={0.5}
              value={minOOD}
              onChange={(e) => setMinOOD(e.target.value)}
              className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
            />
          </Row>
          <Row label="Seed">
            <input
              type="text"
              placeholder="random"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="zatom-field w-20 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
            />
          </Row>
        </div>
      )}

      <button
        onClick={handleBuild}
        disabled={building || !!disabledReason}
        className="zatom-primary zatom-pressable flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-[12px] font-medium"
      >
        <Droplet className="w-3.5 h-3.5" />
        {building ? 'Packing…' : mode === 'box' ? 'Fill box with water' : 'Add water layer'}
      </button>

      {disabledReason && !status && (
        <div
          className="text-[11px] px-2 py-1.5 rounded"
          style={{
            color: 'var(--panel-text-tertiary)',
            backgroundColor: 'var(--panel-elevated)',
            border: '1px solid var(--panel-border)',
          }}
        >
          {disabledReason}
        </div>
      )}

      {status && (
        <StatusLine status={status} />
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <span className="text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>{label}</span>
      {children}
    </div>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}
