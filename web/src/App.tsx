import { useEffect, useRef, useState } from 'react'
import { RotateCwIcon, TriangleAlertIcon, VideoOffIcon } from 'lucide-react'
import { CameraCanvas } from '@/components/CameraCanvas'
import { CameraDialog } from '@/components/CameraDialog'
import { CameraGridSkeleton } from '@/components/CameraGridSkeleton'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Toolbar } from '@/components/Toolbar'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { UnauthorizedError, fetchCameras, fetchConfig, saveConfig } from '@/lib/api'
import { autoArrange, DEFAULT_LAYOUT, type CameraLayout } from '@/lib/layout'
import type { Camera, ConfigInput, ConfigView } from '@/lib/types'

/** What the wall section currently shows. */
type CamerasState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; cameras: Camera[] }

const TOKEN_KEY = 'tapo-wall.token'
const LAYOUT_SAVE_DELAY_MS = 500

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // localStorage may be unavailable; the token then lives for this session only.
  }
}

export default function App() {
  const [state, setState] = useState<CamerasState>({ status: 'loading' })
  const [config, setConfig] = useState<ConfigView | null>(null)
  const [layouts, setLayouts] = useState<Record<string, CameraLayout>>({})
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Camera | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [token, setToken] = useState(readToken)
  const [configError, setConfigError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [requestId, setRequestId] = useState(0)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configRef = useRef<ConfigView | null>(config)
  configRef.current = config

  // Cameras: the secret-free wall list (never requires a token).
  useEffect(() => {
    const controller = new AbortController()

    fetchCameras(controller.signal)
      .then((cameras) => setState({ status: 'ready', cameras }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Неизвестная ошибка',
        })
      })

    return () => controller.abort()
  }, [requestId])

  // Config: the editable view (gated by the token when one is set).
  useEffect(() => {
    let cancelled = false

    fetchConfig(token || undefined)
      .then((cfg) => {
        if (cancelled) return
        setConfig(cfg)
        setLayouts(Object.fromEntries(cfg.cameras.map((camera) => [camera.id, camera.layout])))
        setConfigError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setConfig(null)
        setConfigError(error instanceof UnauthorizedError ? 'token' : (error as Error).message)
      })

    return () => {
      cancelled = true
    }
  }, [requestId, token])

  /** Ask the operator for the access token and retry the config load. */
  const promptForToken = () => {
    const entered = window.prompt('Введите токен доступа для редактирования')
    if (entered === null) return
    storeToken(entered)
    setToken(entered)
    setRequestId((id) => id + 1)
  }

  const reload = () => {
    setSelected(null)
    setState({ status: 'loading' })
    setRequestId((id) => id + 1)
  }

  const cancelPendingSave = () => {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
  }

  /** Persist only the layout (passwords and other sections stay untouched). */
  const persistLayout = (next: Record<string, CameraLayout>) => {
    setLayouts(next)
    cancelPendingSave()

    const cfg = configRef.current
    if (!cfg) return

    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null
      const input: ConfigInput = {
        cameras: cfg.cameras.map((camera) => ({
          id: camera.id,
          name: camera.name,
          host: camera.host,
          port: camera.port,
          username: camera.username,
          streams: camera.streams,
          layout: next[camera.id] ?? camera.layout,
        })),
      }
      try {
        const result = await saveConfig(input, token || undefined)
        setWarnings(result.warnings)
      } catch (error) {
        if (error instanceof UnauthorizedError) promptForToken()
      }
    }, LAYOUT_SAVE_DELAY_MS)
  }

  const handleAutoArrange = () => {
    const ids = state.status === 'ready' ? state.cameras.map((camera) => camera.id) : []
    if (ids.length === 0) return
    persistLayout(autoArrange(ids))
  }

  const openSettings = () => {
    if (!configRef.current) {
      promptForToken()
      return
    }
    setSettingsOpen(true)
  }

  const handleSaveSettings = async (input: ConfigInput) => {
    setSaving(true)
    try {
      const result = await saveConfig(input, token || undefined)
      setWarnings(result.warnings)
      setSettingsOpen(false)
      cancelPendingSave()
      setRequestId((id) => id + 1) // re-read cameras + config
    } catch (error) {
      setSaving(false)
      if (error instanceof UnauthorizedError) {
        setSettingsOpen(false)
        promptForToken()
        return
      }
      throw error // the dialog shows the message
    } finally {
      setSaving(false)
    }
  }

  const cameras = state.status === 'ready' ? state.cameras : []
  const onlineCount = cameras.filter((camera) => camera.status === 'online').length
  const layoutFor = (camera: Camera): CameraLayout => layouts[camera.id] ?? camera.layout ?? DEFAULT_LAYOUT

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-7xl items-start justify-between gap-4 px-6 py-5">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-medium">Tapo Wall</h1>
          <p className="text-sm text-muted-foreground">Локальная стена камер Tapo</p>
        </div>
        <Toolbar
          mode={mode}
          onModeChange={setMode}
          onlineCount={onlineCount}
          totalCount={cameras.length}
          onAutoArrange={handleAutoArrange}
          onOpenSettings={openSettings}
        />
      </header>
      <Separator />

      {configError && (
        <div className="mx-auto w-full max-w-7xl px-6 pt-4">
          {configError === 'token' ? (
            <Alert variant="default">
              <TriangleAlertIcon />
              <AlertTitle>Редактирование защищено токеном</AlertTitle>
              <AlertDescription>Введите токен доступа, чтобы менять камеры и раскладку.</AlertDescription>
              <AlertAction>
                <Button variant="outline" size="sm" onClick={promptForToken}>
                  Ввести токен
                </Button>
              </AlertAction>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Не удалось загрузить настройки</AlertTitle>
              <AlertDescription>{configError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mx-auto w-full max-w-7xl px-6 pt-4">
          <Alert variant="default">
            <TriangleAlertIcon />
            <AlertTitle>MediaMTX перезапустился с предупреждениями</AlertTitle>
            <AlertDescription>{warnings.join(' ')}</AlertDescription>
          </Alert>
        </div>
      )}

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
                <EmptyDescription>Добавьте первую камеру через «Настройки»</EmptyDescription>
              </EmptyHeader>
              <Button variant="outline" onClick={openSettings}>
                Добавить камеру
              </Button>
            </Empty>
          ) : (
            <div className="flex-1">
              <CameraCanvas
                cameras={cameras}
                layouts={Object.fromEntries(cameras.map((camera) => [camera.id, layoutFor(camera)]))}
                mode={mode}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onOpen={setSelected}
                onLayoutsChange={persistLayout}
              />
            </div>
          ))}
      </main>

      <CameraDialog
        camera={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={config}
        onSave={handleSaveSettings}
        saving={saving}
      />
    </div>
  )
}
