import Hls from 'hls.js'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Backoff schedule for fatal stream errors, in milliseconds.
 *
 * The last entry is reused for every further attempt, so a stream that stays
 * down is retried at a steady 10s interval instead of backing off forever.
 */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000]

/** Autoplay is best-effort: a rejected promise is expected and not an error. */
const noop = () => {}

export interface VideoPlayerProps {
  /** HLS playlist URL (`.m3u8`). */
  src: string
  /** Muted is required for reliable autoplay; defaults to `true`. */
  muted?: boolean
  className?: string
}

/**
 * Plays an HLS stream with automatic recovery.
 *
 * Uses `hls.js` wherever Media Source Extensions are available and falls back
 * to the native player (Safari/iOS) otherwise. A camera that is offline never
 * throws: fatal errors are swallowed, retried with an exponential backoff, and
 * the element simply stays a black rectangle until the stream comes back.
 */
export function VideoPlayer({ src, muted = true, className }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current

    if (!video || !src) {
      return
    }

    // No MSE: native HLS only (Safari, iOS). The browser handles reconnects.
    if (!Hls.isSupported()) {
      video.src = src
      video.play().catch(noop)

      return () => {
        video.removeAttribute('src')
        video.load()
      }
    }

    const hls = new Hls()
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryAttempt = 0
    let disposed = false

    const clearRetry = () => {
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
    }

    /** Reload the same source after the next backoff delay. */
    const scheduleReconnect = () => {
      if (disposed || retryTimer !== undefined) {
        return
      }

      const delay =
        RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)]
      retryAttempt += 1

      retryTimer = setTimeout(() => {
        retryTimer = undefined

        if (disposed) {
          return
        }

        // A fatal error has already torn down the pipeline; reloading the
        // source is the cheapest recovery and covers all fatal error classes.
        hls.loadSource(src)
      }, delay)
    }

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      retryAttempt = 0
      video.play().catch(noop)
    })

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        scheduleReconnect()
      }
    })

    hls.loadSource(src)
    hls.attachMedia(video)

    return () => {
      disposed = true
      clearRetry()
      hls.destroy()
    }
  }, [src])

  return (
    <video
      ref={videoRef}
      autoPlay
      muted={muted}
      playsInline
      className={cn('bg-muted', className)}
    />
  )
}
