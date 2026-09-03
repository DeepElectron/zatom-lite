"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { importUnifiedStructureFile, UNIFIED_IMPORT_ACCEPT } from '../../../services/unified-file-import'
import { useStructureAssetRecorder } from '../../structure-asset-context'

const EMPTY_PROMPT = 'Import a file to get started.'

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') === true
}

export function EmptyState() {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'error'; message: string } | null>(null)
  const recordStructureAsset = useStructureAssetRecorder()

  const handleFile = useCallback(async (file: File) => {
    setFeedback(null)
    setIsImporting(true)
    try {
      const result = await importUnifiedStructureFile(file)
      if (result.success) {
        recordStructureAsset(file.name, 'import')
      }
      else setFeedback({ type: 'error', message: result.error })
    } catch (error) {
      console.warn('[file-import]', error)
      setFeedback({ type: 'error', message: 'This file could not be imported. Check its format and try again.' })
    } finally {
      setIsImporting(false)
    }
  }, [recordStructureAsset])

  useEffect(() => {
    const insideViewport = (event: DragEvent) => {
      const bounds = rootRef.current?.getBoundingClientRect()
      return !!bounds
        && event.clientX >= bounds.left && event.clientX <= bounds.right
        && event.clientY >= bounds.top && event.clientY <= bounds.bottom
    }
    const onDragOver = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event) || !insideViewport(event)) {
        setIsDragging(false)
        return
      }
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setIsDragging(true)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      setIsDragging(false)
      if (event.defaultPrevented || !insideViewport(event)) return
      event.preventDefault()
      const file = event.dataTransfer?.files[0]
      if (file) void handleFile(file)
    }
    const onDragEnd = () => setIsDragging(false)
    const onDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) setIsDragging(false)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('dragleave', onDragLeave)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('dragleave', onDragLeave)
    }
  }, [handleFile])

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <input
        ref={fileInputRef}
        type="file"
        accept={UNIFIED_IMPORT_ACCEPT}
        aria-label="Open a structure file"
        disabled={isImporting}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
          event.target.value = ''
        }}
        className="hidden"
      />

      <div className="pointer-events-auto max-w-[420px] px-6 text-center">
        <button
          type="button"
          disabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
          className="zatom-pressable rounded-md px-2 py-1 text-[13px] font-medium disabled:cursor-wait disabled:opacity-60"
          style={{ color: 'var(--panel-text-secondary)' }}
        >
          {isImporting ? 'Opening structure…' : EMPTY_PROMPT}
        </button>
        {feedback ? (
          <p className="mt-2 text-[11px] leading-4" role="alert" style={{ color: 'var(--status-red)' }}>
            {feedback.message}
          </p>
        ) : null}
      </div>

      {isDragging ? (
        <div
          className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-2xl border border-dashed"
          style={{ borderColor: 'var(--control-selected-border)', background: 'var(--control-selected-bg)' }}
        >
          <span className="text-[13px] font-medium" style={{ color: 'var(--control-selected-text)' }}>
            Drop file to open
          </span>
        </div>
      ) : null}
    </div>
  )
}
