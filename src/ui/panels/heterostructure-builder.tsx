"use client"

import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import type { Atom, LatticeVectors } from "../../lib/crystal/types"
import { buildHeterostructure, type HeterostructureOptions } from "../../lib/analysis/builders/heterostructure"
import { BuilderRow, NumInput, BuildButton, StatusLine } from "./builder-controls"

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

/**
 * Heterostructure builder panel — stack the current structure into a bilayer.
 *
 * Single-scene constraint: the modeler holds one active structure, so this
 * stacks the current sheet on a COPY of itself (homobilayer) along z, with a
 * vacuum gap, interlayer distance, and in-plane registry offset. To stack two
 * DISTINCT layers, load the intended top layer as the active structure first
 * (no in-plane lattice matching is done — pre-match the cells).
 */
export function HeterostructureBuilderSection() {
  const atoms = useCrystalStore((s) => s.atoms) as Atom[] | null
  const latticeVectors = useCrystalStore((s) => s.latticeVectors) as LatticeVectors | null
  const supercellParams = useCrystalStore((s) => s.supercellParams) as { nx: number; ny: number; nz: number } | null
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [gap, setGap] = useState("3.35")
  const [vacuum, setVacuum] = useState("15")
  const [offsetX, setOffsetX] = useState("0")
  const [offsetY, setOffsetY] = useState("0")
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const hasStructure = !!atoms && atoms.length > 0 && !!latticeVectors

  const handleBuild = async () => {
    setStatus(null)
    if (!atoms || atoms.length === 0 || !latticeVectors) {
      setStatus({ ok: false, message: "Load a periodic structure first." })
      return
    }
    try {
    // Cartesian atoms span the displayed supercell, so build the periodic box
    // from the same repeated lattice rather than a single unit cell.
      const nx = Math.max(1, supercellParams?.nx ?? 1)
      const ny = Math.max(1, supercellParams?.ny ?? 1)
      const nz = Math.max(1, supercellParams?.nz ?? 1)
      const scale = (v: readonly number[], n: number): Vec3 => [v[0] * n, v[1] * n, v[2] * n]
      const lattice: Mat3 = [
        scale(latticeVectors.a, nx),
        scale(latticeVectors.b, ny),
        scale(latticeVectors.c, nz),
      ]
      const layer = {
        atoms: atoms.map((a) => ({ element: a.element, cartesian: a.cartesian, position: a.position })),
        lattice,
        label: "current",
      }
      const opts: HeterostructureOptions = {
        bottom: layer,
        top: layer,
        vacuum: Math.max(5, parseFloat(vacuum) || 15),
        interlayer_gap: Math.max(1, parseFloat(gap) || 3.35),
        top_offset: [parseFloat(offsetX) || 0, parseFloat(offsetY) || 0],
      }
      const result = buildHeterostructure(opts)
      const loadRes = await loadFromXYZ(result.xyz)
      if (loadRes.success) {
        setPeriodic(true)
        setStatus({ ok: true, message: result.description })
      } else {
        setStatus({ ok: false, message: `Load failed: ${loadRes.error}` })
      }
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--panel-text)", marginBottom: 4 }}>Heterostructure / bilayer</div>
        <p style={{ fontSize: 11, color: "var(--panel-text-tertiary)", lineHeight: 1.5 }}>
          Stack the current structure on a copy of itself along z. For a distinct top layer, load it as
          the active structure first. No in-plane lattice matching — pre-match the cells.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
        <BuilderRow label="Interlayer (Å)"><NumInput value={gap} onChange={setGap} step="0.05" /></BuilderRow>
        <BuilderRow label="Vacuum (Å)"><NumInput value={vacuum} onChange={setVacuum} step="1" /></BuilderRow>
        <BuilderRow label="Offset x (Å)"><NumInput value={offsetX} onChange={setOffsetX} step="0.1" /></BuilderRow>
        <BuilderRow label="Offset y (Å)"><NumInput value={offsetY} onChange={setOffsetY} step="0.1" /></BuilderRow>
      </div>

      <BuildButton label="Stack bilayer" onClick={handleBuild} disabled={!hasStructure} />
      {status && <StatusLine status={status} />}
    </div>
  )
}
