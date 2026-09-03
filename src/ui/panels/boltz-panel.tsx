"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle, Loader2, Sparkles, Square, Trash2, X } from "lucide-react"

import {
  listJobResults,
  type BoltzCandidate,
} from "../../services/boltz-client"
import { useBoltzApiKeyStore } from "../../orchestration/boltzApiKeyStore"
import { decodeBoltzArchive, type BoltzPaeMatrix } from "../../services/boltz-archive"
import { fetchBoltzArtifactBytes } from "../../services/boltz-transport"
import { designScore, landBoltzDesignCandidates } from "../../services/boltz-landing"
import {
  buildAdmeBody,
  buildPredictionBody,
  buildProteinDesignBody,
  buildProteinScreenBody,
  buildSequenceRedesignBody,
  buildSmallMoleculeDesignBody,
  buildSmallMoleculeScreenBody,
  parseSequenceLibrary,
  parseSmilesLibrary,
  buildTemplateBinderDesignBody,
  checkSequenceRedesignRequest,
  checkTemplateBinderRequest,
  BINDER_MODALITIES,
  MAX_PREDICTION_SAMPLES,
  MIN_REDESIGN_RESIDUES,
  type BinderModality,
  type BoltzEntity,
  type DesignMotif,
  type ResidueSelection,
} from "../../services/boltz-requests"
import { getPipeline, isTerminalStatus, type BoltzPipelineId } from "../../services/boltz-pipelines"
import { BoltzExampleGallery } from "./boltz-example-gallery"
import type { BoltzExample } from "../../services/boltz-examples"
import { boltzChainOptions } from "../../services/boltz-structure-input"
import { epitopeFromSelection, primaryEpitope } from "../../services/boltz-epitope"
import { exportTemplateMmcif, templateChainSummaries } from "../../lib/biomolecule/mmcif-export"
import {
  RedesignFields,
  TemplateBinderFields,
  type MotifKind,
  type RedesignMode,
} from "./boltz-template-form"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { useBoltzJobs } from "../../services/useBoltzJobs"
import type { BoltzQueuedJob } from "../../services/boltz-jobs"
import { SlidingSegmented } from "./panel-ui"
import { BoltzPaeHeatmap } from "./boltz-pae-heatmap"

/** Expose only sequence-described target workflows here; library and residue-template workflows use dedicated input shapes. */
/** Use compact modality labels because the segmented control is narrow and the abbreviations are standard. */
const MODALITY_LABELS: Record<BinderModality, string> = {
  custom_protein: "De novo",
  peptide: "Peptide",
  nanobody: "Nanobody",
  antibody: "Antibody",
}

const PANEL_PIPELINES: readonly { value: BoltzPipelineId; label: string }[] = [
  { value: "structure-and-binding", label: "Predict" },
  { value: "protein-design", label: "Binder" },
  { value: "protein-sequence-redesign", label: "Redesign" },
  { value: "small-molecule-design", label: "Ligand" },
  { value: "adme", label: "ADME" },
]

/** Library screening is a source choice within a family rather than another top-level modality. */
function familyTab(id: BoltzPipelineId): BoltzPipelineId {
  if (id === "protein-library-screen") return "protein-design"
  if (id === "small-molecule-library-screen") return "small-molecule-design"
  return id
}

/** Binder source can be generated, redesigned from a mounted chain, or supplied as a library. */
type BinderSource = "de_novo" | "from_structure" | "library"

/** Parse motif ranges separately because motifs may validly contain fewer than four residues. */
function parseLengthPair(value: string): { min: number; max: number } | null {
  const match = value.trim().match(/^(\d+)\.\.(\d+)$/)
  if (!match) return null
  const min = Number(match[1])
  const max = Number(match[2])
  if (min < 1 || max < min || max > 200) return null
  return { min, max }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div className="px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--panel-text-tertiary)]">{children}</div>
}

function cleanSequence(value: string): string {
  return value.replace(/\s/g, "").toUpperCase()
}

/** Parse residue lists and ranges leniently while the user types. */
/** Format residue lists compactly by folding consecutive positions into ranges. */
function formatResidues(residues: readonly number[]): string {
  const parts: string[] = []
  let runStart = residues[0]
  let previous = residues[0]

  for (let index = 1; index <= residues.length; index += 1) {
    const current = residues[index]
    // Flush the current consecutive range at a gap or at the end.
    if (current !== previous + 1) {
      parts.push(runStart === previous ? `${runStart}` : `${runStart}-${previous}`)
      runStart = current
    }
    previous = current
  }

  return parts.join(", ")
}

/** Validate the server-required min..max range before submission. */
function isLengthRange(value: string): boolean {
  const match = value.trim().match(/^(\d+)\.\.(\d+)$/)
  if (!match) return false
  const min = Number(match[1])
  const max = Number(match[2])
  return min >= 4 && max >= min && max <= 200
}

function parseResidues(value: string): number[] {
  const out = new Set<number>()
  for (const part of value.split(/[,\s]+/)) {
    if (!part) continue
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from >= 1 && to >= from && to - from < 1000) {
        for (let r = from; r <= to; r += 1) out.add(r)
      }
      continue
    }
    const single = Number(part)
    if (Number.isInteger(single) && single >= 1) out.add(single)
  }
  return [...out].sort((a, b) => a - b)
}

/** Queue row showing status, progress, cost, and stop/delete actions. */
function JobRow({
  job,
  onStop,
  onRemove,
  onOpen,
  active,
}: {
  job: BoltzQueuedJob
  onStop: () => void
  onRemove: () => void
  onOpen: () => void
  active: boolean
}) {
  const terminal = isTerminalStatus(job.status)
  const failed = job.status === "failed"
  const done = job.status === "completed"

  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[10px] transition-colors"
      style={{
        backgroundColor: active ? "var(--control-selected-bg)" : "var(--panel-elevated)",
        border: `1px solid ${active ? "var(--control-selected-border)" : "transparent"}`,
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!done}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
      >
        {!terminal && <Loader2 className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none text-[var(--panel-accent)]" />}
        {done && <CheckCircle className="h-3 w-3 shrink-0" style={{ color: "var(--status-green)" }} />}
        {failed && <AlertCircle className="h-3 w-3 shrink-0" style={{ color: "var(--status-red)" }} />}
        {job.status === "stopped" && <Square className="h-3 w-3 shrink-0 text-[var(--panel-text-tertiary)]" />}
        <span className="min-w-0 flex-1 truncate text-[var(--panel-text)]">{job.title}</span>
        <span className="shrink-0 font-mono text-[9px] text-[var(--panel-text-tertiary)]">
          {job.progress ?? (done ? "done" : job.status)}
        </span>
      </button>
      {!terminal
        ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={`Stop ${job.title}`}
              className="zatom-pressable shrink-0 rounded p-1 text-[var(--panel-text-tertiary)] hover:text-[var(--status-red)]"
            >
              <Square className="h-3 w-3" />
            </button>
          )
        : (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${job.title}`}
              className="zatom-pressable shrink-0 rounded p-1 text-[var(--panel-text-tertiary)] hover:text-[var(--status-red)]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
    </div>
  )
}

/** Rank candidate lists for triage before users choose which structures to load. */
function CandidateList({
  candidates,
  onLand,
  onInspect,
  busy,
}: {
  candidates: readonly BoltzCandidate[]
  onLand: (selected: readonly BoltzCandidate[]) => void
  onInspect: (candidate: BoltzCandidate) => void
  busy: boolean
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  const ranked = useMemo(
    () => [...candidates].sort((a, b) => designScore(b) - designScore(a)),
    [candidates],
  )

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selected = ranked.filter((candidate) => picked.has(candidate.id))

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <SectionHeading>{ranked.length} candidates</SectionHeading>
        <button
          type="button"
          disabled={selected.length === 0 || busy}
          onClick={() => onLand(selected)}
          className="zatom-pressable rounded-md px-2 py-1 text-[9px] font-semibold disabled:opacity-40"
          style={{ backgroundColor: "var(--control-selected-bg)", color: "var(--control-selected-text)" }}
        >
          {busy ? "Loading…" : `Add ${selected.length || ""} to viewport`}
        </button>
      </div>

      <div className="custom-scrollbar max-h-56 space-y-1 overflow-y-auto">
        {ranked.map((candidate, index) => {
          const score = designScore(candidate)
          const isPicked = picked.has(candidate.id)
          return (
            <div
              key={candidate.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5"
              style={{
                backgroundColor: isPicked ? "var(--control-selected-bg)" : "var(--panel-elevated)",
                border: `1px solid ${isPicked ? "var(--control-selected-border)" : "transparent"}`,
              }}
            >
              <input
                type="checkbox"
                aria-label={`Select candidate ${index + 1}`}
                checked={isPicked}
                onChange={() => toggle(candidate.id)}
                className="h-3 w-3 shrink-0 accent-[var(--panel-accent)]"
              />
              <span className="w-5 shrink-0 font-mono text-[9px] text-[var(--panel-text-tertiary)]">
                {index + 1}
              </span>
              <button
                type="button"
                onClick={() => onInspect(candidate)}
                className="min-w-0 flex-1 truncate text-left font-mono text-[9px] text-[var(--panel-text-secondary)]"
                title={candidate.smiles ?? candidate.sequences?.map((s) => s.value).join(" / ")}
              >
                {candidate.smiles ?? candidate.sequences?.map((s) => s.value).join(" / ") ?? candidate.id}
              </button>
              <span className="shrink-0 font-mono text-[9px] tabular-nums text-[var(--panel-text)]">
                {score > 0 ? score.toFixed(2) : "—"}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function BoltzPanel() {
  // The API key is owned by Functions › Settings; this panel reads the shared store.
  // Updates appear immediately without remounting this panel.
  const apiKey = useBoltzApiKeyStore((state) => state.apiKey)
  const [pipelineId, setPipelineId] = useState<BoltzPipelineId>("structure-and-binding")
  const [sequence, setSequence] = useState("")
  const [ligand, setLigand] = useState("")
  const [epitope, setEpitope] = useState("")

  /** Convert the current 3D selection into epitope residues from the chain with the most hits. */
  const bioStructure = useCrystalStore((state) => state.bioStructure)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  const selectedEpitope = useMemo(
    () => (bioStructure ? primaryEpitope(bioStructure, selectedAtomIds) : null),
    [bioStructure, selectedAtomIds],
  )
  const [units, setUnits] = useState(10)
  /** Protein design requires an explicit binder length range. */
  const [binderLength, setBinderLength] = useState("12..20")
  /** Binder modality selects the backbone prior instead of remaining hard-coded. */
  const [modality, setModality] = useState<BinderModality>("custom_protein")
  /** Keep prediction sample count separate from design units because semantics and limits differ. */
  const [predictionSamples, setPredictionSamples] = useState(1)

  /** Template workflows identify target and binder chains in the exported mmCIF namespace. */
  const [binderSource, setBinderSource] = useState<BinderSource>("de_novo")
  const [templateTargetChain, setTemplateTargetChain] = useState("")
  const [templateBinderChain, setTemplateBinderChain] = useState("")
  const [motifKind, setMotifKind] = useState<MotifKind>("replacement")
  const [motifStart, setMotifStart] = useState("")
  const [motifEnd, setMotifEnd] = useState("")
  const [motifLength, setMotifLength] = useState("5..8")
  /** Both screening workflows share one line-oriented candidate library. */
  const [library, setLibrary] = useState("")
  const [redesignMode, setRedesignMode] = useState<RedesignMode>("generic")
  const [redesignChain, setRedesignChain] = useState("")
  const [redesignResidues, setRedesignResidues] = useState("")

  const [notice, setNotice] = useState<{ kind: "ok" | "error"; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Hold the preflight estimate until the user confirms its cost.
  // Never submit an expensive job before cost confirmation.
  const [pendingCost, setPendingCost] = useState<{ usd: number; body: unknown; title: string } | null>(null)

  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<readonly BoltzCandidate[]>([])
  const [pae, setPae] = useState<BoltzPaeMatrix | null>(null)

  const { jobs, estimate, submit, stop, remove } = useBoltzJobs(apiKey)

  const pipeline = getPipeline(pipelineId)
  /** Clamp shared units to the active workflow limits before preflight and submission. */
  const effectiveUnits = Math.max(units, pipeline.minUnits ?? 1)
  const cleaned = cleanSequence(sequence)
  // Count unknown residues from the final submitted sequence.
  const unknownInSequence = cleaned.split("").filter((symbol) => symbol === "X").length

  /** Polymer chains available for template workflows. */
  const templateChains = useMemo(
    () => (bioStructure ? templateChainSummaries(bioStructure) : []),
    [bioStructure],
  )
  /** Mounted protein chains available for one-click sequence and library filling. */
  const chainOptions = useMemo(
    () => (bioStructure ? boltzChainOptions(bioStructure) : []),
    [bioStructure],
  )
  /** Track source chain ID explicitly because homologous chains can share identical sequences. */
  const [filledChainId, setFilledChainId] = useState<string | null>(null)
  const filledChain = chainOptions.find((chain) => chain.chainId === filledChainId)
  // Clear source provenance after manual sequence edits.
  const filledFromChain = filledChain !== undefined && filledChain.sequence === cleaned
  const filledChainGap = filledFromChain ? filledChain.gapCount : 0

  // Template workflows read selected chains rather than the pasted sequence field.
  const templateBinderMode = pipelineId === "protein-design" && binderSource === "from_structure"
  const redesignPipeline = pipelineId === "protein-sequence-redesign"
  const structuralMode = templateBinderMode || redesignPipeline

  /** When the structure changes, default to its longest target chain and next-longest binder chain. */
  useEffect(() => {
    if (templateChains.length === 0) return
    const byLength = [...templateChains].sort((a, b) => b.length - a.length)
    const ids = new Set(templateChains.map((chain) => chain.chainId))
    setTemplateTargetChain((current) => (ids.has(current) ? current : byLength[0].chainId))
    setTemplateBinderChain((current) =>
      ids.has(current) ? current : (byLength[1] ?? byLength[0]).chainId,
    )
    setRedesignChain((current) => (ids.has(current) ? current : byLength[0].chainId))
  }, [templateChains])

  /** Selected binder-chain range available for motif filling. */
  const selectionOnChain = useCallback(
    (chainId: string) => {
      if (!bioStructure) return null
      const group = epitopeFromSelection(bioStructure, selectedAtomIds).find(
        (entry) => entry.chainId === chainId,
      )
      if (group === undefined || group.positions.length === 0) return null
      return {
        start: group.positions[0],
        end: group.positions[group.positions.length - 1],
        count: group.positions.length,
        positions: group.positions,
      }
    },
    [bioStructure, selectedAtomIds],
  )

  const binderChainSelection = useMemo(
    () => (templateBinderMode ? selectionOnChain(templateBinderChain) : null),
    [selectionOnChain, templateBinderChain, templateBinderMode],
  )
  const redesignSelection = useMemo(
    () => (redesignPipeline ? selectionOnChain(redesignChain) : null),
    [redesignChain, redesignPipeline, selectionOnChain],
  )

  // Screening keeps the pasted target but takes candidates from the supplied library.
  const proteinScreen = pipelineId === "protein-library-screen"
  const ligandScreen = pipelineId === "small-molecule-library-screen"
  const screenMode = proteinScreen || ligandScreen
  // Protein and SMILES libraries require different parsers.
  const libraryEntries = proteinScreen
    ? parseSequenceLibrary(library)
    : ligandScreen
      ? parseSmilesLibrary(library)
      : []

  const needsSequence = !structuralMode && pipelineId !== "adme"
  const needsLigand = pipelineId === "adme"

  /** Template motifs require both a valid position and length range. */
  const motifStartValue = Number(motifStart.trim())
  const motifEndValue = Number(motifEnd.trim())
  // Positions are one-based and must not exceed the chain length.
  // Reject out-of-range positions locally rather than waiting for a server error.
  const motifChainLength = templateChains.find((c) => c.chainId === templateBinderChain)?.length ?? 0
  const motifWithinChain = motifChainLength > 0
    && motifStartValue <= motifChainLength
    && (motifKind === "insertion" || motifEndValue <= motifChainLength)
  const motifReady = Number.isInteger(motifStartValue)
    && motifStartValue >= 1
    && motifWithinChain
    && parseLengthPair(motifLength) !== null
    && (motifKind === "insertion" || (Number.isInteger(motifEndValue) && motifEndValue >= motifStartValue))

  const canSubmit = Boolean(apiKey)
    && (needsSequence ? cleaned.length > 0 : true)
    && (needsLigand ? ligand.trim().length > 0 : true)
    && (structuralMode ? templateChains.length > 0 : true)
    && (templateBinderMode ? templateTargetChain !== templateBinderChain && motifReady : true)
    // Binder redesign enforces MIN_REDESIGN_RESIDUES before request validation.
    // Fail early instead of deferring the same error to checkSequenceRedesignRequest.
    && (redesignPipeline
      ? parseResidues(redesignResidues).length >= (redesignMode === "binder" ? MIN_REDESIGN_RESIDUES : 1)
      : true)
    && (pipelineId === "protein-design" && !templateBinderMode ? isLengthRange(binderLength) : true)
    // Reject empty screening libraries before charging for a meaningless job.
    && (screenMode ? libraryEntries.length > 0 : true)
    && !busy

  const entities = useCallback((): BoltzEntity[] => {
    const list: BoltzEntity[] = [{ type: "protein", value: cleaned, chain_ids: ["A"] }]
    if (ligand.trim()) list.push({ type: "ligand_smiles", value: ligand.trim(), chain_ids: ["B"] })
    return list
  }, [cleaned, ligand])

  /** Build request bodies in boltz-requests; this panel only selects parameters. */
  const buildBody = useCallback((): { body: unknown; title: string } => {
    const residues = parseResidues(epitope)
    const selection: ResidueSelection | undefined = residues.length > 0 ? { A: residues } : undefined

    if (pipelineId === "adme") {
      return {
        body: buildAdmeBody({ smiles: [ligand.trim()] }),
        title: `ADME · ${ligand.trim().slice(0, 18)}`,
      }
    }
    if (pipelineId === "structure-and-binding") {
      return {
        body: buildPredictionBody({
          entities: entities(),
          // Request affinity only when a ligand is present.
          ...(ligand.trim() ? { binderChainId: "B" } : {}),
          // Use the supported prediction sampling range up to ten.
          numSamples: predictionSamples,
        }),
        title: `Predict ×${predictionSamples} · ${cleaned.length} aa${ligand.trim() ? " + ligand" : ""}`,
      }
    }
    if (structuralMode) {
      // Keep a defensive structure guard because preflight also calls this builder.
      if (!bioStructure) throw new Error("Load a structure first — template design needs one.")

      if (templateBinderMode) {
        const length = parseLengthPair(motifLength)
        if (length === null) throw new Error("Segment length must be min..max, for example 5..8.")
        const motif: DesignMotif = motifKind === "insertion"
          ? { type: "insertion", after: motifStartValue, minLength: length.min, maxLength: length.max }
          : {
              type: "replacement",
              start: motifStartValue,
              end: motifEndValue,
              minLength: length.min,
              maxLength: length.max,
            }

        // Export only target and binder template chains.
        // Extra chains would slow modeling and may alter the interface.
        const request = {
          templateCif: exportTemplateMmcif(bioStructure, {
            chains: [templateTargetChain, templateBinderChain],
          }),
          targetChainId: templateTargetChain,
          binderChainId: templateBinderChain,
          motifs: [motif],
          numProteins: effectiveUnits,
          modality,
          ...(residues.length > 0 ? { epitopeResidues: residues } : {}),
        }
        const problem = checkTemplateBinderRequest(request)
        if (problem) throw new Error(problem)
        return {
          body: buildTemplateBinderDesignBody(request),
          title: `Template ${motifKind === "insertion" ? "insert" : "graft"} ×${effectiveUnits} · ${templateBinderChain}→${templateTargetChain}`,
        }
      }

      const positions = parseResidues(redesignResidues)
      // Sequence redesign exports every polymer chain with matching entity declarations.
      const request = {
        structureCif: exportTemplateMmcif(bioStructure),
        numProteins: effectiveUnits,
        mode: redesignMode,
        chains: templateChains.map((chain) => ({
          chainId: chain.chainId,
          ...(redesignMode === "binder"
            ? { role: chain.chainId === redesignChain ? ("binder" as const) : ("target" as const) }
            : {}),
          ...(chain.chainId === redesignChain ? { residues: positions } : {}),
        })),
      }
      const problem = checkSequenceRedesignRequest(request)
      if (problem) throw new Error(problem)
      return {
        body: buildSequenceRedesignBody(request),
        title: `Redesign ×${effectiveUnits} · ${positions.length} res on ${redesignChain}`,
      }
    }

    if (proteinScreen) {
      return {
        body: buildProteinScreenBody({
          targetEntities: [{ type: "protein", value: cleaned, chain_ids: ["A"] }],
          sequences: libraryEntries,
          candidateChainId: "B",
        }),
        title: `Screen ${libraryEntries.length} proteins · ${cleaned.length} aa target`,
      }
    }
    if (ligandScreen) {
      return {
        body: buildSmallMoleculeScreenBody({
          targetEntities: [{ type: "protein", value: cleaned, chain_ids: ["A"] }],
          smiles: libraryEntries,
          // Pocket residues optionally constrain scoring to a surface region.
          ...(selection ? { pocketResidues: selection, ligandChainId: "L" } : {}),
        }),
        title: `Screen ${libraryEntries.length} molecules · ${cleaned.length} aa target`,
      }
    }

    if (pipelineId === "protein-design") {
      return {
        body: buildProteinDesignBody({
          targetEntities: [{ type: "protein", value: cleaned, chain_ids: ["A"] }],
          numProteins: effectiveUnits,
          ...(selection ? { epitopeResidues: selection } : {}),
          binderLengthRange: binderLength.trim(),
          binderChainId: "B",
          modality,
        }),
        title: `${MODALITY_LABELS[modality]} ×${effectiveUnits} · ${binderLength.trim()} aa`,
      }
    }
    return {
      body: buildSmallMoleculeDesignBody({
        targetEntities: [{ type: "protein", value: cleaned, chain_ids: ["A"] }],
        numMolecules: effectiveUnits,
        ...(selection ? { pocketResidues: selection, designedChainId: "L" } : {}),
      }),
      title: `Ligand ×${effectiveUnits} · ${cleaned.length} aa`,
    }
  }, [
    binderLength,
    bioStructure,
    cleaned,
    entities,
    epitope,
    libraryEntries,
    ligand,
    ligandScreen,
    modality,
    motifEndValue,
    motifKind,
    motifLength,
    motifStartValue,
    pipelineId,
    predictionSamples,
    proteinScreen,
    redesignChain,
    redesignMode,
    redesignResidues,
    structuralMode,
    templateBinderMode,
    templateBinderChain,
    templateChains,
    templateTargetChain,
    effectiveUnits,
  ])

  /** Run free cost preflight first so validation errors are caught before payment. */
  const requestEstimate = async () => {
    setNotice(null)
    setBusy(true)
    try {
      const { body, title } = buildBody()
      const usd = await estimate({ pipelineId, body })
      setPendingCost({ usd, body, title })
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Cost estimate failed." })
    } finally {
      setBusy(false)
    }
  }

  /** Submit only after explicit cost confirmation. */
  const confirmSubmit = async () => {
    if (!pendingCost) return
    const { body, title, usd } = pendingCost
    setPendingCost(null)
    await submit({ pipelineId, body, title, estimatedCostUsd: usd })
    setNotice({ kind: "ok", message: `Submitted — it keeps running if you reload.` })
  }

  /** Open completed jobs by loading candidates or decoding prediction output and PAE. */
  const openJob = async (job: BoltzQueuedJob) => {
    if (!job.remoteId) return
    setOpenJobId(job.localId)
    setCandidates([])
    setPae(null)
    setNotice(null)
    setBusy(true)
    try {
      const shape = getPipeline(job.pipelineId).resultShape
      if (shape === "paged") {
        const results = await listJobResults(apiKey, job.pipelineId, job.remoteId)
        setCandidates(results)
        if (results.length === 0) setNotice({ kind: "error", message: "Job returned no candidates." })
      } else {
        setNotice({ kind: "ok", message: "Use “Add to viewport” to load the predicted structure." })
      }
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not load results." })
    } finally {
      setBusy(false)
    }
  }

  /** Download and decode the selected candidate archive for its PAE heatmap. */
  const inspectCandidate = async (candidate: BoltzCandidate) => {
    const archive = candidate.artifacts?.archive
    if (!archive) {
      setNotice({ kind: "error", message: "This candidate has no archive to inspect." })
      return
    }
    setBusy(true)
    setPae(null)
    try {
      const bytes = await fetchBoltzArtifactBytes(archive.url)
      const decoded = await decodeBoltzArchive(bytes)
      const first = Object.values(decoded.pae)[0]
      if (!first) {
        setNotice({ kind: "error", message: "Archive contains no PAE matrix." })
        return
      }
      setPae(first)
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not decode archive." })
    } finally {
      setBusy(false)
    }
  }

  const landCandidates = async (selected: readonly BoltzCandidate[]) => {
    setBusy(true)
    try {
      const { landed, skipped } = await landBoltzDesignCandidates(selected)
      setNotice({
        kind: "ok",
        message: `${landed} added as layer${landed === 1 ? "" : "s"}${skipped > 0 ? ` · ${skipped} skipped` : ""}`,
      })
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not add candidates." })
    } finally {
      setBusy(false)
    }
  }

  const openJobRecord = jobs.find((job) => job.localId === openJobId) ?? null

  // Clear details when their job is deleted.
  useEffect(() => {
    if (openJobId && !jobs.some((job) => job.localId === openJobId)) {
      setOpenJobId(null)
      setCandidates([])
      setPae(null)
    }
  }, [jobs, openJobId])

  /** Reset all related fields before applying an example so stale inputs cannot mix into a paid run. */
  const fillFromExample = (example: BoltzExample): void => {
    const form = example.form
    setPipelineId(example.pipelineId)
    setSequence(form.sequence ?? "")
    setLigand(form.ligand ?? "")
    setEpitope(form.epitope ?? "")
    setLibrary(form.library ?? "")
    setUnits(form.units ?? 10)
    setPredictionSamples(form.predictionSamples ?? 1)
    setBinderSource(form.binderSource ?? "de_novo")
    setBinderLength(form.binderLength ?? "12..20")
    setRedesignMode(form.redesignMode ?? "generic")
    setRedesignChain(form.redesignChain ?? "")
    setRedesignResidues(form.redesignResidues ?? "")
    // Discard estimates and notices from the previous example.
    setPendingCost(null)
    setNotice({
      kind: "ok",
      message: form.structureAsset
        ? `Loaded "${example.title}". This case needs a structure input — load ${form.structureAsset} before estimating cost.`
        : `Loaded "${example.title}". Ready to estimate cost.`,
    })
  }

  return (
    <div className="space-y-3">
      <SlidingSegmented
        options={PANEL_PIPELINES}
        value={familyTab(pipelineId)}
        onChange={(next) => {
          // Selecting a family returns to its default design workflow.
          // Screening must be reselected as the source instead of persisting invisibly.
          setPipelineId(next)
          setBinderSource(next === "protein-design" ? "de_novo" : binderSource)
          // Clear libraries when crossing families because protein and SMILES syntax differ.
          // Preserve library input only when switching within the same family.
          if (familyTab(pipelineId) !== next) setLibrary("")
          setPendingCost(null)
          setNotice(null)
        }}
        ariaLabel="Boltz pipeline"
      />

      <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
        {pipeline.summary}
      </p>


      <BoltzExampleGallery onFillForm={fillFromExample} />

      {(pipelineId === "protein-design" || proteinScreen) && (
        <div className="space-y-1.5">
          <SectionHeading>Binder source</SectionHeading>
          <SlidingSegmented
            semantics="tabs"
            ariaLabel="Binder source"
            value={binderSource}
            onChange={(next) => {
              const source = next as BinderSource
              setBinderSource(source)
              // The source choice determines design versus library-screen pipeline.
              setPipelineId(source === "library" ? "protein-library-screen" : "protein-design")
              setPendingCost(null)
              setNotice(null)
            }}
            options={[
              { value: "de_novo", label: "De novo" },
              { value: "from_structure", label: "Structure" },
              { value: "library", label: "Library" },
            ]}
          />
          <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
            {binderSource === "de_novo"
              ? "Generate a new backbone against a pasted target sequence."
              : binderSource === "from_structure"
                ? "Keep an existing chain's backbone and redesign part of it."
                : "Score candidates you already have — no new backbones are generated."}
          </p>
        </div>
      )}

      {/* Explain when template workflows have no mounted structure instead of silently disabling them. */}
      {structuralMode && templateChains.length === 0 && (
        <p
          className="rounded-lg px-3 py-2.5 text-[10px] leading-relaxed"
          style={{ backgroundColor: "var(--panel-elevated)", color: "var(--panel-text-secondary)" }}
        >
          Load a structure into the viewport first — this mode designs on top of an existing backbone.
        </p>
      )}

      {templateBinderMode && templateChains.length > 0 && (
        <TemplateBinderFields
          chains={templateChains}
          targetChainId={templateTargetChain}
          binderChainId={templateBinderChain}
          motifKind={motifKind}
          motifStart={motifStart}
          motifEnd={motifEnd}
          motifLength={motifLength}
          selectionRange={binderChainSelection}
          onTargetChainChange={setTemplateTargetChain}
          onBinderChainChange={setTemplateBinderChain}
          onMotifKindChange={setMotifKind}
          onMotifStartChange={setMotifStart}
          onMotifEndChange={setMotifEnd}
          onMotifLengthChange={setMotifLength}
          onUseSelection={() => {
            if (!binderChainSelection) return
            // Insertion occurs after the selected range, so anchor at its final position.
            // Using the range start would insert inside the selected motif.
            setMotifStart(String(
              motifKind === "insertion" ? binderChainSelection.end : binderChainSelection.start,
            ))
            setMotifEnd(String(binderChainSelection.end))
          }}
        />
      )}

      {redesignPipeline && templateChains.length > 0 && (
        <RedesignFields
          chains={templateChains}
          mode={redesignMode}
          binderChainId={redesignChain}
          residues={redesignResidues}
          selectionCount={redesignSelection?.count ?? 0}
          minResidues={MIN_REDESIGN_RESIDUES}
          onModeChange={setRedesignMode}
          onBinderChainChange={setRedesignChain}
          onResiduesChange={setRedesignResidues}
          onUseSelection={() => {
            if (!redesignSelection) return
            setRedesignResidues(formatResidues(redesignSelection.positions))
          }}
        />
      )}

      {(pipelineId === "small-molecule-design" || ligandScreen) && (
        <div className="space-y-1.5">
          <SectionHeading>Ligand source</SectionHeading>
          <SlidingSegmented
            semantics="tabs"
            ariaLabel="Ligand source"
            value={ligandScreen ? "library" : "design"}
            onChange={(next) => {
              setPipelineId(next === "library" ? "small-molecule-library-screen" : "small-molecule-design")
              setPendingCost(null)
              setNotice(null)
            }}
            options={[
              { value: "design", label: "Design" },
              { value: "library", label: "Library" },
            ]}
          />
          <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
            {ligandScreen
              ? "Score molecules you already have — no new ones are generated."
              : "Generate new molecules against the target pocket."}
          </p>
        </div>
      )}

      {needsSequence && (
        <div className="space-y-1.5">
          <SectionHeading>Target sequence</SectionHeading>
          {/* Fill inputs directly from mounted chains when available. */}
          {chainOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-0.5">
              <span className="text-[9px] text-[var(--panel-text-tertiary)]">From viewport</span>
              {chainOptions.map((chain) => {
                const active = filledFromChain && chain.chainId === filledChainId
                return (
                  <button
                    key={chain.chainId}
                    type="button"
                    onClick={() => {
                      setSequence(chain.sequence)
                      setFilledChainId(chain.chainId)
                      // Clear epitope positions when the target chain changes.
                      setEpitope("")
                      setPendingCost(null)
                      setNotice(null)
                    }}
                    aria-pressed={active}
                    title={`Chain ${chain.chainId} · ${chain.length} aa${
                      chain.gapCount > 0 ? ` · ${chain.gapCount} unresolved residues` : ""
                    }`}
                    className="zatom-pressable rounded-lg border px-2 py-1 font-mono text-[9px] transition-colors"
                    style={active
                      ? {
                          background: "var(--panel-accent-bg)",
                          borderColor: "var(--panel-accent-border)",
                          color: "var(--panel-accent)",
                        }
                      : {
                          background: "var(--panel-elevated)",
                          borderColor: "var(--panel-border)",
                          color: "var(--panel-text-secondary)",
                        }}
                  >
                    {`${chain.chainId === "" ? "(blank)" : chain.chainId} · ${chain.length}`}
                  </button>
                )
              })}
            </div>
          )}
          <textarea
            aria-label="Target protein sequence"
            value={sequence}
            onChange={(event) => setSequence(event.currentTarget.value)}
            placeholder="MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDAT..."
            rows={4}
            spellCheck={false}
            className="zatom-field custom-scrollbar w-full resize-none rounded-xl px-3 py-2.5 font-mono text-[10px] leading-relaxed"
          />
          <p className="px-1 font-mono text-[9px] text-[var(--panel-text-tertiary)]">
            {/* Display the source chain separately from normalized request chain A. */}
            {filledFromChain
              ? `${cleaned.length} residues · from chain ${filledChainId} · submitted as A`
              : `${cleaned.length} residues · chain A`}
          </p>
          {/* Warn that unknown X residues are accepted but folded without a validation error. */}
          {/* Pasted sequences are the only source that can retain X after chain normalization. */}
          {unknownInSequence > 0 && (
            <p
              role="alert"
              className="px-1 text-[9px] leading-relaxed"
              style={{ color: "var(--status-amber)" }}
            >
              {`${unknownInSequence} unknown residues (X) — the API accepts these and folds them without an identity.`}
            </p>
          )}
          {/* Warn when filling a chain with unresolved residues because its sequence closes crystal gaps. */}
          {filledChainGap > 0 && (
            <p className="px-1 text-[9px] leading-relaxed" style={{ color: "var(--status-amber)" }}>
              {`Chain ${filledChainId} has ${filledChainGap} unresolved residues — this sequence closes those gaps.`}
            </p>
          )}
        </div>
      )}

      {screenMode && (
        <div className="space-y-1.5">
          <SectionHeading>{proteinScreen ? "Candidate sequences" : "Molecule library"}</SectionHeading>
          {/* Protein candidate libraries can use mounted chains; HETATM molecules cannot provide equivalent SMILES. */}
          {proteinScreen && chainOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-0.5">
              <span className="text-[9px] text-[var(--panel-text-tertiary)]">Add chain</span>
              {chainOptions.map((chain) => (
                <button
                  key={chain.chainId}
                  type="button"
                  onClick={() => {
                    // Append mounted chains because a candidate library is inherently multi-entry.
                    setLibrary((current) => (current.trim() === "" ? chain.sequence : `${current.replace(/\s*$/, "")}\n${chain.sequence}`))
                    setPendingCost(null)
                    setNotice(null)
                  }}
                  title={`Append chain ${chain.chainId} · ${chain.length} aa`}
                  className="zatom-pressable rounded-lg border px-2 py-1 font-mono text-[9px] transition-colors"
                  style={{
                    background: "var(--panel-elevated)",
                    borderColor: "var(--panel-border)",
                    color: "var(--panel-text-secondary)",
                  }}
                >
                  {`+ ${chain.chainId === "" ? "(blank)" : chain.chainId} · ${chain.length}`}
                </button>
              ))}
            </div>
          )}
          <textarea
            aria-label={proteinScreen ? "Candidate protein sequences" : "Molecule SMILES library"}
            value={library}
            onChange={(event) => setLibrary(event.currentTarget.value)}
            placeholder={proteinScreen
              ? "MKTAYIVKSHFSRQ\nMKTAYIAKQRQIS"
              : "CCO\nCC(=O)Oc1ccccc1C(=O)O"}
            rows={5}
            spellCheck={false}
            className="zatom-field custom-scrollbar w-full resize-none rounded-xl px-3 py-2.5 font-mono text-[10px] leading-relaxed"
          />
          <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
            {libraryEntries.length > 0
              // Echo candidate count because it is the billing unit.
              ? `${libraryEntries.length} ${proteinScreen ? "sequences" : "molecules"} · one per line${
                  proteinScreen ? " · FASTA headers ignored" : ""
                }`
              : proteinScreen
                ? "One sequence per line. FASTA headers are ignored."
                : "One SMILES per line. Case is preserved — lowercase means aromatic."}
          </p>
        </div>
      )}

      {(pipelineId === "structure-and-binding" || pipelineId === "adme") && (
        <div className="space-y-1.5">
          <SectionHeading>{pipelineId === "adme" ? "Molecule SMILES" : "Ligand SMILES (optional)"}</SectionHeading>
          <input
            aria-label="Ligand SMILES"
            value={ligand}
            onChange={(event) => setLigand(event.currentTarget.value)}
            placeholder="CC(=O)Oc1ccccc1C(=O)O"
            spellCheck={false}
            className="zatom-field w-full rounded-xl px-3 py-2.5 font-mono text-[10px]"
          />
          {pipelineId === "structure-and-binding" && (
            <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
              Adding a ligand also scores binding affinity.
            </p>
          )}
        </div>
      )}

      {pipelineId === "structure-and-binding" && (
        <div className="space-y-1.5">
          <SectionHeading>Samples</SectionHeading>
          <div className="flex items-center gap-2">
            <input
              aria-label="Number of diffusion samples"
              type="range"
              min={1}
              // Cap prediction samples at the server maximum of ten.
              max={MAX_PREDICTION_SAMPLES}
              step={1}
              value={predictionSamples}
              onChange={(event) => setPredictionSamples(Number(event.currentTarget.value))}
              className="h-1 flex-1 accent-[var(--panel-accent)]"
            />
            <span className="w-8 text-right font-mono text-[10px] text-[var(--panel-text)]">
              {predictionSamples}
            </span>
          </div>
          <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
            {predictionSamples === 1
              ? "Single structure. Raise to compare alternative conformations."
              : `${predictionSamples} independent samples, ranked by confidence.`}
          </p>
        </div>
      )}

      {/* Ligand screening count is determined by library length, not the design Count control. */}
      {(pipelineId === "protein-design" || pipelineId === "small-molecule-design" || redesignPipeline || ligandScreen) && (
        <>
          {/* Redesign sites are the selected residues themselves, not an epitope. */}
          {!redesignPipeline && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <SectionHeading>
                {pipelineId === "protein-design" ? "Epitope residues" : "Pocket residues"}
              </SectionHeading>
              {selectedEpitope && (
                <button
                  type="button"
                  // Fill sequence positions rather than author residue numbers.
                  // Submitted sequence strings have no author numbering.
                  // Author numbers only coincide for gapless chains starting at one.
                  onClick={() => setEpitope(formatResidues(selectedEpitope.positions))}
                  className="rounded-md px-1.5 py-0.5 text-[9px] font-medium text-[var(--panel-accent)] transition-colors hover:bg-[var(--panel-hover)]"
                >
                  {`Use selection (${selectedEpitope.positions.length})`}
                </button>
              )}
            </div>
            <input
              aria-label={pipelineId === "protein-design" ? "Epitope residues" : "Pocket residues"}
              value={epitope}
              onChange={(event) => setEpitope(event.currentTarget.value)}
              placeholder="10, 11, 15-18"
              spellCheck={false}
              className="zatom-field w-full rounded-xl px-3 py-2.5 font-mono text-[10px]"
            />
            <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
              {parseResidues(epitope).length > 0
                // Epitope positions are relative to the target chain.
                // Reject selections from another chain instead of silently reinterpreting their numbers.
                ? selectedEpitope && selectedEpitope.chainId !== "A"
                  ? `${parseResidues(epitope).length} positions · selection came from chain ${selectedEpitope.chainId}, applied to the target sequence`
                  : `${parseResidues(epitope).length} positions in the target sequence · 1-based`
                : "Leave empty to let Boltz choose the site, or select residues in the 3D view."}
            </p>
          </div>
          )}

          {pipelineId === "protein-design" && (
            <div className="space-y-1.5">
              <SectionHeading>Modality</SectionHeading>
              <SlidingSegmented
                semantics="tabs"
                ariaLabel="Binder modality"
                value={modality}
                onChange={(next) => setModality(next as BinderModality)}
                options={BINDER_MODALITIES.map((value) => ({ value, label: MODALITY_LABELS[value] }))}
              />
              <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
                {modality === "custom_protein"
                  ? "Free backbone, no scaffold prior."
                  : `Generated on a ${MODALITY_LABELS[modality].toLowerCase()} scaffold.`}
              </p>
            </div>
          )}

          {/* Template motif range already determines binder length. */}
          {pipelineId === "protein-design" && !templateBinderMode && (
            <div className="space-y-1.5">
              <SectionHeading>Binder length</SectionHeading>
              <input
                aria-label="Binder length range"
                value={binderLength}
                onChange={(event) => setBinderLength(event.currentTarget.value)}
                placeholder="12..20"
                spellCheck={false}
                className="zatom-field w-full rounded-xl px-3 py-2.5 font-mono text-[10px]"
              />
              <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
                {isLengthRange(binderLength)
                  ? "Residue count range for the designed binder."
                  : "Use min..max, for example 12..20."}
              </p>
            </div>
          )}

          {/* Screening count is the library length, so a separate Count would conflict. */}
          {!screenMode && (
          <div className="space-y-1.5">
            <SectionHeading>Count</SectionHeading>
            <div className="flex items-center gap-2">
              <input
                aria-label="Number of designs"
                type="range"
                min={pipeline.minUnits ?? 1}
                max={100}
                step={1}
                value={effectiveUnits}
                onChange={(event) => setUnits(Number(event.currentTarget.value))}
                className="h-1 flex-1 accent-[var(--panel-accent)]"
              />
              <span className="w-8 text-right font-mono text-[10px] text-[var(--panel-text)]">{effectiveUnits}</span>
            </div>
            {pipeline.minUnits !== undefined && (
              <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
                Minimum {pipeline.minUnits} per job.
              </p>
            )}
          </div>
          )}
        </>
      )}

      {/* Cost confirmation prevents submission before the amount is visible. */}
      {pendingCost
        ? (
            <div
              className="space-y-2 rounded-lg px-3 py-2.5"
              style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] text-[var(--panel-text-secondary)]">Estimated cost</span>
                <span className="font-mono text-[13px] font-semibold text-[var(--panel-text)]">
                  ${pendingCost.usd.toFixed(2)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void confirmSubmit()}
                  className="zatom-pressable flex-1 rounded-lg py-2 text-[10px] font-semibold"
                  style={{
                    backgroundColor: "var(--control-selected-bg)",
                    border: "1px solid var(--control-selected-border)",
                    color: "var(--control-selected-text)",
                  }}
                >
                  Run job
                </button>
                <button
                  type="button"
                  onClick={() => setPendingCost(null)}
                  aria-label="Cancel"
                  className="zatom-pressable rounded-lg px-3 py-2 text-[var(--panel-text-secondary)]"
                  style={{ border: "1px solid var(--panel-border)" }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        : (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void requestEstimate()}
              className="zatom-pressable flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[11px] font-semibold transition-colors duration-150 ease-out disabled:opacity-40"
              style={{
                backgroundColor: "var(--control-selected-bg)",
                border: "1px solid var(--control-selected-border)",
                color: "var(--control-selected-text)",
              }}
            >
              {busy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                : <Sparkles className="h-3.5 w-3.5" />}
              {/* Point users to the settings panel now that API-key input lives there. */}
              {apiKey ? "Check cost" : "Add a key in Settings"}
            </button>
          )}

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[11px]"
          style={{
            backgroundColor: notice.kind === "error" ? "var(--status-red-bg)" : "var(--status-green-bg)",
            color: notice.kind === "error" ? "var(--status-red)" : "var(--status-green)",
          }}
        >
          {notice.kind === "error"
            ? <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            : <CheckCircle className="mt-px h-3.5 w-3.5 shrink-0" />}
          <span>{notice.message}</span>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeading>Jobs</SectionHeading>
          <div className="custom-scrollbar max-h-40 space-y-1 overflow-y-auto">
            {jobs.map((job) => (
              <JobRow
                key={job.localId}
                job={job}
                active={job.localId === openJobId}
                onStop={() => void stop(job.localId)}
                onRemove={() => remove(job.localId)}
                onOpen={() => void openJob(job)}
              />
            ))}
          </div>
        </div>
      )}

      {openJobRecord?.error && (
        <p className="px-1 text-[9px] leading-relaxed" style={{ color: "var(--status-red)" }}>
          {openJobRecord.error}
        </p>
      )}

      {candidates.length > 0 && (
        <CandidateList
          candidates={candidates}
          busy={busy}
          onLand={(selected) => void landCandidates(selected)}
          onInspect={(candidate) => void inspectCandidate(candidate)}
        />
      )}

      {pae && (
        <div className="space-y-1.5">
          <SectionHeading>Predicted aligned error</SectionHeading>
          <BoltzPaeHeatmap matrix={pae} />
        </div>
      )}
    </div>
  )
}
