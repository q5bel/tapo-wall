/**
 * Wire and domain types for `GET /api/cameras`.
 *
 * These mirror the server-side sanitized camera shape: the API never exposes
 * camera addresses, credentials or RTSP source URLs, only ids, names, status
 * and the local MediaMTX playback endpoints.
 */

/** Live status of one camera, derived from the MediaMTX path readiness. */
export type CameraStatus = 'online' | 'offline' | 'connecting'

/** Playback endpoints of a single stream variant. */
export interface CameraEndpoints {
  /** HLS playlist URL (`.m3u8`). */
  hls: string
  /** WebRTC (WHEP) endpoint URL. */
  webrtc: string
}

/** One camera exactly as the API returns it inside `cameras[]`. */
export interface CameraInfo {
  id: string
  name: string
  status: CameraStatus
  /** Low-latency, low-bandwidth stream used for the wall tiles. */
  preview: CameraEndpoints
  /** Full-quality stream. */
  hd: CameraEndpoints
}

/**
 * Camera as the UI consumes it.
 *
 * The client deliberately has no richer camera view than the sanitized one, so
 * this is the same shape the API sends.
 */
export type Camera = CameraInfo

/** Envelope of `GET /api/cameras`. */
export interface CamerasResponse {
  cameras: CameraInfo[]
}
