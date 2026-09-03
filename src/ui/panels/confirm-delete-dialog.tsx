import type { ReactNode } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../ui-kit/dialog'

export function ConfirmDeleteDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
}: {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  children: ReactNode
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-sm border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--panel-text)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-[var(--panel-text-secondary)]">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="zatom-choice zatom-pressable rounded-lg px-3 py-2 text-sm">
              Cancel
            </button>
          </DialogClose>
          <DialogClose asChild>
            <button
              type="button"
              onClick={onConfirm}
              className="zatom-pressable rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              {confirmLabel}
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
