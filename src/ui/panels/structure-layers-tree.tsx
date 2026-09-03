"use client"

/**
 * Persistent structure-layer tree. The document root edits all layers; selecting
 * a child scopes atom selection and insertion to that layer while dimming others.
 */

import { useState } from "react"
import { Copy, Eye, EyeOff, Folder, FolderOpen, Layers, Pencil, Scissors, Target, Trash2 } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import {
  atomBelongsToGroup,
  bioGroupIsDuplicable,
  isBaseGroup,
} from "../../orchestration/slices/structure-groups-slice"
import { useWorkspaceLayers } from "../../host"

export function StructureLayersTree() {
  const structureGroups = useCrystalStore((s) => s.structureGroups)
  const activeGroupId = useCrystalStore((s) => s.activeGroupId)
  const soloGroupId = useCrystalStore((s) => s.soloGroupId)
  const setActiveGroup = useCrystalStore((s) => s.setActiveGroup)
  const toggleGroupVisible = useCrystalStore((s) => s.toggleGroupVisible)
  const toggleSoloGroup = useCrystalStore((s) => s.toggleSoloGroup)
  const renameGroup = useCrystalStore((s) => s.renameGroup)
  const removeGroup = useCrystalStore((s) => s.removeGroup)
  const createGroupFromSelection = useCrystalStore((s) => s.createGroupFromSelection)
  const duplicateGroup = useCrystalStore((s) => s.duplicateGroup)
  const focusOnAtoms = useCrystalStore((s) => s.focusOnAtoms)
  // Layer clicks respect the same auto-focus preference as atom clicks.
  const autoFocusOnAtom = useCrystalStore((s) => s.autoFocusOnAtom)
  const atoms = useCrystalStore((s) => s.atoms)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const bioStructure = useCrystalStore((s) => s.bioStructure)
  const boundFrameRef = useCrystalStore((s) => s.boundFrameRef)
  const { workspaceState } = useWorkspaceLayers()

  // Show the bound Asset frame name; edits write back to that Asset.
  const boundFrame = boundFrameRef
    ? workspaceState.workspaces
        .find((ws) => ws.id === boundFrameRef.workspaceId)
        ?.assets[boundFrameRef.frameId] ?? null
    : null

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")

  // Empty documents have no layers; populated documents always have Base.
  if (structureGroups.length === 0) return null

  const isParentActive = activeGroupId === null
  const hasSelection = selectedAtomIds.size > 0

  const commitRename = (groupId: string) => {
    const name = editingName.trim()
    if (name) renameGroup(groupId, name)
    setEditingId(null)
  }

  // Share one membership result between counts and camera focus.
  const members = (groupId: string) =>
    atoms.filter((a) => atomBelongsToGroup(a, groupId, structureGroups))

  const atomCount = (groupId: string) => members(groupId).length

  // Match duplicateGroup: only single-HET-residue biomolecule layers can duplicate.
  const canDuplicate = (groupId: string) => {
    const members = atoms.filter((a) => atomBelongsToGroup(a, groupId, structureGroups))
    if (members.length === 0) return false
    return bioStructure ? bioGroupIsDuplicable(members, bioStructure) : true
  }

  const extractSelection = () => {
    const created = createGroupFromSelection(`Layer ${structureGroups.length}`)
    if (created) {
      setEditingId(created)
      setEditingName(`Layer ${structureGroups.length - 1}`)
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--panel-text-secondary)",
          }}
        >
          Structure Layers
        </span>
        {boundFrame && (
          <span style={{ fontSize: 9.5, color: "var(--panel-text-tertiary)" }} title="Layers auto-save to this Batch asset">
            saved in batch
          </span>
        )}
      </div>

      {/* Document root. */}
      <button
        type="button"
        onClick={() => {
          setActiveGroup(null)
        }}
        aria-pressed={isParentActive}
        className="zatom-pressable flex w-full items-center gap-2 rounded-lg px-3 py-2"
        style={{
          backgroundColor: isParentActive ? "var(--control-selected-bg)" : "var(--panel-elevated)",
          border: `1px solid ${isParentActive ? "var(--control-selected-border)" : "var(--panel-border)"}`,
        }}
      >
        {isParentActive ? (
          <FolderOpen className="h-3.5 w-3.5" style={{ color: "var(--control-selected-text)" }} />
        ) : (
          <Folder className="h-3.5 w-3.5" style={{ color: "var(--panel-text-secondary)" }} />
        )}
        <span
          className="flex-1 truncate text-left"
          style={{
            fontSize: 12,
            color: isParentActive ? "var(--control-selected-text)" : "var(--panel-text)",
            fontWeight: isParentActive ? 600 : 400,
          }}
        >
          {boundFrame?.label ?? "Composite structure"}
        </span>
        <span style={{ fontSize: 10, color: "var(--panel-text-tertiary)" }}>
          {structureGroups.length} {structureGroups.length === 1 ? "layer" : "layers"} · {atoms.length} atoms
        </span>
      </button>

      {/* Child layers. */}
      <div className="mt-1 space-y-0.5 pl-4">
        {structureGroups.map((group) => {
          const isActive = activeGroupId === group.id
          const isBase = isBaseGroup(structureGroups, group.id)
          const isSoloed = soloGroupId === group.id
          // When solo is active, dim every layer that is not actually visible.
          const effectivelyVisible = soloGroupId === null ? group.visible : isSoloed
          return (
            <div
              key={group.id}
              className="group flex items-center gap-1.5 rounded-lg px-2 py-1.5"
              style={{
                backgroundColor: isActive ? "var(--control-selected-bg)" : "transparent",
                border: `1px solid ${isActive ? "var(--control-selected-border)" : "transparent"}`,
                opacity: effectivelyVisible ? 1 : 0.45,
              }}
            >
              <Layers
                className="h-3 w-3 shrink-0"
                style={{ color: isActive ? "var(--control-selected-text)" : "var(--panel-text-tertiary)" }}
              />
              {editingId === group.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => commitRename(group.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !(e.nativeEvent.isComposing || e.keyCode === 229)) commitRename(group.id)
                    if (e.key === "Escape") setEditingId(null)
                  }}
                  className="zatom-field min-w-0 flex-1 rounded px-1.5 py-0.5"
                  style={{ fontSize: 11 }}
                  aria-label={`Rename layer ${group.name}`}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const nextActive = isActive ? null : group.id
                    setActiveGroup(nextActive)
                    // Focusing a layer requires selecting it rather than deselecting it,
                    // the layer being visible,
                    // and the auto-focus preference remaining enabled.
                    // The shared focusedAtomIds channel then dims other layers
                    // to match the intent of isolating this layer.
                    // Base owns the document structure, so deleting it would delete the document.
                    if (nextActive && effectivelyVisible && autoFocusOnAtom) {
                      const ids = members(group.id).map((a) => a.id)
                      if (ids.length > 0) focusOnAtoms(ids)
                    }
                  }}
                  className="min-w-0 flex-1 truncate text-left"
                  style={{
                    fontSize: 11.5,
                    color: isActive ? "var(--control-selected-text)" : "var(--panel-text-secondary)",
                    fontWeight: isActive ? 600 : 400,
                  }}
                  title={
                    isActive
                      ? "Click to select the whole composite"
                      : autoFocusOnAtom && effectivelyVisible
                        ? `Edit only ${group.name} · flies the camera to it`
                        : `Edit only ${group.name}`
                  }
                >
                  {group.name}
                </button>
              )}
              <span style={{ fontSize: 9, color: "var(--panel-text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                {atomCount(group.id)}
              </span>
              <button
                type="button"
                onClick={() => {
                  toggleSoloGroup(group.id)
                }}
                aria-pressed={isSoloed}
                className="zatom-pressable rounded p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                style={{
                  color: isSoloed ? "var(--control-selected-text)" : "var(--panel-text-tertiary)",
                  opacity: isSoloed ? 1 : undefined,
                }}
                title={isSoloed ? "Exit isolation" : "Isolate this layer"}
                aria-label={`${isSoloed ? "Exit isolation of" : "Isolate"} ${group.name}`}
              >
                <Target className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => {
                  toggleGroupVisible(group.id)
                }}
                className="zatom-pressable rounded p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                style={{ color: "var(--panel-text-tertiary)", opacity: group.visible ? undefined : 1 }}
                title={group.visible ? "Hide layer" : "Show layer"}
                aria-label={`${group.visible ? "Hide" : "Show"} ${group.name}`}
              >
                {group.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
              {(() => {
                const duplicable = canDuplicate(group.id)
                return (
                  <button
                    type="button"
                    disabled={!duplicable}
                    onClick={() => {
                      duplicateGroup(group.id)
                    }}
                    className="zatom-pressable rounded p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed"
                    style={{ color: "var(--panel-text-tertiary)", opacity: duplicable ? undefined : 0.3 }}
                    title={
                      duplicable
                        ? "Duplicate layer (offset alongside)"
                        : "Only single-residue ligand layers can be duplicated"
                    }
                    aria-label={`Duplicate ${group.name}`}
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                )
              })()}
              <button
                type="button"
                onClick={() => {
                  setEditingId(group.id)
                  setEditingName(group.name)
                }}
                className="zatom-pressable rounded p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                style={{ color: "var(--panel-text-tertiary)" }}
                title="Rename layer"
                aria-label={`Rename ${group.name}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
              {/* Extracting a selection creates a reusable structural layer. */}
              {!isBase && (
                <button
                  type="button"
                  onClick={() => {
                    removeGroup(group.id)
                  }}
                  className="zatom-pressable rounded p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  style={{ color: "var(--panel-text-tertiary)" }}
                  title="Delete layer and its atoms"
                  aria-label={`Delete ${group.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* This is the core primitive for decomposing an existing structure. */}
      <button
        type="button"
        onClick={extractSelection}
        disabled={!hasSelection}
        className="zatom-pressable mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5"
        style={{
          border: `1px dashed ${hasSelection ? "var(--panel-border-strong)" : "var(--panel-border)"}`,
          color: hasSelection ? "var(--panel-text-secondary)" : "var(--panel-text-tertiary)",
          fontSize: 11,
          cursor: hasSelection ? "pointer" : "not-allowed",
          opacity: hasSelection ? 1 : 0.6,
        }}
        title={
          hasSelection
            ? bioStructure
              ? "Move the selected residues into a new layer"
              : "Move the selected atoms into a new layer"
            : "Select atoms in the viewport first"
        }
      >
        <Scissors className="h-3 w-3" />
        {hasSelection
          ? `New layer from ${selectedAtomIds.size} selected`
          : "Select atoms to extract a layer"}
      </button>
    </div>
  )
}
