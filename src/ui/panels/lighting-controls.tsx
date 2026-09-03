/** Ambient, key, and fill lighting controls for the 3D viewport. */

import { Camera } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { resolveViewportTheme } from "../../host"
import { DEFAULT_LIGHT_AZIMUTH_DEG, DEFAULT_LIGHT_ELEVATION_DEG, resolveViewportLighting } from "../../lib/lighting"

function LightSlider({
  label,
  value,
  fallback,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value: number | null
  fallback: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
}) {
  const effective = value ?? fallback
  const isUserOverride = value !== null
  // Derive display precision from the slider step.
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</label>
        <span className="text-[10px] tabular-nums" style={{ color: isUserOverride ? 'var(--panel-accent)' : 'var(--text-tertiary)' }}>
          {effective.toFixed(decimals)}{isUserOverride ? '' : ' (auto)'}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={effective}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          onChange(v)
        }}
        className="w-full h-5 appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[var(--glass-bg-active)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:-mt-1"
      />
    </div>
  )
}

export function LightingControls() {
  const background = useCrystalStore(s => s.background)
  const isDark = resolveViewportTheme(background) === 'dark'
  const lightAmbient = useCrystalStore(s => s.lightAmbient)
  const lightKey = useCrystalStore(s => s.lightKey)
  const lightFill = useCrystalStore(s => s.lightFill)
  const lightAzimuth = useCrystalStore(s => s.lightAzimuth)
  const lightElevation = useCrystalStore(s => s.lightElevation)
  const setLightAmbient = useCrystalStore(s => s.setLightAmbient)
  const setLightKey = useCrystalStore(s => s.setLightKey)
  const setLightFill = useCrystalStore(s => s.setLightFill)
  const setLightAzimuth = useCrystalStore(s => s.setLightAzimuth)
  const setLightElevation = useCrystalStore(s => s.setLightElevation)
  const lightFollowsCamera = useCrystalStore(s => s.lightFollowsCamera)
  const setLightFollowsCamera = useCrystalStore(s => s.setLightFollowsCamera)
  const lightAmbientOcclusion = useCrystalStore(s => s.lightAmbientOcclusion)
  const setLightAmbientOcclusion = useCrystalStore(s => s.setLightAmbientOcclusion)
  const resetLighting = useCrystalStore(s => s.resetLighting)
  const aoEnabled = lightAmbientOcclusion > 0

  // Auto-mode values mirror the lighting used by the current viewport background.
  const defaultLighting = resolveViewportLighting(isDark, null, null, null)

  // Treat AO as an override so Reset remains available while AO is enabled.
  const hasOverride =
    lightAmbient !== null || lightKey !== null || lightFill !== null ||
    lightAzimuth !== null || lightElevation !== null || aoEnabled || lightFollowsCamera

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Lighting</h3>
        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          Tune the three viewport lights. An &ldquo;auto&rdquo; tag means the value follows the {isDark ? 'dark' : 'light'} background default.
        </p>
      </div>

      <LightSlider
        label="Ambient"
        value={lightAmbient}
        fallback={defaultLighting.ambient}
        onChange={setLightAmbient}
        min={0}
        max={2}
        step={0.05}
      />
      <LightSlider
        label="Key Light"
        value={lightKey}
        fallback={defaultLighting.key}
        onChange={setLightKey}
        min={0}
        max={3}
        step={0.05}
      />
      <LightSlider
        label="Fill Light"
        value={lightFill}
        fallback={defaultLighting.fill}
        onChange={setLightFill}
        min={0}
        max={2}
        step={0.05}
      />

      {/* Azimuth and elevation place highlights on ball-and-stick models. */}
      <div className="pt-2" style={{ borderTop: '1px solid var(--panel-border)' }}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Key Light Angle
          </h4>
          <button
            type="button"
            role="switch"
            aria-checked={lightFollowsCamera}
            onClick={() => setLightFollowsCamera(!lightFollowsCamera)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors"
            style={{
              backgroundColor: lightFollowsCamera ? 'var(--control-primary-bg)' : 'var(--control-selected-bg)',
              border: `1px solid ${lightFollowsCamera ? 'var(--control-primary-bg)' : 'var(--control-selected-border)'}`,
              color: lightFollowsCamera ? 'var(--control-primary-text)' : 'var(--text-secondary)',
            }}
          >
            <Camera className="h-3 w-3" />
            Follow view
          </button>
        </div>
        <p className="text-[10px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
          {lightFollowsCamera
            ? 'The key light rides the camera \u2014 whatever faces you stays lit, at any angle.'
            : 'Angles below place the light on a fixed sphere around the structure.'}
        </p>
        {/* Disable angle controls while lights follow the camera because the camera owns those angles. */}
        <div
          aria-hidden={lightFollowsCamera}
          className={`flex flex-col gap-3 transition-opacity ${lightFollowsCamera ? 'opacity-40 pointer-events-none' : ''}`}
        >
          <LightSlider
            label="Azimuth (°)"
            value={lightAzimuth}
            fallback={DEFAULT_LIGHT_AZIMUTH_DEG}
            onChange={setLightAzimuth}
            min={0}
            max={360}
            step={1}
          />
          <LightSlider
            label="Elevation (°)"
            value={lightElevation}
            fallback={DEFAULT_LIGHT_ELEVATION_DEG}
            onChange={setLightElevation}
            min={-90}
            max={90}
            step={1}
          />
        </div>
      </div>

      {/* Keep AO separate because it is a post-processing pass with different override semantics. */}
      <div className="pt-2" style={{ borderTop: '1px solid var(--panel-border)' }}>
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Ambient Occlusion
          </h4>
          <span
            className="text-[10px] tabular-nums"
            style={{ color: aoEnabled ? 'var(--panel-accent)' : 'var(--text-tertiary)' }}
          >
            {aoEnabled ? lightAmbientOcclusion.toFixed(2) : 'off'}
          </span>
        </div>
        <p className="text-[10px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
          Adds contact shadows in crevices. Gives molecular surfaces real depth &mdash; best paired with Surface or Space-filling.
        </p>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={lightAmbientOcclusion}
          aria-label="Ambient occlusion intensity"
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setLightAmbientOcclusion(v)
          }}
          className="w-full h-5 appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[var(--glass-bg-active)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:-mt-1"
        />
      </div>

      <button
        onClick={resetLighting}
        disabled={!hasOverride}
        className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          backgroundColor: 'var(--panel-elevated)',
          border: '1px solid var(--panel-border)',
          color: 'var(--panel-text-secondary)',
        }}
      >
        Reset to {isDark ? 'dark' : 'light'} background default
      </button>
    </div>
  )
}
