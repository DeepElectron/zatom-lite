"use client"

import { useMemo, useState } from "react"
import { Gem, Plus, Trash2 } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { buildWulffShape, type WulffFace } from "../../lib/analysis/builders/wulff"
import { StatusLine } from "./builder-controls"

interface FaceRow {
  id: string
  h: string
  k: string
  l: string
  gamma: string
}

function defaultFaces(): FaceRow[] {
  // Default = a {100}-family cube, six faces, equal γ = 1.0.
  return [
    { id: 'f1', h: '1', k: '0', l: '0', gamma: '1.0' },
    { id: 'f2', h: '-1', k: '0', l: '0', gamma: '1.0' },
    { id: 'f3', h: '0', k: '1', l: '0', gamma: '1.0' },
    { id: 'f4', h: '0', k: '-1', l: '0', gamma: '1.0' },
    { id: 'f5', h: '0', k: '0', l: '1', gamma: '1.0' },
    { id: 'f6', h: '0', k: '0', l: '-1', gamma: '1.0' },
  ]
}

export function WulffBuilderSection() {
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [element, setElement] = useState('Pt')
  const [size, setSize] = useState('20')
  const [vacuum, setVacuum] = useState('10')
  const [faces, setFaces] = useState<FaceRow[]>(defaultFaces())
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const sizeN = Math.max(2, Math.min(60, parseFloat(size) || 20))
  const vacuumN = Math.max(5, Math.min(30, parseFloat(vacuum) || 10))

  const parsedFaces = useMemo<WulffFace[]>(() => {
    return faces
      .map((f) => ({
        hkl: [parseInt(f.h) || 0, parseInt(f.k) || 0, parseInt(f.l) || 0] as [number, number, number],
        surface_energy: parseFloat(f.gamma) || 0,
      }))
      .filter((f) => !(f.hkl[0] === 0 && f.hkl[1] === 0 && f.hkl[2] === 0) && f.surface_energy > 0)
  }, [faces])

  const addFace = () => {
    setFaces([...faces, { id: `f${Date.now()}`, h: '1', k: '1', l: '1', gamma: '1.0' }])
  }
  const removeFace = (id: string) => {
    setFaces(faces.filter((f) => f.id !== id))
  }
  const updateFace = (id: string, key: 'h' | 'k' | 'l' | 'gamma', value: string) => {
    setFaces(faces.map((f) => (f.id === id ? { ...f, [key]: value } : f)))
  }

  const handleBuild = async () => {
    setStatus(null)
    if (!latticeVectors) {
      setStatus({ ok: false, message: 'No lattice — load a periodic structure first' })
      return
    }
    if (parsedFaces.length < 4) {
      setStatus({ ok: false, message: 'Need at least 4 faces to form a closed polyhedron' })
      return
    }
    try {
      const result = buildWulffShape({
        lattice: [
          [...latticeVectors.a] as [number, number, number],
          [...latticeVectors.b] as [number, number, number],
          [...latticeVectors.c] as [number, number, number],
        ],
        faces: parsedFaces,
        element: element.trim() || 'Pt',
        size_angstrom: sizeN,
        vacuum_angstrom: vacuumN,
      })
      const loadRes = await loadFromXYZ(result.xyz)
      if (loadRes.success) {
        setPeriodic(true)
        const facesShown = result.polyhedron?.faces.length ?? parsedFaces.length
        const vol = result.polyhedron?.volume.toFixed(1) ?? '?'
        setStatus({ ok: true, message: `${result.description} · ${facesShown} faces · V = ${vol} Å³` })
      } else {
        setStatus({ ok: false, message: `Load failed: ${loadRes.error}` })
      }
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--panel-text)', marginBottom: 4 }}>
          Wulff construction
        </div>
        <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', lineHeight: 1.5 }}>
          Equilibrium crystal shape from per-face surface energies. Pre-expand
          symmetry-equivalent faces (e.g. all six {`{100}`}, all eight {`{111}`}).
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
        <Row label="Element">
          <input
            type="text"
            value={element}
            onChange={(e) => setElement(e.target.value)}
            className="w-16 px-1.5 py-0.5 rounded text-[11px] bg-transparent text-right"
            style={{ border: '1px solid var(--panel-border)', color: 'var(--panel-text)' }}
          />
        </Row>
        <Row label="Size (Å)">
          <input
            type="number"
            step="1"
            min={2}
            max={60}
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="w-16 px-1.5 py-0.5 rounded text-[11px] bg-transparent text-right tabular-nums"
            style={{ border: '1px solid var(--panel-border)', color: 'var(--panel-text)' }}
          />
        </Row>
        <Row label="Vacuum (Å)">
          <input
            type="number"
            step="1"
            min={5}
            max={30}
            value={vacuum}
            onChange={(e) => setVacuum(e.target.value)}
            className="w-16 px-1.5 py-0.5 rounded text-[11px] bg-transparent text-right tabular-nums"
            style={{ border: '1px solid var(--panel-border)', color: 'var(--panel-text)' }}
          />
        </Row>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--panel-text-secondary)' }}>
            Faces (h k l · γ)
          </span>
          <button
            onClick={addFace}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
            style={{ color: 'var(--panel-text-secondary)', backgroundColor: 'transparent', border: '1px solid var(--panel-border)' }}
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
          {faces.map((f) => (
            <div key={f.id} className="flex items-center gap-1">
              <SmallInt value={f.h} onChange={(v) => updateFace(f.id, 'h', v)} />
              <SmallInt value={f.k} onChange={(v) => updateFace(f.id, 'k', v)} />
              <SmallInt value={f.l} onChange={(v) => updateFace(f.id, 'l', v)} />
              <span className="text-[10px] opacity-50 px-0.5" style={{ color: 'var(--panel-text-tertiary)' }}>·</span>
              <input
                type="text"
                value={f.gamma}
                onChange={(e) => updateFace(f.id, 'gamma', e.target.value)}
                className="flex-1 px-1.5 py-0.5 rounded text-[10px] bg-transparent text-right tabular-nums"
                style={{ border: '1px solid var(--panel-border)', color: 'var(--panel-text)' }}
              />
              <button
                onClick={() => removeFace(f.id)}
                style={{ color: 'var(--panel-text-tertiary)' }}
                title="Remove face"
              >
                <Trash2 className="w-3 h-3 opacity-60 hover:opacity-100" />
              </button>
            </div>
          ))}
        </div>
        <div className="text-[9px] opacity-50 mt-2" style={{ color: 'var(--panel-text-tertiary)' }}>
          {parsedFaces.length} valid faces ready
        </div>
      </div>

      <button
        onClick={handleBuild}
        disabled={parsedFaces.length < 4}
        className="zatom-primary zatom-pressable flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-[12px] font-medium"
      >
        <Gem className="w-3.5 h-3.5" />
        Build Wulff polyhedron
      </button>

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

function SmallInt({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-9 px-1 py-0.5 rounded text-[10px] bg-transparent text-center tabular-nums"
      style={{ border: '1px solid var(--panel-border)', color: 'var(--panel-text)' }}
    />
  )
}
