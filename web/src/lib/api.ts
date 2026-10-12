import type { Camera, CamerasResponse } from '@/lib/types'

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
