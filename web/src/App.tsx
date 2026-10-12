import { useEffect, useState } from 'react'
import { RotateCwIcon, TriangleAlertIcon, VideoOffIcon } from 'lucide-react'
import { CameraDialog } from '@/components/CameraDialog'
import { CameraGrid } from '@/components/CameraGrid'
import { CameraGridSkeleton } from '@/components/CameraGridSkeleton'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { fetchCameras } from '@/lib/api'
import type { Camera } from '@/lib/types'

/** What the main section currently shows. */
type CamerasState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; cameras: Camera[] }

export default function App() {
  const [state, setState] = useState<CamerasState>({ status: 'loading' })
  const [selected, setSelected] = useState<Camera | null>(null)
  // Bumped by "Повторить" to re-run the fetch below.
  const [requestId, setRequestId] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    fetchCameras(controller.signal)
      .then((cameras) => {
        setState({ status: 'ready', cameras })
      })
      .catch((error: unknown) => {
        // A fetch aborted by the cleanup below is not a failure to report.
        if (controller.signal.aborted) {
          return
        }

        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Неизвестная ошибка',
        })
      })

    return () => {
      controller.abort()
    }
  }, [requestId])

  /** Start over: back to the skeleton, with any open camera closed. */
  const reload = () => {
    setSelected(null)
    setState({ status: 'loading' })
    setRequestId((id) => id + 1)
  }

  const cameras = state.status === 'ready' ? state.cameras : []
  const onlineCount = cameras.filter((camera) => camera.status === 'online').length

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-7xl items-start justify-between gap-4 px-6 py-5">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-medium">Tapo Wall</h1>
          <p className="text-sm text-muted-foreground">
            Локальная стена камер Tapo
          </p>
        </div>
        {cameras.length > 0 && (
          <Badge variant="secondary">
            Онлайн {onlineCount} из {cameras.length}
          </Badge>
        )}
      </header>
      <Separator />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6">
        {state.status === 'loading' && <CameraGridSkeleton />}

        {state.status === 'error' && (
          <Alert variant="destructive" className="mx-auto w-full max-w-2xl">
            <TriangleAlertIcon />
            <AlertTitle>Не удалось загрузить камеры</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm" onClick={reload}>
                <RotateCwIcon data-icon="inline-start" />
                Повторить
              </Button>
            </AlertAction>
          </Alert>
        )}

        {state.status === 'ready' &&
          (cameras.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <VideoOffIcon />
                </EmptyMedia>
                <EmptyTitle>Нет камер</EmptyTitle>
                <EmptyDescription>
                  Заполни config/cameras.json и перезапусти
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <CameraGrid cameras={cameras} onSelect={setSelected} />
          ))}
      </main>
      <CameraDialog
        camera={selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null)
          }
        }}
      />
    </div>
  )
}
