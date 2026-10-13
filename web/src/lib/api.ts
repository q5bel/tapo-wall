import type {
  Camera,
  CamerasResponse,
  ConfigInput,
  ConfigView,
  SaveConfigResult,
} from '@/lib/types'

/**
 * Load the sanitized camera list.
 *
 * In dev the request goes to the Vite dev server and is proxied to the backend
 * on `http://localhost:3000` (see `vite.config.ts`); in production the same
 * origin serves both the app and `/api`.
 *
 * @param signal Optional abort signal; pass one to drop the request when the
 *   component that issued it unmounts.
 * @throws If the response status is not ok.
 */
export async function fetchCameras(signal?: AbortSignal): Promise<Camera[]> {
  const response = await fetch('/api/cameras', { signal })

  if (!response.ok) {
    throw new Error(
      `Не удалось получить список камер: ${response.status} ${response.statusText}`,
    )
  }

  const data = (await response.json()) as CamerasResponse

  return data.cameras
}

/**
 * Thrown when a config request is rejected because the configured access token
 * is missing or wrong. The caller should prompt for the token and retry.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
    this.name = 'UnauthorizedError'
  }
}

/** Header carrying the optional access token; empty when no token is set. */
function authHeaders(token?: string): Record<string, string> {
  return token ? { 'x-tapo-token': token } : {}
}

/**
 * Load the editable, secret-free config view.
 *
 * @throws UnauthorizedError on 401, Error otherwise when the status is not ok.
 */
export async function fetchConfig(token?: string): Promise<ConfigView> {
  const response = await fetch('/api/config', { headers: authHeaders(token) })

  if (response.status === 401) {
    throw new UnauthorizedError()
  }
  if (!response.ok) {
    throw new Error(`Не удалось загрузить настройки: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as ConfigView
}

/**
 * Persist a config patch.
 *
 * @throws UnauthorizedError on 401, Error with the server's message otherwise.
 */
export async function saveConfig(
  input: ConfigInput,
  token?: string,
): Promise<SaveConfigResult> {
  const response = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(input),
  })

  if (response.status === 401) {
    throw new UnauthorizedError()
  }

  const data = (await response.json()) as SaveConfigResult & { error?: string }

  if (!response.ok) {
    throw new Error(data.error ?? `Не удалось сохранить настройки: ${response.status}`)
  }

  return data
}
