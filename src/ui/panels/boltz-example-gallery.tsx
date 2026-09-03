/** Gallery of verified examples. Loading saved results is free; loading inputs prepares a new paid run, so the actions remain explicit and separate. */

import { useState } from 'react'
import { BOLTZ_EXAMPLES, type BoltzExample } from '../../services/boltz-examples'
import { getPipeline } from '../../services/boltz-pipelines'
import {
  landExampleCandidates,
  landExampleComplex,
  type StoredExample,
} from '../../services/boltz-example-landing'

interface Props {
  /** Populate the panel form from example inputs. */
  onFillForm: (example: BoltzExample) => void
}

/** Fetch the manifest only when the gallery is first expanded. */
function useManifest(): {
  manifest: readonly StoredExample[] | null
  error: string | null
  load: () => void
} {
  const [manifest, setManifest] = useState<readonly StoredExample[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = (): void => {
    if (manifest !== null) return
    void fetch(`${import.meta.env.BASE_URL}boltz-examples/manifest.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as StoredExample[]
      })
      .then((rows) => {
        setManifest(rows)
        setError(null)
      })
      .catch((cause: unknown) => {
        setError((cause as Error).message)
      })
  }

  return { manifest, error, load }
}

export function BoltzExampleGallery({ onFillForm }: Props): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { manifest, error, load } = useManifest()

  const toggle = (): void => {
    setOpen((previous) => {
      if (!previous) load()
      return !previous
    })
  }

  const showResult = async (example: BoltzExample): Promise<void> => {
    const stored = manifest?.find((row) => row.id === example.id)
    if (!stored) {
      setNote('No stored result for this case yet.')
      return
    }
    setBusy(example.id)
    setNote(null)
    try {
      // Replace for one candidate and spread multiple candidates across viewports for comparison.
      if (stored.candidates.length <= 1) {
        const { atomCount, chainCount } = await landExampleComplex(stored)
        setNote(`Loaded ${atomCount} atoms across ${chainCount} chains.`)
      } else {
        const { landed, skipped } = await landExampleCandidates(stored)
        setNote(
          landed > 0
            ? `Opened in ${landed} viewports${skipped > 0 ? ` (${skipped} candidates had no structure)` : ''}.`
            : 'No candidate in this case produced a structure.',
        )
      }
    } catch (cause) {
      setNote((cause as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        className="zatom-pressable flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[10px] font-semibold"
        aria-expanded={open}
      >
        <span className="text-[var(--panel-text-secondary)]">
          Built-in examples · one per pipeline
        </span>
        <span className="text-[var(--panel-text-tertiary)]">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open ? (
        <div className="space-y-1.5">
          {/* Explain that View result reads saved output while Load inputs prepares a real job. */}
          <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
            Curated cases bundled with the app, each from a real run on verified RCSB and PubChem
            inputs.
            <span className="text-[var(--panel-text-secondary)]"> View result</span> opens the
            stored output — free and instant.
            <span className="text-[var(--panel-text-secondary)]"> Load inputs</span> copies the
            case into the form so you can adjust it and submit your own run, which is billed.
          </p>

          {error !== null ? (
            <p className="rounded-lg px-2.5 py-2 text-[9px] leading-relaxed text-[var(--status-amber)]">
              {`Could not load the example manifest: ${error}. You can still use "Load inputs" to run a case yourself.`}
            </p>
          ) : null}

          {BOLTZ_EXAMPLES.map((example) => {
            const stored = manifest?.find((row) => row.id === example.id)
            const pipeline = getPipeline(example.pipelineId)
            const count = stored?.candidates.length ?? 0
            return (
              <div
                key={example.id}
                className="space-y-1.5 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-elevated)] px-2.5 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-[10px] font-semibold text-[var(--panel-text)]">
                      {example.title}
                    </p>
                    <p className="text-[9px] text-[var(--panel-text-tertiary)]">{pipeline.label}</p>
                  </div>
                  {count > 0 ? (
                    <span className="shrink-0 rounded-md bg-[var(--status-green-bg)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--status-green)]">
                      {count === 1 ? '1 candidate' : `${count} candidates`}
                    </span>
                  ) : null}
                </div>

                <p className="text-[9px] leading-relaxed text-[var(--panel-text-secondary)]">
                  {example.question}
                </p>
                {/* Keep expected behavior beside results so users can evaluate the example. */}
                <p className="text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
                  <span className="font-semibold">Expected: </span>
                  {example.expectation}
                </p>
                {/* Show source identifiers so examples can be verified against RCSB or PubChem. */}
                <p className="text-[9px] leading-relaxed text-[var(--panel-text-tertiary)] opacity-70">
                  <span className="font-semibold">Source: </span>
                  {example.provenance}
                </p>

                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      void showResult(example)
                    }}
                    disabled={busy !== null || stored === undefined}
                    className="zatom-pressable flex-1 rounded-md px-2 py-1.5 text-[9px] font-semibold text-[var(--panel-accent)] disabled:opacity-40"
                  >
                    {busy === example.id ? 'Loading…' : 'View result'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onFillForm(example)
                    }}
                    className="zatom-pressable rounded-md px-2 py-1.5 text-[9px] font-semibold text-[var(--panel-text-secondary)]"
                  >
                    Load inputs
                  </button>
                </div>
              </div>
            )
          })}

          {note !== null ? (
            <p className="px-1 text-[9px] text-[var(--panel-text-secondary)]">{note}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
