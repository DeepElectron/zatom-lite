'use client'

/**
 * 3D labels the agent pins with `guide_annotate`, plus the numbered candidate
 * badges from `guide_present_candidates`. Rendered as drei <Html> so they read
 * at any zoom; a small anchored dot marks the exact point and a short leader
 * connects it to the tag. Clicking a badge focuses that candidate — the same
 * thing the agent does with guide_focus_candidate when the user says "the
 * second one". Cleared automatically when a new structure document starts
 * (the positions would no longer mean anything).
 */

import { useEffect } from 'react'
import { Html, Line } from '@react-three/drei'

import {
  selectGuidanceAnnotations,
  selectGuidanceCandidates,
  useAgentGuidance,
  type GuidanceAnnotationKind,
} from '../../../orchestration/agentGuidanceStore'
import { useViewportStore as useCrystalStore, useViewportStoreApi } from '../../../orchestration/ViewportContext'
import { focusGuidanceCandidateInViewport } from '../../../agent/guidance-surface'

const KIND_COLOR: Record<GuidanceAnnotationKind, string> = {
  info: 'var(--panel-accent, #0a84ff)',
  target: '#ff8a00',
  warn: 'var(--panel-danger, #e5484d)',
}

const CANDIDATE_COLOR = '#ff8a00'

export function AgentGuidanceAnnotations() {
  const allAnnotations = useAgentGuidance(selectGuidanceAnnotations)
  const allCandidates = useAgentGuidance(selectGuidanceCandidates)
  const viewportApi = useViewportStoreApi()
  const viewportKey = viewportApi as unknown as object
  const annotations = allAnnotations.filter((annotation) => annotation.viewportKey === viewportKey)
  const candidates = allCandidates?.viewportKey === viewportKey ? allCandidates : null
  const clear = useAgentGuidance((s) => s.clear)
  const documentVersion = useCrystalStore((s) => s.cameraAutoResetVersion)

  // A new document re-fits the camera; any label positions from the previous
  // structure are meaningless there.
  useEffect(() => {
    if (documentVersion > 0) {
      // A new structure invalidates spatial overlays, but the task plan is
      // still the user's workflow. Clearing everything here used to erase
      // "Preview pose → Verify result" exactly when an adsorbate was applied.
      clear('annotations')
      const current = useAgentGuidance.getState().candidates
      if (current?.viewportKey === viewportKey) {
        useAgentGuidance.getState().invalidateCandidate()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentVersion])

  if (annotations.length === 0 && !candidates) return null

  const visibleCandidates = candidates?.decision.status === 'pending'
    ? candidates.items
    : candidates?.decision.status === 'confirmed'
      ? candidates.items.filter((candidate) => candidate.index === candidates.decision.index)
      : []

  return (
    <group renderOrder={1002}>
      {visibleCandidates.map((c) => {
        const candidateSet = candidates!
        const focused = candidateSet.focusedIndex === c.index
        const interactive = candidateSet.decision.status === 'pending'
        const dimmed = interactive && candidateSet.focusedIndex !== null && !focused
        return (
          <group key={`${candidateSet.id}-${c.index}-visual`}>
            {c.anchorPositions.map((anchorPosition, anchorIndex) => (
              <Line
                key={`${candidateSet.id}-${c.index}-anchor-${anchorIndex}`}
                points={[c.position, anchorPosition]}
                color={CANDIDATE_COLOR}
                lineWidth={1}
                transparent
                opacity={dimmed ? 0.2 : 0.55}
                depthTest={false}
              />
            ))}
          <group position={c.position}>
            <mesh>
              <sphereGeometry args={[focused ? 0.16 : 0.11, 12, 10]} />
              <meshBasicMaterial
                color={CANDIDATE_COLOR}
                depthTest={false}
                toneMapped={false}
                transparent
                opacity={dimmed ? 0.35 : 1}
              />
            </mesh>
            <Html zIndexRange={[900, 800]} center style={{ pointerEvents: 'none' }}>
              <button
                type="button"
                aria-label={`Candidate ${c.index}: ${c.label}`}
                aria-pressed={focused}
                disabled={!interactive}
                onClick={() => {
                  if (!interactive) return
                  const nextIndex = focused ? null : c.index
                  try {
                    focusGuidanceCandidateInViewport(nextIndex, viewportApi)
                  } catch {
                    // The shared validator marks stale candidates resolved.
                    // Never focus an old coordinate after the document changed.
                  }
                }}
                className="flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 font-mono text-[11px] leading-none"
                style={{
                  pointerEvents: 'auto',
                  opacity: dimmed ? 0.45 : 1,
                  color: 'var(--panel-text)',
                  background: 'var(--panel-bg)',
                  border: `1.5px solid ${CANDIDATE_COLOR}`,
                  boxShadow: focused
                    ? `0 0 0 3px ${CANDIDATE_COLOR}55, 0 2px 8px rgba(0,0,0,0.18)`
                    : '0 2px 8px rgba(0,0,0,0.18)',
                  transform: `translateY(-${22 + (c.index - 1) * 20}px)`,
                }}
              >
                <span
                  className="flex size-4 items-center justify-center rounded-full text-[10px] font-semibold"
                  style={{ background: CANDIDATE_COLOR, color: 'var(--panel-bg)' }}
                >
                  {c.index}
                </span>
                <span className="whitespace-nowrap">{c.label}</span>
                {focused && c.detail ? <span className="whitespace-nowrap opacity-70">· {c.detail}</span> : null}
              </button>
            </Html>
          </group>
          </group>
        )
      })}
      {annotations.map((a) => {
        const color = KIND_COLOR[a.kind]
        return (
          <group key={a.id} position={a.position}>
            <mesh>
              <sphereGeometry args={[0.09, 12, 10]} />
              <meshBasicMaterial color={color} depthTest={false} toneMapped={false} />
            </mesh>
            <Html zIndexRange={[900, 800]} style={{ pointerEvents: 'none' }}>
              <div className="flex items-end" style={{ transform: 'translate(10px, -100%)' }}>
                <span aria-hidden className="block h-px w-4" style={{ background: color }} />
                <span
                  className="whitespace-nowrap px-2 py-1 font-mono text-[11px] leading-none"
                  style={{
                    color: 'var(--panel-text)',
                    background: 'var(--panel-bg)',
                    borderLeft: `2px solid ${color}`,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                  }}
                >
                  {a.label}
                </span>
              </div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}
