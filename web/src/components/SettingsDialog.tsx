import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DEFAULT_LAYOUT, type CameraLayout } from '@/lib/layout'
import type { CameraInput, CameraView, ConfigInput, ConfigView } from '@/lib/types'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editable view; `null` while it is still loading. */
  config: ConfigView | null
  /** Resolves after a successful PUT; throws on failure. */
  onSave: (input: ConfigInput) => Promise<void>
  saving: boolean
}

/** A camera being edited locally, plus a password the operator may have typed. */
interface EditableCamera extends CameraView {
  newPassword?: string
}

/** Form values for the camera currently being edited; `port` stays text. */
interface CameraDraft {
  id: string
  name: string
  host: string
  port: string
  username: string
  password: string
  hd: string
  preview: string
}

const NEW_ID = '__new__'

const ID_RE = /^[a-z0-9-]+$/i

function emptyDraft(): CameraDraft {
  return { id: '', name: '', host: '', port: '554', username: '', password: '', hd: '/stream1', preview: '/stream2' }
}

function draftFrom(camera: EditableCamera): CameraDraft {
  return {
    id: camera.id,
    name: camera.name,
    host: camera.host,
    port: String(camera.port),
    username: camera.username,
    password: camera.newPassword ?? '',
    hd: camera.streams.hd,
    preview: camera.streams.preview,
  }
}

/** Validate a draft; `isNew` requires a password. Returns human-readable errors. */
function validateDraft(draft: CameraDraft, isNew: boolean): string[] {
  const errors: string[] = []
  if (!ID_RE.test(draft.id)) errors.push('id: только латиница, цифры и дефисы')
  if (draft.name.trim().length === 0) errors.push('name: не может быть пустым')
  if (draft.host.trim().length === 0) errors.push('host: не может быть пустым')
  const port = Number(draft.port)
  if (!Number.isInteger(port) || port <= 0) errors.push('port: целое число > 0')
  if (draft.username.trim().length === 0) errors.push('username: не может быть пустым')
  if (isNew && draft.password.length === 0) errors.push('password: обязателен для новой камеры')
  if (draft.hd.trim().length === 0 || !draft.hd.startsWith('/')) errors.push('streams.hd: путь, начинающийся с «/»')
  if (draft.preview.trim().length === 0 || !draft.preview.startsWith('/')) errors.push('streams.preview: путь, начинающийся с «/»')
  return errors
}

/** A labeled text field; `type` and `placeholder` vary. */
function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <label className="font-medium text-muted-foreground">
        {label}
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </label>
      {hint ? <span className="text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

/**
 * Config editor: camera CRUD, optional access token and MediaMTX addresses.
 *
 * The operator edits a local copy and commits everything with one "Save". A
 * camera's password is only sent when a new value was typed; leaving the field
 * empty keeps the stored one (for a new camera it is an error).
 */
export function SettingsDialog({ open, onOpenChange, config, onSave, saving }: SettingsDialogProps) {
  const [cameras, setCameras] = useState<EditableCamera[]>([])
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CameraDraft>(emptyDraft())
  const [token, setToken] = useState('')
  const [mediamtx, setMediamtx] = useState<ConfigView['mediamtx']>({
    hlsAddress: ':8888',
    apiAddress: ':9997',
    webrtcAddress: ':8889',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Reset the working copy whenever the dialog is (re)opened with fresh data.
  useEffect(() => {
    if (!open || !config) return
    setCameras(config.cameras.map((camera) => ({ ...camera })))
    setDraftId(null)
    setDraft(emptyDraft())
    setToken('')
    setMediamtx({ ...config.mediamtx })
    setFormError(null)
    setSaveError(null)
  }, [open, config])

  const beginAdd = () => {
    setDraftId(NEW_ID)
    setDraft(emptyDraft())
    setFormError(null)
  }

  const beginEdit = (camera: EditableCamera) => {
    setDraftId(camera.id)
    setDraft(draftFrom(camera))
    setFormError(null)
  }

  const commitCamera = () => {
    const isNew = draftId === NEW_ID
    const errors = validateDraft(draft, isNew)

    // Reject an id that collides with a different camera already in the list.
    const duplicate = cameras.some((camera) => camera.id === draft.id && camera.id !== draftId)
    if (duplicate) errors.push(`id: камера «${draft.id}» уже существует`)

    if (errors.length > 0) {
      setFormError(errors.join('; '))
      return
    }

    const existing = cameras.find((camera) => camera.id === draftId)
    const layout: CameraLayout = existing?.layout ?? DEFAULT_LAYOUT

    const next: EditableCamera = {
      id: draft.id,
      name: draft.name,
      host: draft.host,
      port: Number(draft.port),
      username: draft.username,
      passwordSet: draft.password.length > 0 || (existing?.passwordSet ?? false),
      newPassword: draft.password.length > 0 ? draft.password : undefined,
      streams: { hd: draft.hd, preview: draft.preview },
      layout,
    }

    setCameras((prev) => {
      if (isNew) {
        return [...prev, next]
      }
      return prev.map((camera) => (camera.id === draftId ? next : camera))
    })

    setDraftId(null)
    setDraft(emptyDraft())
    setFormError(null)
  }

  const removeCamera = (id: string) => {
    setCameras((prev) => prev.filter((camera) => camera.id !== id))
    if (draftId === id) {
      setDraftId(null)
      setDraft(emptyDraft())
    }
  }

  const buildInput = (): ConfigInput => ({
    cameras: cameras.map<CameraInput>((camera) => {
      const input: CameraInput = {
        id: camera.id,
        name: camera.name,
        host: camera.host,
        port: camera.port,
        username: camera.username,
        streams: { hd: camera.streams.hd, preview: camera.streams.preview },
        layout: camera.layout,
      }
      if (camera.newPassword) input.password = camera.newPassword
      return input
    }),
    auth: { token: token.trim().length > 0 ? token.trim() : null },
    mediamtx: {
      hlsAddress: mediamtx.hlsAddress,
      apiAddress: mediamtx.apiAddress,
      webrtcAddress: mediamtx.webrtcAddress,
    },
  })

  const submit = async () => {
    setSaveError(null)
    try {
      await onSave(buildInput())
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Не удалось сохранить')
    }
  }

  const editing = draftId !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Настройки</DialogTitle>
          <DialogDescription>
            Камеры, доступ к редактированию и адреса MediaMTX. Пароль камеры виден только как «••••» и
            отправляется заново, лишь если ввести новый.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* Cameras */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Камеры</h2>
            <ul className="flex flex-col gap-1.5">
              {cameras.map((camera) => (
                <li key={camera.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{camera.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {camera.host}:{camera.port}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => beginEdit(camera)}>
                      Изменить
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeCamera(camera.id)}>
                      Удалить
                    </Button>
                  </div>
                </li>
              ))}
              {cameras.length === 0 && <li className="text-sm text-muted-foreground">Нет камер</li>}
            </ul>
            {!editing ? (
              <div>
                <Button variant="outline" size="sm" onClick={beginAdd}>
                  Добавить камеру
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-md border p-3">
                <h3 className="text-sm font-medium">{draftId === NEW_ID ? 'Новая камера' : 'Изменить камеру'}</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="id" value={draft.id} onChange={(v) => setDraft((d) => ({ ...d, id: v }))} />
                  <Field label="name" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
                  <Field label="host" value={draft.host} onChange={(v) => setDraft((d) => ({ ...d, host: v }))} placeholder="192.168.1.101" />
                  <Field label="port" value={draft.port} onChange={(v) => setDraft((d) => ({ ...d, port: v }))} type="number" />
                  <Field label="username" value={draft.username} onChange={(v) => setDraft((d) => ({ ...d, username: v }))} />
                  <Field
                    label="password"
                    type="password"
                    value={draft.password}
                    onChange={(v) => setDraft((d) => ({ ...d, password: v }))}
                    placeholder={draftId === NEW_ID ? 'пароль' : '•••• (пусто — не менять)'}
                  />
                  <Field label="streams.hd" value={draft.hd} onChange={(v) => setDraft((d) => ({ ...d, hd: v }))} />
                  <Field label="streams.preview" value={draft.preview} onChange={(v) => setDraft((d) => ({ ...d, preview: v }))} />
                </div>
                {formError && <p className="text-xs text-destructive">{formError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={commitCamera}>
                    Сохранить камеру
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setDraftId(null); setFormError(null) }}>
                    Отмена
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Access token */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Защита</h2>
            <Field
              label="Токен доступа"
              type="password"
              value={token}
              onChange={setToken}
              placeholder={config?.authEnabled ? 'задан (пусто — отключить)' : 'пусто — без защиты'}
              hint="Пока токен задан, редактирование настроек требует его в заголовке запроса."
            />
          </section>

          {/* MediaMTX */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">MediaMTX</h2>
            <div className="grid grid-cols-3 gap-2">
              <Field label="HLS" value={mediamtx.hlsAddress} onChange={(v) => setMediamtx((m) => ({ ...m, hlsAddress: v }))} />
              <Field label="API" value={mediamtx.apiAddress} onChange={(v) => setMediamtx((m) => ({ ...m, apiAddress: v }))} />
              <Field label="WebRTC" value={mediamtx.webrtcAddress ?? ''} onChange={(v) => setMediamtx((m) => ({ ...m, webrtcAddress: v }))} />
            </div>
            <p className="text-xs text-muted-foreground">Порт интерфейса (httpPort) задаётся при запуске и здесь не меняется.</p>
          </section>

          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить настройки'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
