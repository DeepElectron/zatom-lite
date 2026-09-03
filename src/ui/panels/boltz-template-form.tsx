"use client"

/** Controlled inputs for template workflows; request assembly remains in the parent panel. */

import type { TemplateChainSummary } from "../../lib/biomolecule/mmcif-export"
import { SlidingSegmented } from "./panel-ui"

/** Shared subsection heading style. */
function FieldHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--panel-text-tertiary)]">
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">{children}</p>
}

/** Use native selects because chain count is unbounded; include residue counts for position inputs. */
function ChainSelect({
  label,
  value,
  chains,
  onChange,
}: {
  label: string
  value: string
  chains: readonly TemplateChainSummary[]
  onChange: (next: string) => void
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="zatom-field w-full rounded-xl px-3 py-2.5 font-mono text-[10px]"
    >
      {chains.map((chain) => (
        <option key={chain.chainId} value={chain.chainId}>
          {`${chain.chainId === "" ? "(blank)" : chain.chainId} · ${chain.length} ${chain.polymerType === "protein" ? "aa" : "nt"}`}
        </option>
      ))}
    </select>
  )
}

export type MotifKind = "replacement" | "insertion"

/** Template-binder inputs for target chain, binder chain, and one redesign motif. */
export function TemplateBinderFields({
  chains,
  targetChainId,
  binderChainId,
  motifKind,
  motifStart,
  motifEnd,
  motifLength,
  selectionRange,
  onTargetChainChange,
  onBinderChainChange,
  onMotifKindChange,
  onMotifStartChange,
  onMotifEndChange,
  onMotifLengthChange,
  onUseSelection,
}: {
  chains: readonly TemplateChainSummary[]
  targetChainId: string
  binderChainId: string
  motifKind: MotifKind
  motifStart: string
  motifEnd: string
  motifLength: string
  /** Selected binder-chain range available for filling motif positions. */
  selectionRange: { start: number; end: number; count: number } | null
  onTargetChainChange: (next: string) => void
  onBinderChainChange: (next: string) => void
  onMotifKindChange: (next: MotifKind) => void
  onMotifStartChange: (next: string) => void
  onMotifEndChange: (next: string) => void
  onMotifLengthChange: (next: string) => void
  onUseSelection: () => void
}) {
  const binderChain = chains.find((chain) => chain.chainId === binderChainId)
  // Report the first out-of-range position.
  // Positions are one-based and must stay within the selected chain.
  const outOfRange = (() => {
    if (!binderChain) return null
    const start = Number(motifStart.trim())
    const end = Number(motifEnd.trim())
    if (motifStart.trim() !== "" && Number.isInteger(start) && start > binderChain.length) return start
    if (motifKind === "replacement" && motifEnd.trim() !== "" && Number.isInteger(end) && end > binderChain.length) return end
    return null
  })()

  return (
    <>
      <div className="space-y-1.5">
        <FieldHeading>Target chain</FieldHeading>
        <ChainSelect label="Target chain" value={targetChainId} chains={chains} onChange={onTargetChainChange} />
      </div>

      <div className="space-y-1.5">
        <FieldHeading>Binder scaffold chain</FieldHeading>
        <ChainSelect label="Binder scaffold chain" value={binderChainId} chains={chains} onChange={onBinderChainChange} />
        <Hint>
          {targetChainId === binderChainId
            ? "Pick a different chain — the scaffold cannot also be the target."
            : "Its backbone is kept; only the segment below is redesigned."}
        </Hint>
      </div>

      <div className="space-y-1.5">
        <FieldHeading>Redesign segment</FieldHeading>
        <SlidingSegmented
          semantics="tabs"
          ariaLabel="Segment mode"
          value={motifKind}
          onChange={(next) => onMotifKindChange(next as MotifKind)}
          options={[
            { value: "replacement", label: "Replace" },
            { value: "insertion", label: "Insert" },
          ]}
        />
        <div className="flex items-center gap-2">
          <input
            aria-label={motifKind === "insertion" ? "Insert after position" : "Segment start position"}
            value={motifStart}
            onChange={(event) => onMotifStartChange(event.currentTarget.value)}
            placeholder={motifKind === "insertion" ? "after" : "start"}
            spellCheck={false}
            className="zatom-field w-full rounded-xl px-3 py-2.5 font-mono text-[10px]"
          />
          {motifKind === "replacement" && (
            <input
              aria-label="Segment end position"
              value={motifEnd}
              onChange={(event) => onMotifEndChange(event.currentTarget.value)}
              placeholder="end"
              spellCheck={false}
              className="zatom-field w-full rounded-xl px-3 py-2.5 font-mono text-[10px]"
            />
          )}
        </div>
        {selectionRange && (
          <button
            type="button"
            onClick={onUseSelection}
            className="rounded-md px-1.5 py-0.5 text-[9px] font-medium text-[var(--panel-accent)] transition-colors hover:bg-[var(--panel-hover)]"
          >
            {/* Insert mode uses one anchor rather than a range. */}
            {motifKind === "insertion"
              ? `Use selection (after ${selectionRange.end})`
              : `Use selection (${selectionRange.start}–${selectionRange.end})`}
          </button>
        )}
        <Hint>
          {outOfRange
            // Explain range errors because they also disable submission.
            ? `Position ${outOfRange} is outside chain ${binderChainId === "" ? "(blank)" : binderChainId} (1–${binderChain?.length}).`
            : motifKind === "insertion"
              ? `Insert a new stretch after this position. 1-based, chain ${binderChainId === "" ? "(blank)" : binderChainId}${binderChain ? ` of ${binderChain.length}` : ""}.`
              : `Positions are 1-based and inclusive, chain ${binderChainId === "" ? "(blank)" : binderChainId}${binderChain ? ` of ${binderChain.length}` : ""}.`}
        </Hint>
      </div>

      <div className="space-y-1.5">
        <FieldHeading>New segment length</FieldHeading>
        <input
          aria-label="New segment length range"
          value={motifLength}
          onChange={(event) => onMotifLengthChange(event.currentTarget.value)}
          placeholder="5..8"
          spellCheck={false}
          className="zatom-field w-full rounded-xl px-3 py-2.5 font-mono text-[10px]"
        />
        <Hint>
          {"Length range for the replacement stretch, min..max. It need not match the original length."}
        </Hint>
      </div>
    </>
  )
}

export type RedesignMode = "generic" | "binder"

/** Sequence redesign preserves geometry and changes only selected residues. */
export function RedesignFields({
  chains,
  mode,
  binderChainId,
  residues,
  selectionCount,
  minResidues,
  onModeChange,
  onBinderChainChange,
  onResiduesChange,
  onUseSelection,
}: {
  chains: readonly TemplateChainSummary[]
  mode: RedesignMode
  binderChainId: string
  residues: string
  selectionCount: number
  minResidues: number
  onModeChange: (next: RedesignMode) => void
  onBinderChainChange: (next: string) => void
  onResiduesChange: (next: string) => void
  onUseSelection: () => void
}) {
  const count = residues.trim() === "" ? 0 : residues.split(/[,\s]+/).filter(Boolean).length

  return (
    <>
      <div className="space-y-1.5">
        <FieldHeading>Mode</FieldHeading>
        <SlidingSegmented
          semantics="tabs"
          ariaLabel="Redesign mode"
          value={mode}
          onChange={(next) => onModeChange(next as RedesignMode)}
          options={[
            { value: "generic", label: "Whole complex" },
            { value: "binder", label: "Binder" },
          ]}
        />
        <Hint>
          {mode === "binder"
            ? `Optimises one chain against the others. Needs at least ${minResidues} residues.`
            : "Redesigns the selected residues with no binder/target split."}
        </Hint>
      </div>

      {mode === "binder" && (
        <div className="space-y-1.5">
          <FieldHeading>Binder chain</FieldHeading>
          <ChainSelect label="Binder chain" value={binderChainId} chains={chains} onChange={onBinderChainChange} />
          <Hint>{"Every other chain is treated as target context."}</Hint>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <FieldHeading>Residues to redesign</FieldHeading>
          {selectionCount > 0 && (
            <button
              type="button"
              onClick={onUseSelection}
              className="rounded-md px-1.5 py-0.5 text-[9px] font-medium text-[var(--panel-accent)] transition-colors hover:bg-[var(--panel-hover)]"
            >
              {`Use selection (${selectionCount})`}
            </button>
          )}
        </div>
        <input
          aria-label="Residues to redesign"
          value={residues}
          onChange={(event) => onResiduesChange(event.currentTarget.value)}
          placeholder="3, 4, 5-9"
          spellCheck={false}
          className="zatom-field w-full rounded-xl px-3 py-2.5 font-mono text-[10px]"
        />
        <Hint>
          {/* Explain the minimum-residue shortfall that disables binder submission. */}
          {count > 0 && mode === "binder" && count < minResidues
            ? `${count} of ${minResidues} required for binder mode — add ${minResidues - count} more.`
            : count > 0
              ? `${count} entr${count === 1 ? "y" : "ies"} · 1-based positions in the chain`
              : "Select residues in the 3D view, or type 1-based positions."}
        </Hint>
      </div>
    </>
  )
}
