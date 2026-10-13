/**
 * Wire and domain types for the tapo-wall API.
 *
 * Two shapes come from the server:
 * - `GET /api/cameras` → `CameraInfo[]`: the secret-free list the wall renders.
 * - `GET /api/config` → `ConfigView`: the editable config the settings dialog
 *   edits and `PUT /api/config` → `ConfigInput` sends back.
 *
 * Passwords never leave the server: the view carries only `passwordSet`, and
 * the input carries `password` only when the operator typed a new one.
 */

import type { CameraLayout } from './layout'

/** Live status of one camera, derived from the MediaMTX path readiness. */
export type CameraStatus = 'online' | 'offline' | 'connecting'

/** Playback endpoints of a single stream variant. */
export interface CameraEndpoints {
  /** HLS playlist URL (`.m3u8`). */
  hls: string
  /** WebRTC (WHEP) endpoint URL. */
  webrtc: string
}

/** One camera exactly as `GET /api/cameras` returns it inside `cameras[]`. */
export interface CameraInfo {
  id: string
  name: string
  status: CameraStatus
  /** Free-form placement of the tile on the canvas. */
  layout: CameraLayout
  /** Low-latency, low-bandwidth stream used for the wall tiles. */
  preview: CameraEndpoints
  /** Full-quality stream. */
  hd: CameraEndpoints
}

/** Camera as the UI consumes it on the wall. */
export type Camera = CameraInfo

/** Envelope of `GET /api/cameras`. */
export interface CamerasResponse {
  cameras: CameraInfo[]
}

/** One camera in the editable config view; the password is masked away. */
export interface CameraView {
  id: string
  name: string
  host: string
  port: number
  username: string
  passwordSet: boolean
  streams: { hd: string; preview: string }
  layout: CameraLayout
}

/** Editable, secret-free view of the whole config (`GET /api/config`). */
export interface ConfigView {
  httpPort: number
  authEnabled: boolean
  mediamtx: { hlsAddress: string; apiAddress: string; webrtcAddress?: string }
  cameras: CameraView[]
}

/** One camera as accepted by `PUT /api/config`. */
export interface CameraInput {
  id: string
  name: string
  host: string
  port: number
  username: string
  /** Only sent when the operator typed a new password. */
  password?: string
  streams: { hd: string; preview: string }
  layout?: CameraLayout
}

/** Partial patch accepted by `PUT /api/config`. */
export interface ConfigInput {
  /** A non-empty token installs it; `null`/empty disables the gate. */
  auth?: { token?: string | null }
  mediamtx?: { hlsAddress?: string; apiAddress?: string; webrtcAddress?: string }
  cameras?: CameraInput[]
}

/** Successful `PUT /api/config` response. */
export interface SaveConfigResult {
  ok: boolean
  warnings: string[]
}
