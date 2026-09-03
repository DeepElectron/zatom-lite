import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"

export function ClippingSettings() {
  const enabled = useCrystalStore((s) => s.clippingEnabled)
  const axis = useCrystalStore((s) => s.clippingAxis)
  const offset = useCrystalStore((s) => s.clippingOffset)
  const setEnabled = useCrystalStore((s) => s.setClippingEnabled)
  const setAxis = useCrystalStore((s) => s.setClippingAxis)
  const setOffset = useCrystalStore((s) => s.setClippingOffset)
  const bondCutoff = useCrystalStore((s) => s.bondCutoff)
  const setBondCutoff = useCrystalStore((s) => s.setBondCutoff)
  const bondStiffness = useCrystalStore((s) => s.bondStiffness)
  const setBondStiffness = useCrystalStore((s) => s.setBondStiffness)
  const simSpeed = useCrystalStore((s) => s.simulationSpeed)
  const setSimSpeed = useCrystalStore((s) => s.setSimulationSpeed)

  return (
    <div className="space-y-5">
      {/* Clipping plane */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--panel-text-secondary)' }}>
            Clipping Plane
          </span>
          <button
            onClick={() => setEnabled(!enabled)}
            aria-pressed={enabled}
            data-selected={enabled}
            className="zatom-choice zatom-pressable rounded-full px-3 py-1 text-[11px] font-medium"
          >
            {enabled ? 'On' : 'Off'}
          </button>
        </div>
        {enabled && (
          <div className="space-y-3">
            <div className="flex gap-2">
              {(['x', 'y', 'z'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAxis(a)}
                  aria-pressed={axis === a}
                  data-selected={axis === a}
                  className="zatom-choice zatom-pressable flex-1 rounded-lg py-1.5 text-xs font-medium"
                >
                  {a.toUpperCase()}
                </button>
              ))}
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>Offset</span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--panel-text-secondary)' }}>{offset.toFixed(1)} Å</span>
              </div>
              <input
                type="range" min={-30} max={30} step={0.1} value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
                className="w-full accent-[var(--panel-accent)]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Bond parameters */}
      <div>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--panel-text-secondary)' }}>
          Bond Parameters
        </span>
        <div className="space-y-3 mt-3">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>Cutoff Distance</span>
              <span className="text-[10px] font-mono" style={{ color: 'var(--panel-text-secondary)' }}>{bondCutoff.toFixed(1)} Å</span>
            </div>
            <input
              type="range" min={0.5} max={5.0} step={0.1} value={bondCutoff}
              onChange={(e) => setBondCutoff(Number(e.target.value))}
              className="w-full accent-[var(--panel-accent)]"
            />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>Stiffness</span>
              <span className="text-[10px] font-mono" style={{ color: 'var(--panel-text-secondary)' }}>{bondStiffness}</span>
            </div>
            <input
              type="range" min={1} max={500} step={1} value={bondStiffness}
              onChange={(e) => setBondStiffness(Number(e.target.value))}
              className="w-full accent-[var(--panel-accent)]"
            />
          </div>
        </div>
      </div>

      {/* Simulation speed */}
      <div>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--panel-text-secondary)' }}>
          Simulation Speed
        </span>
        <div className="mt-3">
          <div className="flex justify-between mb-1">
            <span className="text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>Speed Multiplier</span>
            <span className="text-[10px] font-mono" style={{ color: 'var(--panel-text-secondary)' }}>{simSpeed.toFixed(1)}×</span>
          </div>
          <input
            type="range" min={0.1} max={5.0} step={0.1} value={simSpeed}
            onChange={(e) => setSimSpeed(Number(e.target.value))}
            className="w-full accent-[var(--panel-accent)]"
          />
        </div>
      </div>
    </div>
  )
}
