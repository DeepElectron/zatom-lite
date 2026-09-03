import type { ReactNode } from 'react'
import { ConfirmDeleteDialog } from './confirm-delete-dialog'

export function BatchDeleteDialog({
  batchName,
  assetCount,
  onConfirm,
  children,
}: {
  batchName: string
  assetCount: number
  onConfirm: () => void
  children: ReactNode
}) {
  return (
    <ConfirmDeleteDialog
      title={`Delete “${batchName}”?`}
      description={assetCount === 0
        ? 'This empty Batch will be removed.'
        : `This permanently removes ${assetCount} Asset${assetCount === 1 ? '' : 's'} stored only in this Batch.`}
      confirmLabel="Delete Batch"
      onConfirm={onConfirm}
    >
      {children}
    </ConfirmDeleteDialog>
  )
}
