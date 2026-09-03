"use client"

import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { FRAGMENTS, fragmentFromLibrary, type Fragment } from "../../lib/analysis/builders/adsorbate-fragments"
import { FRAGMENT_TEMPLATES } from "../../lib/molecule/templates"
import type { AdsorbateMode, AdsorbateFragmentKey } from "../../orchestration/slices/adsorbate-slice"
import type { BackendService } from "../../host"
import { getGlobalBackendClient } from "../../host"
import { Crosshair, FlaskConical, Loader2 } from "lucide-react"
import { atomicNumberToSymbol } from "../../chemistry/periodic-table"
import { siteDotColor } from "../../lib/render/adsorbate-site-colors"
import { StatusLine } from "./builder-controls"

function getAdsorbateBackend(): Pick<BackendService, 'moleculeFromSmiles'> {
  const backend = getGlobalBackendClient()
  if (!backend) {
    throw new Error('BackendService unavailable for SMILES conversion')
  }
  return backend
}

/**
 * Adsorbate inspector tool (PR-D).
 *
 * Three sub-modes:
 *   - Auto: detect candidate sites (top/bridge/hollow), click to place.
 *   - Manual: pick 1–3 surface atoms in the scene, infer site kind, place.
 *   - Dual: place two fragments at two sites with a desired separation.
 *
 * Wired to the adsorbate-slice; the slice talks to the algorithm layer and
 * to loadFromXYZ.
 */
export function AdsorbateTool() {
  const hasBackend = getGlobalBackendClient() !== null
  const atoms = useCrystalStore((s) => s.atoms)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const mode = useCrystalStore((s) => s.adsorbateMode)
  const setMode = useCrystalStore((s) => s.setAdsorbateMode)
  const fragment = useCrystalStore((s) => s.adsorbateFragment)
  const setFragment = useCrystalStore((s) => s.setAdsorbateFragment)
  const fragmentB = useCrystalStore((s) => s.adsorbateFragmentB)
  const setFragmentB = useCrystalStore((s) => s.setAdsorbateFragmentB)
  const detectedSites = useCrystalStore((s) => s.detectedSites)
  const selectedSiteId = useCrystalStore((s) => s.selectedSiteId)
  const setSelectedSiteId = useCrystalStore((s) => s.setSelectedSiteId)
  const selectedSiteIdB = useCrystalStore((s) => s.selectedSiteIdB)
  const setSelectedSiteIdB = useCrystalStore((s) => s.setSelectedSiteIdB)
  const dualDistance = useCrystalStore((s) => s.dualDistance)
  const setDualDistance = useCrystalStore((s) => s.setDualDistance)
  const detectSites = useCrystalStore((s) => s.detectAdsorbateSites)
  const placeAtSite = useCrystalStore((s) => s.placeFragmentAtSite)
  const placeManual = useCrystalStore((s) => s.placeFragmentAtManualSelection)
  const placeDual = useCrystalStore((s) => s.placeDualAtSelectedSites)
  const lastOutcome = useCrystalStore((s) => s.lastPlacementOutcome)
  const clearSites = useCrystalStore((s) => s.clearAdsorbateSites)
  const siteDetectionIssue = useCrystalStore((s) => s.siteDetectionIssue)
  const customFragment = useCrystalStore((s) => s.customFragment)
  const setCustomFragment = useCrystalStore((s) => s.setCustomFragment)

  const clickPlace = useCrystalStore((s) => s.adsorbateClickPlace)
  const setClickPlace = useCrystalStore((s) => s.setAdsorbateClickPlace)

  const [filter, setFilter] = useState<'all' | 'top' | 'bridge' | 'hollow'>('all')
  const [accessFilter, setAccessFilter] = useState<'any' | 'exposed' | 'blocked'>('exposed')
  const [smilesEditorOpen, setSmilesEditorOpen] = useState(false)
  // Library fragments share the Structure panel source. Normalize the anchor at
  // the origin and orient the body toward +z before reusing custom placement.
  const libraryKeys = Object.keys(FRAGMENT_TEMPLATES)
  // Track the library key for highlighting; SMILES fragments have no library key.
  const [libraryPick, setLibraryPick] = useState<string | null>(null)

  const noAtoms = !atoms || atoms.length === 0
  // `custom` is not a FRAGMENTS key, so resolve both dual-mode labels here.
  const fragLabel = (key: AdsorbateFragmentKey): string => {
    if (key === 'custom') return customFragment?.label ?? 'Custom'
    return FRAGMENTS[key]?.label ?? String(key)
  }
  // Show access filters only after the backend has classified site exposure.
  const hasAccessibility = detectedSites.some((s) => s.accessibility != null)

  const filteredSites = detectedSites.filter((s) => {
    if (filter !== 'all' && s.kind !== filter) return false
    if (hasAccessibility && accessFilter !== 'any' && s.accessibility !== accessFilter) return false
    return true
  })
  const previewCount = 25  // cap for inspector list to keep it scannable
  const shownSites = filteredSites.slice(0, previewCount)

  const fragmentKeys = Object.keys(FRAGMENTS) as AdsorbateFragmentKey[]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Mode tabs */}
      <div className="flex items-center gap-1.5">
        {(['auto', 'manual', 'dual'] as AdsorbateMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m);  }}
            className="zatom-choice zatom-pressable flex-1 rounded py-1.5 text-[11px] font-medium capitalize"
            data-selected={mode === m}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Fragment picker */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--panel-text-secondary)', marginBottom: 6 }}>Fragment</div>
        <div className="grid grid-cols-4 gap-1.5">
          {fragmentKeys.map((key) => (
            <button
              key={key}
              onClick={() => { setFragment(key);  }}
              className="zatom-choice zatom-pressable rounded py-1.5 text-[10px] font-medium"
              data-selected={fragment === key}
            >
              {FRAGMENTS[key].label}
            </button>
          ))}
          {/* Custom fragment tile (shown only when user has loaded a SMILES). */}
          {customFragment && (
            <button
              onClick={() => { setFragment('custom');  }}
              title={`Custom: ${customFragment.label}`}
              className="zatom-choice zatom-pressable truncate rounded py-1.5 text-[10px] font-medium"
              data-selected={fragment === 'custom'}
            >
              {customFragment.label.length > 6 ? customFragment.label.slice(0, 6) + '…' : customFragment.label}
            </button>
          )}
          {hasBackend && (
            <button
              onClick={() => { setSmilesEditorOpen((v) => !v);  }}
              title="Add a custom molecule via SMILES (uses RDKit)"
              className="zatom-choice zatom-pressable flex items-center justify-center gap-1 rounded border-dashed py-1.5 text-[10px] font-medium"
              data-selected={smilesEditorOpen}
            >
              <FlaskConical className="w-3 h-3" /> SMILES
            </button>
          )}
        </div>
        {hasBackend && smilesEditorOpen && (
          <SmilesFragmentEditor
            onCancel={() => setSmilesEditorOpen(false)}
            onAccept={(frag) => {
              setCustomFragment(frag)
              setLibraryPick(null)
              setSmilesEditorOpen(false)
            }}
          />
        )}

        {/* Library fragments — same source as the Structure panel (FRAGMENT_TEMPLATES). */}
        <div style={{ fontSize: 11, color: 'var(--panel-text-secondary)', marginTop: 8, marginBottom: 6 }}>Library</div>
        <div className="grid grid-cols-4 gap-1.5">
          {libraryKeys.map((key) => {
            const tpl = FRAGMENT_TEMPLATES[key]
            const active = fragment === 'custom' && libraryPick === key
            return (
              <button
                key={key}
                onClick={() => {
                  setCustomFragment(fragmentFromLibrary(key, tpl.formula.replace(/^-/, ''), tpl.atoms))
                  setLibraryPick(key)
                  setFragment('custom')
                }}
                title={`${tpl.name} (${tpl.formula})`}
                className="zatom-choice zatom-pressable truncate rounded py-1.5 text-[10px] font-medium"
                data-selected={active}
              >
                {tpl.formula.replace(/^-/, '')}
              </button>
            )
          })}
        </div>
      </div>

      {/* Click-to-place: arm, hover an atom to see a translucent ghost of the
          fragment pose, click to commit. Bulk crystals auto-gain a vacuum layer
          along c (anchor layer becomes the surface). Clicks on empty space keep
          orbiting the camera. */}
      <button
        onClick={() => { setClickPlace(!clickPlace);  }}
        className="zatom-choice zatom-pressable flex items-center justify-center gap-1.5 rounded py-2 text-[11px] font-medium"
        data-selected={clickPlace}
      >
        <Crosshair className="w-3.5 h-3.5" />
        {clickPlace ? 'Hover previews, click places — active' : 'Click-to-place on atom'}
      </button>

      {/* Dual: second fragment + desired distance */}
      {mode === 'dual' && (
        <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
          <div style={{ fontSize: 11, color: 'var(--panel-text-secondary)', marginBottom: 6 }}>Second fragment</div>
          <div className="grid grid-cols-4 gap-1.5 mb-2">
            {fragmentKeys.map((key) => (
              <button
                key={key}
                onClick={() => { setFragmentB(key);  }}
                className="zatom-choice zatom-pressable rounded py-1 text-[10px] font-medium"
                data-selected={fragmentB === key}
              >
                {FRAGMENTS[key].label}
              </button>
            ))}
          </div>
          <label className="text-[10px] text-[var(--panel-text-tertiary)] block mb-1">Target distance (Å)</label>
          <input
            type="number"
            value={dualDistance}
            min={0.5}
            max={5}
            step={0.1}
            onChange={(e) => setDualDistance(parseFloat(e.target.value) || 1.5)}
            className="zatom-field w-full rounded px-2 py-1 text-xs tabular-nums"
          />
        </div>
      )}

      {/* Body depending on mode */}
      {(mode === 'auto' || mode === 'dual') && (
        <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontSize: 11, color: 'var(--panel-text-secondary)' }}>
              Sites: {detectedSites.length}
              {detectedSites.length > 0 && ` (${filteredSites.length} shown)`}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { detectSites();  }}
                disabled={noAtoms}
                className="zatom-choice zatom-pressable rounded px-2 py-1 text-[10px] font-medium disabled:opacity-40"
              >
                Detect
              </button>
              {detectedSites.length > 0 && (
                <button
                  onClick={() => { clearSites();  }}
                  className="px-2 py-1 rounded text-[10px] transition-colors"
                  style={{ color: 'var(--panel-text-tertiary)' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Filter chips — kind */}
          {detectedSites.length > 0 && (
            <div className="flex items-center gap-1 mb-2">
              {(['all', 'top', 'bridge', 'hollow'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => { setFilter(k);  }}
                  className="zatom-choice zatom-pressable rounded px-2 py-0.5 text-[9px] font-medium capitalize"
                  data-selected={filter === k}
                >
                  {k}
                </button>
              ))}
            </div>
          )}

          {/* Filter chips — accessibility (only shows when organic adlayer present) */}
          {hasAccessibility && (
            <div className="flex items-center gap-1 mb-2">
              <span style={{ fontSize: 9, color: 'var(--panel-text-tertiary)', marginRight: 2 }}>access:</span>
              {([
                { v: 'exposed', label: 'Exposed', color: '#30D158' },
                { v: 'blocked', label: 'Blocked', color: '#8E8E93' },
                { v: 'any',     label: 'Both',    color: 'var(--panel-text-secondary)' },
              ] as const).map(({ v, label, color }) => (
                <button
                  key={v}
                  onClick={() => { setAccessFilter(v);  }}
                  className="zatom-choice zatom-pressable rounded px-2 py-0.5 text-[9px] font-medium"
                  data-selected={accessFilter === v}
                  style={{ color: accessFilter === v ? color : undefined }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {detectedSites.length === 0 ? (
            siteDetectionIssue ? (
              // Bulk structures have no surface; require a slab and vacuum before suggesting sites.
              <p
                role="status"
                className="rounded px-2 py-1.5"
                style={{
                  fontSize: 10,
                  lineHeight: 1.6,
                  color: '#FF9F0A',
                  backgroundColor: 'rgba(255,159,10,0.10)',
                  border: '1px solid rgba(255,159,10,0.30)',
                }}
              >
                {siteDetectionIssue}
              </p>
            ) : (
              <p style={{ fontSize: 10, color: 'var(--panel-text-tertiary)' }}>
                Click <strong>Detect</strong> to find candidate adsorption sites on the topmost surface layer.
              </p>
            )
          ) : (
            <div className="space-y-1 max-h-[180px] overflow-y-auto custom-scrollbar">
              {shownSites.map((site) => {
                const isPrimary = selectedSiteId === site.id
                const isSecondary = selectedSiteIdB === site.id
                // Blocked sites use a gray marker at half opacity; exposed or unannotated sites remain normal.
                const isBlocked = site.accessibility === 'blocked'
                // Share site colors with the 3D viewport markers.
                const dotColor = siteDotColor(site.kind, isBlocked)
                return (
                  <button
                    key={site.id}
                    onClick={() => {
                      if (mode === 'dual') {
                        if (isPrimary) {
                          setSelectedSiteId(null)
                        } else if (isSecondary) {
                          setSelectedSiteIdB(null)
                        } else if (!selectedSiteId) {
                          setSelectedSiteId(site.id)
                        } else if (!selectedSiteIdB) {
                          setSelectedSiteIdB(site.id)
                        } else {
                          // Both already selected → replace B
                          setSelectedSiteIdB(site.id)
                        }
                      } else {
                        setSelectedSiteId(isPrimary ? null : site.id)
                      }
                    }}
                    title={isBlocked
                      ? `Blocked by ${site.blockedBy?.length ?? 0} organic atom(s); nearest @ ${site.nearestOrganicDistance?.toFixed(2) ?? '?'} Å`
                      : site.accessibility === 'exposed'
                        ? `Exposed (nearest organic ${site.nearestOrganicDistance?.toFixed(2) ?? '?'} Å)`
                        : undefined}
                    className="zatom-choice zatom-pressable flex w-full items-center gap-2 rounded px-2 py-1 text-left"
                    data-selected={isPrimary || isSecondary}
                    style={{
                      opacity: isBlocked ? 0.55 : 1,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: dotColor,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 10, color: 'var(--panel-text)', textTransform: 'capitalize', flex: 1 }}>
                      {site.kind}
                      {isBlocked && (
                        <span style={{ fontSize: 8, color: '#8E8E93', marginLeft: 4, textTransform: 'none' }}>
                          · blocked
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--panel-text-tertiary)', fontFamily: 'monospace' }}>
                      ({site.position[0].toFixed(1)}, {site.position[1].toFixed(1)}, {site.position[2].toFixed(1)})
                    </span>
                    {mode === 'dual' && isPrimary && (
                      <span style={{ fontSize: 9, color: 'var(--control-selected-text)' }}>A</span>
                    )}
                    {mode === 'dual' && isSecondary && (
                      <span style={{ fontSize: 9, color: 'var(--control-selected-text)' }}>B</span>
                    )}
                  </button>
                )
              })}
              {filteredSites.length > previewCount && (
                <div style={{ fontSize: 9, color: 'var(--panel-text-tertiary)', textAlign: 'center', padding: 4 }}>
                  ... + {filteredSites.length - previewCount} more
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
          <div style={{ fontSize: 11, color: 'var(--panel-text-secondary)', marginBottom: 4 }}>Manual selection</div>
          <p style={{ fontSize: 10, color: 'var(--panel-text-tertiary)', marginBottom: 6, lineHeight: 1.5 }}>
            Select 1, 2, or 3 surface atoms in the 3D view (1 = top, 2 = bridge, 3 = hollow).
          </p>
          <div className="flex items-center gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex-1 py-1.5 rounded text-center text-[10px] font-medium"
                style={{
                  backgroundColor: i < selectedAtomIds.size ? 'var(--control-selected-bg)' : 'transparent',
                  color: i < selectedAtomIds.size ? 'var(--control-selected-text)' : 'var(--panel-text-tertiary)',
                  border: `1px solid ${i < selectedAtomIds.size ? 'var(--control-selected-border)' : 'var(--panel-border)'}`,
                }}
              >
                Atom {i + 1}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--panel-text-tertiary)', marginTop: 6 }}>
            Site kind: {
              selectedAtomIds.size === 1 ? 'top' :
              selectedAtomIds.size === 2 ? 'bridge' :
              selectedAtomIds.size === 3 ? 'hollow' : 'none'
            }
          </div>
        </div>
      )}

      {/* Place button */}
      <button
        onClick={async () => {
          if (mode === 'manual') {
            await placeManual()
          } else if (mode === 'dual') {
            await placeDual()
          } else {
            await placeAtSite()
          }
        }}
        disabled={
          noAtoms ||
          (mode === 'auto' && !selectedSiteId) ||
          (mode === 'manual' && selectedAtomIds.size === 0) ||
          (mode === 'dual' && (!selectedSiteId || !selectedSiteIdB))
        }
        className="zatom-primary zatom-pressable w-full rounded-lg py-2 text-[11px] font-medium"
      >
        {mode === 'auto' ? (
          selectedSiteId
            ? `Place ${fragLabel(fragment)} at selected site`
            : 'Pick a site to place fragment'
        ) : mode === 'manual' ? (
          selectedAtomIds.size > 0
            ? `Place ${fragLabel(fragment)}`
            : 'Select surface atom(s)'
        ) : (
          selectedSiteId && selectedSiteIdB
            ? `Place ${fragLabel(fragment)} + ${fragLabel(fragmentB)}`
            : `Pick two sites (${selectedSiteId ? '1' : '0'}/2)`
        )}
      </button>

      {lastOutcome && (
        <StatusLine status={lastOutcome} />
      )}
    </div>
  )
}


// SMILES-to-fragment panel.
// Load a SMILES molecule through the backend and convert it into a placement fragment.
// Choose the first non-hydrogen atom as the surface anchor.
// Translate the molecule so its anchor lands at the origin.
// Store the accepted fragment in the shared custom-fragment slot.

function SmilesFragmentEditor({
  onCancel,
  onAccept,
}: {
  onCancel: () => void
  onAccept: (frag: Fragment) => void
}) {
  const [smiles, setSmiles] = useState('')
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!smiles.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const data = await getAdsorbateBackend().moleculeFromSmiles({ smiles: smiles.trim() })
      // Prefer the first non-hydrogen atom as the anchor.
      // Fall back to index zero only for an all-hydrogen molecule.
      const anchorIdx = data.atoms.findIndex((a) => a.element !== 1)
      const anchor = anchorIdx >= 0 ? anchorIdx : 0
      const ax = data.atoms[anchor].x
      const ay = data.atoms[anchor].y
      const az = data.atoms[anchor].z
      // Translate the anchor to the origin with the surface direction near +z.
      const fragAtoms = data.atoms.map((a) => ({
        element: atomicNumberToSymbol(a.element),
        pos: [a.x - ax, a.y - ay, a.z - az] as [number, number, number],
      }))
      const frag: Fragment = {
        id: 'custom',
        label: label.trim() || data.formula || 'Custom',
        anchor,
        atoms: fragAtoms,
      }
      onAccept(frag)
      setSmiles('')
      setLabel('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      marginTop: 8,
      padding: 10,
      borderRadius: 6,
      backgroundColor: 'var(--panel-elevated)',
      border: '1px dashed #a855f7',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ fontSize: 10, color: 'var(--panel-text-secondary)' }}>
        SMILES string
      </div>
      <textarea
        value={smiles}
        onChange={(e) => setSmiles(e.target.value)}
        placeholder="c1cnc(-c2ncccn2)nc1 (bipyrimidine)"
        rows={2}
        autoFocus
        style={{
          width: '100%', padding: '4px 6px', borderRadius: 4,
          border: '1px solid var(--panel-border)',
          backgroundColor: 'var(--panel-bg)', color: 'var(--panel-text)',
          fontSize: 11, fontFamily: 'monospace', resize: 'none', outline: 'none',
        }}
      />
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Optional label (e.g. bpym)"
        style={{
          width: '100%', padding: '4px 6px', borderRadius: 4,
          border: '1px solid var(--panel-border)',
          backgroundColor: 'var(--panel-bg)', color: 'var(--panel-text)',
          fontSize: 11, outline: 'none',
        }}
      />
      {error && (
        <div style={{
          padding: '4px 6px', borderRadius: 4,
          backgroundColor: '#fef2f2', border: '1px solid #fca5a5',
          fontSize: 10, color: '#dc2626',
        }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            flex: 1, padding: '5px 8px', borderRadius: 4,
            border: '1px solid var(--panel-border)',
            backgroundColor: 'transparent', color: 'var(--panel-text-secondary)',
            fontSize: 11, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!smiles.trim() || submitting}
          style={{
            flex: 1, padding: '5px 8px', borderRadius: 4,
            border: 'none', backgroundColor: '#a855f7', color: 'white',
            fontSize: 11, cursor: submitting ? 'wait' : 'pointer',
            opacity: !smiles.trim() || submitting ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}
        >
          {submitting ? <><Loader2 className="w-3 h-3 animate-spin" /> Loading</> : 'Add fragment'}
        </button>
      </div>
    </div>
  )
}
