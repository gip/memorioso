'use client'

import { Loader2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type DeleteDraftDialogProps = {
  open: boolean
  draftTitle?: string | null
  errorMessage?: string | null
  isDeleting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export const DeleteDraftDialog = ({
  open,
  draftTitle,
  errorMessage,
  isDeleting,
  onOpenChange,
  onConfirm,
}: DeleteDraftDialogProps) => {
  const title = draftTitle?.trim() || 'Untitled draft'

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isDeleting) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-w-[calc(100%_-_2rem)] rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete draft?</DialogTitle>
          <DialogDescription>
            &ldquo;{title}&rdquo; will be permanently deleted. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {errorMessage && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {isDeleting ? 'Deleting…' : 'Delete draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
