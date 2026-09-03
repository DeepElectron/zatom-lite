"use client"

/**
 * React access to the Asset recorder.
 *
 * The recording logic itself lives in `orchestration/record-structure-asset`
 * because the agent tools need it without a component tree. This file only adds
 * the panel-facing concern React owns: notifying the host so the floating
 * Assets panel can surface a freshly recorded frame.
 */

import { createContext, useCallback, useContext, type ReactNode } from "react"
import {
  recordActiveStructureAsset,
  type StructureAssetOrigin,
} from "../orchestration/record-structure-asset"

export type { StructureAssetOrigin }

type RecordStructureAsset = (label: string, origin: StructureAssetOrigin) => string | null

const StructureAssetContext = createContext<RecordStructureAsset | null>(null)

export function StructureAssetProvider({
  assetsBlockFloating,
  onAssetRecorded,
  children,
}: {
  assetsBlockFloating: boolean
  onAssetRecorded?: () => void
  children: ReactNode
}) {
  const recordStructureAsset = useCallback<RecordStructureAsset>((label, origin) => {
    const recorded = recordActiveStructureAsset(label, origin)
    if (!recorded) return null
    if (!assetsBlockFloating) onAssetRecorded?.()
    return recorded.frameId
  }, [assetsBlockFloating, onAssetRecorded])

  return (
    <StructureAssetContext.Provider value={recordStructureAsset}>
      {children}
    </StructureAssetContext.Provider>
  )
}

export function useStructureAssetRecorder(): RecordStructureAsset {
  const recorder = useContext(StructureAssetContext)
  if (!recorder) throw new Error("useStructureAssetRecorder requires StructureAssetProvider")
  return recorder
}
