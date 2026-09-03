/** Builds an organic overlayer from the current periodic slab and shared adsorbate fragment. */

import { useEffect, useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { FlaskConical, Layers } from "lucide-react"
import { symbolToAtomicNumber, atomicNumberToSymbol } from "../../chemistry/periodic-table"
import type { BackendService, ComputeBuilderInvokePayload } from "../../host"
import { getGlobalBackendClient } from "../../host"

const COVERAGE_OPTIONS = [
  { value: 'auto',        label: 'Auto (use slab as-given)' },
  { value: '1/9_ML',      label: '1/9 ML (3×3 replicate)' },
  { value: '1/6_ML',      label: '1/6 ML (3×2 replicate)' },
  { value: '1/4_ML',      label: '1/4 ML (2×2 replicate)' },
  { value: '1/3_ML',      label: '1/3 ML (3×1 replicate)' },
  { value: '1/2_ML',      label: '1/2 ML (2×1 replicate)' },
  { value: 'saturation',  label: 'Saturation (no replication)' },
]

interface OrganicAdlayerBuildResponse {
  atoms: { element: number; x: number; y: number; z: number }[]
  latticeMatrix: number[][]
  label?: string
  metadata?: { effective_coverage?: number; slab_replication?: [number, number] }
}

function getOrganicAdlayerBackend(): Pick<BackendService, 'invokeComputeBuilder'> {
  const backend = getGlobalBackendClient()
  if (!backend) {
    throw new Error('BackendService unavailable for overlayer builder')
  }
  return backend
}

export function OverlayerBuilder() {
  const atoms = useCrystalStore((s) => s.atoms)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const periodic = useCrystalStore((s) => s.periodic)
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const customFragment = useCrystalStore((s) => s.customFragment)

  const [coverage, setCoverage] = useState<string>('1/4_ML')
  const [orientation, setOrientation] = useState<'flat' | 'tilted' | 'edge_on'>('flat')
  const [heightAA, setHeightAA] = useState<number>(3.0)

  const [preview, setPreview] = useState<{ atoms: number; coverage: number; slabRep: [number, number] } | null>(null)
  const [building, setBuilding] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasSlab = !!atoms && atoms.length > 0 && !!latticeVectors && !!periodic
  const hasMolecule = !!customFragment
  const canBuild = hasSlab && hasMolecule

  // Build seeds payload from current scene + custom fragment.
  const buildSeedsPayload = (): ComputeBuilderInvokePayload | null => {
    if (!atoms || !latticeVectors || !customFragment) return null
    // Convert scene atoms (modeler shape: cartesian) to builder seed format.
    const slabAtoms = atoms.map((a) => {
      const z = symbolToAtomicNumber(a.element)
      const pos = (a.cartesian ?? a.position) as [number, number, number]
      return { element: z, x: pos[0], y: pos[1], z: pos[2] }
    })
    // Convert fragment atoms to builder seed format. Fragment.atoms are already
    // {element: 'Pt' symbol, pos: [x,y,z]} relative to anchor=origin.
    const molAtoms = customFragment.atoms.map((a) => ({
      element: symbolToAtomicNumber(a.element),
      x: a.pos[0], y: a.pos[1], z: a.pos[2],
    }))
    return {
      seeds: {
        slab: {
          atoms: slabAtoms,
          latticeMatrix: [latticeVectors.a, latticeVectors.b, latticeVectors.c],
          label: 'slab',
        },
        molecule: {
          atoms: molAtoms,
          label: customFragment.label,
        },
      },
      params: {
        coverage, orientation, height_above_surface: heightAA,
      },
    }
  }

  // Debounced confirm preview (atom count + effective coverage + replication).
  useEffect(() => {
    if (!canBuild) { setPreview(null); return }
    let cancelled = false
    const id = window.setTimeout(async () => {
      setBuilding(true)
      setError(null)
      try {
        const payload = buildSeedsPayload()
        if (!payload) return
        const data = await getOrganicAdlayerBackend().invokeComputeBuilder<OrganicAdlayerBuildResponse>(
          'build-organic-adlayer',
          payload,
        )
        if (!cancelled) {
          setPreview({
            atoms: data.atoms.length,
            coverage: data.metadata?.effective_coverage ?? 0,
            slabRep: data.metadata?.slab_replication ?? [1, 1],
          })
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setBuilding(false)
      }
    }, 300)
    return () => { cancelled = true; window.clearTimeout(id) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- atoms/latticeVectors ref-stable per modeler load
  }, [canBuild, coverage, orientation, heightAA, customFragment])

  const handleApply = async () => {
    if (!canBuild) return
    setApplying(true)
    setError(null)
    try {
      const payload = buildSeedsPayload()
      if (!payload) return
      const data = await getOrganicAdlayerBackend().invokeComputeBuilder<OrganicAdlayerBuildResponse>(
        'build-organic-adlayer',
        payload,
      )
      // Use the complete shared periodic table so valid elements never degrade to `X`.
      const lat = data.latticeMatrix
      const latStr = [lat[0], lat[1], lat[2]].flat().map((v) => v.toFixed(6)).join(' ')
      const lines = [
        String(data.atoms.length),
        `Lattice="${latStr}" Properties=species:S:1:pos:R:3 ${data.label ? `label="${data.label}"` : ''}`,
        ...data.atoms.map((a) => `${atomicNumberToSymbol(a.element)} ${a.x.toFixed(6)} ${a.y.toFixed(6)} ${a.z.toFixed(6)}`),
      ]
      await loadFromXYZ(lines.join('\n'), { documentMode: 'edit' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--panel-text-secondary)' }}>
        Tile an organic molecule over the current slab (PBC = full overlayer).
        Slab comes from the viewport; molecule comes from the ADSORBATE panel's "+ SMILES" tile.
      </div>

      {/* Status: slab + molecule */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <StatusRow
          icon={<Layers className="w-3 h-3" />}
          label="Slab"
          ok={hasSlab}
          hint={hasSlab ? `${atoms!.length} atoms · viewport` : 'Build or load a periodic slab first (SLAB panel)'}
        />
        <StatusRow
          icon={<FlaskConical className="w-3 h-3" />}
          label="Molecule"
          ok={hasMolecule}
          hint={hasMolecule
            ? `${customFragment!.label} · ${customFragment!.atoms.length} atoms`
            : 'Open ADSORBATE → + SMILES to load a molecule'}
        />
      </div>

      {/* Params */}
      <Field label="Coverage">
        <select
          value={coverage}
          onChange={(e) => setCoverage(e.target.value)}
          disabled={!canBuild}
          style={selectStyle}
        >
          {COVERAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Orientation">
        <select
          value={orientation}
          onChange={(e) => setOrientation(e.target.value as 'flat' | 'tilted' | 'edge_on')}
          disabled={!canBuild}
          style={selectStyle}
        >
          <option value="flat">Flat (ring ⊥ z)</option>
          <option value="tilted">Tilted (as-imported)</option>
          <option value="edge_on">Edge-on (ring ‖ z)</option>
        </select>
      </Field>

      <Field label="Height above surface (Å)">
        <input
          type="number" step={0.1} min={1.5} max={10} value={heightAA}
          onChange={(e) => setHeightAA(Math.max(1.5, Math.min(10, Number(e.target.value) || 3.0)))}
          disabled={!canBuild}
          style={inputStyle}
        />
      </Field>

      {/* Preview confirm */}
      {preview && !error && (
        <div style={{
          padding: '6px 8px', borderRadius: 4,
          border: '1px solid var(--panel-border)',
          backgroundColor: 'var(--panel-elevated)',
          fontSize: 11, color: 'var(--panel-text-secondary)',
          display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4,
        }}>
          <span>{preview.atoms} atoms</span>
          <span>cov ≈ {(preview.coverage * 100).toFixed(1)}%</span>
          <span>slab {preview.slabRep[0]}×{preview.slabRep[1]}</span>
        </div>
      )}

      {error && (
        <div style={{
          padding: '6px 8px', borderRadius: 4,
          border: '1px solid #fca5a5',
          backgroundColor: '#fef2f2',
          fontSize: 11, color: '#dc2626',
        }}>
          {error}
        </div>
      )}

      <button
        onClick={handleApply}
        disabled={!canBuild || applying || building}
        style={{
          padding: '8px 12px',
          borderRadius: 6,
          border: 'none',
          backgroundColor: canBuild ? '#a855f7' : 'var(--panel-border)',
          color: 'white',
          fontSize: 12,
          fontWeight: 500,
          cursor: !canBuild || applying || building ? 'not-allowed' : 'pointer',
          opacity: applying || building ? 0.6 : 1,
        }}
      >
        {applying ? 'Applying...' : `Apply overlayer → viewport`}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--panel-text-secondary)', marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  )
}

function StatusRow({ icon, label, ok, hint }: { icon: React.ReactNode; label: string; ok: boolean; hint: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 8px',
      borderRadius: 4,
      backgroundColor: ok ? 'rgb(168 85 247 / 0.08)' : 'var(--panel-elevated)',
      border: `1px solid ${ok ? 'rgb(168 85 247 / 0.3)' : 'var(--panel-border)'}`,
      fontSize: 11,
    }}>
      <span style={{ color: ok ? '#a855f7' : 'var(--panel-text-tertiary)' }}>
        {icon}
      </span>
      <span style={{ fontWeight: 500, color: ok ? 'var(--panel-text)' : 'var(--panel-text-secondary)' }}>
        {label}
      </span>
      <span style={{ flex: 1, textAlign: 'right', color: 'var(--panel-text-tertiary)', fontSize: 10 }}>
        {hint}
      </span>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid var(--panel-border)',
  backgroundColor: 'var(--panel-bg)',
  color: 'var(--panel-text)',
  fontSize: 11,
  outline: 'none',
}
const selectStyle: React.CSSProperties = { ...inputStyle }
