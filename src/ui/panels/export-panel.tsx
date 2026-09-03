'use client'

/**
 * Shared Figure/Movie export entry. Both panels remain mounted so switching
 * tabs neither aborts an active movie export nor discards chosen settings.
 */

import { useState } from 'react'
import { Clapperboard, ImageDown } from 'lucide-react'
import { SlidingSegmented } from './panel-ui'
import { FigureExportPanel } from './figure-export-panel'
import { MovieExportPanel } from './movie-export-panel'

type ExportKind = 'figure' | 'movie'

const EXPORT_KINDS = [
  { value: 'figure', label: 'Figure', icon: ImageDown },
  { value: 'movie', label: 'Movie', icon: Clapperboard },
] as const satisfies readonly { value: ExportKind; label: string; icon: unknown }[]

const tabId = (kind: ExportKind) => `export-${kind}-tab`
const panelId = (kind: ExportKind) => `export-${kind}-panel`

export function ExportPanel() {
  const [kind, setKind] = useState<ExportKind>('figure')

  return (
    <div className="flex flex-col gap-4">
      <SlidingSegmented
        options={EXPORT_KINDS}
        value={kind}
        onChange={setKind}
        ariaLabel="Export target"
        semantics="tabs"
        getOptionId={tabId}
        getPanelId={panelId}
      />
      {/* Keep both panels mounted but hidden so screen readers skip the inactive panel. */}
      <div id={panelId('figure')} role="tabpanel" aria-labelledby={tabId('figure')} hidden={kind !== 'figure'}>
        <FigureExportPanel />
      </div>
      <div id={panelId('movie')} role="tabpanel" aria-labelledby={tabId('movie')} hidden={kind !== 'movie'}>
        <MovieExportPanel />
      </div>
    </div>
  )
}
