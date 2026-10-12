import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusBadge } from '@/components/StatusBadge'
import { VideoPlayer } from '@/components/VideoPlayer'
import type { Camera } from '@/lib/types'

interface CameraDialogProps {
  /** Camera to show full screen, or `null` while the dialog is closed. */
  camera: Camera | null
  /** Next open state, reported for the close button, the overlay and Escape. */
  onOpenChange: (open: boolean) => void
}

/**
 * Full-screen view of a single camera.
 *
 * The dialog is controlled from above, so the opened camera *is* the state and
 * the whole wall shares one instance. Radix owns the overlay click, Escape and
 * the focus trap; `DialogTitle` keeps the dialog announced to screen readers,
 * and the explicit footer `DialogClose` is the visible way out.
 */
export function CameraDialog({ camera, onOpenChange }: CameraDialogProps) {
  return (
    <Dialog open={camera !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl sm:max-w-5xl">
        {camera !== null && (
          <>
            <DialogHeader className="pr-10">
              <DialogTitle className="truncate" title={camera.name}>
                {camera.name}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <StatusBadge status={camera.status} />
                <span>Полноэкранный HD-поток</span>
              </DialogDescription>
            </DialogHeader>
            <VideoPlayer
              src={camera.hd.hls}
              className="aspect-video w-full rounded-lg object-contain"
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Закрыть</Button>
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
