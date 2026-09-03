/** Plane-relative and origin-fallback controls for inserting a 2D molecule into 3D. */

import { Download } from "lucide-react"

interface InsertWithPlaneProps {
  insertRotation: number
  moleculeOffset: { x: number; y: number }
  onChangeRotation: (deg: number) => void
  onInsert: () => void
}

export function MoleculeInsertWithPlaneControls({
  insertRotation,
  moleculeOffset,
  onChangeRotation,
  onInsert,
}: InsertWithPlaneProps) {
  const hasOffsetOrRotation = moleculeOffset.x !== 0 || moleculeOffset.y !== 0 || insertRotation !== 0
  return (
    <div
      className="px-4 py-2"
      style={{
        background: "rgba(48,209,88,0.1)",
        borderTop: "1px solid rgba(48,209,88,0.2)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-white/60">Rotation:</span>
        <input
          type="range"
          min="0"
          max="360"
          value={insertRotation}
          onChange={(e) => onChangeRotation(Number(e.target.value))}
          className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
          style={{ accentColor: "#30D158" }}
        />
        <span className="text-xs text-white/50 w-10 text-right">{insertRotation}°</span>
      </div>
      <button
        onClick={onInsert}
        className="w-full py-2 rounded-lg text-sm font-medium bg-[#30D158] text-black hover:bg-[#34D65C] transition-colors flex items-center justify-center gap-2"
      >
        <Download className="w-4 h-4" />
        Insert to 3D at Plane
      </button>
      {hasOffsetOrRotation && (
        <p className="text-xs text-white/50 mt-1 text-center">
          Position offset: ({moleculeOffset.x.toFixed(1)}, {moleculeOffset.y.toFixed(1)}) | Rotation: {insertRotation}°
        </p>
      )}
    </div>
  )
}

interface InsertAtOriginProps {
  onInsert: () => void
}

export function MoleculeInsertAtOriginControls({ onInsert }: InsertAtOriginProps) {
  return (
    <div
      className="px-4 py-2"
      style={{
        background: "rgba(255,159,10,0.1)",
        borderTop: "1px solid rgba(255,159,10,0.2)",
      }}
    >
      <button
        onClick={onInsert}
        className="w-full py-2 rounded-lg text-sm font-medium bg-[#FF9F0A] text-black hover:bg-[#FFB340] transition-colors flex items-center justify-center gap-2"
      >
        <Download className="w-4 h-4" />
        Insert to 3D (at origin)
      </button>
      <div className="mt-1.5 text-[10px] text-white/40 text-center">
        Create a plane to insert at specific position
      </div>
    </div>
  )
}
